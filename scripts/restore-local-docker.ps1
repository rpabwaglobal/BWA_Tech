# Restaura um dump de producao no PostgreSQL local (Docker Compose deste repo).
#
# Uso (PowerShell, na raiz do projeto):
#   .\scripts\restore-local-docker.ps1 -DumpPath .\backend\dump_banco_prod\bwaproj_prod_AAAAMMDD_HHMMSS.dump.gz
#
# O dump deve ter sido gerado por scripts/dump-prod-postgres.sh (formato -Fc).
# APAGA O BANCO DE DESENVOLVIMENTO. Pede confirmacao, a menos que -Force.
#
# UTF-8 COM BOM e obrigatorio: o Windows so tem PowerShell 5.1, que le arquivo
# sem BOM como CP1252 e quebra o parse em qualquer acento dentro de string.

param(
    [Parameter(Mandatory = $true)]
    [string] $DumpPath,
    [switch] $Force,
    [switch] $SkipMigrate
)

# PROGRAMA NATIVO ESCREVE EM STDERR SEM QUE ISSO SEJA ERRO.
#
# `docker compose` imprime o progresso ("Container bwa_tech-db-1 Running") no
# STDERR. Com $ErrorActionPreference='Stop', o PowerShell 5.1 embrulha cada uma
# dessas linhas num NativeCommandError TERMINANTE - e o script morria em
# `docker compose up -d db` com o container subindo perfeitamente. O sintoma era
# absurdo: falha imediata, log dizendo apenas "Verificando o container do
# banco...", e o container `Up (healthy)` ao lado.
#
# Com 'Continue', a saida do nativo e so texto. O erro de verdade continua sendo
# detectado, e melhor: por $LASTEXITCODE, conferido depois de cada chamada.
# `throw` segue terminando o script, entao os pontos de falha reais nao mudam.
$ErrorActionPreference = "Continue"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $scriptDir
Set-Location $root

function Get-EnvValor([string] $arquivo, [string] $chave) {
    if (-not (Test-Path -LiteralPath $arquivo)) { return $null }
    foreach ($linha in Get-Content -LiteralPath $arquivo) {
        if ($linha -match "^\s*$chave\s*=\s*(.*)$") {
            return $matches[1].Trim().Trim('"').Trim("'")
        }
    }
    return $null
}

function Resolve-ComposeProjectName {
    if ($env:COMPOSE_PROJECT_NAME) { return }
    $running = @(docker ps -a --format '{{.Names}}' 2>$null)
    if ($running | Where-Object { $_ -match '^bwa_tech-db-' }) {
        $env:COMPOSE_PROJECT_NAME = 'bwa_tech'
        return
    }
    $env:COMPOSE_PROJECT_NAME = 'bwaproj'
}

Resolve-ComposeProjectName
Write-Host "Compose project: $($env:COMPOSE_PROJECT_NAME)"

$resolved = Resolve-Path -LiteralPath $DumpPath
$workFile = $resolved.Path
$tempUncompressed = $null

# O DJANGO DE DEV PODE ESTAR LENDO SQLITE, E AI O RESTORE NAO APARECE.
# config/settings.py so usa Postgres quando USE_POSTGRES=true. Sem a flag, o
# dump entra no Postgres, o Django continua no db.sqlite3, e a tela fica
# exatamente igual - o modo de falha mais confuso possivel, porque tudo
# "funcionou". backend/.env.example ja avisa disso; aqui a checagem e ativa.
$envBackend = Join-Path $root 'backend\.env'
$usePg = Get-EnvValor $envBackend 'USE_POSTGRES'
if ($usePg -and $usePg.ToLower() -ne 'true') {
    Write-Warning "backend/.env tem USE_POSTGRES=$usePg. O Django vai continuar lendo o SQLite e voce NAO vera este dump. Ajuste para true antes de usar os dados."
}

Write-Host "Verificando o container do banco..."
docker compose up -d db | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Nao foi possivel subir o servico db do compose." }

$dbUser = (docker compose exec -T db printenv POSTGRES_USER 2>$null)
$dbName = (docker compose exec -T db printenv POSTGRES_DB 2>$null)
if ($dbUser) { $dbUser = ($dbUser | Select-Object -First 1).Trim() }
if ($dbName) { $dbName = ($dbName | Select-Object -First 1).Trim() }
if (-not $dbUser) { $dbUser = "bwaproj" }
if (-not $dbName) { $dbName = "bwaproj_db" }

# O banco do container e o banco que o Django abre precisam ser O MESMO.
# Se divergirem, o restore vai para um banco que ninguem le, e nada indica isso.
$dbNameDjango = Get-EnvValor $envBackend 'DB_NAME'
if ($dbNameDjango -and $dbNameDjango -ne $dbName) {
    Write-Warning "O container serve $dbName mas backend/.env aponta DB_NAME=$dbNameDjango. O restore vai para $dbName; confira qual dos dois o Django abre."
}

