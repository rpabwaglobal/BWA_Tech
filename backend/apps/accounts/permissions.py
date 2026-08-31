"""Gates de autorização da plataforma.

Regra geral: autorização é decidida por PERMISSÃO (`has_perm`), nunca por
comparação de cargo. É isso que permite ao admin criar um cargo qualquer
(CEO, Supervisor, Gerente...) e conceder a ele as capacidades que quiser.

As duas únicas exceções, ambas deliberadas:
  - `NaoVisitanteEscreve` compara com o cargo 'visitante' — é uma rede de
    segurança de leitura-apenas, não um gate de capacidade;
  - `AdminRolePermissionBackend` (auth_backends.py) concede tudo a role='admin',
    para que a plataforma nunca fique sem administrador.

Além dos gates (que respondem "ESTA pessoa pode?"), este módulo abriga o
resolvedor EM MASSA `usuarios_com_perm_qs` (que responde "QUEM pode?"). Os dois
lados moram juntos de propósito: eles precisam concordar, e é mais fácil manter
isso quando estão no mesmo arquivo.
"""
import logging

from django.conf import settings
from django.db.models import Q
from django.db.utils import DatabaseError
from rest_framework import permissions

from .models import Role
from .permission_catalog import PERMISSION_CATALOG

logger = logging.getLogger(__name__)

# Os codenames que a plataforma reconhece. Importa para o resolvedor em massa:
# dois dos backends de `has_perm` (accounts/auth_backends.py) intersectam com
# este conjunto antes de conceder, então o que está fora dele não é concedido
# nem pelo cargo nem por role='admin'.
CODENAMES_DO_CATALOGO = frozenset(c for c, _label, _area in PERMISSION_CATALOG)


def HasPerm(codename: str):
    """Fábrica de permission class DRF baseada numa permissão granular do
    catálogo (`accounts.<codename>`). Uso:
        permission_classes = [HasPerm('manage_sprints')]
    ou dentro de get_permissions: `return [HasPerm('manage_sprints')()]`."""

    class _HasPerm(permissions.BasePermission):
        def has_permission(self, request, view):
            return request.user.is_authenticated and request.user.has_perm(f'accounts.{codename}')

    _HasPerm.__name__ = f'HasPerm_{codename}'
    return _HasPerm


def HasQualquerPerm(*codenames: str):
    """Passa quem tiver PELO MENOS UMA das permissões (OU, não E).

    Para quando uma capacidade maior implica a menor e exigir as duas só criaria
    jeito de configurar errado: quem pode sortear no Geek Day tem de conseguir
    ver a tela do sorteio, e um cargo com `manage_geekday` mas sem
    `view_geekday` seria um organizador que não enxerga o que organiza.

    Não substitui o encadeamento normal de `permission_classes`, que é E: use
    esta só quando a relação entre as permissões for mesmo de alternativa.
    """

    class _HasQualquerPerm(permissions.BasePermission):
        def has_permission(self, request, view):
            return request.user.is_authenticated and any(
                request.user.has_perm(f'accounts.{c}') for c in codenames)

    _HasQualquerPerm.__name__ = 'HasQualquerPerm_' + '_ou_'.join(codenames)
    return _HasQualquerPerm


def HasPermOrReadOnly(codename: str):
    """Leitura para qualquer autenticado; escrita só para quem tem a permissão."""

    class _HasPermOrReadOnly(permissions.BasePermission):
        def has_permission(self, request, view):
            if not request.user.is_authenticated:
                return False
            if request.method in permissions.SAFE_METHODS:
                return True
            return request.user.has_perm(f'accounts.{codename}')

    _HasPermOrReadOnly.__name__ = f'HasPermOrReadOnly_{codename}'
    return _HasPermOrReadOnly


class _TravasDeAlvo:
    """Duas travas que valem para qualquer ação sobre OUTRO usuário: ninguém
    mexe na própria conta por aqui (evita autobloqueio e autoescalonamento) e
    um admin só é gerenciável por outro admin (senão quem tivesse a permissão
    poderia desativar todos os admins e deixar a plataforma sem administração)."""

    def has_object_permission(self, request, view, obj):
        if obj.pk == request.user.pk:
            return False
        if obj.role == Role.ADMIN and request.user.role != Role.ADMIN:
            return False
        return True


