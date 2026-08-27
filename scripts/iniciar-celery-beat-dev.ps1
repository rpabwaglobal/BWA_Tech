# ===========================================================================
#  BWA Tech - CELERY BEAT em desenvolvimento.
#
#  O relogio das tarefas agendadas: ele nao executa nada, so coloca na fila na
#  hora certa. Quem executa e o worker.
#
#  ENTAO BEAT SOZINHO NAO FAZ NADA. Se so este estiver de pe, as tarefas entram
#  na fila e ficam la. Precisa do worker junto - sao dois bats porque sao dois
#  processos, nao porque um substitui o outro.
#
#  O AGENDAMENTO FICA EM backend\celerybeat-schedule (o .gitignore ja cobre o
#  arquivo e seus companheiros). Se o beat comecar a reclamar de agendamento
#  corrompido depois de uma queda feia, apagar esse arquivo resolve: ele e
#  cache, nao configuracao.
# ===========================================================================
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\infra-dev.ps1"

$raiz = Split-Path -Parent $PSScriptRoot

Escrever-Regua ('BWA TECH ' + $PONTO + ' celery beat')

if (-not (Garantir-Docker)) { exit 1 }
if (-not (Garantir-Bancos $raiz)) { exit 1 }
if (-not (Entrar-No-Backend $raiz)) { exit 1 }

Escrever-Rodape 'Agendador no ar.' 'Ele so enfileira; quem executa e o worker.'

# ULTIMA LINHA, DE PROPOSITO: o codigo de saida do beat vira o do script.
python -m celery -A config.celery beat --loglevel=INFO
exit $LASTEXITCODE
