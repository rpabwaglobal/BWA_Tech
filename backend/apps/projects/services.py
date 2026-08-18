"""
Serviços de negócio para o app projects.
"""
from collections import defaultdict

from django.db import models, transaction
from django.utils import timezone

from .models import (Sprint, Project, ProjectCompartilhamento, Card, CardStatus, ProjectStatus,
                     KanbanStage, ProjectKanbanStageConfig, CardLog, CardLogEventType,
                     CARD_STATUS_FECHADOS)


def _norm_nome_projeto(nome: str) -> str:
    return (nome or "").strip().casefold()


def data_inicio_para_status(status: str, data_inicio):
    """
    data_inicio representa o instante em que o card entrou em desenvolvimento.
    Cards em 'a_desenvolver' não devem ter data de início preenchida.
    """
    if status == CardStatus.A_DESENVOLVER:
        return None
    return data_inicio


def _copiar_logs_card(origem: Card, destino: Card) -> None:
    """Replica o histórico da timeline do card de origem para o card na nova sprint."""
    for log in origem.logs.all().order_by('data', 'id'):
        novo_log = CardLog.objects.create(
            card=destino,
            tipo_evento=log.tipo_evento,
            descricao=log.descricao,
            usuario=log.usuario,
        )
        CardLog.objects.filter(pk=novo_log.pk).update(data=log.data)


def _replicar_card_para_sprint(card: Card, novo_projeto: Project, sprint_origem: Sprint, sprint_destino: Sprint, usuario_fechamento=None) -> Card:
    """
    Cria o card na sprint destino preservando criação, início de desenvolvimento e timeline.
    """
    novo = Card(
        nome=card.nome,
        descricao=card.descricao or '',
        script_url=card.script_url,
        projeto=novo_projeto,
        area=card.area,
        tipo=card.tipo,
        responsavel=card.responsavel,
        criado_por=card.criado_por,
        status=card.status,
        prioridade=card.prioridade,
        data_inicio=data_inicio_para_status(card.status, card.data_inicio),
        data_fim=card.data_fim,
        complexidade_selected_items=card.complexidade_selected_items or [],
        complexidade_selected_development=card.complexidade_selected_development or '',
        complexidade_custom_items=card.complexidade_custom_items or [],
        card_comment=card.card_comment or '',
        # SEM ISTO O CHECKBOX SE PERDE NA VIRADA DA SPRINT, EM SILÊNCIO.
        # Um card marcado para gerar formulário que ainda não foi finalizado é
        # replicado para a sprint seguinte; a cópia nascia com o padrão False, e
        # quando ela finalmente fosse para "Finalizado" o signal não dispararia.
        # Ninguém perceberia: não há erro, não há log — só um feedback que nunca
        # é colhido, justamente nos cards de vida mais longa.
        gerar_formulario_feedback=card.gerar_formulario_feedback,
    )
    novo._from_sprint_replication = True
    novo.save()

    Card.objects.filter(pk=novo.pk).update(created_at=card.created_at)
    novo.refresh_from_db()

    _copiar_logs_card(card, novo)

    CardLog.objects.create(
        card=novo,
        tipo_evento=CardLogEventType.TRANSFERIDO_SPRINT,
        descricao=(
            f'Card transferido da sprint "{sprint_origem.nome}" para a sprint '
            f'"{sprint_destino.nome}" ao finalizar a sprint anterior.'
        ),
        usuario=usuario_fechamento,
    )

    return novo


