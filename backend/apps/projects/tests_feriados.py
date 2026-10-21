"""A unica fonte de feriados do sistema, e o endpoint que a publica.

POR QUE ESTA SUITE EXISTE. Ate 19/10/2026 havia TRES respostas diferentes para
"este dia e feriado?" — uma no frontend, uma no fallback do backend e uma na API
externa — e as tres discordavam entre si. A API nunca chegou a funcionar: a
tabela de cache tinha zero linhas em producao e a chave nunca foi configurada,
entao o backend vinha respondendo pelo fallback de oito datas fixas, sem
Carnaval, sem Sexta-feira Santa, sem Corpus Christi e sem o 20/11.

Os testes abaixo travam as duas metades da regra separadamente, porque elas
falham de jeitos diferentes: a calculada falha se o algoritmo estiver errado, a
cadastrada falha se alguem esquecer de consultar o banco.
"""
from datetime import date

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from apps.projects.feriados import (
    ANO_CONSCIENCIA_NEGRA, e_dia_util, feriados_entre, nacionais_do_ano, pascoa,
)
from apps.projects.models import Feriado

User = get_user_model()


class PascoaTests(TestCase):
    """O algoritmo de Meeus/Jones/Butcher, contra datas publicadas.

    Tudo que e movel no calendario brasileiro sai daqui, entao um erro nesta
    funcao erra quatro feriados por ano de uma vez.
    """

    def test_domingos_de_pascoa_conhecidos(self):
        esperado = {
            2023: date(2023, 4, 9),
            2024: date(2024, 3, 31),
            2025: date(2025, 4, 20),
            2026: date(2026, 4, 5),
            2027: date(2027, 3, 28),
        }
        for ano, dia in esperado.items():
            self.assertEqual(pascoa(ano), dia, 'Pascoa de %d' % ano)

    def test_pascoa_cai_sempre_em_domingo(self):
        """Uma propriedade, nao uma tabela: vale para qualquer ano."""
        for ano in range(2000, 2101):
            self.assertEqual(
                pascoa(ano).weekday(), 6,
                'Pascoa de %d nao caiu num domingo' % ano)


class NacionaisCalculadosTests(TestCase):

    def test_os_moveis_de_2026(self):
        dias = nacionais_do_ano(2026)

        self.assertIn(date(2026, 2, 16), dias, 'carnaval, segunda')
        self.assertIn(date(2026, 2, 17), dias, 'carnaval, terca')
        self.assertIn(date(2026, 4, 3), dias, 'sexta-feira santa')
        self.assertIn(date(2026, 6, 4), dias, 'corpus christi')

    def test_os_fixos_de_2026(self):
        dias = nacionais_do_ano(2026)
        for mes, dia in ((1, 1), (4, 21), (5, 1), (9, 7), (10, 12),
                         (11, 2), (11, 15), (12, 25)):
            self.assertIn(date(2026, mes, dia), dias)

    def test_consciencia_negra_vale_a_partir_de_2024(self):
        """A Lei 14.759/2023 tornou o 20/11 nacional. Antes disso, nao era.

        Contar o 20/11 em anos anteriores mudaria o tempo de desenvolvimento de
        cards ja fechados em 2023 — numero errado, no passado, sem ninguem ter
        pedido.
        """
        self.assertIn(date(ANO_CONSCIENCIA_NEGRA, 11, 20),
                      nacionais_do_ano(ANO_CONSCIENCIA_NEGRA))
        self.assertNotIn(date(ANO_CONSCIENCIA_NEGRA - 1, 11, 20),
                         nacionais_do_ano(ANO_CONSCIENCIA_NEGRA - 1))

    def test_dia_comum_nao_entra(self):
        self.assertNotIn(date(2026, 3, 3), nacionais_do_ano(2026))


