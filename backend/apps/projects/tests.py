from datetime import datetime, time, timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.projects.models import (
    Sprint,
    Project,
    Card,
    CardStatus,
    CardLog,
    CardLogEventType,
    CardPin,
    WeeklyPriority,
    KanbanStage,
    ProjectKanbanStageConfig,
)
from apps.projects.services import (
    data_inicio_para_status,
    desatribuir_cards_de_usuario_desativado,
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

    def test_replicacao_preserva_a_marca_de_gerar_formulario_de_feedback(self):
        """O checkbox atravessa a virada da sprint.

        Sem isto o defeito é MUDO: o card marcado que ainda não foi finalizado é
        replicado para a sprint seguinte, a cópia nasce com o padrão False, e
        quando ela enfim for para "Finalizado" o signal do fluxo de feedback não
        dispara. Não há erro nem log — só um formulário que nunca é gerado,
        justamente nos cards de vida mais longa, que são os que mais atravessam
        sprint. O construtor de `_replicar_card_para_sprint` lista os campos um a
        um, então todo campo novo do Card precisa ser lembrado aqui.
        """
        marcado = Card.objects.create(
            nome='Card com feedback',
            projeto=self.projeto,
            status=CardStatus.EM_DESENVOLVIMENTO,
            criado_por=self.user,
            gerar_formulario_feedback=True,
        )
        self.assertTrue(marcado.gerar_formulario_feedback)

        finalizar_sprint_replicacao(self.sprint_origem, criado_por_user=self.user)

        novo = Card.objects.get(
            nome='Card com feedback', projeto__sprint=self.sprint_destino)
        self.assertTrue(novo.gerar_formulario_feedback)

    def test_replicacao_leva_a_coluna_personalizada_junto_com_o_card(self):
        """A etapa criada no projeto sobrevive a virada da sprint.

        O defeito que isto tranca era MUDO: o card era replicado carregando
        `status = <key da etapa>`, mas o quadro so desenha coluna que tenha
        ProjectKanbanStageConfig. O projeto novo nascia sem nenhuma config,
        entao ganhava as SEIS PADRAO na primeira abertura e o card na etapa
        personalizada sumia da tela - sem erro, sem log, e sem ter sido
        perdido de fato.

        Por isso o teste afirma as DUAS coisas: que a coluna existe no destino
        e que o card continua nela. Afirmar so uma deixaria passar metade.
        """
        # `order` nao existe na etapa global: a ordem e por projeto, e mora na
        # config. E o mesmo motivo de a coluna sumir na virada — o que pertence
        # ao projeto esta na config, e era ela que nao era copiada.
        etapa = KanbanStage.objects.create(
            key='aguardando_cliente', label='Aguardando Cliente')
        ProjectKanbanStageConfig.objects.create(
            project=self.projeto, stage=etapa, order=10)

        card = Card.objects.create(
            nome='Card em etapa personalizada',
            projeto=self.projeto,
            status=etapa.key,
            criado_por=self.user,
        )

        finalizar_sprint_replicacao(self.sprint_origem, criado_por_user=self.user)

        novo_projeto = Project.objects.get(
            nome=self.projeto.nome, sprint=self.sprint_destino)

        self.assertTrue(
            ProjectKanbanStageConfig.objects.filter(
                project=novo_projeto, stage=etapa).exists(),
            'A coluna personalizada nao acompanhou o projeto para a sprint nova.')

        novo_card = Card.objects.get(nome=card.nome, projeto=novo_projeto)
        self.assertEqual(novo_card.status, etapa.key)

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


class DesatribuirCardsDeUsuarioDesativadoTests(TestCase):
    """Regra de produto: conta desativada não segura trabalho vivo.

    O card ABERTO volta para "sem usuário atribuído"; o card ENCERRADO
    (finalizado/inviabilizado) mantém o responsável, porque apagar ali
    reescreveria a métrica de entrega de uma sprint que já passou.
    """

    def setUp(self):
        User = get_user_model()
        self.gestora = User.objects.create_user(
            username='gestora_offboarding',
            email='gestora@example.com',
            password='pass12345',
            role='admin',
        )
        self.saiu = User.objects.create_user(
            username='quem.saiu',
            email='saiu@example.com',
            password='pass12345',
            first_name='Fulano',
            last_name='de Tal',
        )
        self.ficou = User.objects.create_user(
            username='quem.ficou',
            email='ficou@example.com',
            password='pass12345',
            first_name='Beltrana',
        )

        tz = timezone.get_current_timezone()
        hoje = hoje_local()
        self.sprint = Sprint.objects.create(
            nome='Sprint do offboarding',
            data_inicio=timezone.make_aware(datetime.combine(hoje, time.min), tz),
            fechamento_em=timezone.make_aware(
                datetime.combine(hoje + timedelta(days=13), time(23, 0)), tz),
            duracao_dias=14,
            supervisor=self.gestora,
            setor=setor_de_teste(),
        )
        self.projeto = Project.objects.create(nome='Projeto Offboarding', sprint=self.sprint)

    def _card(self, nome, status, responsavel):
        return Card.objects.create(
            nome=nome,
            projeto=self.projeto,
            status=status,
            responsavel=responsavel,
            criado_por=self.gestora,
        )

    def _logs_de_desatribuicao(self, card):
        return card.logs.filter(tipo_evento=CardLogEventType.RESPONSAVEL_ALTERADO)

    def test_card_aberto_perde_o_responsavel(self):
        card = self._card('Card em desenvolvimento', CardStatus.EM_DESENVOLVIMENTO, self.saiu)

        self.assertEqual(desatribuir_cards_de_usuario_desativado(self.saiu), 1)

        card.refresh_from_db()
        self.assertIsNone(card.responsavel_id)

    def test_card_encerrado_mantem_o_responsavel(self):
        """A proteção que o dono do produto pediu: trabalho entregue continua
        sendo de quem entregou, mesmo depois de a pessoa sair."""
        finalizado = self._card('Card entregue', CardStatus.FINALIZADO, self.saiu)
        inviabilizado = self._card('Card inviabilizado', CardStatus.INVIABILIZADO, self.saiu)
        aberto = self._card('Card vivo', CardStatus.PARADO_PENDENCIAS, self.saiu)

        self.assertEqual(desatribuir_cards_de_usuario_desativado(self.saiu), 1)

        for card in (finalizado, inviabilizado):
            card.refresh_from_db()
            self.assertEqual(card.responsavel_id, self.saiu.pk, card.nome)
            self.assertFalse(self._logs_de_desatribuicao(card).exists(), card.nome)
        aberto.refresh_from_db()
        self.assertIsNone(aberto.responsavel_id)

    def test_um_log_por_card_com_nome_anterior_e_operador(self):
        """O histórico é o único rastro de quem segurava o card — o vínculo em
        si é apagado. Precisa sair uma vez por card, com o nome de quem saiu e
        com o gestor que puxou o gatilho."""
        card = self._card('Card com histórico', CardStatus.EM_HOMOLOGACAO, self.saiu)

        desatribuir_cards_de_usuario_desativado(self.saiu, operador=self.gestora)

        logs = list(self._logs_de_desatribuicao(card))
        self.assertEqual(len(logs), 1)
        self.assertIn('Fulano de Tal', logs[0].descricao)
        self.assertIn('conta desativada', logs[0].descricao)
        self.assertEqual(logs[0].usuario_id, self.gestora.pk)

    def test_card_de_outro_usuario_nao_e_tocado(self):
        alheio = self._card('Card da Beltrana', CardStatus.EM_DESENVOLVIMENTO, self.ficou)

        self.assertEqual(desatribuir_cards_de_usuario_desativado(self.saiu), 0)

        alheio.refresh_from_db()
        self.assertEqual(alheio.responsavel_id, self.ficou.pk)
        self.assertFalse(self._logs_de_desatribuicao(alheio).exists())

    def test_segunda_chamada_e_no_op(self):
        """Idempotência: é o que garante que o toggle ativa/desativa repetido e
        a migration re-rodada não escrevam log duplicado."""
        card = self._card('Card idempotente', CardStatus.EM_DESENVOLVIMENTO, self.saiu)

        self.assertEqual(desatribuir_cards_de_usuario_desativado(self.saiu), 1)
        self.assertEqual(desatribuir_cards_de_usuario_desativado(self.saiu), 0)

        self.assertEqual(self._logs_de_desatribuicao(card).count(), 1)

    def test_desativar_pelo_delete_do_model_tambem_solta_os_cards(self):
        """`User.delete()` desativa em vez de apagar — é o offboarding por
        shell/admin. Se ele não chamasse o serviço, a regra seria burlável por
        fora da API."""
        card = self._card('Card do offboarding por shell', CardStatus.EM_DESENVOLVIMENTO, self.saiu)

        self.saiu.delete()

        self.saiu.refresh_from_db()
        self.assertFalse(self.saiu.is_active)
        card.refresh_from_db()
        self.assertIsNone(card.responsavel_id)
        # Sem ator humano identificado, o log fica anônimo em vez de inventar autor.
        log = self._logs_de_desatribuicao(card).get()
        self.assertIsNone(log.usuario_id)

    def test_reativar_nao_devolve_os_cards(self):
        """Decisão explícita do dono do produto: a desatribuição é DEFINITIVA.

        Reativar a conta devolve o acesso, não o trabalho — quem reassumiu o
        card no meio do caminho não pode perdê-lo porque a pessoa voltou. Este
        teste existe para travar a decisão: quem "consertar" isso achando que é
        bug derruba esta asserção e é obrigado a reabrir a conversa.
        """
        card = self._card('Card de quem voltou', CardStatus.EM_DESENVOLVIMENTO, self.saiu)

        self.saiu.delete()  # desativa
        card.refresh_from_db()
        self.assertIsNone(card.responsavel_id, 'pré-condição: o card soltou ao desativar')

        self.saiu.is_active = True
        self.saiu.save(update_fields=['is_active'])

        card.refresh_from_db()
        self.assertIsNone(
            card.responsavel_id,
            'reativar a conta NÃO pode reatribuir o card — o vínculo foi apagado de verdade')

    def test_nao_sai_um_segundo_log_do_signal_para_o_mesmo_fato(self):
        """O `.update()` em massa é o que impede o histórico de contar a mesma
        coisa duas vezes.

        Se alguém trocar o serviço por um `card.save()` em laço, o `post_save`
        escreve SOZINHO um segundo log ('Responsável: Fulano → Ninguém', tipo
        ALTERACAO) e a timeline passa a mostrar o evento em duplicidade. Aqui a
        contagem é de TODOS os tipos, não só a do nosso: é o que detecta o log
        concorrente.
        """
        card = self._card('Card sem log duplicado', CardStatus.EM_DESENVOLVIMENTO, self.saiu)
        logs_antes = card.logs.count()  # o `post_save` de criação já escreveu o CRIADO

        desatribuir_cards_de_usuario_desativado(self.saiu, operador=self.gestora)

        self.assertEqual(
            card.logs.count() - logs_antes, 1,
            'a desatribuição precisa acrescentar exatamente UMA linha ao histórico')
        self.assertFalse(
            card.logs.filter(tipo_evento=CardLogEventType.ALTERACAO).exists(),
            'log automático de alteração significaria o mesmo fato registrado duas vezes')

    def test_card_encerrado_de_status_customizado_conta_como_aberto(self):
        """`aberto` é definido pela NEGATIVA. Um status fora de `CardStatus`
        (as colunas do Kanban são configuráveis e `kanban_move_cards` grava a
        key crua, sem validar choices) cai no balde "aberto" — o lado seguro,
        porque perder o responsável de um card vivo é reversível por
        reatribuição, e apagá-lo de um card encerrado corromperia a métrica."""
        card = self._card('Card em etapa customizada', CardStatus.EM_DESENVOLVIMENTO, self.saiu)
        Card.objects.filter(pk=card.pk).update(status='revisao_do_cliente')

        self.assertEqual(desatribuir_cards_de_usuario_desativado(self.saiu), 1)

        card.refresh_from_db()
        self.assertIsNone(card.responsavel_id)

    def test_reatribuicao_no_meio_do_caminho_nao_apaga_o_responsavel_novo(self):
        """Um usuário ATIVO não pode perder card por causa da desativação de
        OUTRO.

        Entre o SELECT que lista os cards e o UPDATE que apaga o vínculo existe
        uma janela: um PATCH concorrente pode passar o card para outra pessoa.
        Se o UPDATE filtrasse só por `pk__in`, ele apagaria o responsável NOVO —
        apagando dado de quem não tinha nada com o offboarding.

        A janela é encenada aqui de forma determinística: `format_user_name` é
        chamada pelo serviço exatamente entre o SELECT e o UPDATE, então o
        `side_effect` dela é o "outro request" chegando no meio.
        """
        card = self._card('Card disputado', CardStatus.EM_DESENVOLVIMENTO, self.saiu)

        def reatribui_no_meio(usuario):
            Card.objects.filter(pk=card.pk).update(responsavel=self.ficou)
            return 'Fulano de Tal'

        with patch('apps.projects.signals.format_user_name',
                   side_effect=reatribui_no_meio):
            desatribuir_cards_de_usuario_desativado(self.saiu)

        card.refresh_from_db()
        self.assertEqual(
            card.responsavel_id, self.ficou.pk,
            'o card foi reatribuído a alguém ATIVO no meio do caminho; '
            'a desativação não pode apagar o vínculo dessa outra pessoa')

    def test_nao_toca_nenhum_outro_vinculo_com_o_usuario(self):
        """Só `Card.responsavel` sai. Autoria, fixações e prioridades são
        histórico/estado pessoal e não fazem parte do que o produto mandou
        apagar — apagá-los seria apagar demais."""
        card = self._card('Card com tralha pendurada', CardStatus.EM_DESENVOLVIMENTO, self.saiu)
        # `criado_por` é o próprio usuário que está saindo: é o caso em que uma
        # limpeza ampla demais destruiria a autoria junto com a atribuição.
        Card.objects.filter(pk=card.pk).update(criado_por=self.saiu)
        pin = CardPin.objects.create(user=self.saiu, card=card)
        segunda = hoje_local() - timedelta(days=hoje_local().weekday())
        prioridade = WeeklyPriority.objects.create(
            usuario=self.saiu,
            card=card,
            semana_inicio=segunda,
            semana_fim=segunda + timedelta(days=4),
            definido_por=self.gestora,
        )

        self.assertEqual(desatribuir_cards_de_usuario_desativado(self.saiu), 1)

        card.refresh_from_db()
        self.assertIsNone(card.responsavel_id)
        self.assertEqual(card.criado_por_id, self.saiu.pk)
        self.assertTrue(CardPin.objects.filter(pk=pin.pk, user=self.saiu).exists())
        self.assertTrue(
            WeeklyPriority.objects.filter(pk=prioridade.pk, usuario=self.saiu).exists())
        # A sprint e o projeto também não podem ter sido reescritos de tabela.
        self.assertEqual(card.projeto_id, self.projeto.pk)
        self.assertEqual(self.sprint.supervisor_id, self.gestora.pk)


class BackfillCardsDeInativosMigrationTests(TestCase):
    """A migration de dados 0060, que trata o ESTADO QUE JÁ EXISTE no banco.

    O pedido foi escrito no presente ("caso um usuário inativo TENHA um card"),
    então a regra também vale para quem já estava desativado antes do deploy.
    Sem esta cobertura, o backfill é código que roda uma única vez em produção
    sem nunca ter sido executado.

    Os cenários chamam a FUNÇÃO REAL da migration (`RunPython`), passando o
    registro de apps de verdade no lugar do histórico: `apps.get_model` resolve
    os mesmos modelos, e o que se quer provar é a query e a redação do log — não
    o estado congelado do schema.
    """

    def setUp(self):
        from importlib import import_module
        self.migration = import_module(
            'apps.projects.migrations.0060_desatribuir_cards_de_inativos')

        User = get_user_model()
        self.gestora = User.objects.create_user(
            username='gestora_backfill', password='pass12345', role='admin')
        # Já desativado ANTES do deploy: é exatamente o estado legado que a
        # migration existe para limpar.
        self.legado = User.objects.create_user(
            username='legado.inativo', password='pass12345',
            first_name='Ciclano', last_name='Souza', is_active=False)
        self.ativo = User.objects.create_user(
            username='segue.na.casa', password='pass12345', first_name='Deltrano')

        tz = timezone.get_current_timezone()
        hoje = hoje_local()
        self.sprint = Sprint.objects.create(
            nome='Sprint do backfill',
            data_inicio=timezone.make_aware(datetime.combine(hoje, time.min), tz),
            fechamento_em=timezone.make_aware(
                datetime.combine(hoje + timedelta(days=13), time(23, 0)), tz),
            duracao_dias=14,
            supervisor=self.gestora,
            setor=setor_de_teste(),
        )
        self.projeto = Project.objects.create(nome='Projeto Backfill', sprint=self.sprint)

    def _card(self, nome, status, responsavel):
        return Card.objects.create(
            nome=nome, projeto=self.projeto, status=status,
            responsavel=responsavel, criado_por=self.gestora)

    def _rodar_migration(self):
        from django.apps import apps as registro_de_apps
        self.migration.desatribuir_cards_de_inativos(registro_de_apps, None)

    def test_backfill_solta_aberto_e_preserva_encerrado(self):
        aberto = self._card('Legado vivo', CardStatus.EM_DESENVOLVIMENTO, self.legado)
        finalizado = self._card('Legado entregue', CardStatus.FINALIZADO, self.legado)
        inviabilizado = self._card('Legado inviabilizado', CardStatus.INVIABILIZADO, self.legado)

        self._rodar_migration()

        aberto.refresh_from_db()
        self.assertIsNone(aberto.responsavel_id)
        for card in (finalizado, inviabilizado):
            card.refresh_from_db()
            self.assertEqual(
                card.responsavel_id, self.legado.pk,
                f'{card.nome}: card encerrado mantém o responsável — é a métrica da sprint passada')

    def test_backfill_nao_toca_card_de_usuario_ativo(self):
        """O corte é `is_active=False`. Se a migration errasse o filtro, ela
        limparia o quadro inteiro num deploy — e sem volta."""
        card_ativo = self._card('Card de quem ficou', CardStatus.EM_DESENVOLVIMENTO, self.ativo)
        sem_dono = self._card('Card sem responsável', CardStatus.A_DESENVOLVER, None)

        self._rodar_migration()

        card_ativo.refresh_from_db()
        self.assertEqual(card_ativo.responsavel_id, self.ativo.pk)
        self.assertFalse(card_ativo.logs.filter(
            tipo_evento=CardLogEventType.RESPONSAVEL_ALTERADO).exists())
        sem_dono.refresh_from_db()
        self.assertIsNone(sem_dono.responsavel_id)

    def test_backfill_registra_o_nome_de_quem_saiu_no_historico(self):
        """O log é o ÚNICO rastro que sobra: o vínculo é apagado e a migration é
        irreversível. Se o nome não entrar aqui, ninguém descobre depois de quem
        era o card."""
        card = self._card('Legado com histórico', CardStatus.EM_HOMOLOGACAO, self.legado)

        self._rodar_migration()

        log = card.logs.get(tipo_evento=CardLogEventType.RESPONSAVEL_ALTERADO)
        self.assertIn('Ciclano Souza', log.descricao)
        self.assertIn('conta desativada', log.descricao)
        # Deploy não tem ator humano: inventar um seria mentira no histórico.
        self.assertIsNone(log.usuario_id)

    def test_backfill_e_idempotente(self):
        """Migration re-rodada (restore de dump, ambiente recriado) não pode
        empilhar log em cima do mesmo card."""
        card = self._card('Legado idempotente', CardStatus.EM_DESENVOLVIMENTO, self.legado)

        self._rodar_migration()
        self._rodar_migration()

        self.assertEqual(
            card.logs.filter(tipo_evento=CardLogEventType.RESPONSAVEL_ALTERADO).count(), 1)

    def test_backfill_usa_a_mesma_redacao_do_fluxo_online(self):
        """Duas cópias do texto (uma na migration, uma no serviço) é uma
        divergência esperando para acontecer — o histórico ficaria com duas
        frases diferentes para o mesmo fato, dependendo de quando o card soltou."""
        from apps.projects.services import DESCRICAO_DESATRIBUICAO_CONTA_DESATIVADA
        self.assertEqual(self.migration.DESCRICAO, DESCRICAO_DESATRIBUICAO_CONTA_DESATIVADA)

    def test_backfill_congela_os_status_fechados_do_dia_do_deploy(self):
        """A migration é foto do passado e não segue mudanças futuras de
        `CARD_STATUS_FECHADOS` — mas hoje as duas precisam bater, senão ela já
        nasce apagando (ou preservando) a coisa errada."""
        from apps.projects.models import CARD_STATUS_FECHADOS
        self.assertEqual(
            set(self.migration.STATUS_FECHADOS), set(CARD_STATUS_FECHADOS))


class TimelineDaDesatribuicaoNaTelaTests(APITestCase):
    """O registro da desatribuição precisa CHEGAR NA TELA do card, não só
    existir no banco.

    Entre a linha em `CardLog` e a timeline que o usuário lê existe um contrato:
    `GET /api/card-logs/?card=<id>` (o que o `CardLogsModal` consome) tem que
    devolver o evento COM `tipo_evento_display` preenchido. Esse campo é a
    última defesa do rótulo: o componente resolve no if/else só os tipos
    antigos e cai em `tipo_evento_display || tipo_evento` para o resto — sem
    ele, a tag da timeline mostraria a string crua `responsavel_alterado` para
    quem está lendo o histórico.
    """

    def setUp(self):
        User = get_user_model()
        self.gestora = User.objects.create_user(
            username='gestora_timeline', email='gestora.timeline@example.com',
            password='pass12345', role='admin', is_superuser=True, is_staff=True)
        self.saiu = User.objects.create_user(
            username='saiu.timeline', email='saiu.timeline@example.com',
            password='pass12345', first_name='Fulano', last_name='de Tal')

        tz = timezone.get_current_timezone()
        hoje = hoje_local()
        sprint = Sprint.objects.create(
            nome='Sprint da timeline',
            data_inicio=timezone.make_aware(datetime.combine(hoje, time.min), tz),
            fechamento_em=timezone.make_aware(
                datetime.combine(hoje + timedelta(days=13), time(23, 0)), tz),
            duracao_dias=14,
            supervisor=self.gestora,
            setor=setor_de_teste(),
        )
        projeto = Project.objects.create(nome='Projeto da timeline', sprint=sprint)
        self.card = Card.objects.create(
            nome='Card da timeline', projeto=projeto,
            status=CardStatus.EM_DESENVOLVIMENTO,
            responsavel=self.saiu, criado_por=self.gestora)

    def test_endpoint_da_timeline_entrega_o_registro_com_rotulo(self):
        self.client.force_authenticate(user=self.gestora)

        resposta = self.client.post(
            f'/api/users/{self.saiu.pk}/set-active/', {'is_active': False}, format='json')
        self.assertEqual(resposta.status_code, 200, resposta.data)

        self.card.refresh_from_db()
        self.assertIsNone(self.card.responsavel_id)

        resposta = self.client.get(f'/api/card-logs/?card={self.card.pk}')
        self.assertEqual(resposta.status_code, 200, resposta.data)
        corpo = resposta.data
        registros = corpo['results'] if isinstance(corpo, dict) else corpo
        logs = [item for item in registros
                if item['tipo_evento'] == CardLogEventType.RESPONSAVEL_ALTERADO]

        self.assertEqual(len(logs), 1)
        # Rótulo da tag: sem isto a timeline mostra a string crua do enum.
        self.assertEqual(logs[0]['tipo_evento_display'], 'Responsável Alterado')
        self.assertIn('Fulano de Tal', logs[0]['descricao'])
        self.assertIn('conta desativada', logs[0]['descricao'])
        # Quem puxou o gatilho aparece na linha do evento.
        self.assertEqual(logs[0]['usuario_name'], self.gestora.username)


class CatalogoGlobalDeEtapasTests(APITestCase):
    """Editar e apagar etapa do catalogo exige a MESMA permissao que criar.

    O buraco era assimetrico e por isso passou despercebido: `perform_create`
    exigia `manage_global_kanban_stages`, mas PATCH e DELETE caiam so nas
    permissoes de classe, que barram apenas o visitante. Qualquer autenticado
    podia renomear ou apagar uma etapa usada por dezenas de projetos.

    O estrago nao fica no objeto editado: `ProjectKanbanStageConfig.stage` e
    CASCADE, entao apagar `finalizado` levaria junto a coluna nos ~120 projetos
    que a usam. Os cards sobreviveriam (o status e string), mas sumiriam da tela
    em todo o sistema de uma vez.
    """

    def setUp(self):
        User = get_user_model()
        self.dev = User.objects.create_user(
            username='dev_catalogo', email='dev.catalogo@example.com',
            password='pass12345', role='desenvolvedor')
        self.admin = User.objects.create_user(
            username='admin_catalogo', email='admin.catalogo@example.com',
            password='pass12345', role='admin', is_superuser=True, is_staff=True)
        self.etapa = KanbanStage.objects.create(key='coluna_teste', label='Coluna Teste')

    def test_desenvolvedor_nao_renomeia_etapa_global(self):
        self.client.force_authenticate(user=self.dev)
        r = self.client.patch(
            f'/api/kanban-stages/{self.etapa.pk}/', {'label': 'Renomeada'}, format='json')
        self.assertEqual(r.status_code, 403, r.content)
        self.etapa.refresh_from_db()
        self.assertEqual(self.etapa.label, 'Coluna Teste')

    def test_desenvolvedor_nao_apaga_etapa_global(self):
        self.client.force_authenticate(user=self.dev)
        r = self.client.delete(f'/api/kanban-stages/{self.etapa.pk}/')
        self.assertEqual(r.status_code, 403, r.content)
        self.assertTrue(KanbanStage.objects.filter(pk=self.etapa.pk).exists())

    def test_apagar_etapa_em_uso_e_recusado_mesmo_com_permissao(self):
        """Ter a permissao nao torna a cascata aceitavel.

        Quem apaga do catalogo nao ve as consequencias nos outros projetos, e o
        numero de projetos afetados e justamente o dado que falta para decidir.
        """
        sprint = Sprint.objects.create(
            nome='Sprint catalogo',
            data_inicio=timezone.now(),
            fechamento_em=timezone.now() + timedelta(days=7),
            duracao_dias=7,
            supervisor=self.admin,
            setor=setor_de_teste(),
        )
        projeto = Project.objects.create(nome='Projeto catalogo', sprint=sprint)
        ProjectKanbanStageConfig.objects.create(project=projeto, stage=self.etapa, order=0)

        self.client.force_authenticate(user=self.admin)
        r = self.client.delete(f'/api/kanban-stages/{self.etapa.pk}/')

        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn('1 projeto', str(r.content, 'utf-8'))
        self.assertTrue(KanbanStage.objects.filter(pk=self.etapa.pk).exists())

    def test_admin_apaga_etapa_que_nao_esta_em_uso(self):
        self.client.force_authenticate(user=self.admin)
        r = self.client.delete(f'/api/kanban-stages/{self.etapa.pk}/')
        self.assertEqual(r.status_code, 204, r.content)
        self.assertFalse(KanbanStage.objects.filter(pk=self.etapa.pk).exists())


class BlindagemDaEtapaTests(APITestCase):
    """As tres travas do serializer, cada uma contra um modo de falha distinto."""

    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_user(
            username='admin_blindagem', email='admin.blindagem@example.com',
            password='pass12345', role='admin', is_superuser=True, is_staff=True)
        self.client.force_authenticate(user=self.admin)

    def test_nome_longo_demais_e_recusado_com_400_em_vez_de_estourar_no_arraste(self):
        """O teto e `Card.status` (varchar 20), nao `KanbanStage.key` (50).

        Sem esta trava a etapa e criada, a coluna aparece no quadro, e o
        PRIMEIRO card arrastado para ela estoura com DataError no Postgres -
        erro na cara do usuario, num lugar sem relacao aparente com o que ele
        fez minutos antes. Em SQLite passaria calado.
        """
        r = self.client.post(
            '/api/kanban-stages/', {'label': 'Aguardando Cliente Externo'}, format='json')

        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn('26', str(r.content, 'utf-8'))
        self.assertFalse(
            KanbanStage.objects.filter(key='aguardando_cliente_externo').exists())

    def test_nome_no_limite_e_aceito(self):
        """20 caracteres exatos passam: a trava recusa o que NAO cabe, nao o
        que chega perto."""
        r = self.client.post(
            '/api/kanban-stages/', {'label': 'Aguardando Cliente'}, format='json')
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.data['key'], 'aguardando_cliente')

    def test_chave_do_ciclo_de_vida_e_reservada(self):
        """Recriar 'Finalizado' faria os cards do projeto entrarem nas metricas
        e no gatilho de feedback sem ninguem ter pedido."""
        r = self.client.post('/api/kanban-stages/', {'label': 'Finalizado'}, format='json')
        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn('sistema', str(r.content, 'utf-8').lower())

    def test_chave_de_fluxo_interno_e_reservada_sem_estar_cravada(self):
        """A reserva das etapas de fluxo vem de `oculta_no_catalogo`, e nao de
        uma lista de keys do app `feedbacks` dentro de `projects` - que e
        exatamente o que o campo existe para evitar (ver models.py)."""
        KanbanStage.objects.create(
            key='fluxo_interno', label='Fluxo Interno', oculta_no_catalogo=True)

        r = self.client.post('/api/kanban-stages/', {'label': 'Fluxo Interno'}, format='json')
        self.assertEqual(r.status_code, 400, r.content)

    def test_a_key_nao_pode_ser_alterada_depois_de_criada(self):
        """`Card.status` guarda a string e nao ha FK: trocar a key nao arrasta
        os cards, ORFANA todos de uma vez - nos ~120 projetos, sem erro."""
        etapa = KanbanStage.objects.create(key='coluna_x', label='Coluna X')

        r = self.client.patch(
            f'/api/kanban-stages/{etapa.pk}/', {'key': 'coluna_y'}, format='json')

        self.assertEqual(r.status_code, 400, r.content)
        etapa.refresh_from_db()
        self.assertEqual(etapa.key, 'coluna_x')

    def test_renomear_apenas_o_rotulo_continua_liberado(self):
        """E o que a pessoa quer quando pede para 'renomear a coluna'."""
        etapa = KanbanStage.objects.create(key='coluna_z', label='Coluna Z')

        r = self.client.patch(
            f'/api/kanban-stages/{etapa.pk}/', {'label': 'Coluna Renomeada'}, format='json')

        self.assertEqual(r.status_code, 200, r.content)
        etapa.refresh_from_db()
        self.assertEqual(etapa.label, 'Coluna Renomeada')
        self.assertEqual(etapa.key, 'coluna_z')


