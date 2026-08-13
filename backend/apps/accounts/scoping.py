"""Helpers de escopo por setor (segmentação da plataforma).

Regra: cada usuário vê apenas dados dos SEUS setores + dados compartilhados
com esses setores (fail-closed). Quem tem `view_cross_setor` (ou é superuser)
vê tudo. Enquanto `SETOR_SCOPING_ENABLED` for False, tudo é fail-open (nada
filtrado) — permite migrar/backfillar sem quebrar produção.

O escopo é ORTOGONAL às permissões granulares (`has_perm`): um usuário pode
ter permissão de editar sprint, mas só das sprints do seu setor.

## Por que estas funções resolvem ids antes de filtrar

A forma direta — `qs.filter(Q(setor__in=U) | Q(setores_compartilhados__in=U))`
— parece mais simples, mas o ORM traduz cada `Q` de M2M num LEFT JOIN. Em
`scope_cards` isso dava NOVE joins e obrigava um `.distinct()` para desfazer as
linhas duplicadas que os joins criam. Duas consequências medidas neste banco:

1. O `.distinct()` é um nó de deduplicação sobre o produto cartesiano — cresce
   com o volume de cards, que é justamente a tabela que precisa escalar.
2. Pior: `Count()` anotado ANTES do escopo conta as linhas duplicadas. As
   contagens de card por sprint/projeto vinham infladas de forma silenciosa
   assim que houvesse qualquer compartilhamento.

Resolver os ids primeiro (consultas pequenas, sobre as tabelas de vínculo, que
têm ordem de dezenas ou centenas de linhas) e filtrar por `pk__in` deixa a
consulta na tabela grande com um único predicado indexável, sem join e sem
dedupe. O custo passa a depender do número de sprints/projetos compartilhados,
não do número de cards.

Se um dia a lista de ids ficar grande demais para trafegar (na prática, acima
de ~10 mil projetos ou cards compartilhados), a troca é local: trocar o
`pk__in=<lista>` por `pk__in=<subquery>` dentro destas funções, sem tocar em
nenhum call-site. Reavaliar quando `projects_card` passar de 30 mil linhas ou
o p95 de `/api/cards/` passar de 500 ms com a flag ligada.
"""
from django.conf import settings
from django.db.models import Q

BYPASS_PERM = 'accounts.view_cross_setor'
# Setor semeado em accounts/0016_seed_setor_padrao — destino do conteúdo ainda
# não classificado e fallback de quem não tem setor primário.
SETOR_PADRAO_CODENAME = 'sem_setor'


def setores_do_usuario(user):
    """Conjunto de codenames de setor do usuário (via M2M UserSetor)."""
    return set(user.setores.values_list('codename', flat=True))


def setores_ids_do_usuario(user):
    """Ids dos setores do usuário, memoizados na instância.

    Ids em vez de codenames porque filtrar por `setor__codename` obriga o ORM a
    juntar `accounts_setorcatalogo` só para traduzir o texto — quatro joins a
    mais em `scope_cards`, que já é a consulta mais cara do sistema.
    """
    cache = getattr(user, '_setores_ids_cache', None)
    if cache is None:
        cache = set(user.setores.values_list('id', flat=True))
        try:
            user._setores_ids_cache = cache
        except AttributeError:  # objetos sem __dict__ (AnonymousUser)
            pass
    return cache


def setor_primario_do_usuario(user):
    """Objeto SetorCatalogo primário do usuário: vínculo M2M is_primary,
    senão qualquer vínculo M2M, senão o CharField legado `user.setor`.
    Retorna None se não houver nada."""
    from .models import SetorCatalogo, UserSetor
    vinculo = (UserSetor.objects.filter(user=user)
               .order_by('-is_primary', 'added_at')
               .select_related('setor')
               .first())
    if vinculo:
        return vinculo.setor
    if getattr(user, 'setor', None):
        return SetorCatalogo.objects.filter(codename=user.setor).first()
    return None