class FeriadosEntreTests(TestCase):
    """A uniao das duas metades, que e o que o resto do sistema consome."""

    def test_junta_calculado_e_cadastrado(self):
        Feriado.objects.create(
            data=date(2026, 6, 29), nome='Sao Pedro', abrangencia='municipal')

        dias = feriados_entre(date(2026, 1, 1), date(2026, 12, 31))

        self.assertIn(date(2026, 5, 1), dias, 'nacional calculado sumiu')
        self.assertIn(date(2026, 6, 29), dias, 'cadastrado sumiu')

    def test_atravessa_a_virada_do_ano(self):
        """Um intervalo de dezembro a janeiro precisa dos DOIS anos."""
        dias = feriados_entre(date(2025, 12, 1), date(2026, 1, 31))

        self.assertIn(date(2025, 12, 25), dias)
        self.assertIn(date(2026, 1, 1), dias)

    def test_nao_devolve_nada_fora_do_intervalo(self):
        """A guarda contra devolver o ano inteiro quando pedem uma semana."""
        Feriado.objects.create(
            data=date(2026, 6, 29), nome='Sao Pedro', abrangencia='municipal')

        dias = feriados_entre(date(2026, 4, 1), date(2026, 4, 30))

        self.assertIn(date(2026, 4, 3), dias, 'sexta-feira santa')
        self.assertIn(date(2026, 4, 21), dias, 'tiradentes')
        self.assertNotIn(date(2026, 5, 1), dias)
        self.assertNotIn(date(2026, 6, 29), dias)
        self.assertTrue(all(date(2026, 4, 1) <= d <= date(2026, 4, 30) for d in dias))

    def test_intervalo_invertido_nao_devolve_vazio(self):
        """Quem troca inicio e fim recebe o intervalo, nao um silencio."""
        dias = feriados_entre(date(2026, 12, 31), date(2026, 1, 1))

        self.assertIn(date(2026, 5, 1), dias)

    def test_fim_de_semana_NAO_entra(self):
        """Feriado e fim de semana sao perguntas separadas, de proposito.

        Quem chama combina as duas; junta-las aqui esconderia qual das duas
        tirou o dia, e o frontend precisa justamente distinguir isso.
        """
        dias = feriados_entre(date(2026, 3, 1), date(2026, 3, 31))

        self.assertNotIn(date(2026, 3, 7), dias, 'sabado comum entrou')
        self.assertNotIn(date(2026, 3, 8), dias, 'domingo comum entrou')


class EDiaUtilTests(TestCase):

    def test_sabado_e_domingo_nao_sao_uteis(self):
        self.assertFalse(e_dia_util(date(2026, 3, 7)))
        self.assertFalse(e_dia_util(date(2026, 3, 8)))

    def test_feriado_nacional_nao_e_util(self):
        self.assertFalse(e_dia_util(date(2026, 5, 1)))

    def test_feriado_cadastrado_nao_e_util(self):
        Feriado.objects.create(
            data=date(2026, 6, 29), nome='Sao Pedro', abrangencia='municipal')

        self.assertFalse(e_dia_util(date(2026, 6, 29)))

    def test_terca_comum_e_util(self):
        self.assertTrue(e_dia_util(date(2026, 3, 3)))


class EndpointDeFeriadosTests(TestCase):

    def setUp(self):
        self.user = User.objects.create_user(
            username='feriados_api', email='feriados@example.com',
            password='x' * 12, role='admin')
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.url = reverse('feriados')

    def test_exige_autenticacao(self):
        self.assertIn(APIClient().get(self.url).status_code, (401, 403))

    def test_devolve_calculados_e_cadastrados(self):
        Feriado.objects.create(
            data=date(2026, 6, 29), nome='Sao Pedro', abrangencia='municipal')

        r = self.client.get(self.url, {'inicio': '2026-01-01', 'fim': '2026-12-31'})

        self.assertEqual(r.status_code, 200)
        self.assertIn('2026-05-01', r.data['feriados'])
        self.assertIn('2026-06-29', r.data['feriados'])
        self.assertIn('2026-11-20', r.data['feriados'])

    def test_vem_ordenado(self):
        r = self.client.get(self.url, {'inicio': '2026-01-01', 'fim': '2026-12-31'})

        self.assertEqual(r.data['feriados'], sorted(r.data['feriados']))

    def test_sem_parametros_devolve_uma_janela_util(self):
        """Sem filtro o cliente recebe algo utilizavel, nao um erro nem o vazio."""
        r = self.client.get(self.url)

        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data['feriados'])

    def test_recusa_intervalo_invertido(self):
        r = self.client.get(self.url, {'inicio': '2026-12-31', 'fim': '2026-01-01'})

        self.assertEqual(r.status_code, 400)

    def test_recusa_intervalo_absurdo(self):
        """O teto. Sem ele, um pedido de seculos monta um conjunto gigante."""
        r = self.client.get(self.url, {'inicio': '1900-01-01', 'fim': '2099-12-31'})

        self.assertEqual(r.status_code, 400)

    def test_recusa_data_invalida(self):
        r = self.client.get(self.url, {'inicio': 'ontem', 'fim': '2026-01-01'})

        self.assertEqual(r.status_code, 400)


