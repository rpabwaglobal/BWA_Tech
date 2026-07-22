from rest_framework import permissions
from .models import Role


class IsAdmin(permissions.BasePermission):
    """Permissão apenas para Admin"""
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.role == Role.ADMIN


class IsSupervisor(permissions.BasePermission):
    """Permissão apenas para Supervisor"""
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.role == Role.SUPERVISOR


class IsGerente(permissions.BasePermission):
    """Permissão apenas para Gerente"""
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.role == Role.GERENTE


class IsDesenvolvedor(permissions.BasePermission):
    """Permissão apenas para Desenvolvedor"""
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.role == Role.DESENVOLVEDOR


class IsAdminOrSupervisor(permissions.BasePermission):
    """Permissão para Admin ou Supervisor"""
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.role in [Role.ADMIN, Role.SUPERVISOR]


class IsAdminOrSupervisorOrGerente(permissions.BasePermission):
    """Permissão para Admin, Supervisor ou Gerente"""
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.role in [Role.ADMIN, Role.SUPERVISOR, Role.GERENTE]


class IsAdminOrSupervisorOrReadOnly(permissions.BasePermission):
    """Leitura para qualquer autenticado; escrita apenas para Admin ou Supervisor."""
    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        if request.method in permissions.SAFE_METHODS:
            return True
        return request.user.role in [Role.ADMIN, Role.SUPERVISOR]


class CanManageUserPermissions(permissions.BasePermission):
    """Admin/supervisor gerenciando as permissões/status de OUTRO usuário que
    não seja admin (admin só é gerenciável por outro admin). Ninguém pode
    gerenciar a própria conta por aqui (evita autobloqueio/autoescalonamento)."""

    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.role in (Role.ADMIN, Role.SUPERVISOR)

    def has_object_permission(self, request, view, obj):
        if obj.pk == request.user.pk:
            return False
        if obj.role == Role.ADMIN and request.user.role != Role.ADMIN:
            return False
        return True


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
