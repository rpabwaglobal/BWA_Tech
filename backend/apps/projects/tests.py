from datetime import datetime, time, timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone

from apps.projects.models import (
    Sprint,
    Project,
    Card,
    CardStatus,
    CardLog,
    CardLogEventType,
)
from apps.projects.services import (
    data_inicio_para_status,
    finalizar_sprint_replicacao,
    outra_sprint_em_andamento,
    sprint_esta_em_andamento_janela,
)
from apps.projects.serializers import SprintSerializer


def hoje_local():
    """Data de HOJE no fuso do projeto.

    Não use `hoje_local()` em teste: ela devolve a data em UTC, e o
    código de produção compara com data LOCAL (`sprint_esta_em_andamento_janela`
    usa `timezone.localtime(...)`). Em America/Sao_Paulo as duas divergem das
    21h à meia-noite — a suíte passava de dia e quebrava à noite.
    """
    return timezone.localdate()


def setor_de_teste():
    """Sprint pertence a um setor (campo NOT NULL desde projects/0053), então
    todo cenário precisa de um. Reaproveita o setor padrão semeado pelas
    migrations em vez de criar um novo a cada teste."""
    from apps.accounts.models import SetorCatalogo
    setor, _ = SetorCatalogo.objects.get_or_create(
        codename='sem_setor', defaults={'nome': 'Sem Setor', 'is_system': True})
    return setor


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
        hoje = hoje_local()
        origem_fim = hoje - timedelta(days=1)
        origem_inicio = origem_fim - timedelta(days=14)
        destino_fim = hoje + timedelta(days=13)

        self.sprint_origem = Sprint.objects.create(
            nome='Sprint 4',
            data_inicio=timezone.make_aware(datetime.combine(origem_inicio, time.min), tz),
            fechamento_em=timezone.make_aware(datetime.combine(origem_fim, time(23, 0)), tz),
            duracao_dias=14,
            supervisor=self.user,
            setor=setor_de_teste(),
        )
        self.sprint_destino = Sprint.objects.create(
            nome='Sprint 5',
            data_inicio=timezone.make_aware(datetime.combine(hoje, time.min), tz),
            fechamento_em=timezone.make_aware(datetime.combine(destino_fim, time(23, 0)), tz),
            duracao_dias=14,
            supervisor=self.user,
            setor=setor_de_teste(),
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
            setor=setor_de_teste(),
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


class SprintUnicaEmAndamentoTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username='sprintadmin',
            email='sprintadmin@example.com',
            password='pass12345',
            role='admin',
        )
        tz = timezone.get_current_timezone()
        hoje = hoje_local()
        fim = hoje + timedelta(days=13)
        self.sprint_ativa = Sprint.objects.create(
            nome='Sprint Ativa',
            data_inicio=timezone.make_aware(datetime.combine(hoje, time.min), tz),
            fechamento_em=timezone.make_aware(datetime.combine(fim, time(23, 0)), tz),
            duracao_dias=14,
            supervisor=self.user,
            setor=setor_de_teste(),
        )

    def test_sprint_ativa_detectada_na_janela(self):
        self.assertTrue(sprint_esta_em_andamento_janela(self.sprint_ativa))

    def test_nao_permite_segunda_sprint_na_mesma_janela(self):
        tz = timezone.get_current_timezone()
        hoje = hoje_local()
        fim = hoje + timedelta(days=10)
        data = {
            'nome': 'Sprint Duplicada',
            'data_inicio': timezone.make_aware(datetime.combine(hoje, time.min), tz),
            'fechamento_em': timezone.make_aware(datetime.combine(fim, time(23, 0)), tz),
            'supervisor': self.user.pk,
            'setor': self.sprint_ativa.setor.codename,
        }
        serializer = SprintSerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('non_field_errors', serializer.errors)

    def test_permite_sprint_simultanea_em_outro_setor(self):
        """Dois setores podem ter sprint aberta ao mesmo tempo — é o que
        destrava a operação multi-setor."""
        from apps.accounts.models import SetorCatalogo
        outro = SetorCatalogo.objects.create(codename='comercial', nome='Comercial')
        tz = timezone.get_current_timezone()
        hoje = hoje_local()
        fim = hoje + timedelta(days=10)
        serializer = SprintSerializer(data={
            'nome': 'Sprint do Comercial',
            'data_inicio': timezone.make_aware(datetime.combine(hoje, time.min), tz),
            'fechamento_em': timezone.make_aware(datetime.combine(fim, time(23, 0)), tz),
            'supervisor': self.user.pk,
            'setor': outro.codename,
        })
        self.assertTrue(serializer.is_valid(), serializer.errors)

    def _payload(self, nome, dia_inicio, dia_fim, setor=None):
        tz = timezone.get_current_timezone()
        hoje = hoje_local()
        return {
            'nome': nome,
            'data_inicio': timezone.make_aware(
                datetime.combine(hoje + timedelta(days=dia_inicio), time.min), tz),
            'fechamento_em': timezone.make_aware(
                datetime.combine(hoje + timedelta(days=dia_fim), time(23, 0)), tz),
            'supervisor': self.user.pk,
            'setor': (setor or self.sprint_ativa.setor).codename,
        }

    def test_permite_sprint_planejada_depois_do_fechamento(self):
        """A fila é o caso de uso normal: a próxima sprint é cadastrada com
        antecedência para começar quando a atual fechar."""
        s = SprintSerializer(data=self._payload('Sprint Planejada', 14, 27))
        self.assertTrue(s.is_valid(), s.errors)

    def test_recusa_sprint_planejada_que_sobrepoe_a_atual(self):
        """Sem comparar janelas, esta sprint passaria (hoje ela não está em
        andamento) e o setor amanheceria com duas abertas no quinto dia."""
        s = SprintSerializer(data=self._payload('Sprint Sobreposta', 5, 20))
        self.assertFalse(s.is_valid())
        self.assertIn('já tem a sprint', str(s.errors))

    def test_permite_varias_planejadas_enfileiradas(self):
        """Não é "duas sprints por setor": é uma em andamento e quantas
        planejadas o setor quiser, desde que não se cruzem."""
        primeira = SprintSerializer(data=self._payload('Fila 1', 14, 27))
        self.assertTrue(primeira.is_valid(), primeira.errors)
        primeira.save()
        segunda = SprintSerializer(data=self._payload('Fila 2', 28, 41))
        self.assertTrue(segunda.is_valid(), segunda.errors)
        segunda.save()
        self.assertEqual(
            Sprint.objects.filter(setor=self.sprint_ativa.setor, finalizada=False).count(), 3)

    def test_sprint_finalizada_libera_a_janela(self):
        """Finalizar tira a sprint da fila — o período volta a ficar livre."""
        self.sprint_ativa.finalizada = True
        self.sprint_ativa.save(update_fields=['finalizada'])
        s = SprintSerializer(data=self._payload('Nova na mesma janela', 0, 13))
        self.assertTrue(s.is_valid(), s.errors)

    def test_editar_a_propria_sprint_nao_conflita_consigo(self):
        s = SprintSerializer(
            instance=self.sprint_ativa, data={'nome': 'Renomeada'}, partial=True)
        self.assertTrue(s.is_valid(), s.errors)

    def test_outra_sprint_em_andamento_exclui_a_propria(self):
        setor = self.sprint_ativa.setor
        self.assertIsNone(
            outra_sprint_em_andamento(setor_id=setor.pk, exclude_pk=self.sprint_ativa.pk))
        self.assertEqual(outra_sprint_em_andamento(setor_id=setor.pk), self.sprint_ativa)

    def test_sprint_ativa_de_outro_setor_nao_bloqueia(self):
        """A regra 'uma sprint por vez' vale por setor: o ciclo de um setor
        não pode impedir outro de abrir o dele."""
        from apps.accounts.models import SetorCatalogo
        outro = SetorCatalogo.objects.create(codename='comercial', nome='Comercial')
        self.assertIsNone(outra_sprint_em_andamento(setor_id=outro.pk))


