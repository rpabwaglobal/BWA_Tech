# ===========================================================================
#  BWA Tech - CELERY WORKER em desenvolvimento.
#
#  Quem executa as tarefas em segundo plano: geracao de relatorios, envio de
#  notificacoes, integracoes. Sem ele a interface aceita o pedido e ele fica
#  parado na fila para sempre - sem erro nenhum na tela, que e o modo mais
#  confuso de faltar.
#
#  --pool=solo E OBRIGATORIO NO WINDOWS. O pool padrao (prefork) depende de
#  fork(), que o Windows nao tem; sem isso as tarefas falham com erros de
#  processo filho que nao apontam para a causa. E por isso que o compose (Linux)
#  usa --concurrency=1 e aqui e --pool=solo: mesma intencao, plataformas
#  diferentes.
#
#  O WORKER NAO RECARREGA SOZINHO. Diferente do runserver, ele carrega o codigo
#  das tarefas uma vez e segura. Mexeu em task ou em gerador de relatorio:
#  Ctrl+C aqui e sobe de novo, senao voce testa a versao antiga sem perceber.
# ===========================================================================
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\infra-dev.ps1"

$raiz = Split-Path -Parent $PSScriptRoot

Escrever-Regua ('BWA TECH ' + $PONTO + ' celery worker')

if (-not (Garantir-Docker)) { exit 1 }
if (-not (Garantir-Bancos $raiz)) { exit 1 }
if (-not (Entrar-No-Backend $raiz)) { exit 1 }

# SEM MIGRAR AQUI, de proposito: o backend e o dono do schema. Se worker, beat e
# backend migrassem ao subir juntos, seriam tres processos aplicando a mesma
# migracao ao mesmo tempo.
Escrever-Rodape 'Worker aguardando tarefas.' 'Mexeu em uma task? Reinicie: ele nao recarrega sozinho.'

# ULTIMA LINHA, DE PROPOSITO: o codigo de saida do worker vira o do script.
python -m celery -A config.celery worker --loglevel=INFO --pool=solo
exit $LASTEXITCODE
