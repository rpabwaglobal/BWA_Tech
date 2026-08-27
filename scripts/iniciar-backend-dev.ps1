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
. "$PSScriptRoot\infra-dev.ps1"

$raiz = Split-Path -Parent $PSScriptRoot

Escrever-Regua ('BWA TECH ' + $PONTO + ' backend em desenvolvimento')

if (-not (Garantir-Docker)) { exit 1 }
if (-not (Garantir-Bancos $raiz)) { exit 1 }
if (-not (Entrar-No-Backend $raiz)) { exit 1 }

# -- Migracoes -----------------------------------------------------------
# SO AQUI, e nao no worker nem no beat: se os tres migrassem ao subir juntos,
# tres processos aplicariam a mesma migracao ao mesmo tempo. O backend e o dono
# do schema; os outros dois so o consomem.
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

# -- Servidor ------------------------------------------------------------
Escrever-Servico 'http://127.0.0.1:8000' 'Backend em'

# ULTIMA LINHA, DE PROPOSITO: o codigo de saida do runserver vira o do script, e
# quem gerencia o processo enxerga a queda.
python manage.py runserver 127.0.0.1:8000
exit $LASTEXITCODE
