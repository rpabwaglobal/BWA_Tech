# ===========================================================================
#  BWA Tech - BACKEND (Django) em desenvolvimento.
#
#  Chamado por `.bat\BWA Tech - Backend.bat`, que so prepara o console. Mesma
#  divisao do dump de producao: o `.bat` cuida da janela, o PowerShell cuida do
#  trabalho e da aparencia.
#
#  UM PROCESSO, EM PRIMEIRO PLANO. O iniciador antigo ("Iniciar BWA Tech
#  (dev).bat") abre cinco janelas de uma vez com `start`, o que devolve o
#  controle na hora - um gerenciador de processos acharia que tudo terminou bem
#  com os servidores rodando soltos. Aqui o servidor e a ultima coisa que roda, e
#  o processo so termina quando ele termina.
#
#  E POR ISSO NAO HA PERGUNTA NENHUMA AQUI. Quem gerencia o processo nao tem
#  teclado para atender; qualquer `Read-Host` prenderia o servico para sempre.
# ===========================================================================
[CmdletBinding()]
param(
    # Sobe o servidor sem aplicar migracoes. Util quando se sabe que o banco ja
    # esta em dia e se quer o servidor no ar em segundos.
    [switch] $SemMigrar
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\estilo-console.ps1"

$raiz = Split-Path -Parent $PSScriptRoot

Escrever-Regua ('BWA TECH ' + $PONTO + ' backend em desenvolvimento')

# ── Docker ──────────────────────────────────────────────────────────────
Escrever-Passo 'Docker'
docker info 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Escrever-Info 'parado; abrindo o Docker Desktop'
    $exe = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
    if (Test-Path $exe) { Start-Process $exe | Out-Null }

    # ESPERA LIMITADA, e nao laco infinito. O iniciador antigo repete o teste
    # para sempre; num gerenciador isso vira um servico que nunca sobe nem
    # falha, e ninguem descobre o porque.
    $limite = (Get-Date).AddMinutes(2)
    do {
        Start-Sleep -Seconds 5
        docker info 2>&1 | Out-Null
    } while ($LASTEXITCODE -ne 0 -and (Get-Date) -lt $limite)

    if ($LASTEXITCODE -ne 0) {
        Escrever-Erro 'O Docker nao respondeu em 2 minutos.' 'Abra o Docker Desktop e rode de novo.'
        exit 1
    }
    Escrever-Passo 'Docker'
}
Escrever-Fim 'no ar'

# ── Postgres e Redis ────────────────────────────────────────────────────
Escrever-Passo 'Postgres e Redis'
Push-Location $raiz
try {
    docker compose up -d db redis 2>&1 | Out-Null
    $subiu = $LASTEXITCODE -eq 0
} finally {
    Pop-Location
}
if (-not $subiu) {
    Write-Host ''
    Escrever-Erro 'Falha ao subir os containers de banco/redis.' 'Veja: docker compose logs db'
    exit 1
}

# O Django nao sobe sem banco. Esperar aqui alguns segundos evita uma falha
# que so apareceria adiante, como erro de conexao, sem apontar a causa.
$limite = (Get-Date).AddMinutes(2)
do {
    $saude = (docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}sem-health{{end}}' bwa_tech-db-1 2>$null | Out-String).Trim()
    if ($saude -eq 'healthy') { break }
    Start-Sleep -Seconds 2
} while ((Get-Date) -lt $limite)

if ($saude -ne 'healthy') {
    Write-Host ''
    Escrever-Erro "O banco nao ficou saudavel em 2 minutos (estado: $saude)." 'Veja: docker compose logs db'
    exit 1
}
Escrever-Fim 'prontos'

# ── Migracoes ───────────────────────────────────────────────────────────
Set-Location (Join-Path $raiz 'backend')

if (-not $SemMigrar) {
    Escrever-Passo 'Migracoes'
    Write-Host ''
    # SAIDA VISIVEL, e nao engolida: migracao e o unico passo daqui que MUDA o
    # banco. Esconder o que ela fez, para a tela ficar bonita, e o tipo de
    # economia que custa caro no dia em que algo sai errado.
    python manage.py migrate
    if ($LASTEXITCODE -ne 0) {
        Escrever-Erro 'As migracoes falharam. O servidor NAO foi iniciado.'
        exit 1
    }
    Escrever-Fim 'aplicadas'
}

# ── Servidor ────────────────────────────────────────────────────────────
Escrever-Servico 'http://127.0.0.1:8000' 'Backend em'

# ULTIMA LINHA, DE PROPOSITO: o codigo de saida do runserver vira o do script, e
# quem gerencia o processo enxerga a queda.
python manage.py runserver 127.0.0.1:8000
exit $LASTEXITCODE
