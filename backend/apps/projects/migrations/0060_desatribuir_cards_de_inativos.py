"""
Trata o ESTADO QUE JÁ EXISTE: solta o responsável dos cards ABERTOS que estão
pendurados em contas já desativadas, e registra um CardLog por card.

Por que migration e não management command: a regra é "conta desativada não
segura card aberto", um invariante de produto que precisa valer no instante do
deploy. Dependendo de alguém lembrar de rodar um comando, a entrega chega em
produção com o problema visível no dia 1. Precedente da casa para backfill que
faz parte da entrega: `0042_project_is_system_and_backfill`.

O que ela NÃO toca: cards FINALIZADOS e INVIABILIZADOS. Apagar o responsável ali
reescreveria a métrica de entrega das sprints passadas — trabalho entregue
continua sendo de quem entregou.

>>> IRREVERSÍVEL. `reverse_code` é `noop` só para não travar um `migrate` para <<<
>>> trás: ele NÃO restaura nada. O responsável anterior não é guardado em      <<<
>>> campo nenhum — sobra apenas o NOME dentro do texto do CardLog, que não é   <<<
>>> id e não reidentifica a pessoa com segurança.                              <<<

Idempotente: rodar de novo não encontra nada (o filtro exige um responsável
inativo), então não escreve log duplicado.

Signals não disparam aqui (modelo histórico é outra classe), o que neste caso é
bom: nenhum log automático concorrente e nenhum broadcast WebSocket durante o
deploy.
"""

from django.conf import settings
from django.db import migrations


# Retrato CONGELADO dos status fechados. Inline de propósito: migration é foto
# do passado e não deve seguir mudanças futuras de `CARD_STATUS_FECHADOS`
# (models.py) — se a definição de "fechado" mudar amanhã, o que já rodou aqui
# não pode mudar de sentido retroativamente.
STATUS_FECHADOS = ('finalizado', 'inviabilizado')

# Mesma redação do fluxo online (services.DESCRICAO_DESATRIBUICAO_CONTA_DESATIVADA).
DESCRICAO = 'Responsável: {nome_anterior} → Ninguém.\n\nMotivo: conta desativada.'


def _nome_do_responsavel(first_name, last_name, username):
    """Mesmo fallback de `projects.signals.format_user_name`, repetido inline
    porque modelo histórico não tem método nem alcança aquela função."""
    first = (first_name or '').strip()
    last = (last_name or '').strip()
    if first and last:
        return f'{first} {last}'
    if first:
        return first
    if last:
        return last
    return username


def desatribuir_cards_de_inativos(apps, schema_editor):
    Card = apps.get_model('projects', 'Card')
    CardLog = apps.get_model('projects', 'CardLog')

    alvo = (
        Card.objects.filter(responsavel__is_active=False)
        .exclude(status__in=STATUS_FECHADOS)
    )
    # Materializa ANTES do update: depois dele o nome do responsável já era, e
    # é justamente ele que precisa entrar no histórico.
    afetados = list(alvo.values(
        'id',
        'responsavel__first_name',
        'responsavel__last_name',
        'responsavel__username',
    ))
    if not afetados:
        return

    alvo.update(responsavel=None)

    CardLog.objects.bulk_create([
        CardLog(
            card_id=item['id'],
            tipo_evento='responsavel_alterado',
            descricao=DESCRICAO.format(nome_anterior=_nome_do_responsavel(
                item['responsavel__first_name'],
                item['responsavel__last_name'],
                item['responsavel__username'],
            )),
            # Sem ator humano: quem "fez" isto foi o deploy. `CardLog.usuario`
            # é null=True exatamente para não obrigar a inventar um autor.
            usuario_id=None,
        )
        for item in afetados
    ])


def noop_reverso(apps, schema_editor):
    """NÃO desfaz nada — ver o aviso no topo do arquivo. Existe só para o
    `migrate` para trás não travar."""
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('projects', '0059_alter_cardlog_tipo_evento_cardreopenrequest'),
        # É assim que as migrations deste app alcançam accounts.User.
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.RunPython(desatribuir_cards_de_inativos, noop_reverso),
    ]
