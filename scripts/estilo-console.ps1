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

# ── LINHA VIVA ──────────────────────────────────────────────────────────
# Uma linha so, que se reescreve, no lugar de uma linha nova por atualizacao.
#
# VEM DO PAINEL DO DUMP, onde o problema apareceu de verdade: o download da
# imagem enchia a tela de copias do mesmo texto. Aqui em cima ela e util pelo
# mesmo motivo - `docker pull` cospe uma linha por camada por estado, e sao
# dezenas.
#
# RETORNO DE CARRO, E NAO MOVER O CURSOR. Mover o cursor exige um console de
# verdade; retorno de carro nao - ele leva a escrita de volta ao inicio da MESMA
# linha e quem renderiza sobrescreve. E o que `docker pull`, `curl` e `npm` fazem
# quando percebem que estao num cano. Com cursor, rodando sob um gerenciador de
# processos, o texto vai para o cano enquanto o cursor anda no console: cada
# quadro ACRESCENTA, que e exatamente o empilhamento que se quer evitar.
$script:tamanhoLinhaViva = 0

function Escrever-LinhaViva {
    param([string] $texto, [bool] $encerrar = $false)

    # Corta antes de 100 colunas: uma linha que estoura a largura QUEBRA, e dai
    # em diante o retorno de carro volta so ao inicio da ultima parte - o efeito
    # de atualizar no lugar some e vira o empilhamento de novo.
    if ($texto.Length -gt 100) { $texto = $texto.Substring(0, 99) + [char]0x2026 }

    # Espacos ate o tamanho da escrita anterior: sem isso, uma linha curta deixa
    # o rabo da anterior visivel na tela.
    $sobra = [Math]::Max(0, $script:tamanhoLinhaViva - $texto.Length)
    [Console]::Out.Write("`r" + $texto + (' ' * $sobra))

    if ($encerrar) {
        [Console]::Out.Write("`n")
        $script:tamanhoLinhaViva = 0
    } else {
        $script:tamanhoLinhaViva = $texto.Length
    }
}

function Limpar-LinhaViva {
    <#  Apaga a linha viva sem deixar rastro, para outra coisa escrever ali.  #>
    if ($script:tamanhoLinhaViva -gt 0) {
        [Console]::Out.Write("`r" + (' ' * $script:tamanhoLinhaViva) + "`r")
        $script:tamanhoLinhaViva = 0
    }
}

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

function Escrever-Rodape {
    <#
      O mesmo quadro final para quem NAO atende num endereco.

      Worker e beat nao tem URL; forcar um em `Escrever-Servico` so para
      reaproveitar a funcao daria uma linha que mente sobre o que o processo faz.
    #>
    param(
        [string] $texto,
        [string] $detalhe = '',
        # Para quem TERMINA em vez de segurar o console. Sem isso o script da
        # infra fechava mandando apertar Ctrl+C para parar algo que ja tinha
        # acabado - instrucao errada e confusa logo no fim da tela.
        [switch] $Termina
    )
    Write-Host ''
    Write-Host ('  ' + $texto) -ForegroundColor $COR_DESTAQUE
    if ($detalhe) { Write-Host ('  ' + $detalhe) -ForegroundColor $COR_APAGADO }
    if (-not $Termina) { Write-Host '  Ctrl+C para parar.' -ForegroundColor $COR_APAGADO }
    Write-Host ''
}
