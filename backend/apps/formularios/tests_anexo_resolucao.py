"""Anexo da RESOLUÇÃO — o caminho de escrita que sobrou depois de a criação sair.

A equipe de suporte anexa um arquivo ao concluir o chamado, e ele aparece no Portal
para o solicitante. O arquivo atravessa o proxy, e é aí que estava o buraco: a UI aceita
até 10 MB e a API do portal também, mas o proxy monta o corpo com `request.body` e
morria nos 2,5 MB do padrão do Django — devolvendo uma página HTML de 400 que o front
nem conseguia ler para explicar o que houve.
"""
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from rest_framework.test import APITestCase

from apps.formularios.limites import LIMITE_ANEXO_PORTAL_BYTES

User = get_user_model()


class LimiteDeCorpoDoProxyTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='suporte_anexo',
            email='suporte.anexo@example.com',
            password='x' * 12,
            role='admin',
            is_superuser=True,
            is_staff=True,
        )
        self.client.force_authenticate(user=self.user)

    def test_o_limite_de_corpo_cobre_o_anexo_maximo_do_portal(self):
        """Guarda contra alguém baixar o limite e reabrir a faixa morta.

        Se este teste cair, anexo entre o novo limite e 10 MB volta a falhar no meio
        do caminho — com o front e o portal ambos dizendo que o tamanho é válido.
        """
        from django.conf import settings

        self.assertGreater(
            settings.DATA_UPLOAD_MAX_MEMORY_SIZE,
            LIMITE_ANEXO_PORTAL_BYTES,
            'DATA_UPLOAD_MAX_MEMORY_SIZE precisa acomodar o anexo de 10 MB do portal '
            'mais o envelope multipart.',
        )

    @override_settings(
        PORTAL_BASE_URL='https://portal.example.com',
        DATA_UPLOAD_MAX_MEMORY_SIZE=512,
    )
    def test_corpo_grande_devolve_413_em_json_e_nao_html(self):
        arquivo = SimpleUploadedFile('grande.png', b'\x89PNG' + b'\x00' * 4096,
                                     content_type='image/png')

        with patch(
            'apps.formularios.portal_proxy_views._is_internal_host', return_value=False
        ), patch('apps.formularios.portal_proxy_views.requests') as rede:
            r = self.client.patch(
                '/api/portal-formularios/suporte/7/',
                {'status': 'Resolvido', 'anexo_suporte': arquivo},
                format='multipart',
            )

        self.assertEqual(r.status_code, 413)
        self.assertEqual(r.data['reason'], 'corpo_excede_limite')
        self.assertIn('MB', r.data['detail'])
        # Barrado antes de qualquer rede — não adianta gastar conexão para ouvir não.
        rede.request.assert_not_called()

    @override_settings(
        PORTAL_BASE_URL='https://portal.example.com',
        DATA_UPLOAD_MAX_MEMORY_SIZE=12 * 1024 * 1024,
    )
    def test_anexo_dentro_do_limite_segue_para_o_portal(self):
        arquivo = SimpleUploadedFile('resolucao.png', b'\x89PNG' + b'\x00' * (3 * 1024 * 1024),
                                     content_type='image/png')

        with patch(
            'apps.formularios.portal_proxy_views._is_internal_host', return_value=False
        ), patch(
            'apps.formularios.portal_proxy_views.login_on_portal_cached',
            return_value='jwt-de-teste',
        ), patch('apps.formularios.portal_proxy_views.requests') as rede:
            rede.request.return_value.status_code = 200
            rede.request.return_value.content = b'{"id": 7}'
            rede.request.return_value.headers = {'Content-Type': 'application/json'}
            rede.request.return_value.json.return_value = {'id': 7}

            r = self.client.patch(
                '/api/portal-formularios/suporte/7/',
                {'status': 'Resolvido', 'anexo_suporte': arquivo},
                format='multipart',
            )

        self.assertEqual(r.status_code, 200)
        rede.request.assert_called_once()

        # O corpo multipart precisa chegar ao portal INTACTO, com o boundary do
        # cabeçalho original — se o Content-Type perder o boundary, o portal recebe
        # `anexo_suporte` como texto e responde "não é um arquivo".
        _, kwargs = rede.request.call_args
        self.assertIn('multipart/form-data', kwargs['headers']['Content-Type'])
        self.assertIn('boundary=', kwargs['headers']['Content-Type'])
        self.assertIn(b'filename="resolucao.png"', kwargs['data'])