class CadastroDeFeriadosTests(TestCase):
    """O CRUD da metade cadastrada, e quem pode mexer nela.

    A SEPARACAO ENTRE AS DUAS ROTAS E O PONTO. `/api/feriados/` responde "quais
    dias sao feriado" juntando calculado e cadastrado; `/api/feriados-
    cadastrados/` administra as LINHAS. Um feriado nacional nao tem linha, entao
    nao aparece aqui e nao ha como edita-lo — o que evita a tela de
    administracao mostrar dias que ninguem consegue apagar.
    """

    def setUp(self):
        self.admin = User.objects.create_user(
            username='fer_admin', email='fer.admin@example.com',
            password='x' * 12, role='admin')
        self.comum = User.objects.create_user(
            username='fer_comum', email='fer.comum@example.com',
            password='x' * 12, role='colaborador')
        self.url = '/api/feriados-cadastrados/'

    def _como(self, user):
        c = APIClient()
        c.force_authenticate(user)
        return c

    # -- quem pode o que ---------------------------------------------------

    def test_quem_nao_tem_a_permissao_nao_cadastra(self):
        r = self._como(self.comum).post(self.url, {
            'data': '2026-06-29', 'nome': 'Sao Pedro', 'abrangencia': 'municipal'})

        self.assertEqual(r.status_code, 403)
        # A tabela NAO nasce vazia — a migration 0066 cadastra o feriado do RN.
        # Conferir o total aqui daria falso negativo; o que importa e que ESTA
        # data nao entrou.
        self.assertFalse(Feriado.objects.filter(data=date(2026, 6, 29)).exists())

    def test_quem_nao_tem_a_permissao_ainda_consegue_LER(self):
        """A tela mostra a lista a quem so consulta.

        Ler nao e o mesmo que editar, e esconder a lista de quem nao administra
        so geraria a pergunta "por que meu prazo pulou aquele dia?".
        """
        Feriado.objects.create(
            data=date(2026, 6, 29), nome='Sao Pedro', abrangencia='municipal')

        r = self._como(self.comum).get(self.url)

        self.assertEqual(r.status_code, 200)

    def test_admin_cadastra(self):
        r = self._como(self.admin).post(self.url, {
            'data': '2026-06-29', 'nome': 'Sao Pedro', 'abrangencia': 'municipal'})

        self.assertEqual(r.status_code, 201, r.data)
        self.assertTrue(Feriado.objects.filter(data=date(2026, 6, 29)).exists())

    def test_exige_autenticacao(self):
        self.assertIn(APIClient().get(self.url).status_code, (401, 403))

    # -- as travas ---------------------------------------------------------

    def test_recusa_cadastrar_um_dia_que_JA_e_nacional(self):
        """Sem esta trava nasceria uma segunda resposta para o mesmo dia.

        Alguem cadastraria "Natal" em 25/12 achando que estava fazendo falta. O
        registro nao mudaria nada — o dia ja nao e util — mas o sistema voltaria
        a ter duas fontes para o mesmo dia, que e o problema que o modulo de
        feriados existe para encerrar.
        """
        r = self._como(self.admin).post(self.url, {
            'data': '2026-12-25', 'nome': 'Natal', 'abrangencia': 'municipal'})

        self.assertEqual(r.status_code, 400)
        self.assertIn('data', r.data)

    def test_recusa_data_repetida(self):
        Feriado.objects.create(
            data=date(2026, 6, 29), nome='Sao Pedro', abrangencia='municipal')

        r = self._como(self.admin).post(self.url, {
            'data': '2026-06-29', 'nome': 'Outro nome', 'abrangencia': 'empresa'})

        self.assertEqual(r.status_code, 400)

    # -- o efeito no calculo ----------------------------------------------

    def test_cadastrar_tira_o_dia_do_calculo_na_hora(self):
        """Fecha o circuito: cadastrar aqui muda o que `/api/feriados/` devolve.

        Sem este teste, as duas metades poderiam passar em testes separados e
        nunca se encontrarem.
        """
        self.assertNotIn(date(2026, 6, 29),
                         feriados_entre(date(2026, 6, 1), date(2026, 6, 30)))

        self._como(self.admin).post(self.url, {
            'data': '2026-06-29', 'nome': 'Sao Pedro', 'abrangencia': 'municipal'})

        self.assertIn(date(2026, 6, 29),
                      feriados_entre(date(2026, 6, 1), date(2026, 6, 30)))

    def test_excluir_devolve_o_dia_ao_calculo(self):
        f = Feriado.objects.create(
            data=date(2026, 6, 29), nome='Sao Pedro', abrangencia='municipal')

        r = self._como(self.admin).delete('%s%d/' % (self.url, f.pk))

        self.assertEqual(r.status_code, 204)
        self.assertNotIn(date(2026, 6, 29),
                         feriados_entre(date(2026, 6, 1), date(2026, 6, 30)))

    def test_a_listagem_NAO_traz_os_nacionais(self):
        """Eles nao tem linha. Mostra-los aqui ofereceria editar o que nao da."""
        Feriado.objects.create(
            data=date(2026, 6, 29), nome='Sao Pedro', abrangencia='municipal')

        r = self._como(self.admin).get(self.url)
        datas = [item['data'] for item in (r.data.get('results') or r.data)]

        self.assertIn('2026-06-29', datas)
        self.assertNotIn('2026-12-25', datas)


