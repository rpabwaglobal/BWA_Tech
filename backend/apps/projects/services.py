"""
Serviços de negócio para o app projects.
"""
from collections import defaultdict

from django.db import models, transaction
from django.utils import timezone

from .models import (Sprint, Project, ProjectCompartilhamento, Card, CardStatus, ProjectStatus,
                     ProjectKanbanStageConfig, CardLog, CardLogEventType)


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
    """Copia etapas Kanban do projeto `other` para `canonical` (sem duplicar stage)."""
    for cfg in other.kanban_stage_configs.all():
        ProjectKanbanStageConfig.objects.get_or_create(
            project=canonical,
            stage=cfg.stage,
            defaults={"order": cfg.order},
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
    for s in Sprint.objects.filter(finalizada=False).only('id', 'finalizada', 'fechamento_em'):
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
    qs = Sprint.objects.filter(
        finalizada=False,
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
        Sprint.objects.filter(finalizada=False)
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
    qs = Sprint.objects.filter(finalizada=False, setor_id=setor_id)
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
    mesmo_setor = Sprint.objects.filter(setor_id=sprint.setor_id)
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
