from datetime import datetime, time, timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from apps.projects.models import (
    Sprint,
    Project,
    Card,
    CardStatus,
    CardLog,
    CardLogEventType,
)
from apps.projects.services import data_inicio_para_status, finalizar_sprint_replicacao


class CardDataInicioTests(TestCase):
    def test_data_inicio_limpa_em_a_desenvolver(self):
        dt = timezone.now()
        self.assertIsNone(data_inicio_para_status(CardStatus.A_DESENVOLVER, dt))

    def test_data_inicio_mantida_em_desenvolvimento(self):
        dt = timezone.now()
        self.assertEqual(data_inicio_para_status(CardStatus.EM_DESENVOLVIMENTO, dt), dt)


class SprintReplicationTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username='tester',
            email='tester@example.com',
            password='pass12345',
            role='admin',
        )
        tz = timezone.get_current_timezone()
        hoje = timezone.now().date()
        origem_fim = hoje - timedelta(days=1)
        origem_inicio = origem_fim - timedelta(days=14)
        destino_fim = hoje + timedelta(days=13)

        self.sprint_origem = Sprint.objects.create(
            nome='Sprint 4',
            data_inicio=timezone.make_aware(datetime.combine(origem_inicio, time.min), tz),
            fechamento_em=timezone.make_aware(datetime.combine(origem_fim, time(23, 0)), tz),
            duracao_dias=14,
            supervisor=self.user,
        )
        self.sprint_destino = Sprint.objects.create(
            nome='Sprint 5',
            data_inicio=timezone.make_aware(datetime.combine(hoje, time.min), tz),
            fechamento_em=timezone.make_aware(datetime.combine(destino_fim, time(23, 0)), tz),
            duracao_dias=14,
            supervisor=self.user,
        )
        self.projeto = Project.objects.create(
            nome='Projeto Teste Replicação',
            sprint=self.sprint_origem,
        )
        self.criado_em = timezone.make_aware(datetime.combine(origem_inicio, time(9, 0)), tz)
        self.data_inicio_dev = timezone.make_aware(datetime.combine(origem_inicio, time(10, 41)), tz)
        self.card = Card.objects.create(
            nome='Mudar layout da assinatura de email',
            projeto=self.projeto,
            status=CardStatus.EM_DESENVOLVIMENTO,
            criado_por=self.user,
            data_inicio=self.data_inicio_dev,
        )
        Card.objects.filter(pk=self.card.pk).update(created_at=self.criado_em)
        self.card.refresh_from_db()

    def test_replicacao_preserva_criacao_inicio_e_timeline(self):
        result = finalizar_sprint_replicacao(self.sprint_origem, criado_por_user=self.user)
        self.assertIsNotNone(result)
        self.assertEqual(result['cards_copiados'], 1)

        novo = Card.objects.get(
            nome=self.card.nome,
            projeto__sprint=self.sprint_destino,
        )
        self.assertEqual(novo.created_at, self.criado_em)
        self.assertEqual(novo.data_inicio, self.data_inicio_dev)
        self.assertEqual(novo.status, CardStatus.EM_DESENVOLVIMENTO)
        self.assertEqual(novo.criado_por_id, self.user.id)

        logs = list(novo.logs.order_by('data', 'id'))
        tipos = [log.tipo_evento for log in logs]
        self.assertIn(CardLogEventType.CRIADO, tipos)
        self.assertIn(CardLogEventType.TRANSFERIDO_SPRINT, tipos)
        self.assertEqual(tipos.count(CardLogEventType.CRIADO), 1)

        transfer = novo.logs.filter(tipo_evento=CardLogEventType.TRANSFERIDO_SPRINT).first()
        self.assertIn('Sprint 4', transfer.descricao)
        self.assertIn('Sprint 5', transfer.descricao)

    def test_replicacao_a_desenvolver_sem_data_inicio(self):
        card_backlog = Card.objects.create(
            nome='Card backlog',
            projeto=self.projeto,
            status=CardStatus.A_DESENVOLVER,
            criado_por=self.user,
            data_inicio=self.data_inicio_dev,
        )
        Card.objects.filter(pk=card_backlog.pk).update(created_at=self.criado_em)

        self.sprint_origem.finalizada = False
        self.sprint_origem.save(update_fields=['finalizada'])

        finalizar_sprint_replicacao(self.sprint_origem, criado_por_user=self.user)

        novo = Card.objects.get(nome='Card backlog', projeto__sprint=self.sprint_destino)
        self.assertIsNone(novo.data_inicio)
        self.assertEqual(novo.created_at, self.criado_em)


class CardSaveDataInicioTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username='tester2',
            email='tester2@example.com',
            password='pass12345',
            role='admin',
        )
        self.sprint = Sprint.objects.create(
            nome='Sprint',
            data_inicio=timezone.now(),
            fechamento_em=timezone.now(),
            duracao_dias=14,
            supervisor=self.user,
        )
        self.project = Project.objects.create(nome='Proj', sprint=self.sprint)

    def test_save_limpa_data_inicio_em_a_desenvolver(self):
        card = Card.objects.create(
            nome='Backlog',
            projeto=self.project,
            status=CardStatus.A_DESENVOLVER,
            data_inicio=timezone.now(),
        )
        card.refresh_from_db()
        self.assertIsNone(card.data_inicio)
