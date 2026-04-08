"""
Serviços de negócio para o app projects.
"""
from collections import defaultdict

from django.db import transaction
from django.utils import timezone

from .models import Sprint, Project, Card, CardStatus, ProjectStatus, ProjectKanbanStageConfig


def _norm_nome_projeto(nome: str) -> str:
    return (nome or "").strip().casefold()


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


def get_proxima_sprint(sprint):
    """
    Retorna a sprint de destino para replicação: sprint em andamento ou
    a próxima por data_inicio. Retorna None se não houver.
    """
    agora = timezone.now()
    fim_dia = timezone.localtime(sprint.fechamento_em).date()
    # 1) Outra sprint ainda aberta (já começou no relógio e ainda não fechou)
    em_andamento = Sprint.objects.filter(
        finalizada=False,
        data_inicio__lte=agora,
        fechamento_em__gt=agora,
    ).exclude(pk=sprint.pk).order_by('data_inicio').first()
    if em_andamento:
        return em_andamento
    # 2) Próxima cadastrada com início (data local) após o dia de término desta sprint
    proxima = Sprint.objects.filter(
        data_inicio__date__gt=fim_dia,
    ).order_by('data_inicio').first()
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

            for card in cards_pendentes:
                Card.objects.create(
                    nome=card.nome,
                    descricao=card.descricao or '',
                    script_url=card.script_url,
                    projeto=novo_projeto,
                    area=card.area,
                    tipo=card.tipo,
                    responsavel=card.responsavel,
                    criado_por=criado_por_user or card.criado_por,
                    status=card.status,
                    prioridade=card.prioridade,
                    data_inicio=card.data_inicio,
                    data_fim=card.data_fim,
                    complexidade_selected_items=card.complexidade_selected_items or [],
                    complexidade_selected_development=card.complexidade_selected_development or '',
                    complexidade_custom_items=card.complexidade_custom_items or [],
                    card_comment=card.card_comment or '',
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