def merge_project_kanban_into(canonical: Project, other: Project) -> None:
    """Leva as colunas de `other` para `canonical`.

    ETAPA GLOBAL É REAPROVEITADA; ETAPA DO PROJETO É CLONADA.

    A diferença decide se a operação funciona. Uma etapa que pertence a `other`
    não pode ser apenas referenciada pelo `canonical`: os dois chamadores que
    consolidam projetos apagam `other` logo em seguida, e com `on_delete=CASCADE`
    a etapa iria junto — levando pela cascata a coluna recém-criada no destino.
    Na replicação de sprint o dano seria outro e pior, porque silencioso: o
    projeto de ORIGEM SOBREVIVE na sprint passada, então mover a etapa esvaziaria
    o quadro histórico dela.

    Clonar mantém a MESMA `key`, e é isso que faz os cards continuarem no lugar:
    `Card.status` guarda a string, então o card replicado cai na coluna clonada
    sem que nada precise ser reescrito.

    Idempotente pelos dois lados: `get_or_create` na etapa (por projeto+key) e na
    config (por projeto+etapa), então rodar duas vezes não duplica nada.
    """
    for cfg in other.kanban_stage_configs.select_related('stage'):
        etapa = cfg.stage

        if etapa.projeto_id is not None:
            etapa, _ = KanbanStage.objects.get_or_create(
                projeto=canonical,
                key=etapa.key,
                defaults={
                    'label': etapa.label,
                    'is_terminal': etapa.is_terminal,
                    'requires_required_data': etapa.requires_required_data,
                    'oculta_no_catalogo': etapa.oculta_no_catalogo,
                },
            )

        # A CONFERÊNCIA TEM DE SER PELA KEY, QUE É O QUE O BANCO TRAVA.
        #
        # `get_or_create(project, stage)` casa por ETAPA, mas a constraint é
        # `(project, stage_key)`. Se o destino já tiver uma coluna com a mesma
        # key vinda de outra linha — uma global homônima, por exemplo — o
        # `get_or_create` não a encontraria, tentaria inserir, e o
        # IntegrityError derrubaria a virada da sprint INTEIRA, no meio,
        # para todos os projetos.
        #
        # Hoje nenhum caminho produz esse estado (a migração converteu as
        # customizadas e o `add` recusa key repetida), mas a virada de sprint é
        # justamente o lugar onde não se quer descobrir isso.
        if ProjectKanbanStageConfig.objects.filter(
                project=canonical, stage_key=etapa.key).exists():
            continue

        ProjectKanbanStageConfig.objects.get_or_create(
            project=canonical,
            stage=etapa,
            defaults={"order": cfg.order, "stage_key": etapa.key},
        )


_CARD_STATUS_RANK_DEDUPE = {
    CardStatus.A_DESENVOLVER: 1,
    CardStatus.PARADO_PENDENCIAS: 2,
    CardStatus.EM_DESENVOLVIMENTO: 3,
    CardStatus.EM_HOMOLOGACAO: 4,
    CardStatus.FINALIZADO: 5,
    CardStatus.INVIABILIZADO: 5,
}


def _pick_card_winner_duplicate_group(cards: list[Card]) -> Card:
    """Mantém o card mais avançado no fluxo; empate: menor id."""

    def rank(c: Card) -> int:
        return _CARD_STATUS_RANK_DEDUPE.get(c.status, 0)

    return max(cards, key=lambda c: (rank(c), -c.id))


def dedupe_cards_mesmo_nome_no_projeto(project_id: int) -> list[int]:
    """
    Remove cards com o mesmo nome (normalizado) no mesmo projeto.
    Retorna os IDs dos cards excluídos.
    """
    qs = list(Card.objects.filter(projeto_id=project_id).order_by("id"))
    by_name: dict[str, list[Card]] = defaultdict(list)
    for card in qs:
        by_name[_norm_nome_projeto(card.nome)].append(card)

    to_delete: list[int] = []
    for norm, group in by_name.items():
        if not norm or len(group) < 2:
            continue
        winner = _pick_card_winner_duplicate_group(group)
        for c in group:
            if c.id != winner.id:
                to_delete.append(c.id)

    if to_delete:
        Card.objects.filter(pk__in=to_delete).delete()
    return to_delete


def dedupe_cards_mesmo_nome_em_todos_projetos_da_sprint(sprint_id: int) -> list[int]:
    """Roda dedupe por nome em cada projeto da sprint; retorna todos os IDs removidos."""
    removed: list[int] = []
    for pid in Project.objects.filter(sprint_id=sprint_id).values_list("id", flat=True):
        removed.extend(dedupe_cards_mesmo_nome_no_projeto(pid))
    return removed


def sprint_esta_em_andamento_janela(sprint) -> bool:
    """Mesma regra do frontend (`getSprintsEmAndamentoJanela`): não finalizada,
    dia local >= início e instante atual <= fechamento_em."""
    if not sprint or sprint.finalizada:
        return False
    now = timezone.now()
    if sprint.fechamento_em and sprint.fechamento_em < now:
        return False
    if sprint.data_inicio:
        di = sprint.data_inicio
        if timezone.is_naive(di):
            di = timezone.make_aware(di, timezone.get_current_timezone())
        if timezone.localtime(now).date() < timezone.localtime(di).date():
            return False
    return True


