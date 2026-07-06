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
