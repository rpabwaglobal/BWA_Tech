# ===========================================================================
#  BWA Tech - FRONTEND (Vite) em desenvolvimento.
#
#  Chamado por `.bat\BWA Tech - Frontend.bat`, que so prepara o console. Mesma
#  divisao do dump de producao e do backend: o `.bat` cuida da janela, o
#  PowerShell cuida do trabalho e da aparencia.
#
#  NAO DEPENDE DO BACKEND. O Vite serve a interface sozinho; sem o Django as
#  telas abrem e sao as chamadas de API que falham. Prender o frontend a espera
#  do backend tiraria justamente a utilidade de terem bats separados - mexer em
#  tela sem precisar do resto de pe.
# ===========================================================================
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\estilo-console.ps1"

$raiz = Split-Path -Parent $PSScriptRoot
$pastaFront = Join-Path $raiz 'frontend'

Escrever-Regua ('BWA TECH ' + $PONTO + ' frontend em desenvolvimento')

if (-not (Test-Path $pastaFront)) {
    Escrever-Erro "Nao encontrei a pasta frontend em $pastaFront." 'Este script precisa ficar em scripts\ dentro do repositorio.'
    exit 1
}
Set-Location $pastaFront

# ── Dependencias ────────────────────────────────────────────────────────
# CONFERIDAS, E NAO PRESUMIDAS. Sem `node_modules` o `npm run dev` morre com
# "vite nao e reconhecido" - erro que nao diz o que fazer. Acontece de verdade:
# checkout novo, troca de branch com package.json diferente, pasta limpa.
Escrever-Passo 'Dependencias'
if (-not (Test-Path 'node_modules')) {
    Write-Host ''
    Escrever-Info 'node_modules ausente; instalando (demora alguns minutos)'
    Write-Host ''
    npm install
    if ($LASTEXITCODE -ne 0) {
        Escrever-Erro 'A instalacao das dependencias falhou.' 'Veja a saida acima do npm.'
        exit 1
    }
    Escrever-Passo 'Dependencias'
}
Escrever-Fim 'prontas'

# ── Vite ────────────────────────────────────────────────────────────────
Escrever-Servico 'http://localhost:5173' 'Interface em'

# ULTIMA LINHA, DE PROPOSITO: o codigo de saida do Vite vira o do script, e quem
# gerencia o processo enxerga a queda.
npm run dev
exit $LASTEXITCODE
