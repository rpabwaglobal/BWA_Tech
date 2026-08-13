"""
A ESTRUTURA do fluxo "Monitoramento de Feedbacks" e o que acontece na entrega.

Duas funções, e a divisão entre elas é a divisão entre "onde os cards moram" e
"quando os cards nascem":

  - `garantir_estrutura_monitoramento()`  cria (uma vez, idempotente) a sprint
    sistêmica, o projeto oculto e as 3 etapas com a config do board;

  - `gerar_pedidos_do_projeto()`  roda quando um projeto vira ENTREGUE: para
    cada card marcado, chama o motor da fase 1 e cria o card de exibição.

>>> ESTE ARQUIVO É GÊMEO DE `migrations/0003_seed_monitoramento.py`. <<<
As mesmas três criações estão escritas lá com `apps.get_model`, de propósito e
não por descuido: migration é retrato congelado do schema e NUNCA importa código
de app — se esta função ganhar um campo amanhã, a migration antiga continuaria
rodando com o código novo e quebraria bancos antigos. Quando mexer aqui, decida
CONSCIENTEMENTE se a migration precisa de uma irmã nova (normalmente não: a
função abaixo é auto-curativa e conserta o banco sozinha na primeira entrega).

POR QUE A AUTO-CURA EXISTE: `Sprint.supervisor` é NOT NULL com PROTECT. Num
banco recém-migrado pode não existir usuário nenhum, e a migration tem de PULAR
o seed sem quebrar. Com a chamada daqui, o gatilho conserta na primeira entrega
— e a suíte de testes não precisa montar a estrutura à mão em cada caso.

NÃO EXISTE E-MAIL EM LUGAR NENHUM: o link nasce com o pedido e é enviado À MÃO
por uma pessoa, que copia do card.
"""
from __future__ import annotations

import logging
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

logger = logging.getLogger(__name__)

NOME_PROJETO_MONITORAMENTO = 'Monitoramento de Feedbacks'
NOME_SPRINT_SISTEMICA = 'Monitoramento de Feedbacks'

# O SETOR TÉCNICO DO FLUXO — e por que ele NÃO é `sem_setor`.
#
# A primeira versão desta função ancorava sprint, projeto e cards no setor
# padrão do sistema, com o argumento de que "`sem_setor` não é setor de trabalho
# de ninguém, logo ninguém enxerga (fail-closed)". O argumento é FALSO neste
# sistema, e `apps.accounts` diz isso em três lugares:
#
#   - a migration accounts/0016 vincula TODO usuário existente a `sem_setor`;
#   - `RegisterSerializer.create` põe toda conta NOVA em `sem_setor`;
#   - `aplicar_regra_do_setor_padrao` documenta o efeito com todas as letras: o
#     vínculo com o balde "entregaria a essa pessoa todo o conteúdo NÃO
#     CLASSIFICADO da empresa".
#
# `sem_setor` não é "de ninguém": é o setor de todo mundo que ainda não foi
# classificado (no banco de desenvolvimento deste projeto, 14 dos 15 vínculos).
# Com `SETOR_SCOPING_ENABLED` ligada, cada um deles receberia TODO card de
# feedback da empresa pelo termo `Q(setor_id__in=setores)` de `scope_cards` — e,
# junto, a `url_publica`, que é a credencial INTEIRA da rota anônima.
#
# O setor abaixo existe para que a frase original passe a ser verdadeira: é
# técnico, `is_system=True` (não excluível pela tela) e NENHUM caminho do
# produto vincula usuário a ele. Quem precisa ver um card de feedback entra
# pelo `CardCompartilhamento` que `_gerar_pedido_do_card` cria, um a um, para o
# setor que ENTREGOU — que continua sendo a única porta.
#
# Efeito colateral aceito e consciente: ele aparece no catálogo de setores das
# Configurações. É o preço de ter um dono que não é ninguém, e é reversível na
# tela por um administrador (que aí estará decidindo, e não herdando em
# silêncio).
SETOR_MONITORAMENTO_CODENAME = 'monitoramento_feedbacks'
SETOR_MONITORAMENTO_NOME = 'Monitoramento de Feedbacks'
SETOR_MONITORAMENTO_DESCRICAO = (
    'Setor técnico do fluxo de feedbacks pós-entrega. Nenhum usuário deve ser '
    'vinculado a ele: cada card é emprestado ao setor que entregou o trabalho.'
)

