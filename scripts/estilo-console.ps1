# ===========================================================================
#  A APARENCIA DOS SCRIPTS DE CONSOLE DO BWA TECH, NUM LUGAR SO.
#
#  Nasceu do painel de "sincronizar-banco-dev.ps1" (o dump de producao), que
#  define a linguagem visual: regua com titulo, cores por significado, marcas de
#  ok e erro, e degradacao para ASCII quando o console nao esta em UTF-8.
#
#  MODULO, E NAO COPIA. Sao tres scripts com a mesma cara; copiada, bastaria
#  ajustar um para os outros ficarem diferentes - e ninguem abre os tres lado a
#  lado para notar. E o mesmo motivo pelo qual `lib/arrastar.ts` e
#  `useTimelineRecolhivel` existem do lado do frontend.
#
#  Uso:  . "$PSScriptRoot\estilo-console.ps1"
# ===========================================================================

# Cores por SIGNIFICADO, nao por gosto: quem le o script sabe o que muda ao
# trocar uma delas.
$COR_TITULO = 'White'
$COR_APAGADO = 'DarkGray'
$COR_ANDAMENTO = 'Cyan'
$COR_OK = 'Green'
$COR_ERRO = 'Red'
$COR_DESTAQUE = 'Yellow'

# SIMBOLOS COM RESERVA EM ASCII.
# O `.bat` roda `chcp 65001`, mas ele pode falhar (console antigo, politica de
# grupo, saida capturada). Sem a reserva, a tela mostra caixinha no lugar da
# marca de concluido - e um simbolo ilegivel e pior que um `v`.
$ehUtf8 = [Console]::OutputEncoding.CodePage -eq 65001
$MARCA_OK = if ($ehUtf8) { [char]0x2714 } else { 'v' }
$MARCA_ERRO = if ($ehUtf8) { [char]0x2718 } else { 'x' }
$MARCA_INFO = if ($ehUtf8) { [char]0x00B7 } else { '-' }
$SETA = if ($ehUtf8) { [char]0x21B3 } else { '>' }
$TRACO = if ($ehUtf8) { [char]0x2500 } else { '-' }
$PONTO = if ($ehUtf8) { [char]0x00B7 } else { '-' }

function Obter-Largura {
    try { return [Math]::Max(40, [Math]::Min(72, [Console]::WindowWidth - 2)) } catch { return 72 }
}

function Escrever-Regua {
    <#  A regua de titulo do BWA Tech: linha em branco, titulo, filete.  #>
    param([string] $texto, [string] $cor = $COR_TITULO)
    Write-Host ''
    Write-Host ('  ' + $texto) -ForegroundColor $cor
    Write-Host ('  ' + ([string]$TRACO) * (Obter-Largura)) -ForegroundColor $COR_APAGADO
}

function Escrever-Passo {
    <#  Uma etapa em andamento. Sem quebra de linha: `Escrever-Fim` completa. #>
    param([string] $texto)
    Write-Host ('  ' + $MARCA_INFO + ' ' + $texto) -NoNewline -ForegroundColor $COR_ANDAMENTO
}

function Escrever-Fim {
    <#  Fecha a linha aberta por `Escrever-Passo`.  #>
    param([string] $texto = 'ok', [bool] $ok = $true)
    Write-Host ('  ' + $(if ($ok) { $MARCA_OK } else { $MARCA_ERRO }) + ' ' + $texto) `
        -ForegroundColor $(if ($ok) { $COR_OK } else { $COR_ERRO })
}

function Escrever-Info {
    param([string] $texto)
    Write-Host ('      ' + $SETA + ' ' + $texto) -ForegroundColor $COR_APAGADO
}

function Escrever-Erro {
    <#  O fim de linha de quem falhou, sempre com o que fazer a seguir.  #>
    param([string] $texto, [string] $comoResolver = '')
    Write-Host ''
    Write-Host ('  ' + $MARCA_ERRO + ' ' + $texto) -ForegroundColor $COR_ERRO
    if ($comoResolver) {
        Write-Host ('    ' + $comoResolver) -ForegroundColor $COR_APAGADO
    }
    Write-Host ''
}

function Escrever-Servico {
    <#  O quadro final: onde o servico atende e como se para.  #>
    param([string] $endereco, [string] $rotulo)
    Write-Host ''
    Write-Host ('  ' + $rotulo + ' ') -NoNewline -ForegroundColor $COR_APAGADO
    Write-Host $endereco -ForegroundColor $COR_DESTAQUE
    Write-Host '  Ctrl+C para parar.' -ForegroundColor $COR_APAGADO
    Write-Host ''
}