def sprint_esta_em_andamento_ou_planejada(sprint) -> bool:
    """True se a sprint está EM ANDAMENTO (janela ativa) OU PLANEJADA (ainda vai
    começar): ou seja, não finalizada e cujo fechamento ainda não passou.

    Sprints finalizadas, ou já expiradas (fechamento no passado) mas não
    finalizadas, retornam False. Espelha o inverso de `isSprintPastFechamento`
    do frontend (`sprintFechamento.ts`)."""
    if not sprint or sprint.finalizada:
        return False
    if sprint.fechamento_em and sprint.fechamento_em < timezone.now():
        return False
    return True


def get_sprint_ids_atribuiveis() -> set:
    """IDs das sprints em andamento ou planejadas — sprints cujos cards podem
    receber score no seletor. Sprints são poucas, então iterar em Python é
    barato e mantém a MESMA semântica de `sprint_esta_em_andamento_ou_planejada`."""
    ids = set()
    # `is_system=False`: a sprint sistêmica não é ciclo de trabalho, então os
    # cards de feedback pendurados nela não podem aparecer no seletor do Score.
    for s in Sprint.objects.filter(finalizada=False, is_system=False).only('id', 'finalizada', 'fechamento_em'):
        if sprint_esta_em_andamento_ou_planejada(s):
            ids.add(s.id)
    return ids


def _aware(dt):
    """Normaliza para timezone-aware; datetimes ingênuos vêm do payload da API."""
    if dt is not None and timezone.is_naive(dt):
        return timezone.make_aware(dt, timezone.get_current_timezone())
    return dt


def sprint_conflitante_na_janela(setor_id, data_inicio, fechamento_em, exclude_pk=None):
    """Outra sprint não finalizada do MESMO SETOR cuja janela cruza [início, fim].

    A regra é "uma sprint EM ANDAMENTO por setor" — não "uma sprint por setor".
    O setor pode deixar quantas sprints planejadas quiser na fila, desde que
    cada uma comece depois que a anterior fechar.

    Por isso a comparação é entre JANELAS, e não entre "está em andamento
    agora". Uma sprint cadastrada para começar dia 5, enquanto a atual só fecha
    dia 20, não conflita hoje — mas no dia 5 o setor amanheceria com duas
    sprints abertas, sem que ninguém tivesse feito nada. Comparar janelas
    recusa isso no cadastro, que é o único instante em que dá para corrigir.

    Sprints finalizadas não entram: já saíram da fila.
    """
    di, fe = _aware(data_inicio), _aware(fechamento_em)
    if di is None or fe is None:
        return None
    # Dois intervalos se cruzam quando cada um começa antes do outro terminar.
    #
    # `is_system=False` é OBRIGATÓRIO aqui: a sprint sistêmica tem janela de ~100
    # anos, logo cruza QUALQUER janela. Sem este recorte, nenhuma sprint nova
    # poderia mais ser criada no setor onde ela mora.
    qs = Sprint.objects.filter(
        finalizada=False,
        is_system=False,
        setor_id=setor_id,
        data_inicio__lte=fe,
        fechamento_em__gte=di,
    )
    if exclude_pk is not None:
        qs = qs.exclude(pk=exclude_pk)
    return qs.order_by('data_inicio').first()


def conflitos_ao_mover_sprints(sprint_ids, setor_destino_id):
    """Pares de sprints que passariam a se sobrepor se `sprint_ids` fossem para
    `setor_destino_id`. Lista vazia = a mudança é segura.

    Mover conteúdo é a porta dos fundos da regra "uma sprint em andamento por
    setor": a validação do serializer olha o cadastro, e uma sprint que muda de
    dono não passa por lá. Sem esta checagem, arrastar uma sprint ativa para um
    setor que já tem a dele produziria, por outro caminho, exatamente o estado
    que o cadastro recusa.
    """
    candidatas = list(
        # Mesma razão de `sprint_conflitante_na_janela`: a janela da sprint
        # sistêmica cruza tudo e ela viraria conflito com qualquer movimentação.
        Sprint.objects.filter(finalizada=False, is_system=False)
        .filter(models.Q(pk__in=sprint_ids) | models.Q(setor_id=setor_destino_id))
        .only('id', 'nome', 'data_inicio', 'fechamento_em')
    )
    conflitos = []
    for i, a in enumerate(candidatas):
        for b in candidatas[i + 1:]:
            if a.data_inicio <= b.fechamento_em and b.data_inicio <= a.fechamento_em:
                conflitos.append((a, b))
    return conflitos