class ColunaPertenceAoProjetoTests(APITestCase):
    """O pedido original: a coluna e do PROJETO, nao do sistema.

    Dois projetos podem ter, cada um, a sua "Backlog", com cards proprios; e a
    coluna acompanha o projeto quando ele passa de sprint.
    """

    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_user(
            username='admin_colunas', email='admin.colunas@example.com',
            password='pass12345', role='admin', is_superuser=True, is_staff=True)
        tz = timezone.get_current_timezone()
        hoje = hoje_local()
        self.sprint = Sprint.objects.create(
            nome='Sprint colunas',
            data_inicio=timezone.make_aware(datetime.combine(hoje - timedelta(days=15), time.min), tz),
            fechamento_em=timezone.make_aware(datetime.combine(hoje - timedelta(days=1), time(23, 0)), tz),
            duracao_dias=14, supervisor=self.admin, setor=setor_de_teste())
        self.sprint_nova = Sprint.objects.create(
            nome='Sprint colunas 2',
            data_inicio=timezone.make_aware(datetime.combine(hoje, time.min), tz),
            fechamento_em=timezone.make_aware(datetime.combine(hoje + timedelta(days=13), time(23, 0)), tz),
            duracao_dias=14, supervisor=self.admin, setor=setor_de_teste())
        self.projeto_a = Project.objects.create(nome='Projeto A', sprint=self.sprint)
        self.projeto_b = Project.objects.create(nome='Projeto B', sprint=self.sprint)
        self.client.force_authenticate(user=self.admin)

    def _criar_coluna(self, projeto, label):
        etapa = KanbanStage.objects.create(key='backlog', label=label, projeto=projeto)
        ProjectKanbanStageConfig.objects.create(
            project=projeto, stage=etapa, order=0, stage_key=etapa.key)
        return etapa

    def test_dois_projetos_tem_backlog_independentes(self):
        """Mesma key, linhas diferentes, cards separados.

        Era exatamente isto que a key unica global impedia: 'Backlog' do projeto
        A e do B eram a MESMA linha, entao renomear numa renomeava na outra.
        """
        a = self._criar_coluna(self.projeto_a, 'Backlog')
        b = self._criar_coluna(self.projeto_b, 'Ideias Guardadas')

        self.assertNotEqual(a.pk, b.pk)
        self.assertEqual(a.key, b.key)

        Card.objects.create(nome='Card A', projeto=self.projeto_a, status='backlog',
                            criado_por=self.admin)
        Card.objects.create(nome='Card B1', projeto=self.projeto_b, status='backlog',
                            criado_por=self.admin)
        Card.objects.create(nome='Card B2', projeto=self.projeto_b, status='backlog',
                            criado_por=self.admin)

        self.assertEqual(Card.objects.filter(projeto=self.projeto_a, status='backlog').count(), 1)
        self.assertEqual(Card.objects.filter(projeto=self.projeto_b, status='backlog').count(), 2)

        # E renomear uma NAO toca na outra - o ponto de partida do pedido.
        r = self.client.patch(f'/api/kanban-stages/{a.pk}/', {'label': 'Backlog do A'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        b.refresh_from_db()
        self.assertEqual(b.label, 'Ideias Guardadas')

    def test_pedir_a_coluna_que_ja_existe_e_idempotente(self):
        """Com a global homonima disponivel, adicionar 'backlog' num projeto que
        JA tem a sua resolve para a dele - nao cria uma segunda.

        A busca prefere a etapa do proprio projeto, entao o pedido vira no-op em
        vez de conflito. O que importa e o invariante: UMA coluna por key no
        quadro, porque `Card.status` e string e duas colunas homonimas deixariam
        o card pertencendo as duas.
        """
        propria = self._criar_coluna(self.projeto_a, 'Backlog')
        KanbanStage.objects.create(key='backlog', label='Backlog Global')

        r = self.client.post(
            f'/api/projects/{self.projeto_a.pk}/kanban-config/add/',
            {'stage_key': 'backlog'}, format='json')

        self.assertEqual(r.status_code, 200, r.content)
        configs = ProjectKanbanStageConfig.objects.filter(
            project=self.projeto_a, stage_key='backlog')
        self.assertEqual(configs.count(), 1)
        self.assertEqual(configs.first().stage_id, propria.pk)

    def test_o_banco_recusa_duas_colunas_de_mesma_key_no_mesmo_projeto(self):
        """A defesa final e a constraint, nao o codigo da view.

        Se algum caminho futuro esquecer a checagem, o banco ainda barra.
        """
        from django.db import IntegrityError, transaction as _tx

        self._criar_coluna(self.projeto_a, 'Backlog')
        outra = KanbanStage.objects.create(
            key='backlog', label='Backlog 2', projeto=self.projeto_b)

        with self.assertRaises(IntegrityError):
            with _tx.atomic():
                ProjectKanbanStageConfig.objects.create(
                    project=self.projeto_a, stage=outra, order=1, stage_key='backlog')

    def test_a_coluna_do_projeto_e_CLONADA_na_virada_da_sprint(self):
        """Clonada, nao compartilhada: o quadro da sprint anterior sobrevive.

        Se a etapa fosse apenas referenciada, apagar o projeto antigo levaria a
        coluna do novo junto pela cascata; e mover esvaziaria o board historico.
        """
        etapa = self._criar_coluna(self.projeto_a, 'Backlog')
        Card.objects.create(nome='Card que atravessa', projeto=self.projeto_a,
                            status='backlog', criado_por=self.admin)

        finalizar_sprint_replicacao(self.sprint, criado_por_user=self.admin)

        novo_projeto = Project.objects.get(nome='Projeto A', sprint=self.sprint_nova)
        nova_cfg = ProjectKanbanStageConfig.objects.get(
            project=novo_projeto, stage_key='backlog')

        self.assertNotEqual(nova_cfg.stage_id, etapa.pk)
        self.assertEqual(nova_cfg.stage.projeto_id, novo_projeto.pk)
        self.assertEqual(nova_cfg.stage.key, 'backlog')

        # o card atravessou e continua na coluna
        novo_card = Card.objects.get(nome='Card que atravessa', projeto=novo_projeto)
        self.assertEqual(novo_card.status, 'backlog')

        # e o quadro da sprint ANTERIOR continua de pe
        self.assertTrue(
            ProjectKanbanStageConfig.objects.filter(
                project=self.projeto_a, stage_key='backlog').exists())

    def test_remover_a_coluna_apaga_a_etapa_do_projeto_mas_nunca_a_global(self):
        """Etapa do projeto sem config nao serve a ninguem E prende o slot da
        constraint, impedindo recriar a mesma coluna depois."""
        etapa = self._criar_coluna(self.projeto_a, 'Backlog')

        r = self.client.post(
            f'/api/projects/{self.projeto_a.pk}/kanban-config/remove/',
            {'stage_key': 'backlog'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertFalse(KanbanStage.objects.filter(pk=etapa.pk).exists())

        # a global sai do board, mas continua existindo para os outros projetos
        glob, _ = KanbanStage.objects.get_or_create(
            key='a_desenvolver', projeto=None, defaults={'label': 'A Desenvolver'})
        ProjectKanbanStageConfig.objects.create(
            project=self.projeto_b, stage=glob, order=0, stage_key=glob.key)
        r = self.client.post(
            f'/api/projects/{self.projeto_b.pk}/kanban-config/remove/',
            {'stage_key': 'a_desenvolver'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(KanbanStage.objects.filter(pk=glob.pk).exists())

    def test_o_catalogo_lista_so_as_globais(self):
        """Coluna de projeto nao e oferecivel a ninguem, e listar vazaria o nome
        de colunas de projetos de outros setores."""
        self._criar_coluna(self.projeto_a, 'Backlog')

        r = self.client.get('/api/kanban-stages/')
        self.assertEqual(r.status_code, 200, r.content)
        # sem paginacao: a resposta e a lista, nao um envelope
        self.assertIsInstance(r.data, list)
        self.assertTrue(all(s.get('key') != 'backlog' for s in r.data))

    def test_criar_coluna_pelo_label_nasce_dona_do_projeto(self):
        """Uma chamada so, e a etapa ja nasce com dono.

        Antes o front criava a etapa GLOBAL e depois a pendurava pela key - dois
        passos, e o primeiro deixava lixo no catalogo de todo mundo quando o
        segundo falhava.
        """
        r = self.client.post(
            f'/api/projects/{self.projeto_a.pk}/kanban-config/add/',
            {'label': 'Em Discussao'}, format='json')

        self.assertEqual(r.status_code, 201, r.content)
        etapa = KanbanStage.objects.get(key='em_discussao')
        self.assertEqual(etapa.projeto_id, self.projeto_a.pk)
        self.assertTrue(ProjectKanbanStageConfig.objects.filter(
            project=self.projeto_a, stage=etapa, stage_key='em_discussao').exists())

        # e nao entrou no catalogo global
        lista = self.client.get('/api/kanban-stages/')
        self.assertTrue(all(s.get('key') != 'em_discussao' for s in lista.data))

    def test_criar_coluna_com_nome_longo_demais_e_recusado(self):
        """O teto e `Card.status` (varchar 20). Sem isto a coluna aparece e o
        primeiro arraste estoura."""
        r = self.client.post(
            f'/api/projects/{self.projeto_a.pk}/kanban-config/add/',
            {'label': 'Aguardando Cliente Externo'}, format='json')

        self.assertEqual(r.status_code, 400, r.content)
        self.assertFalse(KanbanStage.objects.filter(key='aguardando_cliente_externo').exists())

    def test_criar_coluna_com_nome_de_etapa_do_sistema_e_recusado(self):
        r = self.client.post(
            f'/api/projects/{self.projeto_a.pk}/kanban-config/add/',
            {'label': 'Finalizado'}, format='json')
        self.assertEqual(r.status_code, 400, r.content)

    def test_nao_da_para_pendurar_coluna_no_quadro_de_fluxo_automatico(self):
        """A guarda vale para os DOIS modos de criacao.

        Ela ficava depois da bifurcacao, e o modo `label` devolvia 201 sem
        passar por ela: dava para pendurar uma coluna decorativa no quadro do
        monitoramento de feedbacks - e a propria guarda parava de disparar dali
        em diante, porque ela pergunta 'todas as colunas sao ocultas?'.
        """
        fluxo = Project.objects.create(nome='Fluxo automatico', sprint=self.sprint)
        oculta = KanbanStage.objects.create(
            key='etapa_oculta', label='Etapa Oculta', oculta_no_catalogo=True)
        ProjectKanbanStageConfig.objects.create(
            project=fluxo, stage=oculta, order=0, stage_key=oculta.key)

        for corpo in ({'label': 'Coluna Nova'}, {'stage_key': 'a_desenvolver'}):
            with self.subTest(corpo=corpo):
                r = self.client.post(
                    f'/api/projects/{fluxo.pk}/kanban-config/add/', corpo, format='json')
                self.assertEqual(r.status_code, 400, r.content)

        self.assertEqual(
            ProjectKanbanStageConfig.objects.filter(project=fluxo).count(), 1)

    def test_quem_cria_a_coluna_do_projeto_consegue_renomea_la(self):
        """Criar exigia `manage_kanban_config` e renomear exigia a permissao de
        CATALOGO GLOBAL: dava para criar e nao dava para editar."""
        User = get_user_model()
        from django.contrib.auth.models import Permission
        supervisor = User.objects.create_user(
            username='sup_coluna', email='sup.coluna@example.com',
            password='pass12345', role='supervisor')
        supervisor.user_permissions.add(
            Permission.objects.get(codename='manage_kanban_config'),
            Permission.objects.get(codename='view_content'),
        )

        etapa = self._criar_coluna(self.projeto_a, 'Backlog')

        self.client.force_authenticate(user=supervisor)
        r = self.client.patch(
            f'/api/kanban-stages/{etapa.pk}/', {'label': 'Backlog Novo'}, format='json')

        self.assertEqual(r.status_code, 200, r.content)
        etapa.refresh_from_db()
        self.assertEqual(etapa.label, 'Backlog Novo')

    def test_o_supervisor_do_projeto_nao_mexe_no_catalogo_global(self):
        """A distincao tem de valer nos dois sentidos: coluna do projeto sim,
        etapa global nao."""
        User = get_user_model()
        from django.contrib.auth.models import Permission
        supervisor = User.objects.create_user(
            username='sup_global', email='sup.global@example.com',
            password='pass12345', role='supervisor')
        supervisor.user_permissions.add(
            Permission.objects.get(codename='manage_kanban_config'),
            Permission.objects.get(codename='view_content'),
        )
        glob = KanbanStage.objects.create(key='coluna_global', label='Coluna Global')

        self.client.force_authenticate(user=supervisor)
        r = self.client.patch(
            f'/api/kanban-stages/{glob.pk}/', {'label': 'Renomeada'}, format='json')

        self.assertEqual(r.status_code, 403, r.content)