class CanManageUsers(_TravasDeAlvo, permissions.BasePermission):
    """Gerenciar usuários: ativar/desativar, atribuir cargo e setor."""

    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.has_perm('accounts.manage_users')


class CanViewPermissionCatalog(permissions.BasePermission):
    """Ler o catálogo de permissões. Exigido pelas telas de gestão de usuários
    E de cargos — ambas precisam listar as permissões existentes para montar os
    switches, mesmo quem só administra o catálogo."""

    def has_permission(self, request, view):
        u = request.user
        return u.is_authenticated and (
            u.has_perm('accounts.manage_user_permissions')
            or u.has_perm('accounts.manage_users')
            or u.has_perm('accounts.manage_cargos')
        )


class CanManageCargos(permissions.BasePermission):
    """Criar/editar/excluir cargos."""

    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.has_perm('accounts.manage_cargos')


class CanManageSetores(permissions.BasePermission):
    """Criar/editar/excluir setores, e classificar conteúdo neles."""

    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.has_perm('accounts.manage_setores')


class CanManageUserPermissions(_TravasDeAlvo, permissions.BasePermission):
    """Conceder/revogar permissões de OUTRO usuário."""

    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.has_perm('accounts.manage_user_permissions')


class NaoVisitanteEscreve(permissions.BasePermission):
    """Leitura livre (SAFE_METHODS); escrita negada para o cargo Visitante.

    Rede de segurança do requisito "visitante só visualiza" nos viewsets de
    trabalho que historicamente aceitam escrita de qualquer autenticado
    (cards, eventos, prioridades...). Não substitui os gates granulares
    (has_perm) — apenas garante que um visitante recém-cadastrado não muta
    nada mesmo onde não há gate específico."""
    message = 'Visitantes não podem alterar dados. Solicite acesso a um supervisor.'

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        if request.method in permissions.SAFE_METHODS:
            return True
        return request.user.is_superuser or request.user.role != Role.VISITANTE


class PodeVerConteudo(permissions.BasePermission):
    """Piso de leitura do trabalho: sprints, projetos, cards e satélites.

    `NaoVisitanteEscreve` sempre cobriu só a ESCRITA, então quem entrava sem
    cargo nenhum não conseguia mudar nada — mas lia o acervo inteiro. Isto é a
    metade que faltava do requisito "entra como visitante sem acesso a nada até
    que alguém atribua setor e cargo".

    Por permissão, e não por nome de cargo: um cargo novo criado pelo admin sem
    `view_content` também não enxerga nada, sem precisar mexer em código. O
    cargo Visitante nasce sem ela; todos os outros a recebem no template
    (migration accounts/0021).

    Não cobre o que é DA PESSOA — perfil, notificações, notas pessoais e os
    próprios chamados de suporte continuam acessíveis. Alguém recém-cadastrado
    precisa conseguir pedir acesso.
    """
    message = ('Sua conta ainda não tem acesso ao conteúdo da plataforma. '
               'Peça a um gestor para atribuir um cargo e um setor a você.')

    def has_permission(self, request, view):
        return (request.user.is_authenticated
                and request.user.has_perm('accounts.view_content'))


class SetorPermiteEscrita(permissions.BasePermission):
    """Escrita só em item que o setor do usuário alcança com direito de escrita.

    É o gate de OBJETO do compartilhamento: `scope_*` decide o que aparece,
    isto decide o que pode ser alterado. Sem ele, "compartilhar para leitura"
    seria só uma etiqueta — o item apareceria na tela e o PATCH passaria.

    Fica atrás de `SETOR_WRITE_ENFORCEMENT_ENABLED`, uma flag SEPARADA da
    `SETOR_SCOPING_ENABLED`: dá para ligar a visibilidade por setor, observar
    que ninguém perdeu tela, e só então começar a recusar escrita. Ligar as
    duas de uma vez transformaria qualquer erro de classificação de setor em
    "não consigo mais trabalhar".

    Complementa `has_perm`, não o substitui: o cargo diz O QUE a pessoa faz, o
    setor diz ONDE.
    """
    message = ('Este item foi compartilhado com o seu setor apenas para '
               'visualização. Peça ao setor dono para liberar a edição.')

    def has_object_permission(self, request, view, obj):
        if request.method in permissions.SAFE_METHODS:
            return True
        if not getattr(settings, 'SETOR_WRITE_ENFORCEMENT_ENABLED', False):
            return True
        from .scoping import pode_editar
        return pode_editar(request.user, obj)