# ~100 anos. `Sprint.fechamento_em` é NOT NULL e `duracao_dias` tem
# MinValueValidator(1), então "nunca fecha" precisa ser escrito como uma data
# absurdamente distante. O efeito colateral ("aparece como em andamento") é
# exatamente o que `Sprint.is_system` corta — ver o comentário do campo.
DURACAO_DIAS_SISTEMICA = 36500


def etapas_monitoramento():
    """As 4 colunas do board de monitoramento: (key, label, is_terminal).

    As KEYS são LITERALMENTE os valores de `EstadoPedido`. Não é coincidência: é
    o que faz a sincronização card↔pedido ser um `update(status=estado)` e não
    uma tabela de-para.

    NÃO RENOMEAR NEM PREFIXAR AS TRÊS PRIMEIRAS: `Card.status` é
    CharField(max_length=20) e 'aguardando_resposta' já tem 19 caracteres. Um
    prefixo 'feedback_' estoura — DataError no Postgres, silêncio no SQLite. A
    quarta NASCEU com o prefixo e tem 18 chars, que é o motivo de ela caber (ver
    o comentário de `EstadoPedido.ENCERRADO`).

    `requires_required_data=False` nas quatro porque nenhuma delas pede nada de
    um humano: as transições vêm da varredura dos 30 dias, da resposta anônima e
    — só na última — do arraste de quem decide encerrar a coleta.

    'feedback_encerrado' entra por ÚLTIMO (order=3) porque é o fim da linha do
    fluxo, e com `is_terminal=True` pelo mesmo motivo que 'respondido': o flag é
    rótulo de leitura do board, não trava de movimento (`_card_edicao_restrita`
    olha `Card.status`, não `KanbanStage.is_terminal`), então marcá-lo NÃO impede
    arrastar o card de volta — que é literalmente o requisito.
    """
    from .models import EstadoPedido

    return [
        (EstadoPedido.AGUARDANDO_PRAZO, 'Aguardando 30 dias', False),
        (EstadoPedido.AGUARDANDO_RESPOSTA, 'Aguardando Feedback', False),
        (EstadoPedido.RESPONDIDO, 'Feedback colhido', True),
        (EstadoPedido.ENCERRADO, 'Feedback Finalizado', True),
    ]


def setor_do_monitoramento():
    """O setor técnico do fluxo, criado sob demanda. IDEMPOTENTE.

    `get_or_create` pelo codename (que é unique), como todo o resto deste
    módulo. Diferente do supervisor, aqui NÃO existe o caso "não dá para criar":
    o setor não depende de nenhuma linha pré-existente, então esta função nunca
    devolve None — o que também remove um caminho de desistência silenciosa que
    a versão anterior tinha quando o catálogo estava vazio.
    """
    from apps.accounts.models import SetorCatalogo

    setor, _ = SetorCatalogo.objects.get_or_create(
        codename=SETOR_MONITORAMENTO_CODENAME,
        defaults={
            'nome': SETOR_MONITORAMENTO_NOME,
            # `is_system=True` só o seed consegue marcar (a API força False), e
            # é ele que impede a exclusão pela tela — sem isso, apagar o setor
            # tentaria derrubar sprint, projeto e cards presos por PROTECT.
            'is_system': True,
            'descricao': SETOR_MONITORAMENTO_DESCRICAO,
        },
    )
    return setor


def _supervisor_para_a_sprint(preferido=None):
    """Quem assina a sprint sistêmica. `None` se o banco não tiver usuário algum.

    Preferência pelo SUPERUSER: `Sprint.supervisor` é PROTECT, ou seja, esse
    usuário passa a não poder mais ser excluído. Prender um superuser
    (que ninguém apaga mesmo) é menos incômodo do que prender uma conta comum.
    """
    from django.contrib.auth import get_user_model

    User = get_user_model()
    return (
        User.objects.filter(is_superuser=True, is_active=True).order_by('id').first()
        or preferido
        or User.objects.filter(is_active=True).order_by('id').first()
        or User.objects.order_by('id').first()
    )