def outra_sprint_em_andamento(setor_id, exclude_pk=None):
    """Retorna outra sprint na janela ativa DO MESMO SETOR, ou None.

    "Uma sprint por vez" é regra de cada setor, não da empresa: com a
    plataforma segmentada, o ciclo de Tecnologia não tem por que impedir
    Comercial de abrir o dele.
    """
    # `is_system=False`: a sprint sistêmica satisfaz o predicado "em andamento"
    # por construção (não finalizada, fechamento no futuro) e seria devolvida
    # como "a sprint em andamento do setor" para sempre.
    qs = Sprint.objects.filter(finalizada=False, is_system=False, setor_id=setor_id)
    if exclude_pk is not None:
        qs = qs.exclude(pk=exclude_pk)
    for other in qs.order_by('-data_inicio'):
        if sprint_esta_em_andamento_janela(other):
            return other
    return None


def get_proxima_sprint(sprint):
    """
    Retorna a sprint de destino para replicação: sprint em andamento ou
    a próxima por data_inicio, SEMPRE do mesmo setor da sprint finalizada
    (senão a finalização moveria projetos/cards para outro setor
    silenciosamente). Retorna None se não houver.
    """
    agora = timezone.now()
    fim_dia = timezone.localtime(sprint.fechamento_em).date()
    # `is_system=False` é o recorte CRÍTICO desta função: a sprint sistêmica
    # nunca é finalizada e tem fechamento no futuro, então seria eleita destino
    # de replicação de toda sprint real do setor — e `finalizar_sprint_replicacao`
    # despejaria projetos e cards pendentes dentro do fluxo de monitoramento.
    mesmo_setor = Sprint.objects.filter(setor_id=sprint.setor_id, is_system=False)
    # 1) Outra sprint na janela ativa (mesma regra do dashboard / menu Sprints)
    for candidata in mesmo_setor.filter(finalizada=False).exclude(pk=sprint.pk).order_by('data_inicio'):
        if sprint_esta_em_andamento_janela(candidata):
            return candidata
    # 2) Próxima cadastrada com início (data local) após o dia de término desta sprint
    proxima = mesmo_setor.filter(
        finalizada=False,
        data_inicio__date__gt=fim_dia,
    ).exclude(pk=sprint.pk).order_by('data_inicio').first()
    return proxima


