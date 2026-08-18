# Gera o dump do PostgreSQL na VPS e baixa para backend/dump_banco_prod/.
# Com -Restore, sobe o dump no Postgres de desenvolvimento na sequencia.
#
# Uso (na raiz do repositorio):
#   $env:BWA_VPS_HOST = "IP_DA_VPS"
#   .\scripts\fetch-prod-dump.ps1 -Restore
#
#   .\scripts\fetch-prod-dump.ps1 -VpsHost 203.0.113.10 -Restore
#
# Variaveis de ambiente opcionais:
#   BWA_VPS_HOST, BWA_VPS_USER (default root), BWA_VPS_SSH_PORT (default 22)
#   BWA_VPS_REMOTE_DIR (default /opt/bwa_tech)
#
# ESTE ARQUIVO E UTF-8 COM BOM, E ISSO NAO E DETALHE DE EDITOR.
# O Windows so tem PowerShell 5.1, que le arquivo sem BOM como CP1252. Um
# travessao ou uma seta dentro de string vira 3 caracteres, e um deles e aspa:
# a string fecha no meio e o arquivo inteiro deixa de fazer parse. Foi
# exatamente o que aconteceu aqui - a seta em "Configuracoes -> Aplicativos"
# quebrava o script antes da primeira linha rodar. Ao editar, mantenha o BOM.

param(
    [string] $VpsHost = $env:BWA_VPS_HOST,
    [string] $VpsUser = $(if ($env:BWA_VPS_USER) { $env:BWA_VPS_USER } else { 'root' }),
    [int] $SshPort = $(if ($env:BWA_VPS_SSH_PORT) { [int]$env:BWA_VPS_SSH_PORT } else { 22 }),
    [string] $RemoteDir = $(if ($env:BWA_VPS_REMOTE_DIR) { $env:BWA_VPS_REMOTE_DIR } else { '/opt/bwa_tech' }),
    [switch] $Restore,
    [switch] $Force
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $scriptDir
$localDir = Join-Path $root 'backend\dump_banco_prod'

if (-not $VpsHost) {
    throw @"
Defina o IP da VPS:
  `$env:BWA_VPS_HOST = 'SEU_IP'
  .\scripts\fetch-prod-dump.ps1 -Restore

Ou passe -VpsHost diretamente.
"@
}

foreach ($cmd in @('ssh', 'scp')) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        throw "Comando $cmd nao encontrado. Instale o cliente OpenSSH pelo menu Configuracoes, Aplicativos, Recursos opcionais."
    }
}

New-Item -ItemType Directory -Force -Path $localDir | Out-Null

$sshTarget = "${VpsUser}@${VpsHost}"
$sshArgs = @('-p', "$SshPort", $sshTarget)
$scpArgs = @('-P', "$SshPort")

Write-Host "Gerando dump em ${sshTarget}:${RemoteDir} ..." -ForegroundColor Cyan
$remoteCmd = @"
set -euo pipefail
cd '$RemoteDir'
export COMPOSE_PROJECT_NAME=bwa_tech
bash scripts/dump-prod-postgres.sh
"@

$saidaRemota = ssh @sshArgs $remoteCmd
if ($LASTEXITCODE -ne 0) {
    throw "A geracao do dump falhou na VPS (codigo $LASTEXITCODE). Saida acima."
}

# O NOME DO ARQUIVO VEM DA LINHA 'DUMP_FILE=', NAO DA SAIDA INTEIRA.
# dump-prod-postgres.sh imprime nove linhas em stdout (projeto do compose,
# progresso, instrucoes de copia). A versao anterior fazia
# (ssh ...).Trim() e usava tudo como se fosse o caminho: em PowerShell a
# saida do ssh e um ARRAY, e interpolar array numa string junta as linhas com
# espaco. O scp recebia "/opt/bwa_tech/Compose project: bwa_tech Gerando ..."
# e nunca podia funcionar. A linha DUMP_FILE= existe no shell script
# justamente para ser lida por maquina; e o contrato entre os dois.
$linhaDump = $saidaRemota | Where-Object { $_ -match '^\s*DUMP_FILE=' } | Select-Object -Last 1
if (-not $linhaDump) {
    Write-Host ($saidaRemota -join "`n")
    throw "A VPS nao devolveu a linha DUMP_FILE=. Veja a saida acima."
}
$remoteRelative = ($linhaDump -replace '^\s*DUMP_FILE=', '').Trim()

$remoteFile = "$RemoteDir/$remoteRelative"
$leaf = Split-Path -Leaf $remoteRelative
$localPath = Join-Path $localDir $leaf

Write-Host "Baixando $remoteFile ..." -ForegroundColor Cyan
scp @scpArgs "${sshTarget}:${remoteFile}" $localPath
if ($LASTEXITCODE -ne 0) {
    throw "scp falhou (codigo $LASTEXITCODE)."
}
if (-not (Test-Path -LiteralPath $localPath)) {
    throw "O scp terminou sem erro mas o arquivo nao chegou: $localPath"
}

$tamanho = (Get-Item -LiteralPath $localPath).Length
Write-Host ("Dump salvo em: {0} ({1:N1} MB)" -f $localPath, ($tamanho / 1MB)) -ForegroundColor Green

if ($tamanho -lt 1024) {
    throw "O dump tem apenas $tamanho bytes. Isso nao e um banco - verifique a saida da VPS antes de restaurar."
}

if ($Restore) {
    $argumentos = @{ DumpPath = $localPath }
    if ($Force) { $argumentos['Force'] = $true }
    & (Join-Path $scriptDir 'restore-local-docker.ps1') @argumentos
} else {
    Write-Host @"

Para restaurar no banco local:
  .\scripts\restore-dump-banco-prod.ps1

Ou com este arquivo:
  .\scripts\restore-dump-banco-prod.ps1 -DumpPath '$localPath'
"@
}
