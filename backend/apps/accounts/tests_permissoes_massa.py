"""O resolvedor em massa TEM de concordar com `has_perm`, sempre.

Ele existe por desempenho: a listagem de usuarios percorria o catalogo inteiro
chamando `has_perm` por linha (49 consultas, ~616 ms para 15 usuarios). Mas
desempenho nao pode custar CORRECAO aqui - divergir do `has_perm` faria a tela
mostrar um mapa de poderes que nao e o real.

Por isso o teste nao afirma valores esperados: ele compara as DUAS
implementacoes, usuario por usuario, permissao por permissao.
"""
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group, Permission
from django.test import TestCase

from apps.accounts.permission_catalog import PERMISSION_CATALOG
from apps.accounts.models import Cargo
from apps.accounts.permissions import permissoes_por_usuario

User = get_user_model()


class PermissoesEmMassaTests(TestCase):

    def _conferir(self, usuarios):
        """Compara o resolvedor em massa com o laco de has_perm."""
        massa = permissoes_por_usuario(usuarios)
        for u in usuarios:
            u_fresco = User.objects.get(pk=u.pk)  # sem cache de permissao
            esperado = sorted(
                c for c, _l, _a in PERMISSION_CATALOG
                if u_fresco.has_perm(f'accounts.{c}')
            )
            self.assertEqual(
                massa.get(u.pk), esperado,
                f'Divergencia para {u.username}: em massa={massa.get(u.pk)} '
                f'has_perm={esperado}')

    def test_concorda_com_has_perm_em_todas_as_formas_de_conceder(self):
        cargo = Cargo.objects.create(
            codename='gerente_teste', nome='Gerente Teste',
            permissoes_padrao=['view_content', 'manage_kanban_config'])

        comum = User.objects.create_user(
            username='comum_perm', email='comum.perm@example.com', password='x' * 12,
            role='visitante')
        por_cargo = User.objects.create_user(
            username='cargo_perm', email='cargo.perm@example.com', password='x' * 12,
            role=cargo.codename)
        direta = User.objects.create_user(
            username='direta_perm', email='direta.perm@example.com', password='x' * 12,
            role='visitante')
        direta.user_permissions.add(Permission.objects.get(codename='view_metrics'))
        admin = User.objects.create_user(
            username='admin_perm', email='admin.perm@example.com', password='x' * 12,
            role='admin')
        superus = User.objects.create_superuser(
            username='super_perm', email='super.perm@example.com', password='x' * 12)
        inativo = User.objects.create_user(
            username='inativo_perm', email='inativo.perm@example.com', password='x' * 12,
            role='admin', is_active=False)

        # Soma de cargo + permissao direta: o caso que o backend de cargo existe
        # para garantir (as duas se somam, em qualquer ordem).
        somado = User.objects.create_user(
            username='somado_perm', email='somado.perm@example.com', password='x' * 12,
            role=cargo.codename)
        somado.user_permissions.add(Permission.objects.get(codename='manage_users'))

        # Permissao vinda de GRUPO.
        grupo = Group.objects.create(name='grupo_perm')
        grupo.permissions.add(Permission.objects.get(codename='view_geekday'))
        de_grupo = User.objects.create_user(
            username='grupo_perm_user', email='grupo.perm@example.com', password='x' * 12,
            role='visitante')
        de_grupo.groups.add(grupo)

        self._conferir([comum, por_cargo, direta, admin, superus, inativo, somado, de_grupo])

    def test_concorda_para_todos_os_usuarios_ja_existentes(self):
        """Cobre o que as migracoes semearam, sem depender de fixture."""
        usuarios = list(User.objects.all()[:30])
        if usuarios:
            self._conferir(usuarios)

    def test_lista_vazia_nao_consulta_nada(self):
        self.assertEqual(permissoes_por_usuario([]), {})

    def test_inativo_nao_recebe_nada_mesmo_sendo_admin(self):
        inativo = User.objects.create_user(
            username='adm_inativo', email='adm.inativo@example.com', password='x' * 12,
            role='admin', is_active=False)
        self.assertEqual(permissoes_por_usuario([inativo])[inativo.pk], [])