def finalizar_sprint_replicacao(sprint, criado_por_user=None):
    """
    Executa a lógica de finalização: replica projetos com cards não entregues
    para a próxima sprint e marca a sprint como finalizada.

    Retorno:
    - dict com 'proxima_sprint_id', 'proxima_sprint_nome', 'projetos_criados', 'cards_copiados'
      (e opcionalmente 'ja_finalizada': True se já estava finalizada)
    - None se não houver próxima sprint (não altera finalizada nesse caso;
      o caller pode marcar finalizada na task e retornar 400 na view).
    """
    if sprint.finalizada:
        return {
            'ja_finalizada': True,
            'projetos_criados': 0,
            'cards_copiados': 0,
        }

    proxima = get_proxima_sprint(sprint)
    if proxima is None:
        return None

    nao_entregues = [CardStatus.FINALIZADO, CardStatus.INVIABILIZADO]
    projetos_concluidos = {ProjectStatus.ENTREGUE, ProjectStatus.HOMOLOGADO}

    with transaction.atomic():
        projetos_criados = 0
        cards_copiados = 0
        projetos_reutilizados = 0

        # Cache por nome normalizado para evitar duplicação na sprint destino
        projetos_destino_por_nome = {
            _norm_nome_projeto(p.nome): p
            for p in Project.objects.filter(sprint=proxima).select_related("sprint")
        }

        for project in sprint.projects.all():
            cards_pendentes = project.cards.exclude(status__in=nao_entregues)
            project_nao_concluido = project.status not in projetos_concluidos

            # Copia o projeto quando:
            # 1) há cards não concluídos, ou
            # 2) o próprio projeto ainda não está concluído.
            # Em ambos os casos, mantém o projeto original na sprint passada.
            if not cards_pendentes.exists() and not project_nao_concluido:
                continue

            nome_norm = _norm_nome_projeto(project.nome)
            novo_projeto = projetos_destino_por_nome.get(nome_norm)
            if novo_projeto:
                projetos_reutilizados += 1
            else:
                novo_projeto = Project.objects.create(
                    nome=project.nome,
                    descricao=project.descricao or '',
                    sprint=proxima,
                    gerente_atribuido=project.gerente_atribuido,
                    desenvolvedor=project.desenvolvedor,
                    status=ProjectStatus.CRIADO,
                )
                projetos_destino_por_nome[nome_norm] = novo_projeto
                projetos_criados += 1
            # O compartilhamento entre setores acompanha o trabalho pendente,
            # COM O NÍVEL: quem tinha o projeto só para leitura não pode ganhar
            # edição de brinde na virada da sprint. No projeto reutilizado é
            # união — um vínculo que já existe no destino não é rebaixado.
            ja_no_destino = set(
                novo_projeto.compartilhamentos.values_list('setor_id', flat=True))
            ProjectCompartilhamento.objects.bulk_create([
                ProjectCompartilhamento(
                    project=novo_projeto, setor_id=c.setor_id, nivel=c.nivel,
                    compartilhado_por=c.compartilhado_por)
                for c in project.compartilhamentos.all()
                if c.setor_id not in ja_no_destino
            ])

            # AS COLUNAS DO QUADRO TAMBEM ACOMPANHAM O TRABALHO.
            #
            # Sem isto o projeto chegava na sprint nova SEM as etapas
            # personalizadas, e o modo de falha era mudo: o card e replicado
            # carregando `status = <key da etapa>`, mas o quadro so desenha
            # coluna que tenha ProjectKanbanStageConfig. O projeto novo nascia
            # com zero configs, entao `_ensure_project_default_kanban_config`
            # criava as SEIS PADRAO na primeira abertura — e todo card que
            # estivesse numa etapa personalizada sumia da tela sem erro, sem
            # log e sem ter sido perdido.
            #
            # Recriar a coluna a mao "resolvia" porque a KanbanStage e um
            # catalogo GLOBAL: ela nunca foi apagada, so tinha perdido o
            # vinculo com este projeto. Refeito o vinculo, os cards reapareciam
            # na hora, com o status que sempre tiveram.
            #
            # get_or_create por (project, stage), igual ao compartilhamento
            # acima: no projeto reutilizado isto e uniao, nao substituicao.
            merge_project_kanban_into(novo_projeto, project)

            for card in cards_pendentes:
                _replicar_card_para_sprint(
                    card,
                    novo_projeto,
                    sprint,
                    proxima,
                    usuario_fechamento=criado_por_user,
                )
                cards_copiados += 1

        sprint.finalizada = True
        sprint.save(update_fields=['finalizada', 'updated_at'])

    return {
        'proxima_sprint_id': str(proxima.id),
        'proxima_sprint_nome': proxima.nome,
        'projetos_criados': projetos_criados,
        'projetos_reutilizados': projetos_reutilizados,
        'cards_copiados': cards_copiados,
    }


def sprint_em_andamento_do_setor(setor_id):
    """A sprint que está na janela ativa HOJE naquele setor, ou None.

    Reabertura só existe se houver para onde reabrir: é a mesma pergunta que
    `outra_sprint_em_andamento` responde, exposta com um nome que diz a
    intenção de quem chama.
    """
    return outra_sprint_em_andamento(setor_id=setor_id)


