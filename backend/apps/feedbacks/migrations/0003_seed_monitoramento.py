"""
Semeia a estrutura do fluxo "Monitoramento de feedbacks".

>>> ESTE ARQUIVO É GÊMEO DE `apps/feedbacks/estrutura.py`. <<<
As mesmas três criações estão escritas nos dois lugares, e isso NÃO é duplicação
por descuido: é a regra do Django. Migration é retrato congelado do schema e
nunca importa código de app — se `garantir_estrutura_monitoramento` passar a
gravar um campo novo amanhã, esta migration continuaria rodando com o código
novo contra bancos antigos e quebraria. Por isso aqui usamos `apps.get_model`.

POR QUE A MIGRATION PODE PULAR SEM QUEBRAR: `Sprint.supervisor` é NOT NULL com
PROTECT. Num banco recém-migrado (o de teste, por exemplo) pode não existir
usuário nenhum. Sem supervisor esta migration NÃO cria nada e apenas loga — a
estrutura nasce depois, na primeira entrega, porque `gerar_pedidos_do_projeto`
chama `garantir_estrutura_monitoramento` como primeira coisa (auto-cura). O
SETOR nunca é motivo para pular: ele é criado aqui mesmo e não depende de
nenhuma linha anterior.

DETALHE QUE SALVA A MIGRATION: modelos históricos não carregam métodos
customizados. Nem `Sprint.save()` (que agenda ETA no Celery) nem `Project.save()`
(que herda o setor da sprint) rodam aqui. Consequência prática: o `setor_id` do
projeto TEM de ser setado explicitamente, e nenhuma task é publicada no broker.
"""
import logging
from datetime import timedelta

from django.db import migrations
from django.utils import timezone

logger = logging.getLogger(__name__)

NOME_PROJETO = 'Monitoramento de feedbacks'
NOME_SPRINT = 'Monitoramento de feedbacks'
DURACAO_DIAS = 36500  # ~100 anos: `fechamento_em` é NOT NULL e ela nunca fecha.

# Setor TÉCNICO do fluxo — deliberadamente NÃO é `sem_setor`. O balde de não
# classificados é o setor de todo usuário ainda não classificado (accounts/0016
# vincula os existentes, `RegisterSerializer` vincula os novos), então ancorar o
# fluxo lá entregaria todo feedback da empresa — e a `url_publica`, que é a
# credencial da rota anônima — a qualquer conta não classificada assim que
# `SETOR_SCOPING_ENABLED` for ligada. Ver o comentário longo em estrutura.py.
SETOR_MONITORAMENTO_CODENAME = 'monitoramento_feedbacks'
SETOR_MONITORAMENTO_NOME = 'Monitoramento de Feedbacks'
SETOR_MONITORAMENTO_DESCRICAO = (
    'Setor técnico do fluxo de feedbacks pós-entrega. Nenhum usuário deve ser '
    'vinculado a ele: cada card é emprestado ao setor que entregou o trabalho.'
)

# (key, label, is_terminal). As keys são os valores de `EstadoPedido` — ver o
# comentário de `etapas_monitoramento()` em estrutura.py.
ETAPAS = [
    ('aguardando_prazo', 'Aguardando 30 dias', False),
    ('aguardando_resposta', 'Aguardando Feedback', False),
    ('respondido', 'Feedback colhido', True),
]