def setor_padrao_do_sistema():
    """Setor de destino de tudo que ainda não foi classificado ("Sem Setor",
    semeado em accounts/0016).

    Último recurso quando não há setor primário — sem ele, criar uma sprint
    estouraria IntegrityError, já que o campo é NOT NULL. Cai em "o primeiro
    setor que existir" se alguém tiver renomeado o padrão."""
    from .models import SetorCatalogo
    return (SetorCatalogo.objects.filter(codename=SETOR_PADRAO_CODENAME).first()
            or SetorCatalogo.objects.order_by('id').first())


def usuario_ve_tudo(user):
    return bool(getattr(user, 'is_superuser', False) or user.has_perm(BYPASS_PERM))


def _scoping_on():
    return getattr(settings, 'SETOR_SCOPING_ENABLED', False)


def _sem_escopo(user):
    """A consulta deve passar inteira? (flag desligada ou usuário com bypass)"""
    return not _scoping_on() or usuario_ve_tudo(user)


# --- Resolução dos ids compartilhados --------------------------------------
# Consultas pequenas, direto na tabela de vínculo (e não no model do conteúdo):
# é ela que tem o índice (setor, nivel) e ela cresce com o número de
# empréstimos, não com o número de cards.

def _ids_compartilhados(modelo, coluna, setores_ids, nivel=None):
    qs = modelo.objects.filter(setor_id__in=setores_ids)
    if nivel is not None:
        qs = qs.filter(nivel=nivel)
    return set(qs.values_list(coluna, flat=True))


def _sprints_compartilhadas(setores_ids, nivel=None):
    from apps.projects.models import SprintCompartilhamento
    return _ids_compartilhados(SprintCompartilhamento, 'sprint_id', setores_ids, nivel)


def _projetos_compartilhados(setores_ids, nivel=None):
    from apps.projects.models import ProjectCompartilhamento
    return _ids_compartilhados(ProjectCompartilhamento, 'project_id', setores_ids, nivel)


def _cards_compartilhados(setores_ids, nivel=None):
    from apps.projects.models import CardCompartilhamento
    return _ids_compartilhados(CardCompartilhamento, 'card_id', setores_ids, nivel)


def _projetos_visiveis_ids(setores_ids):
    """Projetos que o usuário enxerga: dos seus setores, compartilhados com
    ele, ou dentro de uma sprint compartilhada (a cascata)."""
    from apps.projects.models import Project

    condicao = Q(setor_id__in=setores_ids) | Q(pk__in=_projetos_compartilhados(setores_ids))
    sprints = _sprints_compartilhadas(setores_ids)
    if sprints:
        condicao |= Q(sprint_id__in=sprints)
    return set(Project.objects.filter(condicao).values_list('id', flat=True))


def scope_sprints(qs, user):
    if _sem_escopo(user):
        return qs
    setores = setores_ids_do_usuario(user)
    if not setores:
        return qs.none()
    return qs.filter(
        Q(setor_id__in=setores) | Q(pk__in=_sprints_compartilhadas(setores))
    )


def scope_projects(qs, user):
    if _sem_escopo(user):
        return qs
    setores = setores_ids_do_usuario(user)
    if not setores:
        return qs.none()
    return qs.filter(
        Q(setor_id__in=setores)
        | Q(pk__in=_projetos_compartilhados(setores))
        | Q(sprint_id__in=_sprints_compartilhadas(setores))
    )


def scope_cards(qs, user):
    """Card visível se o setor é dono, se o PRÓPRIO card foi compartilhado, ou
    se veio por herança do projeto/sprint (compartilhar em cascata)."""
    if _sem_escopo(user):
        return qs
    setores = setores_ids_do_usuario(user)
    if not setores:
        return qs.none()
    return qs.filter(
        Q(setor_id__in=setores)
        | Q(pk__in=_cards_compartilhados(setores))
        | Q(projeto_id__in=_projetos_visiveis_ids(setores))
    )


def scope_card_scores(qs, user):
    """Escopa CardScore pelo card dono. Mesma semântica do scope_cards, mas
    filtrando pelos ids de card já resolvidos — sem repetir a árvore."""
    if _sem_escopo(user):
        return qs
    setores = setores_ids_do_usuario(user)
    if not setores:
        return qs.none()
    return qs.filter(
        Q(card__setor_id__in=setores)
        | Q(card_id__in=_cards_compartilhados(setores))
        | Q(card__projeto_id__in=_projetos_visiveis_ids(setores))
    )