def reancorar_card_na_sprint(card, sprint_destino):
    """Move o card para `sprint_destino`, casando o projeto pelo nome.

    Card não aponta para sprint: ele pertence a um Project, e o Project é que
    pertence à Sprint. Mover um card de sprint é, portanto, reancorá-lo num
    projeto de mesmo nome na sprint destino — exatamente o que
    `finalizar_sprint_replicacao` já faz ao virar a sprint, e por isso a regra
    de casamento é a MESMA (`_norm_nome_projeto`): duas implementações do mesmo
    pareamento acabariam divergindo, e aí o mesmo projeto viraria dois.

    Diferente da replicação, aqui o card é MOVIDO e não copiado: a decisão do
    dono do produto é que a métrica conte na sprint em que o card foi reaberto.
    A sprint de origem perde a entrega, o que está correto — se o trabalho
    voltou, ele não estava concluído.

    Devolve (projeto_destino, criou_projeto). Se o card já está na sprint
    destino, não faz nada.
    """
    projeto_atual = card.projeto
    if projeto_atual and projeto_atual.sprint_id == sprint_destino.pk:
        return projeto_atual, False

    nome_norm = _norm_nome_projeto(projeto_atual.nome) if projeto_atual else ''
    destino = next(
        (p for p in Project.objects.filter(sprint=sprint_destino)
         if _norm_nome_projeto(p.nome) == nome_norm),
        None,
    )
    criou = False
    if destino is None:
        destino = Project.objects.create(
            nome=projeto_atual.nome,
            descricao=projeto_atual.descricao or '',
            sprint=sprint_destino,
            gerente_atribuido=projeto_atual.gerente_atribuido,
            desenvolvedor=projeto_atual.desenvolvedor,
            status=ProjectStatus.CRIADO,
            setor=sprint_destino.setor,
        )
        criou = True
        # O empréstimo entre setores acompanha o trabalho, COM o nível — quem
        # tinha o projeto só para leitura não ganha edição na mudança de sprint.
        ProjectCompartilhamento.objects.bulk_create([
            ProjectCompartilhamento(
                project=destino, setor_id=c.setor_id, nivel=c.nivel,
                compartilhado_por=c.compartilhado_por)
            for c in projeto_atual.compartilhamentos.all()
        ])

    card.projeto = destino
    return destino, criou


# Texto do histórico da desatribuição. A primeira linha usa DELIBERADAMENTE o
# mesmo vocabulário de diff do log automático de troca de responsável
# (`signals.py`: 'Responsável: {antigo} → {novo}', com 'Ninguém' sendo
# literalmente a palavra usada para ausência), para a timeline do card ler de
# forma contínua. O `Motivo:` é o que diferencia este evento de uma
# reatribuição comum — e é o padrão da casa para justificativa.
DESCRICAO_DESATRIBUICAO_CONTA_DESATIVADA = (
    'Responsável: {nome_anterior} → Ninguém.\n\nMotivo: conta desativada.'
)


