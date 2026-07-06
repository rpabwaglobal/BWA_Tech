# Gera dump do PostgreSQL na VPS e baixa para backend/dump_banco_prod/.
# Requer OpenSSH (ssh/scp) no Windows e acesso SSH à VPS.
#
# Uso (na raiz do repositório):
#   $env:BWA_VPS_HOST = "IP_DA_VPS"
#   .\scripts\fetch-prod-dump.ps1
#
#   .\scripts\fetch-prod-dump.ps1 -VpsHost 203.0.113.10 -Restore
#
# Variáveis de ambiente opcionais:
#   BWA_VPS_HOST, BWA_VPS_USER (default root), BWA_VPS_SSH_PORT (default 22)
#   BWA_VPS_REMOTE_DIR (default /opt/bwa_tech)

param(
    [string] $VpsHost = $env:BWA_VPS_HOST,
    [string] $VpsUser = $(if ($env:BWA_VPS_USER) { $env:BWA_VPS_USER } else { 'root' }),
    [int] $SshPort = $(if ($env:BWA_VPS_SSH_PORT) { [int]$env:BWA_VPS_SSH_PORT } else { 22 }),
    [string] $RemoteDir = $(if ($env:BWA_VPS_REMOTE_DIR) { $env:BWA_VPS_REMOTE_DIR } else { '/opt/bwa_tech' }),
    [switch] $Restore
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $scriptDir
$localDir = Join-Path $root 'backend\dump_banco_prod'

if (-not $VpsHost) {
    throw @"
Defina o IP da VPS:
  `$env:BWA_VPS_HOST = 'SEU_IP'
  .\scripts\fetch-prod-dump.ps1

Ou passe -VpsHost diretamente.
"@
}

if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) {
    throw 'Comando ssh não encontrado. Instale o cliente OpenSSH (Configurações → Aplicativos → Recursos opcionais).'
}
if (-not (Get-Command scp -ErrorAction SilentlyContinue)) {
    throw 'Comando scp não encontrado. Instale o cliente OpenSSH.'
}

New-Item -ItemType Directory -Force -Path $localDir | Out-Null

$sshTarget = "${VpsUser}@${VpsHost}"
$sshArgs = @('-p', "$SshPort", $sshTarget)
$scpArgs = @('-P', "$SshPort")

Write-Host "Gerando dump em ${sshTarget}:${RemoteDir} ..."
$remoteCmd = @"
set -euo pipefail
cd '$RemoteDir'
export COMPOSE_PROJECT_NAME=bwa_tech
bash scripts/dump-prod-postgres.sh
ls -t backups/bwaproj_prod_*.dump.gz 2>/dev/null | head -1
"@

$remoteRelative = (ssh @sshArgs $remoteCmd).Trim()
if (-not $remoteRelative) {
    throw 'Dump não encontrado no servidor após execução do script.'
}

$remoteFile = "$RemoteDir/$remoteRelative"
$leaf = Split-Path -Leaf $remoteRelative
$localPath = Join-Path $localDir $leaf

Write-Host "Baixando $remoteFile ..."
scp @scpArgs "${sshTarget}:${remoteFile}" $localPath

Write-Host "Dump salvo em: $localPath"

if ($Restore) {
    Write-Host "Restaurando no Postgres local (Docker)..."
    & (Join-Path $scriptDir 'restore-dump-banco-prod.ps1') -DumpPath $localPath
} else {
    Write-Host @"

Para restaurar no banco local:
  .\scripts\restore-dump-banco-prod.ps1

Ou com este ficheiro:
  .\scripts\restore-dump-banco-prod.ps1 -DumpPath '$localPath'
"@
}