def garantir_estrutura_monitoramento(supervisor=None):
    """Cria (ou devolve) o projeto oculto de monitoramento. IDEMPOTENTE.

    Devolve o `Project`, ou `None` no ÚNICO caso em que não há como criar: banco
    sem usuário nenhum para ser supervisor (`Sprint.supervisor` é NOT NULL) — o
    chamador loga e desiste, e a próxima entrega tenta de novo. O SETOR nunca é
    motivo de desistência: ele é criado aqui mesmo, sem depender de nada.

    A IDENTIDADE de cada peça, e por que ela é essa:
      - setor   -> `codename` do setor TÉCNICO do fluxo. NÃO é `sem_setor`: ver
                   o comentário de `SETOR_MONITORAMENTO_CODENAME`, que é a
                   correção de um vazamento dormente de visibilidade.
      - sprint  -> `is_system=True` É a chave. Ela diz a verdade: existe NO
                   MÁXIMO UMA sprint sistêmica.
      - projeto -> "o único projeto da sprint sistêmica". Nunca o NOME: este
                   projeto abandonou o casamento por nome de propósito (ver o
                   comentário de `Project.is_system`).
      - etapas  -> `key`, que já é unique no catálogo global.

    ORDEM QUE SALVA O BOARD: projeto e as 3 configs nascem na MESMA transação.
    `_ensure_project_default_kanban_config` (projects/views.py) injeta as 6
    colunas normais em QUALQUER projeto que esteja com zero configs — uma janela
    de um instante sem config deixaria o board de monitoramento com as 6 colunas
    erradas para sempre.
    """
    from apps.projects.models import (
        Card, KanbanStage, Project, ProjectKanbanStageConfig, Sprint,
    )

    setor = setor_do_monitoramento()

    supervisor = _supervisor_para_a_sprint(supervisor)
    if supervisor is None:
        logger.error(
            'Feedback: sem usuário para ser supervisor — a estrutura de '
            'monitoramento não pôde ser criada.')
        return None

    agora = timezone.now()
    with transaction.atomic():
        sprint, _ = Sprint.objects.get_or_create(
            is_system=True,
            defaults={
                'nome': NOME_SPRINT_SISTEMICA,
                'data_inicio': agora,
                'fechamento_em': agora + timedelta(days=DURACAO_DIAS_SISTEMICA),
                'duracao_dias': DURACAO_DIAS_SISTEMICA,
                'supervisor': supervisor,
                # O SETOR TÉCNICO DO FLUXO (ver o comentário da constante lá em
                # cima), e não um setor real nem o balde `sem_setor`: em
                # `scope_cards`, o termo `Q(setor_id__in=setores)` entregaria
                # todos os feedbacks da empresa a quem quer que seja dono deste
                # setor. Aqui ninguém é — e quem precisa ver entra pelo
                # compartilhamento por card que `_gerar_pedido_do_card` cria.
                'setor': setor,
                # `finalizada=False` PARA SEMPRE: se virar True,
                # `_sprint_efetivamente_fechada` torna todo card de feedback
                # "edição restrita" e `_sprint_is_active` desliga o realtime do
                # board.
                'finalizada': False,
            },
        )

        projeto, _ = Project.objects.get_or_create(
            sprint=sprint,
            defaults={
                'nome': NOME_PROJETO_MONITORAMENTO,
                'descricao': 'Fluxo automático de acompanhamento dos formulários de '
                             'feedback pós-entrega.',
                # Oculto do produto: fora das métricas, do bulk-archive/delete e
                # da listagem principal de projetos.
                'is_system': True,
                'setor': setor,
            },
        )

        # RECONCILIAÇÃO DO SETOR — para o banco onde o seed ANTERIOR já rodou.
        # Uma versão antiga desta função ancorava tudo em `sem_setor`; deixar
        # aquele estado de pé seria manter o vazamento em silêncio justamente
        # nas instalações que já entregaram projetos. Como esta função roda a
        # cada entrega, a correção chega sozinha — ninguém precisa rodar nada à
        # mão. `.update()` e não `save()`: `Card.save()` reescreveria o setor a
        # partir do projeto e desfaria a correção no mesmo instante.
        if sprint.setor_id != setor.pk:
            Sprint.objects.filter(pk=sprint.pk).update(setor=setor)
            sprint.setor_id = setor.pk
        if projeto.setor_id != setor.pk:
            Project.objects.filter(pk=projeto.pk).update(setor=setor)
            projeto.setor_id = setor.pk
            logger.warning(
                'Feedback: fluxo de monitoramento movido para o setor técnico '
                '«%s» (estava em outro setor, o que o exporia a quem fosse dono '
                'dele com a segmentação ligada).', SETOR_MONITORAMENTO_CODENAME)
        Card.objects.filter(projeto_id=projeto.pk).exclude(setor_id=setor.pk).update(
            setor=setor)

        for idx, (key, label, terminal) in enumerate(etapas_monitoramento()):
            stage, criada = KanbanStage.objects.get_or_create(
                key=key,
                defaults={
                    'label': label,
                    'is_terminal': terminal,
                    'requires_required_data': False,
                    'oculta_no_catalogo': True,
                },
            )
            # Reconcilia um banco que já tenha a etapa sem o flag (ex.: criada à
            # mão antes deste deploy) — sem isso ela voltaria ao seletor de
            # "adicionar coluna" dos projetos comuns.
            if not criada and not stage.oculta_no_catalogo:
                KanbanStage.objects.filter(pk=stage.pk).update(oculta_no_catalogo=True)

            # SÓ NESTE PROJETO. É este recorte — e não a existência da etapa —
            # que decide quais colunas um board desenha. Por isso as 3 etapas não
            # vazam para projeto nenhum, e as 6 normais não aparecem aqui.
            ProjectKanbanStageConfig.objects.update_or_create(
                project=projeto, stage=stage, defaults={'order': idx},
            )

    return projeto


