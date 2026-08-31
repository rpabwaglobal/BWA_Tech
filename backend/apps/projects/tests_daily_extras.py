"""O que o Daily Mode precisa e a pagina de Prioridades nao carrega.

`priorities_view` cobre as duas primeiras colunas do daily (o card em
desenvolvimento e os concluidos hoje). As outras duas coisas nao existiam em
lugar nenhum da API, e sao o que este endpoint acrescenta: o TEXTO do
impedimento e as entregas dos ultimos dias.

Os testes que mais importam aqui nao sao os do caminho feliz. Sao os que
guardam decisoes que ja falharam uma vez na minha frente:

- `test_o_motivo_sai_do_card_log_e_nao_do_model_event`, porque escrevi este
  endpoint contra `Event.tipo='pendencia'` primeiro. O nome bate, o campo
  `motivo` existe - e a tabela esta VAZIA no banco inteiro. Quem grava e o
  `CardLog`. O endpoint devolvia motivo vazio para todos, e nenhum teste de
  caminho feliz pegaria isso, porque vazio e uma resposta valida.
- `test_a_referencia_e_finalizado_em_e_nao_updated_at`, porque `updated_at`
  sobe a cada edicao: um card entregue na terca e corrigido na quinta
  apareceria como entrega de quinta, e a daily contaria o trabalho no dia
  errado.
- `test_hoje_fica_de_fora_das_entregas`, porque o daily ja tem uma coluna so
  para hoje. Sem esta exclusao o mesmo card aparece duas vezes na tela.
"""
import datetime as dt

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import SetorCatalogo
from apps.projects.models import (
    Card, CardLog, CardLogEventType, CardStatus, Event, EventType, Project,
    Sprint,
)

User = get_user_model()

ROTA = '/api/cards/daily_extras/'

DIAS_DA_SEMANA = (
    'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo',
)


