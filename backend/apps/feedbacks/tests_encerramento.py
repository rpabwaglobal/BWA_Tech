"""SONDA do encerramento — um teste só, o ciclo inteiro.

Não descreve o código: exercita a rota pública e a rota autenticada de arrastar
e confere o que o usuário pediu, na ordem em que ele pediu.

  aberto -> encerra (arraste) -> link recusa -> volta (arraste) -> link abre
                                      ^
                        e a resposta gravada ANTES continua no banco o tempo todo
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


class CicloDeEncerramento(APITestCase):
    """O caminho completo, com HTTP de verdade nas duas pontas."""

    def setUp(self):
        # O throttle da rota pública guarda contadores em cache; sem limpar, um
        # teste contaminaria o seguinte.
        cache.clear()
        User = get_user_model()
        self.admin = User.objects.create_superuser(
            username='sonda_admin', email='sonda@bwa.global', password='x',
        )
        setor = SetorCatalogo.objects.create(codename='sonda_tec', nome='Tecnologia')
        agora = timezone.now()
        sprint = Sprint.objects.create(
            nome='Sprint da sonda', data_inicio=agora,
            fechamento_em=agora + timedelta(days=30), duracao_dias=30,
            supervisor=self.admin, setor=setor,
        )
        projeto = Project.objects.create(nome='Projeto da sonda', sprint=sprint)
        card = Card.objects.create(nome='Entrega da sonda', projeto=projeto)

        self.monitoramento = garantir_estrutura_monitoramento(supervisor=self.admin)
        self.card_kanban = Card.objects.create(
            nome='Acompanhamento', projeto=self.monitoramento,
            status=EstadoPedido.AGUARDANDO_RESPOSTA,
        )
        self.pedido = criar_pedido_feedback(
            card_id=card.pk,
            data_referencia=timezone.localdate(),
            referencia_publica='Entrega da sonda',
        )
        PedidoFeedback.objects.filter(pk=self.pedido.pk).update(
            card_kanban=self.card_kanban, estado=EstadoPedido.AGUARDANDO_RESPOSTA,
        )
        self.pedido.refresh_from_db()
        self.url_publica = reverse(
            'feedback-publico', kwargs={'token': self.pedido.token},
        )
        self.url_card = f'/api/cards/{self.card_kanban.pk}/'

    def _arrastar(self, destino):
        self.client.force_authenticate(user=self.admin)
        resposta = self.client.patch(self.url_card, {'status': destino}, format='json')
        self.client.force_authenticate(user=None)
        return resposta

    def test_encerrar_invalida_voltar_reabre_e_a_resposta_fica(self):
        # 1. ABERTO: o link responde e a resposta é gravada.
        self.assertEqual(self.client.get(self.url_publica).status_code, 200)
        envio = self.client.post(
            self.url_publica,
            {'valores': resposta_valida(
                self.pedido.formulario.campos, texto='Maria da Sonda')},
            format='json',
        )
        self.assertEqual(envio.status_code, 201)
        resposta_id = RespostaFeedback.objects.get(pedido=self.pedido).pk

        # 2. ENCERRA pelo arraste: o PEDIDO (fonte da verdade) muda junto do card.
        arraste = self._arrastar(EstadoPedido.ENCERRADO)
        self.assertEqual(arraste.status_code, 200, arraste.data)
        self.pedido.refresh_from_db()
        self.card_kanban.refresh_from_db()
        self.assertEqual(self.pedido.estado, EstadoPedido.ENCERRADO)
        self.assertEqual(self.card_kanban.status, EstadoPedido.ENCERRADO)

        # 3. LINK INVÁLIDO, com tela PRÓPRIA (410 + flag), nos dois verbos.
        get_encerrado = self.client.get(self.url_publica)
        self.assertEqual(get_encerrado.status_code, 410)
        self.assertTrue(get_encerrado.data['encerrado'])
        post_encerrado = self.client.post(
            self.url_publica,
            {'valores': resposta_valida(self.pedido.formulario.campos, texto='Tarde')},
            format='json',
        )
        self.assertEqual(post_encerrado.status_code, 410)

        # Token INEXISTENTE continua indistinguível de inválido: 404, nunca 410.
        self.assertEqual(
            self.client.get(reverse(
                'feedback-publico', kwargs={'token': 'naoexiste'})).status_code,
            404,
        )

        # 4. A RESPOSTA CONTINUA NO BANCO — encerrar não apaga nada.
        self.assertTrue(RespostaFeedback.objects.filter(pk=resposta_id).exists())
        self.assertEqual(RespostaFeedback.objects.filter(pedido=self.pedido).count(), 1)

        # 5. VOLTAR REABRE: o token é o mesmo, nada foi revogado.
        volta = self._arrastar(EstadoPedido.RESPONDIDO)
        self.assertEqual(volta.status_code, 200, volta.data)
        self.pedido.refresh_from_db()
        self.assertEqual(self.pedido.estado, EstadoPedido.RESPONDIDO)
        self.assertEqual(self.client.get(self.url_publica).status_code, 200)
        segundo_envio = self.client.post(
            self.url_publica,
            {'valores': resposta_valida(
                self.pedido.formulario.campos, texto='Voltou a funcionar')},
            format='json',
        )
        self.assertEqual(segundo_envio.status_code, 201)
        self.assertEqual(RespostaFeedback.objects.filter(pedido=self.pedido).count(), 2)

    def test_editar_e_excluir_seguem_bloqueados_e_sair_do_fluxo_tambem(self):
        self.client.force_authenticate(user=self.admin)
        # Editar (campo que não é `status`) -> 403.
        self.assertEqual(
            self.client.patch(
                self.url_card, {'nome': 'renomeado'}, format='json').status_code,
            403,
        )
        # Arrastar de carona com uma edição -> 403 (o corpo tem de ser SÓ status).
        self.assertEqual(
            self.client.patch(
                self.url_card,
                {'status': EstadoPedido.ENCERRADO, 'nome': 'renomeado'},
                format='json',
            ).status_code,
            403,
        )
        # Sair do fluxo -> 400.
        self.assertEqual(
            self.client.patch(
                self.url_card, {'status': 'finalizado'}, format='json').status_code,
            400,
        )
        # Excluir -> 403.
        self.assertEqual(self.client.delete(self.url_card).status_code, 403)

    def test_payload_do_card_traz_quem_respondeu(self):
        self.client.post(
            self.url_publica,
            {'valores': resposta_valida(
                self.pedido.formulario.campos,
                respondente='Maria da Sonda', setor_respondente='Financeiro')},
            format='json',
        )
        # Sem nome: o rótulo é honesto, nunca inventado.
        self.client.post(
            self.url_publica,
            {'valores': resposta_valida(
                self.pedido.formulario.campos, respondente='')},
            format='json',
        )
        self.client.force_authenticate(user=self.admin)
        dados = self.client.get(
            f'/api/feedbacks/pedidos/?card={self.card_kanban.pk}').data
        respostas = (dados['results'] if isinstance(dados, dict) else dados)[0]['respostas']
        self.assertEqual(len(respostas), 2)
        # Ordenação é da mais recente para a mais antiga.
        self.assertEqual(respostas[0]['respondente'], 'Anônimo')
        self.assertTrue(respostas[0]['anonimo'])
        self.assertEqual(respostas[1]['respondente'], 'Maria da Sonda')
        self.assertFalse(respostas[1]['anonimo'])
        self.assertEqual(respostas[1]['setor_respondente'], 'Financeiro')
        self.assertTrue(respostas[1]['itens'])
