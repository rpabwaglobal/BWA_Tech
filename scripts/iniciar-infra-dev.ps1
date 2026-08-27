# ===========================================================================
#  BWA Tech - POSTGRES E REDIS em desenvolvimento.
#
#  So a base: sobe os containers e confere que ficaram saudaveis. Os outros bats
#  ja fazem isso sozinhos, entao este nao e obrigatorio - ele serve para quando
#  se quer o banco de pe SEM subir a aplicacao: rodar teste, abrir um cliente de
#  SQL, restaurar o dump de producao, olhar log de container.
#
#  ESTE TERMINA, e nao fica preso. Os containers rodam em segundo plano no
#  Docker; segurar a janela aqui nao manteria nada de pe - so daria a impressao
#  errada de que fechar a janela derruba o banco. Para derrubar de verdade:
#  docker compose stop db redis
# ===========================================================================
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\infra-dev.ps1"

$raiz = Split-Path -Parent $PSScriptRoot

Escrever-Regua ('BWA TECH ' + $PONTO + ' postgres e redis')

if (-not (Garantir-Docker)) { exit 1 }
if (-not (Garantir-Bancos $raiz)) { exit 1 }

Escrever-Rodape 'Base no ar, rodando em segundo plano.' 'Para derrubar: docker compose stop db redis' -Termina
exit 0
