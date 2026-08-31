"""
O RESUMO DO DASHBOARD NUMA REQUISIÇÃO SÓ.

Antes esta tela montava a resposta no cliente, e o custo era N+1 sobre HTTP em
dois níveis empilhados:

  1. `projectService.getAll()` percorria as páginas de projetos EM SEQUÊNCIA
     (`?page=2`, `3`, `4`, `5`, `6`), uma esperando a outra, 450-660 ms cada;
  2. depois disparava UMA requisição de cards POR PROJETO
     (`projetos.map((p) => cardService.getByProject(p.id))`), em dois pontos do
     arquivo — a carga inicial e o refresh do WebSocket.

Medido no navegador: LCP de 6,53 s e cerca de quarenta requisições.

E o desperdício era maior do que o número sugere: tudo aquilo baixava centenas
de objetos de card COMPLETOS para no fim calcular CONTAGENS e um conjunto de
ids. Nenhum card individual daquela leva aparece na tela — só os que estão em
desenvolvimento, que são poucos.

Aqui o banco responde o que a tela pergunta: um `GROUP BY status`, duas listas
curtas e alguns totais. O padrão não é novo no projeto — a página da sprint já
usa um bundle (`SprintViewSet.bundle`) pelo mesmo motivo; o dashboard é que
tinha ficado para trás.

TUDO PASSA PELO ESCOPO. `scope_sprints`, `scope_projects` e `scope_cards` são os
mesmos usados pelas rotas REST: agregar no servidor não pode virar uma porta
lateral que devolve, somado, o que a pessoa não veria item a item.
"""
from django.db.models import Count, Q
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import PodeVerConteudo, ids_que_executam_o_trabalho
from apps.accounts.scoping import scope_cards, scope_projects, scope_sprints

from .models import Card, CardStatus, Project, ProjectStatus, Sprint
from .serializers import CardKanbanSerializer, ProjectSerializer, SprintSerializer
from .services import sprint_esta_em_andamento_janela

# Quantos projetos recentes a tela lista. Vive aqui, e não no cliente, porque
# quem corta a lista agora é a consulta — mandar 120 projetos para o front
# escolher 5 é o tipo de desperdício que este módulo existe para eliminar.
RECENTES = 5


class CardDoDashboardSerializer(CardKanbanSerializer):
    """O card enxuto do kanban, MAIS o nome do projeto.

    `CardKanbanSerializer` omite o nome de propósito — a página da sprint já
    carrega a lista de projetos e resolve o nome no cliente. O dashboard não
    carrega, e é exatamente esse o ponto deste endpoint: ele não vai baixar 109
    projetos para descobrir o nome de 11. Uma coluna a mais no `select_related`
    resolve o que antes exigia a lista inteira do outro lado.
    """

    projeto_nome = serializers.CharField(source='projeto.nome', read_only=True)

    class Meta(CardKanbanSerializer.Meta):
        fields = list(CardKanbanSerializer.Meta.fields) + ['projeto_nome']


