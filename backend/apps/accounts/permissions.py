"""Gates de autorização da plataforma.

Regra geral: autorização é decidida por PERMISSÃO (`has_perm`), nunca por
comparação de cargo. É isso que permite ao admin criar um cargo qualquer
(CEO, Supervisor, Gerente...) e conceder a ele as capacidades que quiser.

As duas únicas exceções, ambas deliberadas:
  - `NaoVisitanteEscreve` compara com o cargo 'visitante' — é uma rede de
    segurança de leitura-apenas, não um gate de capacidade;
  - `AdminRolePermissionBackend` (auth_backends.py) concede tudo a role='admin',
    para que a plataforma nunca fique sem administrador.
"""
from django.conf import settings
from rest_framework import permissions

from .models import Role


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