class CompartilhamentoPorNivelTests(TestCase):
    """Os dois níveis do compartilhamento entre setores.

    Exercita `nivel_de_acesso` diretamente, sem HTTP: é ela que decide, e o
    gate do viewset e o payload de `compartilhar/` são só invólucros. Os
    caminhos por HTTP estão validados contra o dump real.
    """

    def setUp(self):
        from apps.accounts.models import SetorCatalogo

        User = get_user_model()
        self.dono = setor_de_teste()
        self.convidado_setor = SetorCatalogo.objects.create(
            codename='comercial', nome='Comercial')
        self.supervisor = User.objects.create_user(
            username='sup', email='sup@example.com', password='pass12345', role='admin')
        # Cargo qualquer, SEM view_cross_setor: com o bypass o escopo é
        # ignorado e o teste não provaria nada.
        self.convidado = User.objects.create_user(
            username='convidado', email='conv@example.com', password='pass12345',
            role='analista')
        self.convidado.setor_links.create(setor=self.convidado_setor, is_primary=True)

        hoje = hoje_local()
        tz = timezone.get_current_timezone()
        self.sprint = Sprint.objects.create(
            nome='Sprint A', duracao_dias=14, supervisor=self.supervisor, setor=self.dono,
            data_inicio=timezone.make_aware(datetime.combine(hoje, time.min), tz),
            fechamento_em=timezone.make_aware(
                datetime.combine(hoje + timedelta(days=13), time(23, 0)), tz))
        self.projeto = Project.objects.create(
            nome='Proj', sprint=self.sprint, setor=self.dono)
        self.card = Card.objects.create(
            nome='Card', projeto=self.projeto, setor=self.dono,
            status=CardStatus.A_DESENVOLVER)

    def _acesso(self, obj):
        from apps.accounts.scoping import nivel_de_acesso
        self.convidado._setores_ids_cache = None
        return nivel_de_acesso(self.convidado, obj)

    def _compartilhar(self, nivel):
        from apps.projects.models import SprintCompartilhamento
        SprintCompartilhamento.objects.update_or_create(
            sprint=self.sprint, setor=self.convidado_setor, defaults={'nivel': nivel})

    @override_settings(SETOR_SCOPING_ENABLED=True)
    def test_sem_compartilhamento_nao_alcanca(self):
        self.assertIsNone(self._acesso(self.sprint))
        self.assertIsNone(self._acesso(self.card))

    @override_settings(SETOR_SCOPING_ENABLED=True)
    def test_leitura_alcanca_mas_nao_edita(self):
        from apps.accounts.scoping import pode_editar
        self._compartilhar('leitura')
        self.assertEqual(self._acesso(self.sprint), 'leitura')
        self.assertEqual(self._acesso(self.card), 'leitura', 'a cascata leva o nível junto')
        self.convidado._setores_ids_cache = None
        self.assertFalse(pode_editar(self.convidado, self.card))

    @override_settings(SETOR_SCOPING_ENABLED=True)
    def test_edicao_desce_a_arvore(self):
        from apps.accounts.scoping import pode_editar
        self._compartilhar('edicao')
        for obj in (self.sprint, self.projeto, self.card):
            self.assertEqual(self._acesso(obj), 'edicao')
            self.convidado._setores_ids_cache = None
            self.assertTrue(pode_editar(self.convidado, obj))

    @override_settings(SETOR_SCOPING_ENABLED=True)
    def test_o_mais_permissivo_vence(self):
        """Sprint em edição + card em leitura = edição no card. O acesso mais
        amplo já foi concedido de propósito; rebaixar seria surpresa."""
        from apps.projects.models import CardCompartilhamento
        self._compartilhar('edicao')
        CardCompartilhamento.objects.create(
            card=self.card, setor=self.convidado_setor, nivel='leitura')
        self.assertEqual(self._acesso(self.card), 'edicao')

    @override_settings(SETOR_SCOPING_ENABLED=True)
    def test_dono_ignora_o_compartilhamento(self):
        self.convidado.setor_links.create(setor=self.dono)
        self._compartilhar('leitura')
        self.assertEqual(self._acesso(self.card), 'dono')

    def test_flag_desligada_libera_tudo(self):
        """Estado atual de produção: sem escopo, ninguém perde acesso."""
        self.assertEqual(self._acesso(self.card), 'dono')

    def test_mover_sprint_para_setor_ocupado_e_conflito(self):
        from apps.projects.services import conflitos_ao_mover_sprints
        Sprint.objects.create(
            nome='Sprint do Comercial', duracao_dias=14, supervisor=self.supervisor,
            setor=self.convidado_setor, data_inicio=self.sprint.data_inicio,
            fechamento_em=self.sprint.fechamento_em)
        self.assertTrue(
            conflitos_ao_mover_sprints([self.sprint.pk], self.convidado_setor.pk))

    def test_mover_sprint_sem_colisao_e_permitido(self):
        from apps.projects.services import conflitos_ao_mover_sprints
        self.assertEqual(
            conflitos_ao_mover_sprints([self.sprint.pk], self.convidado_setor.pk), [])
