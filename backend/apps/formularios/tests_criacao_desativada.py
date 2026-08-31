"""Chamado nasce no portal; o BWA Tech apenas recebe.

Esconder o botão no front não fecha nada — as duas portas HTTP continuariam
abertas. Estes testes guardam o fechamento nas duas, e guardam também o que NÃO
pode ser derrubado junto.

O teste que mais importa aqui é `test_o_compartilhamento_por_setor_continua_de_pe`.
O jeito óbvio de "fechar a criação" é tirar `post` de `http_method_names` do
`ChamadoSuporteViewSet` — e isso levaria junto a ação `compartilhar/`, que vem do
`CompartilhamentoSetorMixin` e também é POST. O compartilhamento cairia sem que
nenhum outro teste percebesse.
"""
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import override_settings
from rest_framework.test import APITestCase

from apps.formularios.models import (
    ChamadoSuporte,
    SuporteItem,
    SuporteMotivo,
    SuporteTipo,
)
from apps.formularios.portal_proxy_views import _e_criacao_de_chamado

User = get_user_model()


class CriacaoDeChamadoDesativadaTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='suporte_criacao',
            email='suporte.criacao@example.com',
            password='x' * 12,
            role='admin',
            is_superuser=True,
            is_staff=True,
        )
        self.client.force_authenticate(user=self.user)

        self.tipo = SuporteTipo.objects.create(nome='RPA', ativo=True)
        self.item = SuporteItem.objects.create(nome='Robô X', tipo=self.tipo, ativo=True)
        self.motivo = SuporteMotivo.objects.create(nome='Erro', ativo=True)

    def _payload(self):
        return {
            'usuario_nome': 'Maria',
            'usuario_email': 'maria@example.com',
            'usuario_setor': 'TI',
            'tipo': self.tipo.pk,
            'item': self.item.pk,
            'motivo': self.motivo.pk,
            'empresa': 'Empresa X',
            'descricao': 'Problema no robô',
        }

    def test_post_no_viewset_local_devolve_405_e_nao_grava(self):
        r = self.client.post('/api/formularios/suporte/', self._payload(), format='json')

        self.assertEqual(r.status_code, 405)
        self.assertEqual(ChamadoSuporte.objects.count(), 0)

    def test_o_compartilhamento_por_setor_continua_de_pe(self):
        """A armadilha: `compartilhar/` também é POST no mesmo viewset.

        Se alguém "fechar" a criação removendo `post` de `http_method_names`,
        este teste cai — que é exatamente o aviso que se quer.
        """
        chamado = ChamadoSuporte.objects.create(
            usuario_nome='Maria',
            usuario_email='maria@example.com',
            usuario_setor='TI',
            tipo=self.tipo,
            item=self.item,
            motivo=self.motivo,
            empresa='Empresa X',
            descricao='Problema no robô',
        )

        r = self.client.post(
            f'/api/formularios/suporte/{chamado.pk}/compartilhar/',
            {'setores': []},
            format='json',
        )

        self.assertNotEqual(r.status_code, 405)

    @override_settings(PORTAL_BASE_URL='https://portal.example.com')
    def test_post_pelo_proxy_e_barrado_sem_tocar_a_rede(self):
        """Esta era a porta que funcionava em produção.

        O proxy autentica no portal com UMA conta de serviço e o `usuario_email`
        vinha de campo livre — enquanto o POST passasse, qualquer autenticado
        abria chamado em nome de outra pessoa.
        """
        with patch(
            'apps.formularios.portal_proxy_views._is_internal_host', return_value=False
        ), patch('apps.formularios.portal_proxy_views.requests') as rede:
            r = self.client.post(
                '/api/portal-formularios/suporte/',
                data='{"descricao": "x"}',
                content_type='application/json',
            )

        self.assertEqual(r.status_code, 405)
        self.assertEqual(r.data['reason'], 'criacao_de_chamado_desativada')
        rede.request.assert_not_called()


class AlcanceDoBloqueioDoProxyTests(APITestCase):
    """O bloqueio é estreito de propósito: só POST em `suporte/` na raiz."""

    def test_barra_apenas_post_em_suporte_na_raiz(self):
        self.assertTrue(_e_criacao_de_chamado('POST', 'suporte/'))
        self.assertTrue(_e_criacao_de_chamado('POST', '/suporte'))

    def test_nao_barra_leitura_nem_atualizacao(self):
        self.assertFalse(_e_criacao_de_chamado('GET', 'suporte/por-usuario/'))
        self.assertFalse(_e_criacao_de_chamado('PATCH', 'suporte/7/'))
        self.assertFalse(_e_criacao_de_chamado('PATCH', 'suporte/7/notificar-usuario/'))

    def test_nao_barra_outras_rotas_post_do_portal(self):
        """`sugestoes/` também é POST no portal e não tem nada a ver com chamados."""
        self.assertFalse(_e_criacao_de_chamado('POST', 'sugestoes/'))
        self.assertFalse(_e_criacao_de_chamado('POST', 'suporte/7/algo/'))