def gerar_pedido_do_card_finalizado(card_id: int) -> dict:
    """Gera o pedido e o card de exibição de UM card recém-finalizado.

    >>> O EIXO É O CARD, NÃO O PROJETO. <<<
    Neste sistema o projeto é uma PASTA que agrupa cards; quem tem data de
    entrega e homologação é o card. A versão anterior desta função observava
    `Project.status` virando 'entregue' — e os dados mostraram que aquilo nunca
    acontece (106 de 106 projetos em 'criado', nenhum com `data_entrega`). O
    gatilho ficava mudo e a feature, inerte.

    Chamada de `transaction.on_commit` no signal do Card — e por isso o corpo
    INTEIRO está embrulhado em try/except: um callback de `on_commit` que levanta
    propaga para quem fez o commit, ou seja, o PATCH do card responderia 500 COM
    O DADO JÁ GRAVADO. Aqui nada sobe; a falha vira `logger.exception` e um
    contador. É falha silenciosa POR DESENHO, e o log é o único aviso — a mesma
    escolha que a task do motor (`tasks.py`) já faz.
    """
    resumo = {'pedidos': 0, 'cards': 0, 'falhas': 0}
    try:
        from apps.projects.models import Card

        card = (
            Card.objects.select_related('projeto', 'projeto__sprint')
            .filter(pk=card_id)
            .first()
        )
        if card is None or not card.gerar_formulario_feedback:
            return resumo

        # O próprio fluxo de monitoramento nunca gera feedback de si mesmo —
        # senão um card de feedback finalizado geraria outro, e assim por diante.
        sprint = getattr(card.projeto, 'sprint', None) if card.projeto_id else None
        if sprint is not None and sprint.is_system:
            return resumo

        # A DATA DE ENTREGA É `finalizado_em`, e ela é confiável: preenchida
        # automaticamente em 688 de 688 cards finalizados do banco. É o instante
        # observável da entrega — diferente de `Project.data_entrega`, que
        # ninguém preenche, e de `data_fim`, que é o PRAZO combinado e pode
        # estar no passado ou no futuro em relação à conclusão real.
        #
        # `timezone.localdate(dt)` e JAMAIS `dt.date()`: o campo é DateTimeField
        # gravado em UTC, e essa conversão errada já causou bug neste projeto
        # (das 21h à meia-noite as duas datas apontam para dias diferentes).
        #
        # Fallback para hoje só se `finalizado_em` vier vazio — caminho que os
        # dados dizem não existir, mas que um save por outro caminho poderia
        # produzir; melhor um dia aproximado do que nenhum pedido.
        data_ref = (
            timezone.localdate(card.finalizado_em)
            if card.finalizado_em
            else timezone.localdate()
        )

        projeto_monitoramento = garantir_estrutura_monitoramento(
            supervisor=getattr(sprint, 'supervisor', None),
        )
        if projeto_monitoramento is None:
            resumo['falhas'] += 1
            return resumo

        # `card.nome` como referência pública: decisão explícita do usuário
        # ("o nome do projeto no form deve ser na verdade o nome do card").
        # No domínio dele o card É a entrega avaliada.
        _gerar_pedido_do_card(
            card, projeto_monitoramento, data_ref, resumo, referencia=card.nome,
        )
    except Exception:  # noqa: BLE001 — roda em on_commit; nada pode subir
        resumo['falhas'] += 1
        logger.exception('Feedback: falha ao gerar o pedido do card %s', card_id)

    if resumo['pedidos'] or resumo['falhas']:
        logger.info(
            'Feedback: card %s finalizado -> %s pedido(s), %s card(s) novo(s), %s falha(s).',
            card_id, resumo['pedidos'], resumo['cards'], resumo['falhas'],
        )
    return resumo