# --- Resolvedor em massa ---------------------------------------------------
#
# Tudo abaixo responde à pergunta INVERTIDA dos gates acima: em vez de "esta
# pessoa pode?", "quem pode?".


def cargos_que_concedem(codename: str):
    """Codenames dos CARGOS cujo `permissoes_padrao` contém `codename`.

    Resolvido em Python, e não com um lookup dentro do JSONField, por dois
    motivos: `permissoes_padrao` guarda uma lista JSON e a sintaxe de busca
    dentro dela varia entre backends de banco e versões do Django (`contains`
    sobre JSONField não é portável para SQLite, por exemplo), e a tabela `Cargo`
    tem ordem de DEZENAS de linhas — cabe inteira na memória sem custo. Uma
    consulta lê o catálogo, o filtro acontece aqui, e quem chama usa o resultado
    num `role__in=[...]`, que é indexável e não faz join nenhum.

    Ignora entradas que não são string e cargos cujo `permissoes_padrao` não é
    lista: espelha exatamente o que `CargoPermissionBackend._consultar_cargo`
    faz ao conceder — se ele não concede por causa de um valor estranho gravado
    no JSON, aqui também não pode contar.
    """
    from .models import Cargo

    try:
        linhas = list(Cargo.objects.values_list('codename', 'permissoes_padrao'))
    except DatabaseError:
        # Tabela ainda não existe (bootstrapping antes das migrations). Mesma
        # postura fail-closed do backend: não conceder por falha de leitura.
        logger.warning('Cargos indisponíveis ao resolver quem tem %s', codename)
        return []
    return [
        cargo_codename
        for cargo_codename, template in linhas
        if isinstance(template, list) and codename in template
    ]