class DashboardResumoView(APIView):
    """`GET /api/dashboard/resumo/` — tudo que a tela inicial precisa."""

    permission_classes = [IsAuthenticated, PodeVerConteudo]

    def get(self, request):
        usuario = request.user

        # ── Sprints ────────────────────────────────────────────────────────
        sprints = list(
            scope_sprints(Sprint.objects.filter(is_system=False), usuario)
            .select_related('setor', 'supervisor')
        )
        # A janela é avaliada em Python, e não em SQL, para usar EXATAMENTE a
        # mesma função que o resto do backend (e o espelho dela no frontend).
        # Sprints são dezenas de linhas; reimplementar a regra em filtro seria
        # criar uma segunda definição de "em andamento" para economizar nada.
        em_andamento = [s for s in sprints if sprint_esta_em_andamento_janela(s)]
        ids_em_andamento = [s.id for s in em_andamento]

        # ── Projetos ───────────────────────────────────────────────────────
        # EXCLUI SÓ O FLUXO DE MONITORAMENTO, e não `is_system` inteiro.
        #
        # A regra é a mesma do cliente (`isProjetoMonitoramento`): projeto de
        # sistema DENTRO de sprint de sistema. Cortar por `is_system` sozinho
        # tiraria Suporte, Sugestões e Projetos Descartados destes números — e o
        # comentário no Dashboard registra que eles CONTAM hoje, e que mudar
        # isso alteraria o painel sem ninguém ter pedido. Um endpoint novo não é
        # licença para mexer no que a tela mostra.
        #
        # `arquivado=False` espelha o padrão da listagem de projetos.
        projetos_qs = scope_projects(
            Project.objects.filter(arquivado=False), usuario
        ).exclude(is_system=True, sprint__is_system=True).select_related('sprint')

        total_projetos = projetos_qs.count()
        # Os MESMOS conjuntos de status que a tela usava. `ENTREGUE` não entra em
        # nenhum dos dois: quem decide isso é o painel, não a semântica do enum.
        projetos_ativos = projetos_qs.filter(
            status__in=[ProjectStatus.EM_DESENVOLVIMENTO, ProjectStatus.EM_AVALIACAO]
        ).count()
        projetos_concluidos = projetos_qs.filter(
            status=ProjectStatus.HOMOLOGADO
        ).count()

        # `cards_entregues_count` é anotação do ProjectSerializer; aqui a soma
        # sai direto do banco, sem trazer projeto nenhum para a memória.
        entregues_total = Card.objects.filter(
            projeto__in=projetos_qs, status=CardStatus.FINALIZADO
        ).count()
        entregues_ativas = Card.objects.filter(
            projeto__in=projetos_qs, projeto__sprint_id__in=ids_em_andamento,
            status=CardStatus.FINALIZADO,
        ).count()

        projetos_ativos_qs = projetos_qs.filter(sprint_id__in=ids_em_andamento)
        total_projetos_ativos = projetos_ativos_qs.count()

        # ── Cards das sprints em andamento ─────────────────────────────────
        cards_qs = scope_cards(
            Card.objects.filter(projeto__in=projetos_ativos_qs), usuario
        )

        # UMA consulta para todas as contagens por status. Antes eram dezenas de
        # requisições HTTP e um `.filter()` em JavaScript sobre centenas de cards.
        contagens = cards_qs.aggregate(
            a_desenvolver=Count('id', filter=Q(status=CardStatus.A_DESENVOLVER)),
            em_desenvolvimento=Count('id', filter=Q(status=CardStatus.EM_DESENVOLVIMENTO)),
        )

        em_desenvolvimento_qs = (
            cards_qs.filter(status=CardStatus.EM_DESENVOLVIMENTO)
            .select_related('projeto', 'projeto__sprint', 'responsavel')
            .order_by('-created_at')
        )

        # ── Quem está sem card em desenvolvimento ──────────────────────────
        #
        # A pergunta da tela é essa, e ela cabe num conjunto: antes o cliente
        # baixava TODOS os cards só para montar `Set(responsavel)` e subtrair.
        com_card = set(
            em_desenvolvimento_qs.exclude(responsavel__isnull=True)
            .values_list('responsavel_id', flat=True)
        )
        from apps.accounts.models import User

        # `executam`, e NÃO `participam`. As duas telas de "quem está sem card"
        # — esta e a de Prioridades — faziam a mesma pergunta com regras
        # diferentes: aqui entrava todo mundo que ENXERGA o trabalho, lá só quem
        # o EXECUTA. Na prática o painel listava duas pessoas a mais, o admin
        # entre elas, e cobrar card de quem distribui card não quer dizer nada.
        participantes = (
            User.objects.filter(id__in=ids_que_executam_o_trabalho(), is_active=True)
            .exclude(id__in=com_card)
            .order_by('first_name', 'username')
        )

        contexto = {'request': request}
        return Response(
            {
                'sprints': {
                    'total': len(sprints),
                    'em_andamento': len(em_andamento),
                    # A sprint "principal" — a mais recente entre as em
                    # andamento. É a mesma regra de `getSprintEmAndamentoPrincipal`
                    # no cliente, e a tela usa este id no atalho "Meus Cards".
                    # Vem daqui para o dashboard não precisar da lista inteira
                    # de sprints só para escolher uma.
                    'principal_id': (
                        max(em_andamento, key=lambda s: s.data_inicio).id
                        if em_andamento else None
                    ),
                },
                'projetos': {
                    'total': total_projetos,
                    'em_sprints_ativas': total_projetos_ativos,
                    'ativos': projetos_ativos,
                    'concluidos': projetos_concluidos,
                    'recentes': ProjectSerializer(
                        projetos_qs.order_by('-created_at')[:RECENTES],
                        many=True, context=contexto,
                    ).data,
                },
                'cards': {
                    'a_desenvolver': contagens['a_desenvolver'],
                    'em_desenvolvimento': contagens['em_desenvolvimento'],
                    'entregues_sprints_ativas': entregues_ativas,
                    'entregues_total': entregues_total,
                    'lista_em_desenvolvimento': CardDoDashboardSerializer(
                        em_desenvolvimento_qs, many=True, context=contexto,
                    ).data,
                },
                'usuarios_sem_card': [
                    {
                        'id': u.id,
                        'username': u.username,
                        'first_name': u.first_name,
                        'last_name': u.last_name,
                        'role': u.role,
                        'setor': u.setor,
                        'profile_picture_url': _foto(u, request),
                    }
                    for u in participantes
                ],
            },
            status=status.HTTP_200_OK,
        )


def _foto(user, request):
    from apps.accounts.profile_picture_utils import get_profile_picture_url

    return get_profile_picture_url(user, request=request)
