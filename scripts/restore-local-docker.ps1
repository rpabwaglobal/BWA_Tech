# Restaura um dump de produção no PostgreSQL local (Docker Compose deste repositório).
# Uso (PowerShell, na raiz do projeto):
#   .\scripts\restore-local-docker.ps1 -DumpPath .\backups\bwaproj_prod_YYYYMMDD_HHMMSS.dump.gz
#
# O dump deve ter sido gerado com scripts/dump-prod-postgres.sh (formato custom -Fc).
# ATENÇÃO: sobrescreve os dados do banco local (mesmo nome DB do compose).

param(
    [Parameter(Mandatory = $true)]
    [string] $DumpPath
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $scriptDir
Set-Location $root

$resolved = Resolve-Path -LiteralPath $DumpPath
$workFile = $resolved.Path
$tempUncompressed = $null

# Se for .gz, descompacta via container Alpine (não exige gzip instalado no Windows)
if ($workFile -match '\.gz$') {
    $tmpName = "bwaproj_restore_{0}.dump" -f ([Guid]::NewGuid().ToString("N"))
    $tmp = Join-Path $env:TEMP $tmpName
    $parent = Split-Path -Parent $workFile
    $leaf = Split-Path -Leaf $workFile
    Write-Host "Descompactando .gz para arquivo temporário..."
    docker run --rm -v "${parent}:/in:ro" -v "${env:TEMP}:/out" alpine:3.19 sh -c "gunzip -c /in/$leaf > /out/$tmpName"
    $workFile = $tmp
    $tempUncompressed = $tmp
}

if (-not (Test-Path -LiteralPath $workFile)) {
    throw "Arquivo não encontrado: $workFile"
}

Write-Host "Parando backend e workers para liberar conexões ao banco..."
docker compose stop backend celery-worker celery-beat 2>$null | Out-Null

try {
    Write-Host "Copiando dump para o container db..."
    docker compose cp -- "$workFile" "db:/tmp/bwaproj_restore.dump"

    $dbUser = (docker compose exec -T db printenv POSTGRES_USER).Trim()
    $dbName = (docker compose exec -T db printenv POSTGRES_DB).Trim()
    if (-not $dbUser) { $dbUser = "bwaproj" }
    if (-not $dbName) { $dbName = "bwaproj_db" }

    Write-Host "Restaurando em $dbName (pg_restore --clean --if-exists)..."
    docker compose exec -T db pg_restore `
        -U $dbUser `
        -d $dbName `
        --clean `
        --if-exists `
        --no-owner `
        --no-acl `
        /tmp/bwaproj_restore.dump

    docker compose exec -T db rm -f /tmp/bwaproj_restore.dump
    Write-Host "Restore concluído."
}
finally {
    if ($null -ne $tempUncompressed -and (Test-Path -LiteralPath $tempUncompressed)) {
        Remove-Item -LiteralPath $tempUncompressed -Force -ErrorAction SilentlyContinue
    }
    Write-Host "Subindo backend e workers..."
    docker compose start backend celery-worker celery-beat 2>$null | Out-Null
}

Write-Host "Pronto. Suba o stack se necessário: docker compose up -d"
