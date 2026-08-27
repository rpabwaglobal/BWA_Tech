# ===========================================================================
#  A INFRAESTRUTURA COMPARTILHADA DO BWA TECH EM DESENVOLVIMENTO.
#
#  Backend, Celery worker e Celery beat precisam exatamente da mesma base de
#  pe: Docker rodando, Postgres e Redis saudaveis. Escrever isso tres vezes
#  seria garantir que as tres copias divergissem - basta alguem corrigir uma.
#  Mesmo motivo de "estilo-console.ps1" existir.
#
#  Uso:  . "$PSScriptRoot\infra-dev.ps1"        (ja traz o estilo junto)
# ===========================================================================

. "$PSScriptRoot\estilo-console.ps1"

# Nomes fixos porque o compose deste repositorio usa o projeto "bwa_tech". Ha
# OUTROS redis nesta maquina (n8n, redis_v5); olhar "um container redis" pegaria
# o container errado e daria um "tudo pronto" mentiroso.
$CONTAINER_DB = 'bwa_tech-db-1'
$CONTAINER_REDIS = 'bwa_tech-redis-1'

function Invocar-Silencioso {
    <#
      Roda um comando nativo engolindo a saida e devolvendo SO o codigo de saida.

      EXISTE POR UMA ARMADILHA REAL DO POWERSHELL 5.1: com
      $ErrorActionPreference = 'Stop', redirecionar o stderr de um executavel
      (`docker info 2>&1`) transforma cada linha de erro num ErrorRecord que
      LANCA excecao. Ou seja: `docker info 2>&1 | Out-Null` funciona enquanto o
      Docker esta no ar e explode justamente quando ele esta parado - o unico
      caso em que aquela verificacao servia para alguma coisa. Testado:
      NativeCommandError tanto com `2>&1` quanto com `2>$null`.
    #>
    param([Parameter(Mandatory)] [scriptblock] $comando)

    $anterior = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $comando 2>&1 | Out-Null
        return $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $anterior
    }
}

function Garantir-Docker {
    <#  Docker no ar; tenta abrir o Docker Desktop se estiver parado.  #>
    Escrever-Passo 'Docker'

    if ((Invocar-Silencioso { docker info }) -eq 0) {
        Escrever-Fim 'no ar'
        return $true
    }

    Write-Host ''
    Escrever-Info 'parado; abrindo o Docker Desktop'
    $exe = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
    if (Test-Path $exe) { Start-Process $exe | Out-Null }

    # ESPERA LIMITADA, e nao laco infinito. O iniciador antigo repete o teste
    # para sempre; num gerenciador de processos isso vira um servico que nunca
    # sobe nem falha, e ninguem descobre o porque.
    $limite = (Get-Date).AddMinutes(2)
    do {
        Start-Sleep -Seconds 5
        $codigo = Invocar-Silencioso { docker info }
    } while ($codigo -ne 0 -and (Get-Date) -lt $limite)

    if ($codigo -ne 0) {
        Escrever-Erro 'O Docker nao respondeu em 2 minutos.' 'Abra o Docker Desktop e rode de novo.'
        return $false
    }

    Escrever-Passo 'Docker'
    Escrever-Fim 'no ar'
    return $true
}

function Obter-Saude {
    <#  Estado do healthcheck de um container, ou 'ausente' se ele nao existe. #>
    param([string] $container)

    $anterior = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $saida = docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}sem-health{{end}}' $container 2>&1
        if ($LASTEXITCODE -ne 0) { return 'ausente' }
        return ($saida | Out-String).Trim()
    } finally {
        $ErrorActionPreference = $anterior
    }
}

function Baixar-Imagem {
    <#
      Baixa uma imagem mostrando o progresso NUMA LINHA SO.

      `docker pull` sem terminal cospe uma linha por camada por estado - com
      postgres e redis sao dezenas, e a tela vira um paredao de texto repetido.
      A linha viva mostra sempre o estado atual e nada mais, do mesmo jeito que o
      painel do dump de producao.
    #>
    param([Parameter(Mandatory)] [string] $imagem)

    $anterior = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        docker pull $imagem 2>&1 | ForEach-Object {
            $linha = ("$_").Trim()
            if ($linha) { Escrever-LinhaViva ('      ' + $SETA + ' ' + $imagem + '  ' + $linha) }
        }
        $codigo = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $anterior
    }

    if ($codigo -eq 0) {
        # Encerra a linha viva com o resultado: o que terminou vira historico, o
        # que esta rodando continua ocupando uma linha so.
        Escrever-LinhaViva ('      ' + $SETA + ' ' + $imagem + '  ' + $MARCA_OK + ' baixada') $true
    } else {
        Limpar-LinhaViva
    }
    return $codigo
}

