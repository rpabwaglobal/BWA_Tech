"""A versao exibida na tela precisa vir do arquivo VERSION, e nao de codigo."""
from pathlib import Path
from unittest import mock

from django.test import SimpleTestCase

from config.versao import VERSAO_DESCONHECIDA, versao_atual


class VersaoDoSistemaTests(SimpleTestCase):

    def setUp(self):
        # `versao_atual` e cacheada por lru_cache: sem limpar, o primeiro teste
        # a rodar congela o valor para os demais.
        versao_atual.cache_clear()

    def tearDown(self):
        versao_atual.cache_clear()

    def test_le_o_arquivo_version_da_raiz(self):
        raiz = Path(__file__).resolve().parent.parent.parent.parent
        arquivo = raiz / 'VERSION'
        self.assertTrue(arquivo.exists(), 'O arquivo VERSION sumiu da raiz do repositorio.')

        esperado = arquivo.read_text(encoding='utf-8').strip()
        self.assertEqual(versao_atual(), esperado)

    def test_o_numero_tem_o_formato_de_tres_partes(self):
        """MAIOR.MENOR.CORRECAO - e o formato que a tag do git espelha."""
        import re
        self.assertRegex(versao_atual(), r'^\d+\.\d+\.\d+')

    def test_sem_o_arquivo_devolve_marcador_explicito_e_nao_um_numero_plausivel(self):
        """Um '1.0.0' inventado passaria despercebido e mentiria sobre o que
        esta no ar - que e exatamente o problema que este modulo resolve."""
        with mock.patch.object(Path, 'read_text', side_effect=OSError):
            self.assertEqual(versao_atual(), VERSAO_DESCONHECIDA)

    def test_a_raiz_da_api_devolve_a_mesma_versao(self):
        """O contrato que a tela consome: GET /api/ traz `version`."""
        resposta = self.client.get('/api/')
        self.assertEqual(resposta.status_code, 200)
        self.assertEqual(resposta.json()['version'], versao_atual())