def semear(apps, schema_editor):
    SetorCatalogo = apps.get_model('accounts', 'SetorCatalogo')
    User = apps.get_model('accounts', 'User')
    Sprint = apps.get_model('projects', 'Sprint')
    Project = apps.get_model('projects', 'Project')
    KanbanStage = apps.get_model('projects', 'KanbanStage')
    ProjectKanbanStageConfig = apps.get_model('projects', 'ProjectKanbanStageConfig')

    supervisor = (User.objects.filter(is_superuser=True, is_active=True).order_by('id').first()
                  or User.objects.order_by('id').first())
    if supervisor is None:
        logger.warning(
            'Feedback: seed do monitoramento PULADO (não há usuário para ser '
            'supervisor da sprint). A estrutura será criada na primeira entrega, '
            'pela auto-cura de gerar_pedidos_do_projeto.',
        )
        return

    # O setor técnico não depende de nada pré-existente: sempre dá para criar.
    setor, _ = SetorCatalogo.objects.get_or_create(
        codename=SETOR_MONITORAMENTO_CODENAME,
        defaults={
            'nome': SETOR_MONITORAMENTO_NOME,
            'is_system': True,
            'descricao': SETOR_MONITORAMENTO_DESCRICAO,
        },
    )

    agora = timezone.now()
    # A chave é `is_system=True`, e ela diz a verdade: existe NO MÁXIMO UMA
    # sprint sistêmica.
    sprint, _ = Sprint.objects.get_or_create(
        is_system=True,
        defaults={
            'nome': NOME_SPRINT,
            'data_inicio': agora,
            'fechamento_em': agora + timedelta(days=DURACAO_DIAS),
            'duracao_dias': DURACAO_DIAS,
            'supervisor_id': supervisor.id,
            'setor_id': setor.id,
            'finalizada': False,
        },
    )

    # A identidade do projeto é "o único projeto da sprint sistêmica" — NUNCA o
    # nome (este projeto abandonou o casamento por nome de propósito).
    # `setor_id` explícito: o `Project.save()` real, que herdaria da sprint, não
    # roda em modelo histórico.
    projeto, _ = Project.objects.get_or_create(
        sprint_id=sprint.id,
        defaults={
            'nome': NOME_PROJETO,
            'descricao': 'Fluxo automático de acompanhamento dos formulários de '
                         'feedback pós-entrega.',
            'is_system': True,
            'setor_id': setor.id,
        },
    )

    for idx, (key, label, terminal) in enumerate(ETAPAS):
        stage, criada = KanbanStage.objects.get_or_create(
            key=key,
            defaults={
                'label': label,
                'is_terminal': terminal,
                'requires_required_data': False,
                'oculta_no_catalogo': True,
            },
        )
        if not criada and not stage.oculta_no_catalogo:
            KanbanStage.objects.filter(pk=stage.pk).update(oculta_no_catalogo=True)
        # SÓ neste projeto: é este recorte que impede as 3 etapas de virarem
        # coluna em qualquer outro board. E, pelo mesmo motivo, as 6 colunas
        # normais NÃO são configuradas aqui — repare que não existe o laço
        # "para todo projeto" da migration projects/0028.
        ProjectKanbanStageConfig.objects.update_or_create(
            project_id=projeto.id, stage_id=stage.id, defaults={'order': idx},
        )


def remover(apps, schema_editor):
    """Reversão conservadora: só desfaz o que claramente não está em uso.

    Nunca apaga a sprint/projeto se já houver card lá dentro — o pedido de
    feedback tem FK para o card, e apagar levaria dado real junto.
    """
    Sprint = apps.get_model('projects', 'Sprint')
    Project = apps.get_model('projects', 'Project')
    KanbanStage = apps.get_model('projects', 'KanbanStage')

    for sprint in Sprint.objects.filter(is_system=True):
        projetos = Project.objects.filter(sprint_id=sprint.id)
        if any(p.cards.exists() for p in projetos):
            continue
        projetos.delete()
        sprint.delete()
    KanbanStage.objects.filter(
        key__in=[k for k, _, _ in ETAPAS], project_configs__isnull=True,
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('feedbacks', '0002_seed_formulario_padrao'),
        # Os três campos novos (`Sprint.is_system`, `Card.gerar_formulario_feedback`,
        # `KanbanStage.oculta_no_catalogo`) precisam existir antes deste seed.
        ('projects', '0061_feedback_fase2'),
        # `SetorCatalogo` (com `is_system`) precisa existir para o setor técnico
        # do fluxo ser criado.
        ('accounts', '0016_seed_setor_padrao'),
    ]

    operations = [
        migrations.RunPython(semear, remover),
    ]
