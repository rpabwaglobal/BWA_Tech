"""Backends de permissão baseados no CARGO do usuário.

Por que existem: todos os gates da plataforma foram convertidos para `has_perm`,
de modo que qualquer cargo criado pelo admin (CEO, Supervisor, Gerente...) possa
receber capacidades administrativas. Só que o próprio Admin não pode depender de
alguém ter lembrado de aplicar o template de permissões nele — um admin sem
permissão trava a plataforma inteira, sem ninguém para destravar.

Então a regra "admin pode tudo" fica declarada AQUI, num lugar só, em vez de
espalhada em comparações `role == 'admin'` pelos viewsets. `is_superuser` já é
tratado pelo ModelBackend do Django e não precisa passar por aqui.

`CargoPermissionBackend` estende a mesma ideia aos demais cargos: o que está em
`Cargo.permissoes_padrao` passa a ser concedido de verdade, e não apenas copiado
para `user_permissions` quando alguém lembra de marcar a caixinha.
"""
import logging

from django.contrib.auth.backends import BaseBackend
from django.db.utils import DatabaseError

from .permission_catalog import PERMISSION_CATALOG

logger = logging.getLogger(__name__)

ADMIN_ROLE = 'admin'
_ALL_PERMS = frozenset(f'accounts.{codename}' for codename, _label, _area in PERMISSION_CATALOG)


class AdminRolePermissionBackend(BaseBackend):
    """Concede o catálogo inteiro a quem tem role='admin'. Não autentica nada."""

    def authenticate(self, request, **kwargs):
        return None

    def _eh_admin(self, user_obj):
        return bool(
            user_obj
            and user_obj.is_active
            and getattr(user_obj, 'role', None) == ADMIN_ROLE
        )

    def get_all_permissions(self, user_obj, obj=None):
        if obj is not None or not self._eh_admin(user_obj):
            return set()
        return set(_ALL_PERMS)

    def has_perm(self, user_obj, perm, obj=None):
        if obj is not None:
            return False
        return self._eh_admin(user_obj) and perm in _ALL_PERMS


class CargoPermissionBackend(BaseBackend):
    """Concede ao usuário as permissões do cargo dele (`Cargo.permissoes_padrao`).

    POR QUE isto é um backend de autenticação, e não uma cópia do template para
    `user_permissions` no momento em que o cargo é atribuído:

    O requisito diz que a permissão do cargo e a permissão personalizada devem
    "se somar e manter, independente dessa permissão vir depois de ter o setor
    atribuído ou ele já ter a permissão antes". Copiar faz a ORDEM importar, e
    das duas formas dá errado:
      - aplicar o template DEPOIS de uma permissão personalizada sobrescreve a
        personalizada (`user_permissions.set(...)` substitui o conjunto);
      - conceder a personalizada ANTES e trocar o cargo depois perde a
        personalizada pelo mesmo motivo;
      - e editar `permissoes_padrao` de um cargo não alcançaria ninguém que já
        o tem — o template só é lido no instante da atribuição.

    Resolvendo na hora do `has_perm`, a união é ESTRUTURAL: o `_user_has_perm`
    do Django percorre todos os backends e devolve True se QUALQUER um disser
    True. O ModelBackend responde pelas permissões personalizadas (a tabela
    `user_permissions`), este aqui responde pelas do cargo, e a soma acontece
    sem ninguém precisar orquestrar nada. Ordem deixa de existir como conceito:
    não há estado copiado que possa ficar desatualizado ou ser sobrescrito, e
    editar o cargo passa a valer imediatamente para todo mundo que o tem.

    Consequência de projeto: `permissoes_padrao` deixa de ser "template" e vira
    fonte de autoridade. Quem edita essa lista concede acesso de verdade — por
    isso o gate de edição de Cargo (accounts/views.py, CargoViewSet) aplica a
    mesma regra anti-escalonamento do `set-permissions` de usuário.
    """

    # Atributo de cache PRÓPRIO: `_perm_cache`/`_user_perm_cache` são do
    # ModelBackend e sobrescrevê-los faria as permissões personalizadas sumirem.
    # O valor é guardado no `__dict__` da INSTÂNCIA de User (nunca na classe,
    # nunca em módulo): a instância vive uma request, então trocar o cargo de
    # alguém vale na request seguinte. Um cache de módulo faria a mudança só
    # surtir efeito no próximo restart do processo — o oposto de "tempo real".
    _CACHE_ATTR = '_cargo_perm_cache'

    def authenticate(self, request, **kwargs):
        return None

    @staticmethod
    def _consultar_cargo(role):
        """Lê `permissoes_padrao` do cargo e devolve o conjunto de permissões.

        Filtra pelo PERMISSION_CATALOG: `permissoes_padrao` é um JSONField, e um
        codename inválido gravado lá (typo, permissão removida do catálogo numa
        release) não pode virar permissão fantasma que nenhum gate reconhece."""
        from .models import Cargo

        try:
            cargo = Cargo.objects.filter(codename=role).only('permissoes_padrao').first()
        except DatabaseError:
            # Tabela ainda não existe (bootstrapping antes das migrations).
            # Nunca conceder por falha de leitura: fail-closed.
            logger.warning('Cargo indisponível ao resolver permissões de role=%s', role)
            return frozenset()
        if cargo is None:
            # `role` é CharField livre: pode apontar para um cargo excluído ou
            # nunca criado. Conjunto vazio, sem estourar.
            return frozenset()
        template = cargo.permissoes_padrao or []
        if not isinstance(template, list):
            logger.warning('permissoes_padrao do cargo %s não é lista — ignorado', role)
            return frozenset()
        return frozenset(
            f'accounts.{c}' for c in template if isinstance(c, str)
        ) & _ALL_PERMS

    def _permissoes_do_cargo(self, user_obj):
        if not (user_obj is not None and getattr(user_obj, 'is_active', False)):
            # Inativo/anônimo não recebe nada — espelha o ModelBackend, e evita
            # que uma conta desativada continue autorizada pelo cargo.
            return frozenset()
        role = (getattr(user_obj, 'role', '') or '').strip()
        if not role:
            return frozenset()
        # A chave inclui o role: se o cargo mudar na MESMA instância (fluxos que
        # fazem `u.role = X; u.save()` e logo depois checam acesso), o cache é
        # descartado em vez de responder pelo cargo antigo.
        cacheado = user_obj.__dict__.get(self._CACHE_ATTR)
        if cacheado is not None and cacheado[0] == role:
            return cacheado[1]
        perms = self._consultar_cargo(role)
        user_obj.__dict__[self._CACHE_ATTR] = (role, perms)
        return perms

    def get_all_permissions(self, user_obj, obj=None):
        if obj is not None:
            return set()
        return set(self._permissoes_do_cargo(user_obj))

    def has_perm(self, user_obj, perm, obj=None):
        if obj is not None:
            return False
        return perm in self._permissoes_do_cargo(user_obj)