def usuarios_com_perm_qs(codename: str):
    """Queryset dos usuários ATIVOS para quem `has_perm('accounts.<codename>')`
    é True. É o "quem pode?" — a pergunta invertida do `has_perm`.

    POR QUE existem as duas versões. `has_perm` responde por UMA pessoa e é o
    que os gates usam; mas escolher destinatário de notificação, ou filtrar uma
    listagem de usuários, é decidir sobre TODO MUNDO de uma vez. Fazer isso com
    `has_perm` num laço custa uma consulta por linha (e, na listagem paginada,
    mais uma por usuário só para responder um booleano). Daí a versão em massa.

    E POR QUE isso é delicado: as duas TÊM que concordar. Se uma enxerga um
    caminho de concessão que a outra não enxerga, o sistema passa a mentir de
    formas silenciosas — foi exatamente o que aconteceu quando o CARGO virou
    fonte de autoridade (`CargoPermissionBackend`, accounts/auth_backends.py) e
    a versão em massa continuou olhando só `user_permissions`: quem tinha a
    permissão pelo cargo deixava de ser notificado, e ninguém abre chamado por
    um aviso que não sabia que existia.

    Por isso TODOS os caminhos que o `has_perm` enxerga são reproduzidos aqui:
      1. `user_permissions` — concessão individual, resolvida pelo ModelBackend;
      2. grupos do Django — o ModelBackend também os soma. A plataforma não usa
         grupos hoje (a gestão de acesso é cargo + permissão individual), mas o
         /admin permite criar um, e aí a divergência que esta função existe para
         eliminar voltaria calada;
      3. `is_superuser=True` — `PermissionsMixin.has_perm` devolve True para
         QUALQUER string, sem consultar catálogo nenhum;
      4. `role` apontando para um `Cargo` cujo `permissoes_padrao` contém o
         codename — resolvido por `CargoPermissionBackend`;
      5. `role='admin'` — recebe o catálogo inteiro (`AdminRolePermissionBackend`).

    Os caminhos 4 e 5 valem SÓ para codename do catálogo, porque os dois
    backends que os implementam intersectam com `_ALL_PERMS` antes de conceder;
    1, 2 e 3 valem para qualquer string, porque o ModelBackend e o
    `PermissionsMixin` não conhecem o catálogo. Reproduzir essa assimetria é o
    que faz um codename digitado errado devolver aqui exatamente o mesmo
    conjunto que o `has_perm` devolveria — em vez de "todos os admins".

    >>> QUALQUER NOVO CAMINHO DE CONCESSÃO PRECISA ENTRAR NOS DOIS LADOS: <<<
    >>> num backend em accounts/auth_backends.py (para o `has_perm`) E aqui   <<<
    >>> (para o "quem pode?"). Mexer só em um deles é criar divergência.      <<<

    `is_active=True` não é um recorte a mais, é parte da equivalência: todos os
    backends (e o próprio `PermissionsMixin`) checam `is_active` antes de
    conceder, então conta desativada tem `has_perm` False para tudo.

    `distinct()` porque quem casa em mais de um critério (permissão individual E
    cargo, por exemplo) voltaria duplicado pelos joins de `user_permissions` e
    `groups`.
    """
    from django.contrib.auth import get_user_model

    User = get_user_model()

    criterios = (
        Q(
            user_permissions__codename=codename,
            user_permissions__content_type__app_label='accounts',
        )
        | Q(
            groups__permissions__codename=codename,
            groups__permissions__content_type__app_label='accounts',
        )
        | Q(is_superuser=True)
    )

    if codename in CODENAMES_DO_CATALOGO:
        criterios |= Q(role=Role.ADMIN)
        cargos = cargos_que_concedem(codename)
        if cargos:
            criterios |= Q(role__in=cargos)

    return User.objects.filter(criterios, is_active=True).distinct()


def ids_que_participam_do_trabalho():
    """Ids de quem tem `view_content` — o PISO de leitura do trabalho.

    Existe como função nomeada (em vez de `usuarios_com_perm_qs('view_content')`
    espalhado por aí) porque "participa do trabalho" é um conceito de produto:
    quem não enxerga sprint, projeto nem card não deve aparecer em lista de
    "pessoas sem card" nem entrar no denominador de métrica nenhuma. O dia em
    que a definição desse piso mudar, muda aqui.

    Devolve um `set` de ids, e não um queryset, porque o uso é sempre de
    pertinência (`pk in ...`) ou de filtro (`pk__in=...`) — resolver uma vez e
    reusar é o que evita o N+1 na serialização de uma página inteira.
    """
    return set(usuarios_com_perm_qs('view_content').values_list('id', flat=True))


def ids_que_executam_o_trabalho():
    """Ids de quem aparece como LINHA nas telas de "quem está sem card".

    IRMÃ MAIS ESTREITA de `ids_que_participam_do_trabalho`, e a diferença entre
    as duas é de produto, não de técnica:

      - `participam` é o PISO DE LEITURA — quem enxerga sprint, projeto e card.
        Serve para listagem de gente e denominador de métrica.
      - `executam` tira dali quem SUPERVISIONA as prioridades. Quem supervisiona
        é leitor dessas telas, não item delas: cobrar card de quem distribui
        card não quer dizer nada, e é por isso que o admin aparecia na lista de
        "sem card" do painel.

    Estava escrita como `_usuarios_que_executam` dentro de `projects/views.py` e
    valia só para Prioridades; o painel usava o piso de leitura e por isso
    mostrava duas pessoas a mais. Subiu para cá — mesma casa de
    `ids_que_participam_do_trabalho` — para as duas telas responderem à mesma
    pergunta com a mesma resposta.
    """
    return ids_que_participam_do_trabalho() - set(
        usuarios_com_perm_qs('manage_weekly_priorities').values_list('id', flat=True)
    )