def _gerar_pedido_do_card(card, projeto_monitoramento, data_ref, resumo, referencia) -> None:
    """A ORDEM AQUI É O QUE IMPEDE CARD DUPLICADO NA REENTREGA.

    E ela é o INVERSO da intuitiva. A ordem ingênua — "crio o card e depois
    chamo o motor passando `card_kanban_id`" — produz um card ÓRFÃO a cada nova
    entrega, porque `card_kanban_id` é `defaults` do `get_or_create` do motor e é
    IGNORADO na segunda chamada: o pedido continuaria apontando para o card
    antigo e o novo ficaria parado no board sem dono.

    A ordem correta é:
      1. chamar o motor SEM `card_kanban_id`  (idempotente por constraint);
      2. `if pedido.card_kanban_id: return`   ← A GUARDA DE REENTREGA, lida
         direto do OneToOne que a fase 1 já mantém;
      3. só então criar o Card, com `status=pedido.estado` — NUNCA
         'aguardando_prazo' cravado: se o projeto for reentregue depois de o
         pedido já ter sido promovido, o card novo tem de nascer na coluna certa;
      4. amarrar com `filter(card_kanban__isnull=True).update(...)` — o
         `isnull=True` no WHERE é quem decide a corrida entre dois workers;
         rowcount 0 significa que o outro ganhou, então o card recém-criado é
         apagado;
      5. compartilhar o card com o setor de origem.

    O CARD ORIGINAL NÃO É TOCADO em nenhum passo: não muda de status, não muda de
    projeto, não muda de sprint. O card de monitoramento é NOVO.
    """
    from apps.accounts.models import NivelCompartilhamento
    from apps.projects.models import Card, CardCompartilhamento

    from .models import PedidoFeedback
    from .services import criar_pedido_feedback

    with transaction.atomic():
        pedido = criar_pedido_feedback(
            card_id=card.pk,
            data_referencia=data_ref,
            # `referencia_publica` = o nome do CARD.
            #
            # O formulário abre com o campo 1.1 rotulado "Nome do projeto:",
            # preenchido automaticamente daqui — é EXIBIÇÃO, não resposta, e é a
            # única coisa do sistema que um anônimo vê.
            #
            # O RÓTULO vem do formulário; o VALOR é o nome do card, por decisão
            # explícita do usuário. A regra da cardinalidade é o que torna isso
            # coerente: um pedido POR CARD MARCADO. Cinco cards marcados do mesmo
            # projeto geram cinco links, e é o nome do card que diz a QUAL das
            # cinco entregas cada link se refere — com o nome do projeto os cinco
            # exibiriam a mesma string e quem recebesse dois não saberia
            # distinguir o que está avaliando.
            #
            # O que continua valendo, independente da escolha: a página pública
            # devolve só {titulo, subtitulo, referencia, campos} — sem setor, sem
            # responsável, sem sprint, sem id, sem valores, sem join nenhum.
            # Como `referencia` é texto livre digitado pela equipe, quem nomear
            # um card com dado sensível o expõe a quem tiver o link; o mesmo já
            # valeria para o nome do projeto.
            #
            # PEDIDO JÁ CRIADO NÃO MUDA: `referencia_publica` vive nos
            # `defaults` do `get_or_create` (services.py), e `defaults` só se
            # aplica na CRIAÇÃO. Renomear o card depois não altera link nenhum
            # já gerado — a cópia congelada funcionando como projetada, para que
            # o registro guarde o que a pessoa de fato viu na tela.
            referencia_publica=referencia,
        )
        resumo['pedidos'] += 1

        if pedido.card_kanban_id:
            # REENTREGA: o card de exibição já existe. Nada a fazer — nem um
            # segundo card, nem um segundo link.
            return

        card_kanban = Card.objects.create(
            nome=card.nome,
            # Sem nome de projeto nem de setor na descrição: este card é
            # emprestado a outro setor logo abaixo e o board é do fluxo interno.
            descricao=f'Acompanhamento do formulário de feedback do card #{card.pk}.',
            projeto=projeto_monitoramento,
            # Área e tipo copiados do card original só para o board ficar legível
            # (são os mesmos badges do card de origem).
            area=card.area,
            tipo=card.tipo,
            prioridade=card.prioridade,
            # A coluna sai do ESTADO DO PEDIDO, que é a fonte da verdade.
            status=pedido.estado,
            # Nasce SEM responsável e SEM prazo: não é trabalho de ninguém, é um
            # lembrete. Sem responsável também não dispara notificação.
        )

        vinculou = PedidoFeedback.objects.filter(
            pk=pedido.pk, card_kanban__isnull=True,
        ).update(card_kanban=card_kanban)
        if vinculou != 1:
            # Outro worker amarrou primeiro (o OneToOne recusaria o segundo de
            # qualquer forma). Desfaz o card recém-criado e segue.
            card_kanban.delete()
            return
        resumo['cards'] += 1

        # SETOR — o ponto que só quebra DEPOIS, quando `SETOR_SCOPING_ENABLED`
        # for ligada, e por isso é resolvido agora:
        #
        # `Card.save()` sobrescreve `setor_id` com o do PROJETO em todo save, e o
        # projeto de monitoramento é do setor TÉCNICO do fluxo, que não é de
        # ninguém. Sem mais nada, `scope_cards` esconderia o card de TODO MUNDO —
        # inclusive do time que entregou o trabalho e é justamente quem precisa
        # copiar o link para cobrar o feedback. Fail-closed, seguro, e inútil.
        #
        # O mecanismo previsto pelo próprio modelo para este caso é o
        # compartilhamento pontual (ver o comentário de
        # `Card.setores_compartilhados`): "empresta ESTE card a outros setores
        # sem mover o projeto inteiro... é o único jeito de dar acesso a um card
        # específico". Resolve sem tocar em `Card.save()`, sem tornar
        # `Project.setor` nulável e sem exigir um projeto de monitoramento por
        # setor (o usuário pediu UM projeto oculto).
        #
        # QUEM PASSA A ENXERGAR: só o setor que ENTREGOU (e quem tem
        # `view_cross_setor`/superuser). O resto da empresa não.
        #
        # `nivel=LEITURA` porque o card é PROJEÇÃO — ninguém deve editá-lo. E o
        # nível não atrapalha o link: `_cards_compartilhados` é consultado SEM
        # nível em `scope_cards`, então LEITURA já basta para o endpoint de
        # pedidos devolver a `url_publica` a quem entregou.
        #
        # LIMITE HONESTO E ACEITO: é um RETRATO do setor no momento da entrega,
        # igual a `referencia_publica`. Se o projeto original mudar de setor
        # depois, o vínculo fica velho. Corrigir isso exigiria observar mudança
        # de setor de projeto, que ninguém pediu.
        #
        # `card.setor_id` já É o espelho do projeto original — nenhum join.
        if card.setor_id:
            CardCompartilhamento.objects.get_or_create(
                card=card_kanban,
                setor_id=card.setor_id,
                defaults={'nivel': NivelCompartilhamento.LEITURA},
            )