class FeriadoRecorrenteTests(TestCase):
    """Feriado anual de data fixa vale todo ano, sem recadastro.

    POR QUE ISTO EXISTE. Sem a marcacao, cadastrar o 3 de outubro resolveria
    2026 e so 2026: alguem teria de voltar la em 2027, 2028, e um dia
    esqueceria. E o mesmo envelhecimento silencioso que a tabela de cache da API
    externa produziu, so que movido para a mao da equipe — e com o agravante de
    que o 03/10 cai em sabado em 2026 e domingo em 2027, entao a falta so
    apareceria em 2028 e ninguem ligaria a causa ao efeito.
    """

    def _no_ano(self, ano):
        return feriados_entre(date(ano, 1, 1), date(ano, 12, 31))

    # A data destes testes e NEUTRA de proposito: 10 de agosto nao e feriado
    # nacional nem e a linha que a migration 0066 semeia (03/10). Usar a do RN
    # aqui faria o teste colidir com o seed e, pior, passar por causa dele.
    BASE = date(2026, 8, 10)

    def test_vale_nos_anos_seguintes(self):
        Feriado.objects.create(
            data=self.BASE, nome='Aniversario da cidade',
            abrangencia='municipal', recorrente=True)

        for ano in (2026, 2027, 2028, 2035):
            self.assertIn(date(ano, 8, 10), self._no_ano(ano),
                          'recorrente sumiu em %d' % ano)

    def test_NAO_vale_para_tras(self):
        """Aplicar para tras mudaria cards ja fechados, em silencio."""
        Feriado.objects.create(
            data=self.BASE, nome='Aniversario da cidade',
            abrangencia='municipal', recorrente=True)

        self.assertNotIn(date(2025, 8, 10), self._no_ano(2025))
        self.assertNotIn(date(2024, 8, 10), self._no_ano(2024))

    def test_nao_recorrente_vale_so_no_ano_cadastrado(self):
        """Recesso de um ano so nao pode virar feriado perpetuo."""
        Feriado.objects.create(
            data=date(2026, 12, 28), nome='Recesso de fim de ano',
            abrangencia='empresa', recorrente=False)

        self.assertIn(date(2026, 12, 28), self._no_ano(2026))
        self.assertNotIn(date(2027, 12, 28), self._no_ano(2027))

    def test_29_de_fevereiro_pula_o_ano_sem_o_dia(self):
        """Nao existe 29/02 em ano comum. Pular e a unica resposta honesta.

        Empurrar para 28/02 ou 01/03 inventaria um feriado em data que ninguem
        cadastrou — e o calculo de prazo passaria a tirar um dia util que a
        empresa nunca declarou.
        """
        Feriado.objects.create(
            data=date(2024, 2, 29), nome='Dia inventado', abrangencia='empresa',
            recorrente=True)

        self.assertIn(date(2024, 2, 29), self._no_ano(2024))
        self.assertIn(date(2028, 2, 29), self._no_ano(2028), 'proximo bissexto')

        de_2025 = self._no_ano(2025)
        self.assertNotIn(date(2025, 2, 28), de_2025)
        self.assertNotIn(date(2025, 3, 1), de_2025)

    def test_recorrente_entra_no_calculo_de_dias_uteis(self):
        """Fecha o circuito ate o numero que a pessoa ve."""
        from apps.projects.business_time import calculate_development_time
        from django.utils import timezone
        import datetime as dt
        from zoneinfo import ZoneInfo

        tz = ZoneInfo('America/Sao_Paulo')
        def dia_inteiro(ano):
            return calculate_development_time(
                timezone.make_aware(dt.datetime(ano, 8, 10, 8), tz),
                timezone.make_aware(dt.datetime(ano, 8, 10, 17), tz))

        # 10/08/2028 e uma QUINTA: dia util ate alguem dizer o contrario.
        self.assertEqual(dia_inteiro(2028)['dias_uteis_desenvolvimento'], 1)

        Feriado.objects.create(
            data=self.BASE, nome='Aniversario da cidade',
            abrangencia='municipal', recorrente=True)

        self.assertEqual(dia_inteiro(2028)['dias_uteis_desenvolvimento'], 0)

    def test_os_feriados_de_natal_rn_vieram_pelas_migrations(self):
        """As duas linhas semeadas chegam ao banco, e valem todo ano.

        Uma migration de dados que falhasse em silencio deixaria a lista vazia e
        os dias voltariam a contar como uteis sem ninguem desconfiar. Os dois
        caem em fim de semana em 2026 e 2027, entao a falta so apareceria em
        2028 — tarde demais para alguem ligar a causa ao efeito.
        """
        esperados = {
            date(2026, 1, 6): ('Dia de Santos Reis', 'municipal'),
            date(2026, 10, 3): ('Martires de Cunhau e Uruacu', 'estadual'),
            date(2026, 11, 21): ('Nossa Senhora da Apresentacao', 'municipal'),
        }
        for dia, (_, abrangencia) in esperados.items():
            f = Feriado.objects.filter(data=dia).first()
            self.assertIsNotNone(f, 'nao cadastrado: %s' % dia)
            self.assertTrue(f.recorrente, '%s precisa valer todo ano' % dia)
            self.assertEqual(f.abrangencia, abrangencia)

        # Todos valem em 2028, que e quando o 03/10 e o 21/11 finalmente caem
        # em dia de semana. O 06/01 ja cai em dia de semana desde 2026.
        de_2028 = feriados_entre(date(2028, 1, 1), date(2028, 12, 31))
        for dia in (date(2028, 1, 6), date(2028, 10, 3), date(2028, 11, 21)):
            self.assertIn(dia, de_2028)

    def test_a_fonte_legal_de_cada_feriado_fica_registrada(self):
        """Sem a norma anotada, a proxima pessoa refaz a busca inteira.

        As tres entraram por migration a partir de fontes diferentes — duas de
        um decreto municipal, uma de lei estadual. A `observacao` e onde isso
        fica, e e o que permite auditar a lista sem confiar na memoria de
        ninguem.
        """
        for dia in (date(2026, 1, 6), date(2026, 10, 3), date(2026, 11, 21)):
            f = Feriado.objects.get(data=dia)
            self.assertTrue(
                f.observacao.strip(),
                'feriado %s cadastrado sem dizer de onde veio' % dia)

    def test_o_feriado_do_RN_veio_pela_migration(self):
        """A linha que a migration 0066 cadastra chega mesmo ao banco.

        Uma migration de dados que falha em silencio deixaria a lista vazia, e o
        03/10 voltaria a contar como dia util sem ninguem desconfiar.
        """
        f = Feriado.objects.filter(data=date(2026, 10, 3)).first()

        self.assertIsNotNone(f, 'a migration 0066 nao cadastrou o feriado do RN')
        self.assertTrue(f.recorrente, 'o feriado do RN precisa valer todo ano')
        self.assertEqual(f.abrangencia, 'estadual')