def permissoes_concediveis_por(user):
    """Permissões que `user` pode conceder a terceiros.

    Anti-escalonamento: quem administra permissões só distribui o que já tem.
    Sem isso, `manage_user_permissions` seria um caminho direto para virar
    admin. Superuser é a exceção — ele já pode tudo por definição.
    """
    from .permission_catalog import PERMISSION_CATALOG

    todos = [codename for codename, _label, _area in PERMISSION_CATALOG]
    if user.is_superuser:
        return set(todos)
    return {c for c in todos if user.has_perm(f'accounts.{c}')}


def permissoes_por_usuario(usuarios) -> dict:
    """`{user_id: [codenames]}` para uma lista de usuários, em POUCAS consultas.

    A versão por linha custa caro numa listagem: `UserSerializer.get_permissions`
    percorre o catálogo inteiro chamando `has_perm`, e cada usuário novo obriga
    o Django a carregar as permissões dele. Medido em `/api/users/` com 15
    usuários vistos por uma conta que gerencia usuários: 49 consultas e ~616 ms
    — e como a tela do projeto espera as quatro chamadas dela em `Promise.all`,
    esse era o piso do carregamento, mesmo num projeto com ZERO cards.

    ESTE RESOLVEDOR PRECISA CONCORDAR COM `has_perm`, SEMPRE. Ele não é uma
    aproximação: reproduz os três backends que a plataforma tem, na mesma ordem
    em que eles concedem (a união do que qualquer um conceder):

      1. `ModelBackend`      — `user_permissions` e grupos; superusuário leva tudo
      2. `AdminRolePermission` — `role == 'admin'` leva o catálogo inteiro
      3. `CargoPermission`   — o que estiver em `Cargo.permissoes_padrao`

    Usuário INATIVO recebe lista vazia: é o que o Django faz em `has_perm`, e os
    outros dois backends também exigem `is_active`.

    O teste `PermissoesEmMassaTests` compara o resultado desta função com o laço
    de `has_perm` para TODOS os usuários do banco — se algum dia os backends
    mudarem e esta função ficar para trás, ele quebra.
    """
    from django.contrib.auth.models import Permission
    from .models import Cargo

    usuarios = list(usuarios or [])
    if not usuarios:
        return {}

    catalogo = {codename for codename, _label, _area in PERMISSION_CATALOG}

    # 1 consulta: o catálogo de cargos inteiro (dezenas de linhas).
    try:
        por_cargo = {
            codename: set(template) if isinstance(template, list) else set()
            for codename, template in Cargo.objects.values_list('codename', 'permissoes_padrao')
        }
    except DatabaseError:
        logger.warning('Cargos indisponíveis ao resolver permissões em massa')
        por_cargo = {}

    # 1 consulta: TODAS as permissões diretas dos usuários desta página.
    ids = [u.pk for u in usuarios]
    diretas: dict = {}
    for user_id, codename in Permission.objects.filter(
        user__in=ids, content_type__app_label='accounts'
    ).values_list('user__id', 'codename'):
        diretas.setdefault(user_id, set()).add(codename)

    # 1 consulta: permissões vindas de GRUPO.
    for user_id, codename in Permission.objects.filter(
        group__user__in=ids, content_type__app_label='accounts'
    ).values_list('group__user__id', 'codename'):
        diretas.setdefault(user_id, set()).add(codename)

    resultado = {}
    for u in usuarios:
        if not u.is_active:
            resultado[u.pk] = []
            continue
        if u.is_superuser:
            resultado[u.pk] = sorted(catalogo)
            continue

        concedidas = set(diretas.get(u.pk, set()))
        papel = getattr(u, 'role', None)
        if papel == 'admin':
            concedidas |= catalogo
        concedidas |= por_cargo.get(papel, set())

        # Só o que o catálogo declara: permissão de outro app (ou órfã de uma
        # versão antiga) não é assunto desta lista.
        resultado[u.pk] = sorted(concedidas & catalogo)

    return resultado