def scope_weekly_priorities(qs, user):
    """Escopa WeeklyPriority pelo CARD priorizado, não pelo usuário alvo.

    Uma prioridade é uma afirmação sobre um card, e o setor mora no card — o
    usuário alvo pode até ser de outro setor (alguém emprestado a um card
    compartilhado) sem que isso torne o card visível. `WeeklyPriority.card` é
    NOT NULL, então não existe prioridade órfã para decidir o que fazer: toda
    linha tem card e é o card que responde pela visibilidade."""
    if _sem_escopo(user):
        return qs
    setores = setores_ids_do_usuario(user)
    if not setores:
        return qs.none()
    return qs.filter(
        Q(card__setor_id__in=setores)
        | Q(card_id__in=_cards_compartilhados(setores))
        | Q(card__projeto_id__in=_projetos_visiveis_ids(setores))
    )


# --- Nível de acesso a UM item ---------------------------------------------
# As funções acima respondem "o que eu enxergo?". Estas respondem "o que eu
# posso fazer com este item?" — a pergunta que o gate de escrita faz.

ACESSO_DONO = 'dono'
ACESSO_EDICAO = 'edicao'
ACESSO_LEITURA = 'leitura'


def _niveis_que_alcancam(obj, setores_ids):
    """Níveis de todo compartilhamento que chega a `obj`: o dele e os dos
    ancestrais. Mesma cascata das queries de visibilidade — emprestar a sprint
    empresta o que está dentro dela."""
    from apps.formularios.models import ChamadoCompartilhamento, ChamadoSuporte
    from apps.projects.models import (Card, CardCompartilhamento, Project,
                                      ProjectCompartilhamento, Sprint,
                                      SprintCompartilhamento)

    def niveis(modelo, **filtro):
        return list(modelo.objects.filter(setor_id__in=setores_ids, **filtro)
                    .values_list('nivel', flat=True))

    if isinstance(obj, Sprint):
        return niveis(SprintCompartilhamento, sprint_id=obj.pk)
    if isinstance(obj, Project):
        encontrados = niveis(ProjectCompartilhamento, project_id=obj.pk)
        if obj.sprint_id:
            encontrados += niveis(SprintCompartilhamento, sprint_id=obj.sprint_id)
        return encontrados
    if isinstance(obj, Card):
        encontrados = niveis(CardCompartilhamento, card_id=obj.pk)
        if obj.projeto_id:
            encontrados += niveis(ProjectCompartilhamento, project_id=obj.projeto_id)
            sprint_id = (Project.objects.filter(pk=obj.projeto_id)
                         .values_list('sprint_id', flat=True).first())
            if sprint_id:
                encontrados += niveis(SprintCompartilhamento, sprint_id=sprint_id)
        return encontrados
    if isinstance(obj, ChamadoSuporte):
        return niveis(ChamadoCompartilhamento, chamado_id=obj.pk)
    return []


def nivel_de_acesso(user, obj):
    """Como este usuário alcança este item: 'dono', 'edicao', 'leitura' ou None.

    'dono' quando o item pertence a um setor dele — aí o compartilhamento nem
    entra na conta. Entre empréstimos, o mais permissivo vence: receber a
    sprint para edição e o card para leitura dá edição, porque o acesso mais
    amplo já foi concedido de propósito.

    Isto NÃO substitui `has_perm`: responde só o que o SETOR alcança. Quem não
    pode editar card em lugar nenhum continua não podendo aqui.
    """
    if _sem_escopo(user):
        return ACESSO_DONO
    setores = setores_ids_do_usuario(user)
    if not setores:
        return None
    if getattr(obj, 'setor_id', None) in setores:
        return ACESSO_DONO
    encontrados = _niveis_que_alcancam(obj, setores)
    if ACESSO_EDICAO in encontrados:
        return ACESSO_EDICAO
    if encontrados:
        return ACESSO_LEITURA
    return None


def pode_editar(user, obj):
    """O setor do usuário alcança este item com direito de escrita?"""
    return nivel_de_acesso(user, obj) in (ACESSO_DONO, ACESSO_EDICAO)