class DailyExtrasTests(APITestCase):

    def setUp(self):
        self.supervisor = User.objects.create_user(
            username='sup_daily', email='sup.daily@example.com',
            password='x' * 12, role='admin', is_superuser=True, is_staff=True)
        self.dev = User.objects.create_user(
            username='dev_daily', email='dev.daily@example.com',
            password='x' * 12, role='desenvolvedor')
        # SEM `view_content` o dev nao aparece NA RESPOSTA, e nao apenas sem
        # cards: `_usuarios_que_executam` exclui quem nao enxerga sprint nem
        # projeto, porque "sem card" e "sem acesso" sao coisas diferentes.
        self.dev.user_permissions.add(
            Permission.objects.get(codename='view_content'))
        self.setor = SetorCatalogo.objects.create(
            codename='setor_daily', nome='Daily')

        agora = timezone.now()
        self.sprint = Sprint.objects.create(
            nome='Sprint do daily', data_inicio=agora - dt.timedelta(days=1),
            fechamento_em=agora + dt.timedelta(days=7), duracao_dias=8,
            supervisor=self.supervisor, setor=self.setor)
        self.projeto = Project.objects.create(
            nome='Projeto do daily', sprint=self.sprint)

        self.client.force_authenticate(user=self.supervisor)

    # -- auxiliares ------------------------------------------------------

    def _card(self, nome, status=CardStatus.EM_DESENVOLVIMENTO, dono=None):
        return Card.objects.create(
            nome=nome, projeto=self.projeto, status=status,
            responsavel=dono or self.dev, criado_por=self.supervisor)

    def _finalizar_em(self, card, quando):
        """Grava a conclusao SEM passar pelo save(), para o signal nao
        sobrescrever `finalizado_em` com o instante do teste."""
        Card.objects.filter(pk=card.pk).update(
            status=CardStatus.FINALIZADO, finalizado_em=quando,
            updated_at=quando)
        card.refresh_from_db()
        return card

    def _extras_do_dev(self, resposta):
        for linha in resposta.data['usuarios']:
            if linha['usuario_id'] == self.dev.id:
                return linha
        self.fail('o dev nao apareceu na resposta de daily_extras')

    def _instante(self, dias_atras, hora=14):
        dia = timezone.localdate() - dt.timedelta(days=dias_atras)
        return timezone.make_aware(dt.datetime.combine(dia, dt.time(hora, 0)))

    # -- permissao -------------------------------------------------------

    def test_exige_permissao_de_metricas(self):
        """Mesmo portao de `priorities_view`: o daily expoe o trabalho da
        equipe inteira, nao so o de quem olha."""
        self.client.force_authenticate(user=self.dev)
        self.assertEqual(self.client.get(ROTA).status_code, 403)

    def test_anonimo_nao_entra(self):
        self.client.force_authenticate(user=None)
        self.assertIn(self.client.get(ROTA).status_code, (401, 403))

    # -- entregas dos ultimos dias ---------------------------------------

    def test_agrupa_as_entregas_por_dia(self):
        self._finalizar_em(self._card('Entrega de ontem'), self._instante(1))
        self._finalizar_em(self._card('Entrega de anteontem'), self._instante(2))

        extras = self._extras_do_dev(self.client.get(ROTA))

        self.assertEqual(extras['total_entregas'], 2)
        self.assertEqual(len(extras['entregas']), 2)
        # Mais recente primeiro: a daily comeca por "o que voce fez desde ontem".
        self.assertEqual(extras['entregas'][0]['items'][0]['nome'],
                         'Entrega de ontem')
        self.assertEqual(extras['entregas'][1]['items'][0]['nome'],
                         'Entrega de anteontem')

    def test_hoje_fica_de_fora_das_entregas(self):
        """O daily tem uma coluna so para hoje. Um card nas duas seria contado
        duas vezes pela pessoa que esta falando."""
        self._finalizar_em(self._card('Entrega de hoje'), timezone.now())

        extras = self._extras_do_dev(self.client.get(ROTA))

        self.assertEqual(extras['total_entregas'], 0)

    def test_ignora_entregas_alem_da_janela(self):
        self._finalizar_em(self._card('Entrega antiga'), self._instante(20, 9))

        extras = self._extras_do_dev(self.client.get(ROTA))
        self.assertEqual(extras['total_entregas'], 0)

        # ... mas aparece quando a janela e aberta o suficiente.
        extras = self._extras_do_dev(self.client.get(ROTA, {'dias': 25}))
        self.assertEqual(extras['total_entregas'], 1)

    def test_a_referencia_e_finalizado_em_e_nao_updated_at(self):
        """Um card entregue ha tres dias e corrigido hoje continua sendo
        entrega de tres dias atras."""
        card = self._finalizar_em(
            self._card('Entregue e depois corrigido'), self._instante(3, 11))
        # A edicao posterior mexe SO no updated_at.
        Card.objects.filter(pk=card.pk).update(updated_at=timezone.now())

        extras = self._extras_do_dev(self.client.get(ROTA))

        self.assertEqual(extras['total_entregas'], 1)
        esperado = (timezone.localdate() - dt.timedelta(days=3)).isoformat()
        self.assertEqual(extras['entregas'][0]['dia'], esperado)

    def test_o_rotulo_do_dia_traz_o_dia_da_semana_em_portugues(self):
        ontem = timezone.localdate() - dt.timedelta(days=1)
        self._finalizar_em(self._card('Entrega rotulada'), self._instante(1, 10))

        extras = self._extras_do_dev(self.client.get(ROTA))

        esperado = '%s, %02d/%02d' % (
            DIAS_DA_SEMANA[ontem.weekday()], ontem.day, ontem.month)
        self.assertEqual(extras['entregas'][0]['label'], esperado)

    def test_card_nao_finalizado_nao_vira_entrega(self):
        self._card('Ainda em desenvolvimento')
        extras = self._extras_do_dev(self.client.get(ROTA))
        self.assertEqual(extras['total_entregas'], 0)

    # -- motivo da pendencia ---------------------------------------------

    def test_o_motivo_sai_do_card_log_e_nao_do_model_event(self):
        """`Event.tipo='pendencia'` existe e esta vazio no banco inteiro; quem
        grava o motivo e o `CardLog`. Este teste falha se alguem trocar a fonte
        de volta pelo nome mais bonito."""
        card = self._card('Card travado', status=CardStatus.PARADO_PENDENCIAS)
        # A isca: um Event que o endpoint NAO deve ler.
        Event.objects.create(
            card=card, tipo=EventType.PENDENCIA, descricao='ignore isto',
            motivo='MOTIVO ERRADO, veio do Event')
        CardLog.objects.create(
            card=card, tipo_evento=CardLogEventType.PENDENCIA,
            descricao=('Em Desenvolvimento -> Parado por Pendências'
                       '\n\nMotivo: aguardando acesso ao banco'))

        extras = self._extras_do_dev(self.client.get(ROTA))

        self.assertEqual(len(extras['pendencias']), 1)
        self.assertEqual(extras['pendencias'][0]['motivo'],
                         'aguardando acesso ao banco')

    def test_o_motivo_perde_a_linha_da_transicao(self):
        """A primeira linha do log repete o que o bloco vermelho ja diz."""
        card = self._card('Outro travado', status=CardStatus.PARADO_PENDENCIAS)
        CardLog.objects.create(
            card=card, tipo_evento=CardLogEventType.PENDENCIA,
            descricao=('Em Homologação -> Parado por Pendências'
                       '\n\nMotivo: aguardando retorno do fornecedor'))

        extras = self._extras_do_dev(self.client.get(ROTA))

        self.assertNotIn('Homologação', extras['pendencias'][0]['motivo'])
        self.assertEqual(extras['pendencias'][0]['motivo'],
                         'aguardando retorno do fornecedor')

    def test_vale_a_pendencia_mais_recente(self):
        """Um card trava, destrava e trava de novo. O motivo velho descreve
        outro impedimento."""
        card = self._card('Travado duas vezes',
                          status=CardStatus.PARADO_PENDENCIAS)
        antigo = CardLog.objects.create(
            card=card, tipo_evento=CardLogEventType.PENDENCIA,
            descricao='Motivo: impedimento antigo')
        CardLog.objects.filter(pk=antigo.pk).update(
            data=timezone.now() - dt.timedelta(days=5))
        CardLog.objects.create(
            card=card, tipo_evento=CardLogEventType.PENDENCIA,
            descricao='Motivo: impedimento de agora')

        extras = self._extras_do_dev(self.client.get(ROTA))

        self.assertEqual(extras['pendencias'][0]['motivo'],
                         'impedimento de agora')

    def test_card_parado_sem_motivo_registrado_devolve_texto_vazio(self):
        """Acontece de verdade: no banco de producao ha card parado sem nenhum
        log de motivo. O endpoint nao pode inventar um texto nem estourar."""
        self._card('Travado e mudo', status=CardStatus.PARADO_PENDENCIAS)

        extras = self._extras_do_dev(self.client.get(ROTA))

        self.assertEqual(len(extras['pendencias']), 1)
        self.assertEqual(extras['pendencias'][0]['motivo'], '')

    def test_sem_card_parado_nao_ha_pendencia(self):
        self._card('Tocando normalmente')
        extras = self._extras_do_dev(self.client.get(ROTA))
        self.assertEqual(extras['pendencias'], [])

    def test_dois_cards_parados_trazem_dois_motivos(self):
        """A primeira versao devolvia UM card parado por pessoa, num dicionario
        `responsavel_id -> card`. O segundo card travado sumia sem aviso, e a
        coluna mostrava o motivo de um card ao lado do nome de outro."""
        primeiro = self._card('Travado A', status=CardStatus.PARADO_PENDENCIAS)
        segundo = self._card('Travado B', status=CardStatus.PARADO_PENDENCIAS)
        CardLog.objects.create(
            card=primeiro, tipo_evento=CardLogEventType.PENDENCIA,
            descricao='Motivo: falta o acesso')
        CardLog.objects.create(
            card=segundo, tipo_evento=CardLogEventType.PENDENCIA,
            descricao='Motivo: falta o retorno do cliente')

        extras = self._extras_do_dev(self.client.get(ROTA))

        por_nome = {p['card_nome']: p['motivo'] for p in extras['pendencias']}
        self.assertEqual(por_nome, {
            'Travado A': 'falta o acesso',
            'Travado B': 'falta o retorno do cliente',
        })

    # -- janela ----------------------------------------------------------

    def test_dias_invalido_nao_derruba_o_endpoint(self):
        for valor in ('abc', '', '-3', '999'):
            resposta = self.client.get(ROTA, {'dias': valor})
            self.assertEqual(resposta.status_code, 200, valor)
            self.assertGreaterEqual(resposta.data['dias'], 1)
            self.assertLessEqual(resposta.data['dias'], 30)
