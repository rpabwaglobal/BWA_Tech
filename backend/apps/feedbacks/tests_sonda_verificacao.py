"""SONDA DE VERIFICAÇÃO (temporária) — os buracos que a sonda do autor não cobre.

Não repete o ciclo feliz: ataca o que ficou de fora.
  1. voltar para AGUARDANDO_RESPOSTA (a sonda do autor só voltou para RESPONDIDO);
  2. encerrar um pedido que NUNCA teve resposta (o UPDATE de promoção com Coalesce);
  3. o 404 é indistinguível BYTE A BYTE entre inexistente, alfabeto inválido e
     grande demais — comparação de corpo, não só de status;
  4. o card COMUM continua sendo movido pelo caminho normal.
"""
from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import SetorCatalogo
from apps.projects.models import Card, Project, Sprint

from ._apoio_testes import resposta_valida
from .estrutura import garantir_estrutura_monitoramento
from .models import EstadoPedido, PedidoFeedback, RespostaFeedback
from .services import criar_pedido_feedback


class SondaVerificacao(APITestCase):
    def setUp(self):
        cache.clear()
        User = get_user_model()
        self.admin = User.objects.create_superuser(
            username='verif_admin', email='verif@bwa.global', password='x',
        )
        setor = SetorCatalogo.objects.create(codename='verif_tec', nome='Tec')
        agora = timezone.now()
        self.sprint = Sprint.objects.create(
            nome='Sprint verif', data_inicio=agora,
            fechamento_em=agora + timedelta(days=30), duracao_dias=30,
            supervisor=self.admin, setor=setor,
        )
        self.projeto_comum = Project.objects.create(nome='Projeto verif', sprint=self.sprint)
        card = Card.objects.create(nome='Entrega verif', projeto=self.projeto_comum)

        self.monitoramento = garantir_estrutura_monitoramento(supervisor=self.admin)
        self.card_kanban = Card.objects.create(
            nome='Acompanhamento verif', projeto=self.monitoramento,
            status=EstadoPedido.AGUARDANDO_RESPOSTA,
        )
        self.pedido = criar_pedido_feedback(
            card_id=card.pk,
            data_referencia=timezone.localdate(),
            referencia_publica='Entrega verif',
        )
        PedidoFeedback.objects.filter(pk=self.pedido.pk).update(
            card_kanban=self.card_kanban, estado=EstadoPedido.AGUARDANDO_RESPOSTA,
        )
        self.pedido.refresh_from_db()
        self.url_publica = reverse('feedback-publico', kwargs={'token': self.pedido.token})
        self.url_card = f'/api/cards/{self.card_kanban.pk}/'

    def _arrastar(self, destino):
        self.client.force_authenticate(user=self.admin)
        r = self.client.patch(self.url_card, {'status': destino}, format='json')
        self.client.force_authenticate(user=None)
        return r

    def _responder(self, texto):
        return self.client.post(
            self.url_publica,
            {'valores': resposta_valida(self.pedido.formulario.campos, texto=texto)},
            format='json',
        )

    def test_voltar_para_aguardando_feedback_reabre_o_link(self):
        """O usuário citou DUAS etapas de volta. A outra também precisa reabrir."""
        self.assertEqual(self._responder('primeira').status_code, 201)
        self.pedido.refresh_from_db()
        primeiro_respondido_em = self.pedido.respondido_em
        self.assertIsNotNone(primeiro_respondido_em)

        self.assertEqual(self._arrastar(EstadoPedido.ENCERRADO).status_code, 200)
        self.assertEqual(self.client.get(self.url_publica).status_code, 410)

        # Volta para AGUARDANDO_RESPOSTA (não para RESPONDIDO).
        self.assertEqual(self._arrastar(EstadoPedido.AGUARDANDO_RESPOSTA).status_code, 200)
        self.assertEqual(self.client.get(self.url_publica).status_code, 200)
        self.assertEqual(self._responder('depois de reabrir').status_code, 201)
        self.assertEqual(RespostaFeedback.objects.filter(pedido=self.pedido).count(), 2)

        # E o respondido_em (corte de retenção) NÃO andou, apesar de o pedido ter
        # reentrado no WHERE do UPDATE de promoção.
        self.pedido.refresh_from_db()
        self.assertEqual(self.pedido.respondido_em, primeiro_respondido_em)
        self.assertEqual(self.pedido.estado, EstadoPedido.RESPONDIDO)

    def test_encerrar_pedido_sem_nenhuma_resposta_e_reabrir(self):
        """Encerrar antes de qualquer resposta: nada a preservar, tudo a reabrir."""
        self.assertEqual(self._arrastar(EstadoPedido.ENCERRADO).status_code, 200)
        self.assertEqual(self.client.get(self.url_publica).status_code, 410)
        self.assertEqual(self._responder('tarde demais').status_code, 410)
        self.assertEqual(RespostaFeedback.objects.filter(pedido=self.pedido).count(), 0)

        self.assertEqual(self._arrastar(EstadoPedido.AGUARDANDO_RESPOSTA).status_code, 200)
        self.assertEqual(self._responder('agora vale').status_code, 201)
        self.pedido.refresh_from_db()
        self.assertEqual(self.pedido.estado, EstadoPedido.RESPONDIDO)
        self.assertIsNotNone(self.pedido.respondido_em)

    def test_o_404_continua_indistinguivel_byte_a_byte(self):
        """O 410 novo não pode ter aberto oráculo de EXISTÊNCIA."""
        casos = {
            'inexistente': 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            'fora_do_alfabeto': 'nao-existe$$$',
            'grande_demais': 'a' * 200,
        }
        vistos = set()
        for nome, token in casos.items():
            r = self.client.get(reverse('feedback-publico', kwargs={'token': token}))
            self.assertEqual(r.status_code, 404, nome)
            self.assertNotIn('encerrado', r.data, nome)
            vistos.add((r.status_code, str(r.data)))
        # UM único par (status, corpo) para os três casos.
        self.assertEqual(len(vistos), 1, vistos)

        # E o encerrado é 410 — distinção deliberada, só entre encerrado x aberto.
        self._arrastar(EstadoPedido.ENCERRADO)
        self.assertEqual(self.client.get(self.url_publica).status_code, 410)

    def test_o_board_desenha_as_quatro_colunas_na_ordem(self):
        """A 4ª etapa existe NO BOARD, não só no enum.

        Esta asserção morava em `tests_fase2.py` (`CHAVES_DAS_ETAPAS`), módulo que
        hoje nem importa — e a constante de lá continua congelada em 3 chaves.
        Sem esta cópia, "quero mais uma etapa no nosso fluxo" ficaria sem NENHUM
        teste executável provando que a coluna aparece.

        E as 4 etapas NÃO podem vazar para o board de um projeto comum: o recorte
        é a `ProjectKanbanStageConfig`, não a existência da `KanbanStage`.
        """
        self.client.force_authenticate(user=self.admin)
        r = self.client.get(f'/api/projects/{self.monitoramento.pk}/kanban-config/')
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(
            [s['key'] for s in r.json()['stages']],
            ['aguardando_prazo', 'aguardando_resposta', 'respondido', 'feedback_encerrado'],
        )

        comum = self.client.get(f'/api/projects/{self.projeto_comum.pk}/kanban-config/')
        self.assertEqual(comum.status_code, 200, comum.data)
        keys_comuns = {s['key'] for s in comum.json()['stages']}
        self.assertEqual(keys_comuns & {'feedback_encerrado'}, set())

    def test_card_comum_nao_foi_afetado(self):
        """A trava do fluxo não pode ter vazado para o board normal."""
        comum = Card.objects.create(
            nome='Card comum', projeto=self.projeto_comum, status='a_desenvolver',
        )
        self.client.force_authenticate(user=self.admin)
        # PATCH só de status: passa pelo caminho NORMAL do serializer.
        r = self.client.patch(
            f'/api/cards/{comum.pk}/', {'status': 'em_desenvolvimento'}, format='json',
        )
        self.assertEqual(r.status_code, 200, r.data)
        comum.refresh_from_db()
        self.assertEqual(comum.status, 'em_desenvolvimento')
        # E renomear (o que o fluxo proíbe) continua permitido no card comum.
        r2 = self.client.patch(
            f'/api/cards/{comum.pk}/', {'nome': 'Renomeado'}, format='json',
        )
        self.assertEqual(r2.status_code, 200, r2.data)
        # Criar e excluir também.
        criado = self.client.post('/api/cards/', {
            'nome': 'Novo comum', 'projeto': self.projeto_comum.pk,
            'status': 'a_desenvolver',
        }, format='json')
        self.assertEqual(criado.status_code, 201, criado.data)
        self.assertEqual(
            self.client.delete(f'/api/cards/{comum.pk}/').status_code, 204,
        )
