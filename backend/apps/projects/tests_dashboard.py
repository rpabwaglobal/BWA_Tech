"""O resumo do dashboard: uma requisicao no lugar de ~40.

O teste que mais importa aqui NAO e o das contagens - e o de ESCOPO. Agregar no
servidor nao pode virar uma porta lateral que devolve, somado, o que a pessoa
nao veria item a item.
"""
import datetime as dt

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import SetorCatalogo
from apps.projects.models import Card, CardStatus, Project, Sprint

User = get_user_model()
ROTA = '/api/dashboard/resumo/'


class DashboardResumoTests(APITestCase):

    def setUp(self):
        self.admin = User.objects.create_user(
            username='admin_dash', email='admin.dash@example.com', password='x' * 12,
            role='admin', is_superuser=True, is_staff=True)
        self.setor_a = SetorCatalogo.objects.create(codename='setor_a', nome='Setor A')
        self.setor_b = SetorCatalogo.objects.create(codename='setor_b', nome='Setor B')

        agora = timezone.now()
        self.sprint_ativa = Sprint.objects.create(
            nome='Ativa', data_inicio=agora - dt.timedelta(days=1),
            fechamento_em=agora + dt.timedelta(days=7), duracao_dias=8,
            supervisor=self.admin, setor=self.setor_a)
        self.sprint_velha = Sprint.objects.create(
            nome='Velha', data_inicio=agora - dt.timedelta(days=40),
            fechamento_em=agora - dt.timedelta(days=20), duracao_dias=20,
            supervisor=self.admin, setor=self.setor_a, finalizada=True)

        self.projeto = Project.objects.create(nome='Projeto A', sprint=self.sprint_ativa)
        self.projeto_velho = Project.objects.create(nome='Projeto velho', sprint=self.sprint_velha)

        self.dev = User.objects.create_user(
            username='dev_dash', email='dev.dash@example.com', password='x' * 12,
            role='desenvolvedor')

        Card.objects.create(nome='C1', projeto=self.projeto, status=CardStatus.A_DESENVOLVER,
                            criado_por=self.admin)
        Card.objects.create(nome='C2', projeto=self.projeto,
                            status=CardStatus.EM_DESENVOLVIMENTO, responsavel=self.dev,
                            criado_por=self.admin)
        Card.objects.create(nome='C3', projeto=self.projeto, status=CardStatus.FINALIZADO,
                            criado_por=self.admin)
        # Card de sprint ENCERRADA: nao pode entrar nas contagens de "sprints ativas".
        Card.objects.create(nome='C-velho', projeto=self.projeto_velho,
                            status=CardStatus.A_DESENVOLVER, criado_por=self.admin)

        self.client.force_authenticate(user=self.admin)

    def test_contagens_batem_com_o_estado_do_banco(self):
        r = self.client.get(ROTA)
        self.assertEqual(r.status_code, 200, r.content)

        self.assertEqual(r.data['sprints']['em_andamento'], 1)
        self.assertEqual(r.data['cards']['a_desenvolver'], 1, 'card de sprint encerrada vazou')
        self.assertEqual(r.data['cards']['em_desenvolvimento'], 1)
        self.assertEqual(len(r.data['cards']['lista_em_desenvolvimento']), 1)

    def test_a_lista_traz_o_nome_do_projeto_pronto(self):
        """O cliente montava isso cruzando cards com a lista de projetos - mais
        um motivo para ele baixar todos os projetos."""
        r = self.client.get(ROTA)
        card = r.data['cards']['lista_em_desenvolvimento'][0]
        self.assertEqual(card['projeto_nome'], 'Projeto A')

    def test_usuarios_sem_card_exclui_quem_tem_card_em_desenvolvimento(self):
        r = self.client.get(ROTA)
        ids = {u['id'] for u in r.data['usuarios_sem_card']}
        self.assertNotIn(self.dev.id, ids, 'quem TEM card em desenvolvimento apareceu como sem card')

    def test_visitante_sem_view_content_e_recusado(self):
        visitante = User.objects.create_user(
            username='visita_dash', email='visita.dash@example.com', password='x' * 12,
            role='visitante')
        self.client.force_authenticate(user=visitante)
        r = self.client.get(ROTA)
        self.assertIn(r.status_code, (401, 403), r.content)

    @override_settings(SETOR_SCOPING_ENABLED=True)
    def test_com_recorte_por_setor_ligado_a_agregacao_respeita_o_escopo(self):
        """A pergunta que este endpoint torna perigosa: agregar poderia
        devolver SOMADO o que a pessoa nao ve item a item.

        Com o recorte ligado, quem so enxerga o Setor B nao pode receber a
        contagem dos cards do Setor A.
        """
        from apps.accounts.models import UserSetor

        de_outro_setor = User.objects.create_user(
            username='outro_setor', email='outro.setor@example.com', password='x' * 12,
            role='desenvolvedor')
        UserSetor.objects.create(user=de_outro_setor, setor=self.setor_b, is_primary=True)
        from django.contrib.auth.models import Permission
        de_outro_setor.user_permissions.add(
            Permission.objects.get(codename='view_content'))

        self.client.force_authenticate(user=de_outro_setor)
        r = self.client.get(ROTA)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(
            r.data['cards']['em_desenvolvimento'], 0,
            'a agregacao devolveu card de um setor que este usuario nao enxerga')
        self.assertEqual(r.data['cards']['a_desenvolver'], 0)

    def test_projeto_de_sistema_em_sprint_normal_CONTINUA_contando(self):
        """Suporte, Sugestoes e Descartados sao `is_system` e SEMPRE contaram.

        O corte e so o fluxo de monitoramento (sistema DENTRO de sprint de
        sistema). Cortar por `is_system` sozinho mudaria o painel sem ninguem
        ter pedido - o Dashboard registra isso em comentario.
        """
        Project.objects.create(nome='Suporte', sprint=self.sprint_ativa, is_system=True)
        r = self.client.get(ROTA)
        nomes = {p['nome'] for p in r.data['projetos']['recentes']}
        self.assertIn('Suporte', nomes)

    def test_fluxo_de_monitoramento_nao_conta(self):
        sprint_sistema = Sprint.objects.create(
            nome='Sistema', data_inicio=timezone.now() - dt.timedelta(days=1),
            fechamento_em=timezone.now() + dt.timedelta(days=30), duracao_dias=31,
            supervisor=self.admin, setor=self.setor_a, is_system=True)
        Project.objects.create(
            nome='Monitoramento de Feedbacks', sprint=sprint_sistema, is_system=True)

        r = self.client.get(ROTA)
        nomes = {p['nome'] for p in r.data['projetos']['recentes']}
        self.assertNotIn('Monitoramento de Feedbacks', nomes)

    def test_ativos_e_concluidos_usam_os_mesmos_status_da_tela(self):
        """A tela contava ativos como em_desenvolvimento+em_avaliacao e
        concluidos como homologado. `entregue` nao entra em nenhum dos dois."""
        from apps.projects.models import ProjectStatus

        Project.objects.create(nome='P em dev', sprint=self.sprint_ativa,
                               status=ProjectStatus.EM_DESENVOLVIMENTO)
        Project.objects.create(nome='P em aval', sprint=self.sprint_ativa,
                               status=ProjectStatus.EM_AVALIACAO)
        Project.objects.create(nome='P homologado', sprint=self.sprint_ativa,
                               status=ProjectStatus.HOMOLOGADO)
        Project.objects.create(nome='P entregue', sprint=self.sprint_ativa,
                               status=ProjectStatus.ENTREGUE)

        r = self.client.get(ROTA)
        self.assertEqual(r.data['projetos']['ativos'], 2)
        self.assertEqual(r.data['projetos']['concluidos'], 1)

    def test_projeto_arquivado_fica_de_fora(self):
        Project.objects.create(nome='Arquivado', sprint=self.sprint_ativa, arquivado=True)
        r = self.client.get(ROTA)
        nomes = {p['nome'] for p in r.data['projetos']['recentes']}
        self.assertNotIn('Arquivado', nomes)