if (-not $Force) {
    Write-Host ""
    Write-Host "  ISTO APAGA O BANCO DE DESENVOLVIMENTO $dbName E O SUBSTITUI POR PRODUCAO." -ForegroundColor Yellow
    Write-Host "  Arquivo: $workFile" -ForegroundColor Yellow
    Write-Host ""
    $resposta = Read-Host "Digite SIM para continuar"
    if ($resposta -ne 'SIM') {
        Write-Host "Cancelado."
        return
    }
}

if ($workFile -match '\.gz$') {
    $tmpName = "bwaproj_restore_{0}.dump" -f ([Guid]::NewGuid().ToString("N"))
    $tmp = Join-Path $env:TEMP $tmpName
    $parent = Split-Path -Parent $workFile
    $leaf = Split-Path -Leaf $workFile
    Write-Host "Descompactando..."
    docker run --rm -v "${parent}:/in:ro" -v "${env:TEMP}:/out" alpine:3.19 sh -c "gunzip -c /in/$leaf > /out/$tmpName"
    if ($LASTEXITCODE -ne 0) { throw "Falha ao descompactar o dump." }
    $workFile = $tmp
    $tempUncompressed = $tmp
}

if (-not (Test-Path -LiteralPath $workFile)) { throw "Arquivo nao encontrado: $workFile" }

Write-Host "Parando servicos do compose que usam o banco..."
cmd /c "docker compose stop backend celery-worker celery-beat" | Out-Null

try {
    Write-Host "Copiando dump para o container..."
    docker compose cp -- "$workFile" "db:/tmp/bwaproj_restore.dump"
    if ($LASTEXITCODE -ne 0) { throw "Falha ao copiar o dump para o container." }

    # RECRIA O BANCO EM VEZ DE USAR pg_restore --clean.
    #
    # Dois motivos. (1) Em dev o Django e o Celery rodam NATIVAMENTE (ver
    # iniciar-dev.bat), fora do compose: parar os servicos do compose nao solta
    # as conexoes deles, e o --clean fica esperando lock para dropar cada
    # objeto. (2) --clean so remove o que existe no dump; objeto que exista so
    # no dev sobrevive e vira lixo silencioso. Derrubar as conexoes e recriar o
    # banco vazio da um estado igual ao de producao, sem restos.

    Write-Host "Derrubando conexoes abertas em $dbName..."
    $sqlKill = "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$dbName' AND pid <> pg_backend_pid();"
    docker compose exec -T db psql -U $dbUser -d postgres -v ON_ERROR_STOP=1 -c $sqlKill | Out-Null

    Write-Host "Recriando o banco $dbName..."
    docker compose exec -T db psql -U $dbUser -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $dbName;"
    if ($LASTEXITCODE -ne 0) {
        throw "Nao foi possivel apagar $dbName. Feche as janelas do backend e do Celery abertas pelo iniciar-dev.bat e rode de novo."
    }
    docker compose exec -T db psql -U $dbUser -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $dbName OWNER $dbUser;"
    if ($LASTEXITCODE -ne 0) { throw "Nao foi possivel criar $dbName." }

    Write-Host "Restaurando (pg_restore)..."
    docker compose exec -T db pg_restore -U $dbUser -d $dbName --no-owner --no-acl /tmp/bwaproj_restore.dump

    # pg_restore devolve codigo 1 tambem para avisos que nao impedem a
    # restauracao. Por isso a verificacao seguinte olha o RESULTADO (existem
    # tabelas?) em vez de confiar no codigo de saida.
    docker compose exec -T db rm -f /tmp/bwaproj_restore.dump | Out-Null

    $contagem = (docker compose exec -T db psql -U $dbUser -d $dbName -t -A -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")
    $contagem = ($contagem | Select-Object -First 1).Trim()
    if ([int]$contagem -lt 5) {
        throw "O banco ficou com apenas $contagem tabelas. O restore nao veio inteiro."
    }
    Write-Host "Restore concluido: $contagem tabelas em $dbName." -ForegroundColor Green
}
finally {
    if ($null -ne $tempUncompressed -and (Test-Path -LiteralPath $tempUncompressed)) {
        Remove-Item -LiteralPath $tempUncompressed -Force -ErrorAction SilentlyContinue
    }
}

if (-not $SkipMigrate) {
    # O dump traz o schema de PRODUCAO. O checkout local costuma estar a frente,
    # e sem isto o backend sobe reclamando de coluna inexistente.
    Write-Host "Aplicando migracoes pendentes do checkout local..."
    Push-Location (Join-Path $root 'backend')
    try {
        python manage.py migrate --noinput
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "As migracoes falharam. Rode manualmente: cd backend; python manage.py migrate"
        }
    } finally {
        Pop-Location
    }
}

Write-Host ""
Write-Host "Pronto. Se o backend estava rodando, reinicie pelo iniciar-dev.bat." -ForegroundColor Green