def desatribuir_cards_de_usuario_desativado(user, operador=None) -> int:
    """Solta os cards ABERTOS de quem acabou de ser desativado. Devolve quantos.

    Regra de produto: conta desativada não segura trabalho vivo. O card volta
    para "sem usuário atribuído" e alguém precisa reassumi-lo.

    O que NÃO é tocado: cards FINALIZADOS e INVIABILIZADOS mantêm o
    responsável. Apagar ali reescreveria a métrica de entrega de sprints
    passadas — trabalho entregue continua sendo de quem entregou, mesmo que a
    pessoa tenha saído. Por isso o recorte vem de `CARD_STATUS_FECHADOS`, pela
    negativa (ver o comentário da constante em models.py).

    >>> ESTE SERVIÇO É O ÚNICO DONO DA REGRA E PRECISA SER CHAMADO POR TODO <<<
    >>> CAMINHO QUE DESATIVA UMA CONTA. Hoje são dois, pareados:            <<<
    >>>   - `UserViewSet.set_active` (accounts/views.py) — porta HTTP;       <<<
    >>>   - `User.delete()` (accounts/models.py), que desativa em vez de     <<<
    >>>     apagar — porta de shell/admin.                                   <<<

    Por que serviço e não um `post_save` de User: (i) dentro do signal não há
    `request.user`, então todo CardLog sairia sem autor; (ii) `post_save`
    dispara com `raw=True` em `loaddata`, e um restore do dump de produção
    desatribuiria cards em massa; (iii) data migration usa modelo histórico e
    não dispara signal nenhum, então o tratamento do estado legado não herdaria
    a regra de qualquer forma.

    `operador` é quem puxou o gatilho (vai para `CardLog.usuario`). Fica None
    quando não há ator humano (shell, migration) — inventar um autor seria
    mentira no histórico, e o campo é `null=True` justamente por isso.

    Idempotente: a segunda chamada não encontra mais nada (o filtro exige o
    usuário como responsável), então não duplica log.
    """
    if user is None or not getattr(user, 'pk', None):
        return 0

    # `atomic` AQUI, e não só nos chamadores: esta função apaga vínculo e
    # escreve o histórico desse apagamento em DOIS statements. Se um caller
    # futuro esquecer a transação (e o docstring acima convida a criar novos
    # callers), o `.update()` comita sozinho e uma falha no `bulk_create`
    # deixaria os cards soltos SEM nenhuma linha de histórico dizendo para
    # onde o responsável foi — dano silencioso e irreversível. Aninhado nos
    # dois callers atuais isto é só um savepoint, custo desprezível.
    with transaction.atomic():
        # Materializa ANTES do update: depois dele o vínculo já era, e o log
        # precisa dizer de quem o card saiu. `select_related` para o broadcast
        # alcançar a sprint sem uma consulta por card.
        #
        # `select_for_update(of=('self',))` trava só as linhas de Card até o
        # commit. Sem isso há JANELA entre este SELECT e o UPDATE abaixo: uma
        # reatribuição concorrente (PATCH no card) poderia passar o card para
        # outra pessoa ATIVA no meio, e o UPDATE apagaria o responsável DELA.
        # O `of=('self',)` existe para não travar também as linhas de
        # Project/Sprint trazidas pelo `select_related`.
        cards = list(
            Card.objects.filter(responsavel=user)
            .exclude(status__in=CARD_STATUS_FECHADOS)
            .select_related('projeto__sprint')
            .select_for_update(of=('self',))
        )
        if not cards:
            return 0

        # Import TARDIO (idioma do arquivo vizinho: `signals.py` importa
        # `.realtime` dentro das funções) para não inverter o grafo de imports.
        from .signals import format_user_name

        nome_anterior = format_user_name(user) or 'Ninguém'

        # `.update()` em massa em vez de `card.save()` em laço, de propósito: o
        # `post_save` do Card escreveria SOZINHO um segundo log dizendo o mesmo
        # fato ('Responsável: Fulano → Ninguém'), e ainda dispararia uma
        # notificação por card para o gerente de cada projeto. É a mesma receita
        # de `kanban_move_cards` (lista → `.update()` → `bulk_create` dos logs).
        #
        # Pular o `Card.save()` é seguro aqui: ele só zera `data_inicio` quando
        # o status é 'a_desenvolver' e espelha o `setor_id` do projeto — e não
        # mexemos em status nem em projeto.
        #
        # O `responsavel=user` no filtro NÃO é redundante com o `pk__in`: ele
        # reafirma no momento da ESCRITA a condição que autorizou o apagamento.
        # É a mesma proteção que a migration 0060 ganha de graça por reusar o
        # queryset filtrado. Sem ela, o `pk__in` sozinho apagaria o vínculo de
        # quem tivesse recebido o card no intervalo.
        Card.objects.filter(
            pk__in=[c.pk for c in cards], responsavel=user,
        ).update(responsavel=None)

        CardLog.objects.bulk_create([
            CardLog(
                card_id=c.pk,
                tipo_evento=CardLogEventType.RESPONSAVEL_ALTERADO,
                descricao=DESCRICAO_DESATRIBUICAO_CONTA_DESATIVADA.format(
                    nome_anterior=nome_anterior),
                usuario=operador,
            )
            for c in cards
        ])

        # Um broadcast por SPRINT afetada, não por card: o payload é só o id do
        # card + o ator, e o cliente responde recarregando o widget. N eventos
        # na mesma sprint seriam N recargas da mesma coisa.
        representativos = {}
        for c in cards:
            projeto = getattr(c, 'projeto', None)
            sprint_id = getattr(projeto, 'sprint_id', None) if projeto else None
            if sprint_id is not None:
                representativos.setdefault(sprint_id, c)

        if representativos:
            cards_por_sprint = list(representativos.values())
            operador_id = getattr(operador, 'pk', None)

            def _avisar_kanban():
                # `on_commit`: o contrato do realtime é "cliente recebe o evento
                # e refaz o GET". Emitir dentro da transação faria o cliente ler
                # o estado anterior ao commit.
                from .realtime import broadcast_kanban_changed
                for card in cards_por_sprint:
                    broadcast_kanban_changed(card, actor_user_id=operador_id)

            transaction.on_commit(_avisar_kanban)

        return len(cards)