class CarnavalContaComoNaoUtilTests(TestCase):
    """Carnaval nao e feriado por lei — e por decisao da empresa.

    OS DECRETOS DE 2026 O CLASSIFICAM COMO PONTO FACULTATIVO. Tanto o municipal
    de Natal (13.643/2025) quanto o estadual (35.209/2025) listam a segunda e a
    terca de Carnaval como ponto facultativo, e NAO como feriado. Mesmo assim o
    sistema os conta como dias nao uteis, porque a BWA nao trabalha neles —
    decisao confirmada pelo usuario em 21/10/2026.

    Esta suite existe porque a decisao e invisivel no codigo: quem ler a lei e
    for "corrigir" o sistema tirando o Carnaval estara certo juridicamente e
    errado para esta empresa. O teste cai e explica por que.

    QUARTA-FEIRA DE CINZAS FICA DE FORA de proposito: o decreto a trata como
    ponto facultativo ate as 14h, e o sistema nao modela meio expediente.
    """

    #: Segunda e terca de Carnaval, conferidas contra a Pascoa de cada ano.
    CARNAVAIS = {
        2026: (date(2026, 2, 16), date(2026, 2, 17)),
        2027: (date(2027, 2, 8), date(2027, 2, 9)),
        2028: (date(2028, 2, 28), date(2028, 2, 29)),
    }

    def test_carnaval_nao_e_dia_util(self):
        for ano, (segunda, terca) in self.CARNAVAIS.items():
            self.assertFalse(e_dia_util(segunda), 'carnaval %d, segunda' % ano)
            self.assertFalse(e_dia_util(terca), 'carnaval %d, terca' % ano)

    def test_as_datas_batem_com_a_pascoa(self):
        """A trava contra uma tabela decorada que envelhece.

        Se alguem mexer no calculo da Pascoa, as datas acima deixam de ser
        Carnaval — e o teste acima continuaria passando por coincidencia, sobre
        dias que nao sao mais feriado nenhum.
        """
        from datetime import timedelta

        for ano, (segunda, terca) in self.CARNAVAIS.items():
            domingo = pascoa(ano)
            self.assertEqual(segunda, domingo - timedelta(days=48), 'ano %d' % ano)
            self.assertEqual(terca, domingo - timedelta(days=47), 'ano %d' % ano)

    def test_quarta_feira_de_cinzas_NAO_entra(self):
        """Ponto facultativo ate as 14h; o sistema nao modela meio expediente.

        Conta-la inteira tiraria um dia util que a empresa so perde pela
        metade.
        """
        for ano, (_, terca) in self.CARNAVAIS.items():
            from datetime import timedelta
            cinzas = terca + timedelta(days=1)
            if cinzas.weekday() < 5:
                self.assertTrue(e_dia_util(cinzas), 'cinzas %d virou feriado' % ano)