def checar_escrita_no_pai(user, pai):
    """Gate de CRIAÇÃO: escrever dentro de `pai` exige poder editar `pai`.

    O gate de objeto (`SetorPermiteEscrita`) só roda em rota de detalhe, e um
    POST não passa por lá. Sem esta checagem, quem recebesse um projeto só para
    leitura não poderia editar os cards existentes, mas poderia criar cards
    novos dentro dele — o furo exato que o nível de leitura deveria fechar.

    Silencioso quando a flag de escrita está desligada, como o resto do gate.
    """
    if pai is None or not getattr(settings, 'SETOR_WRITE_ENFORCEMENT_ENABLED', False):
        return
    if not pode_editar(user, pai):
        from rest_framework.exceptions import PermissionDenied
        raise PermissionDenied(
            f'«{pai}» foi compartilhado com o seu setor apenas para '
            'visualização — não é possível criar conteúdo dentro dele.')


def scope_card_logs(qs, user):
    """Histórico de um card: visível exatamente onde o card é visível.

    Mesma expressão de `scope_card_scores`. O log conta quem fez o quê e
    quando — deixá-lo fora do escopo entregaria a operação de um setor a
    qualquer um que soubesse o id do card."""
    if _sem_escopo(user):
        return qs
    setores = setores_ids_do_usuario(user)
    if not setores:
        return qs.none()
    return qs.filter(
        Q(card__setor_id__in=setores)
        | Q(card_id__in=_cards_compartilhados(setores))
        | Q(card__projeto_id__in=_projetos_visiveis_ids(setores))
    )


# --- Satélites do card ------------------------------------------------------
# Event, CardAnexo, CardPin, CardDueDateChangeRequest e CardReopenRequest não
# têm setor próprio:
# nenhum deles existe fora de um card, então quem responde pela visibilidade é
# sempre o CARD dono. Escopar pelo autor (quem comentou, quem anexou, quem
# pediu o prazo) seria errado por dois lados: esconderia do resto do setor um
# registro que é do time, e continuaria mostrando o card alheio para quem
# escreveu nele. Todos repetem a expressão de `scope_card_scores` de propósito
# — é a mesma pergunta ("este card é meu?"), respondida sobre a FK `card`.

def scope_events(qs, user):
    """Eventos (pendência/prioridade/tag/comentário) visíveis onde o card é.

    `Event.card` é NOT NULL no modelo (apps/projects/models.py — a FK não
    declara `null=True`), então não existe evento de agenda pessoal nem evento
    órfão: toda linha tem card e nenhuma escapa do filtro. Se um dia a FK virar
    nulável, esta função precisa decidir explicitamente o que fazer com o
    evento sem card — hoje a questão não se coloca, e por isso NÃO há aqui a
    cláusula `Q(card__isnull=True)` que `scope_chamados` tem.
    """
    if _sem_escopo(user):
        return qs
    setores = setores_ids_do_usuario(user)
    if not setores:
        return qs.none()
    return qs.filter(
        Q(card__setor_id__in=setores)
        | Q(card_id__in=_cards_compartilhados(setores))
        | Q(card__projeto_id__in=_projetos_visiveis_ids(setores))
    )


def scope_card_anexos(qs, user):
    """Anexos visíveis exatamente onde o card é visível.

    Aqui o escopo protege mais do que metadado: o serializer devolve a
    `arquivo_url` absoluta e `/media/` só exige estar autenticado, então
    entregar a linha do anexo é entregar o arquivo (planilha, PDF, print) de
    outro setor. O anexo não tem setor próprio — quem manda é o card.
    """
    if _sem_escopo(user):
        return qs
    setores = setores_ids_do_usuario(user)
    if not setores:
        return qs.none()
    return qs.filter(
        Q(card__setor_id__in=setores)
        | Q(card_id__in=_cards_compartilhados(setores))
        | Q(card__projeto_id__in=_projetos_visiveis_ids(setores))
    )