function Garantir-Imagens {
    <#
      Confere que as imagens de db e redis existem na maquina e baixa as que
      faltam.

      ANTES DE SUBIR, e nao durante. O `docker compose up` baixa sozinho o que
      falta, mas se esse download falhar (sem internet, registro fora, limite de
      taxa) o erro que chega e um "falha ao subir os containers" - que manda
      procurar no lugar errado. Separado, cada falha diz o que de fato aconteceu.
      Mesma licao do dump de producao, que acusava "dump corrompido" quando o
      problema era a imagem que nao baixou.
    #>
    param([Parameter(Mandatory)] [string] $raiz)

    Escrever-Passo 'Imagens'

    # LIDAS DO COMPOSE, e nao escritas aqui. Fixar "postgres:16.6-alpine" neste
    # script daria uma copia para esquecer no dia em que a versao subir.
    Push-Location $raiz
    try {
        $anterior = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            $imagens = @(docker compose config --images db redis 2>&1 |
                ForEach-Object { ("$_").Trim() } |
                Where-Object { $_ -and $_ -notmatch '\s' })
            $codigo = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $anterior
        }
    } finally {
        Pop-Location
    }

    if ($codigo -ne 0 -or $imagens.Count -eq 0) {
        Escrever-Erro 'Nao consegui ler as imagens do docker-compose.yml.' 'Veja: docker compose config --images db redis'
        return $false
    }

    $faltando = @()
    foreach ($img in $imagens) {
        if ((Invocar-Silencioso { docker image inspect $img }) -ne 0) { $faltando += $img }
    }

    if ($faltando.Count -eq 0) {
        Escrever-Fim 'ja na maquina'
        return $true
    }

    # AVISO ANTES DO PRIMEIRO BYTE: na primeira vez sao centenas de megabytes, e
    # silencio por minutos parece travamento.
    Write-Host ''
    Escrever-Info ('baixando ' + $faltando.Count + ' imagem(ns); da primeira vez demora')

    foreach ($img in $faltando) {
        if ((Baixar-Imagem $img) -ne 0) {
            Escrever-Erro "Nao foi possivel baixar a imagem $img." 'Verifique a internet e se o Docker esta logado no registro.'
            return $false
        }
    }

    Escrever-Passo 'Imagens'
    Escrever-Fim 'baixadas'
    return $true
}

function Garantir-Bancos {
    <#
      Sobe Postgres e Redis e SO devolve quando os dois estao saudaveis.

      Esperar aqui, e nao adiante: sem isso a falha aparece la na frente como
      "connection refused" do Django ou do Celery, que nao diz a causa.
    #>
    param([Parameter(Mandatory)] [string] $raiz)

    if (-not (Garantir-Imagens $raiz)) { return $false }

    Escrever-Passo 'Postgres e Redis'

    Push-Location $raiz
    try {
        $codigo = Invocar-Silencioso { docker compose up -d db redis }
    } finally {
        Pop-Location
    }

    if ($codigo -ne 0) {
        Escrever-Erro 'Falha ao subir os containers de banco/redis.' 'Veja: docker compose logs db'
        return $false
    }

    # OS DOIS, e nao so o banco: o Celery fala com o Redis antes de falar com o
    # Postgres, entao esperar so o banco deixaria passar exatamente a falha que
    # derruba o worker.
    $limite = (Get-Date).AddMinutes(2)
    do {
        $saudeDb = Obter-Saude $CONTAINER_DB
        $saudeRedis = Obter-Saude $CONTAINER_REDIS
        if ($saudeDb -eq 'healthy' -and $saudeRedis -eq 'healthy') {
            Escrever-Fim 'prontos'
            return $true
        }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $limite)

    Escrever-Erro "Nao ficaram saudaveis em 2 minutos (db: $saudeDb, redis: $saudeRedis)." `
        'Veja: docker compose logs db redis'
    return $false
}

function Entrar-No-Backend {
    <#  Vai para backend\ e confere que e mesmo o repositorio do BWA Tech.  #>
    param([Parameter(Mandatory)] [string] $raiz)

    $pasta = Join-Path $raiz 'backend'
    if (-not (Test-Path (Join-Path $pasta 'manage.py'))) {
        Escrever-Erro "Nao encontrei backend\manage.py em $pasta." 'Este script precisa ficar em scripts\ dentro do repositorio.'
        return $false
    }
    Set-Location $pasta
    return $true
}
