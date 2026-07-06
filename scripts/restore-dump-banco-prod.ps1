# Restaura o dump colocado em backend/dump_banco_prod/ (ex.: cópia de produção).
# Uso (PowerShell, na raiz do repositório):
#   .\scripts\restore-dump-banco-prod.ps1
#
# Para baixar da VPS e restaurar de uma vez:
#   $env:BWA_VPS_HOST = 'IP_DA_VPS'
#   .\scripts\fetch-prod-dump.ps1 -Restore

param(
    [string] $DumpPath = ""
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $scriptDir
$defaultDir = Join-Path $root "backend\dump_banco_prod"

if (-not $DumpPath) {
    if (-not (Test-Path -LiteralPath $defaultDir)) {
        throw "Pasta não encontrada: $defaultDir. Crie-a e coloque o ficheiro .dump.gz de produção."
    }
    $candidates = @(
        Get-ChildItem -LiteralPath $defaultDir -Filter "*.dump.gz" -File -ErrorAction SilentlyContinue
        Get-ChildItem -LiteralPath $defaultDir -Filter "*.dump" -File -ErrorAction SilentlyContinue
    )
    if (-not $candidates -or $candidates.Count -eq 0) {
        throw "Nenhum ficheiro .dump.gz ou .dump em $defaultDir"
    }
    $DumpPath = ($candidates | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
    Write-Host "Usando dump: $DumpPath"
}

& (Join-Path $scriptDir "restore-local-docker.ps1") -DumpPath $DumpPath