def scope_card_pins(qs, user):
    """Fixações visíveis onde o CARD fixado é visível.

    `CardPin` tem FK para usuário e para card, e o escopo é pelo CARD, não pelo
    dono do pin: filtrar por `user=request.user` responde "é meu pin?", que é
    privacidade, não segmentação. Um pin criado sobre um card de outro setor
    (ou sobre um card que depois saiu do escopo) continuaria renderizando o
    `card_detail` completo desse card para o dono do pin. É esse resíduo que
    esta função corta — o gate de criação é outro, no `validate_card`.
    """
    if _sem_escopo(user):
        return qs
    setores = setores_ids_do_usuario(user)
    if not setores:
        return qs.none()
    return qs.filter(
        Q(card__setor_id__in=setores)
        | Q(card_id__in=_cards_compartilhados(setores))
        | Q(card__projeto_id__in=_projetos_visiveis_ids(setores))
    )


def scope_card_date_change_requests(qs, user):
    """Solicitações de mudança de prazo visíveis onde o card é visível.

    A fila de pedidos carrega o card inteiro e o `reason` em texto livre (o
    motivo do atraso, escrito por gente do setor dono), então ela é tão
    sensível quanto o card. Escopar aqui também fecha o lado da escrita sem
    código extra: `approve`, `reject` e `destroy` saem todos de `get_object()`,
    que passa a dar 404 fora do escopo.
    """
    if _sem_escopo(user):
        return qs
    setores = setores_ids_do_usuario(user)
    if not setores:
        return qs.none()
    return qs.filter(
        Q(card__setor_id__in=setores)
        | Q(card_id__in=_cards_compartilhados(setores))
        | Q(card__projeto_id__in=_projetos_visiveis_ids(setores))
    )


def scope_card_reopen_requests(qs, user):
    """Solicitações de reabertura visíveis onde o card é visível.

    Mesma expressão do irmão `scope_card_date_change_requests`, e pela mesma
    razão: a fila devolve o `card_detail` inteiro e um `reason` em texto livre
    (por que aquele trabalho encerrado precisa voltar), então ela é tão sensível
    quanto o card — quem responde pela visibilidade é sempre o CARD dono, nunca
    o autor do pedido.

    Escopar aqui fecha o lado da VISIBILIDADE de uma vez: `approve`, `reject`,
    `update` e `destroy` saem todos de `get_object()`, que passa a dar 404 fora
    do escopo em vez de ressuscitar o card de outro setor. NÃO fecha o lado da
    ESCRITA — card emprestado em nível 'leitura' continua VISÍVEL —, e por isso
    o `approve` chama `checar_escrita_no_pai` explicitamente.
    """
    if _sem_escopo(user):
        return qs
    setores = setores_ids_do_usuario(user)
    if not setores:
        return qs.none()
    return qs.filter(
        Q(card__setor_id__in=setores)
        | Q(card_id__in=_cards_compartilhados(setores))
        | Q(card__projeto_id__in=_projetos_visiveis_ids(setores))
    )


def scope_chamados(qs, user):
    """Chamados de suporte visíveis: do setor dono ou compartilhados com ele.

    Chamados sem setor (`setor__isnull`) permanecem visíveis — o vínculo é
    best-effort (derivado por e-mail na criação) e esconder um chamado órfão
    faria alguém perder um pedido de ajuda."""
    if _sem_escopo(user):
        return qs
    from apps.formularios.models import ChamadoCompartilhamento
    setores = setores_ids_do_usuario(user)
    if not setores:
        return qs.none()
    compartilhados = _ids_compartilhados(
        ChamadoCompartilhamento, 'chamado_id', setores)
    return qs.filter(
        Q(setor_id__in=setores)
        | Q(pk__in=compartilhados)
        | Q(setor__isnull=True)
    )


def scope_users(qs, user):
    """Usuários visíveis: os que compartilham algum setor com o operador
    (mais ele mesmo). Sem setor → só a si mesmo."""
    if _sem_escopo(user):
        return qs
    from .models import UserSetor
    setores = setores_ids_do_usuario(user)
    if not setores:
        return qs.filter(pk=user.pk)
    colegas = set(
        UserSetor.objects.filter(setor_id__in=setores).values_list('user_id', flat=True)
    )
    colegas.add(user.pk)
    return qs.filter(pk__in=colegas)


# --- Querysets para campo GRAVÁVEL de serializer ----------------------------
# As funções acima respondem "o que eu enxergo?". Estas respondem "onde eu
# posso pendurar coisa?" — servem de `queryset=` em PrimaryKeyRelatedField.
#
# Por que a flag que manda aqui é a DE ESCRITA (`SETOR_WRITE_ENFORCEMENT_ENABLED`)
# e não a de visibilidade: restringir o queryset de um campo gravável faz o DRF
# responder "objeto inválido" na validação, ou seja, RECUSA UMA ESCRITA. Se
# elas obedecessem à flag de visibilidade, ligar só a visibilidade já começaria
# a barrar `PATCH`/`POST` — exatamente o acoplamento que as duas flags separadas
# existem para evitar (ver o comentário delas em config/settings.py).
#
# São a versão declarativa do `checar_escrita_no_pai`: mesmo predicado, só que
# aplicado antes, no campo, para que o alvo fora do escopo sequer seja
# resolvível — o que impede de vazar o objeto de volta no `*_detail` da resposta
# (o PATCH que muda o pai devolve o pai novo serializado).
#
# `nivel='edicao'` porque item emprestado só para LEITURA não pode receber
# conteúdo: aceitar um card num projeto emprestado para leitura seria escrever
# dentro dele. Setor dono entra sempre, sem olhar compartilhamento.

def sprints_editaveis(user):
    """Sprints em que o usuário pode escrever: das dele, ou emprestadas ao
    setor dele em nível 'edicao'. Para o campo `sprint` de ProjectSerializer."""
    from apps.projects.models import Sprint

    # Inline em vez de `_sem_escopo` de propósito: aquele lê a flag de
    # VISIBILIDADE, e aqui quem manda é a de escrita.
    if (not getattr(settings, 'SETOR_WRITE_ENFORCEMENT_ENABLED', False)
            or usuario_ve_tudo(user)):
        return Sprint.objects.all()
    setores = setores_ids_do_usuario(user)
    if not setores:
        return Sprint.objects.none()
    return Sprint.objects.filter(
        Q(setor_id__in=setores)
        | Q(pk__in=_sprints_compartilhadas(setores, nivel=ACESSO_EDICAO))
    )


def projetos_editaveis(user):
    """Projetos em que o usuário pode escrever: dos setores dele, emprestados
    em 'edicao', ou dentro de uma sprint emprestada em 'edicao' (a mesma
    cascata de `nivel_de_acesso` — emprestar a sprint para edição empresta o
    que está dentro dela). Para o campo `projeto` de CardSerializer."""
    from apps.projects.models import Project

    if (not getattr(settings, 'SETOR_WRITE_ENFORCEMENT_ENABLED', False)
            or usuario_ve_tudo(user)):
        return Project.objects.all()
    setores = setores_ids_do_usuario(user)
    if not setores:
        return Project.objects.none()
    return Project.objects.filter(
        Q(setor_id__in=setores)
        | Q(pk__in=_projetos_compartilhados(setores, nivel=ACESSO_EDICAO))
        | Q(sprint_id__in=_sprints_compartilhadas(setores, nivel=ACESSO_EDICAO))
    )


def cards_editaveis(user):
    """Cards em que o usuário pode escrever: dos setores dele, emprestados em
    'edicao', ou dentro de um projeto editável (que já traz a cascata da
    sprint). Para campos graváveis que apontam para card — CardPin.card,
    Event.card, CardAnexo.card, CardDueDateChangeRequest.card.

    O `Card.setor_id` é espelhado do projeto no `save()`, então o primeiro
    termo já cobre "card de projeto do meu setor"; a resolução dos projetos
    editáveis existe para os casos de EMPRÉSTIMO, em que o setor do card
    continua sendo o do dono."""
    from apps.projects.models import Card

    if (not getattr(settings, 'SETOR_WRITE_ENFORCEMENT_ENABLED', False)
            or usuario_ve_tudo(user)):
        return Card.objects.all()
    setores = setores_ids_do_usuario(user)
    if not setores:
        return Card.objects.none()
    # Ids resolvidos antes, como no resto do módulo: mantém o filtro no Card
    # (a tabela grande) com um único predicado indexável, sem join nem dedupe.
    projetos_ids = set(projetos_editaveis(user).values_list('id', flat=True))
    return Card.objects.filter(
        Q(setor_id__in=setores)
        | Q(pk__in=_cards_compartilhados(setores, nivel=ACESSO_EDICAO))
        | Q(projeto_id__in=projetos_ids)
    )
