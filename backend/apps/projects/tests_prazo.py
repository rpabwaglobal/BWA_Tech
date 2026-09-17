"""Entregue no prazo, quando o prazo tem minuto e a entrega tem segundo.

O bug relatado: dois cards apareciam como "Fora do prazo" mostrando na tela
exatamente o mesmo horario do prazo. Medido no banco: entregues 26 e 21
SEGUNDOS depois de um prazo cravado em segundo zero.

A causa e estrutural, nao um acidente: o seletor de data grava
`YYYY-MM-DDTHH:mm` e completa os segundos com zero, e a conclusao e o instante
do clique. **1074 de 1074** prazos terminam em segundo zero; **0 de 902**
conclusoes terminam. Sao dois relogios de precisao diferente.

O teste que mais importa aqui e `test_o_orm_concorda_com_o_python`. Os outros
conferem a regra; esse guarda a razao de a regra existir num modulo so — ela
estava escrita em oito lugares, e a tela de Metricas usa o ORM enquanto os
relatorios usam Python. Se os dois caminhos divergirem, o sistema passa a dar
duas respostas para a mesma pergunta, que e pior que o erro original.
"""
import datetime as dt

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from apps.accounts.models import SetorCatalogo
from apps.projects.models import Card, CardStatus, Project, Sprint
from apps.projects.prazo import (
    dias_de_atraso, entregue_atrasado, entregue_no_prazo, q_entregue_atrasado,
)

User = get_user_model()


class PrazoDeEntregaTests(TestCase):

    def setUp(self):
        self.admin = User.objects.create_user(
            username='admin_prazo', email='admin.prazo@example.com',
            password='x' * 12, role='admin', is_superuser=True, is_staff=True)
        self.setor = SetorCatalogo.objects.create(
            codename='setor_prazo', nome='Prazo')

        agora = timezone.now()
        self.sprint = Sprint.objects.create(
            nome='Sprint do prazo', data_inicio=agora - dt.timedelta(days=1),
            fechamento_em=agora + dt.timedelta(days=7), duracao_dias=8,
            supervisor=self.admin, setor=self.setor)
        self.projeto = Project.objects.create(
            nome='Projeto do prazo', sprint=self.sprint, setor=self.setor)

        # O prazo como a tela grava: minuto cravado, segundo zero.
        self.prazo = timezone.make_aware(
            dt.datetime(2026, 8, 19, 18, 30, 0, 0))

    def _card(self, segundos_depois=None, microssegundos=0, nome='Card'):
        """Cria um card finalizado `segundos_depois` do prazo.

        Grava com `update` para o signal nao sobrescrever `finalizado_em` com o
        instante do teste — e e justamente esse campo que esta em julgamento.
        """
        card = Card.objects.create(
            nome=nome, projeto=self.projeto, status=CardStatus.EM_DESENVOLVIMENTO,
            criado_por=self.admin, data_fim=self.prazo)
        if segundos_depois is not None:
            conclusao = self.prazo + dt.timedelta(
                seconds=segundos_depois, microseconds=microssegundos)
            Card.objects.filter(pk=card.pk).update(
                status=CardStatus.FINALIZADO, finalizado_em=conclusao)
            card.refresh_from_db()
        return card

    # -- o caso relatado -------------------------------------------------

    def test_entrega_no_mesmo_minuto_do_prazo_esta_no_prazo(self):
        """O bug: prazo 18:30:00, entrega 18:30:26 — a tela mostra 18:30 nos dois.

        Para qualquer pessoa, foi no horario. A regra antiga (`>`) dizia que
        nao.
        """
        card = self._card(segundos_depois=26, microssegundos=989266)

        self.assertTrue(entregue_no_prazo(card))
        self.assertFalse(entregue_atrasado(card))

    def test_o_segundo_mais_tarde_do_minuto_ainda_esta_no_prazo(self):
        """18:30:59,999 — o ultimo instante do minuto combinado."""
        card = self._card(segundos_depois=59, microssegundos=999999)
        self.assertTrue(entregue_no_prazo(card))

    def test_entrega_exatamente_no_instante_do_prazo_esta_no_prazo(self):
        card = self._card(segundos_depois=0)
        self.assertTrue(entregue_no_prazo(card))

    # -- o que NAO pode mudar --------------------------------------------

    def test_o_minuto_seguinte_ja_esta_atrasado(self):
        """A tolerancia e de um minuto, nao de 'um pouquinho'. 18:31:00 atrasou.

        Sem esta trava, a correcao viraria licenca para esticar o prazo.
        """
        card = self._card(segundos_depois=60)

        self.assertTrue(entregue_atrasado(card))
        self.assertFalse(entregue_no_prazo(card))

    def test_atraso_de_horas_continua_atrasado(self):
        card = self._card(segundos_depois=3 * 3600)
        self.assertTrue(entregue_atrasado(card))

    def test_atraso_de_dias_continua_atrasado(self):
        card = self._card(segundos_depois=5 * 86400)
        self.assertTrue(entregue_atrasado(card))
        self.assertEqual(dias_de_atraso(card), 4)

    def test_dias_de_atraso_e_zero_para_quem_entregou_no_prazo(self):
        self.assertEqual(dias_de_atraso(self._card(segundos_depois=26)), 0)

    # -- fora da pergunta ------------------------------------------------

    def test_card_sem_prazo_nao_esta_no_prazo_nem_atrasado(self):
        """Sem prazo nao ha promessa a cumprir. As duas respostas sao False, e
        isso e diferente de 'entregou no prazo'."""
        card = Card.objects.create(
            nome='Sem prazo', projeto=self.projeto,
            status=CardStatus.FINALIZADO, criado_por=self.admin, data_fim=None)
        Card.objects.filter(pk=card.pk).update(finalizado_em=timezone.now())
        card.refresh_from_db()

        self.assertFalse(entregue_no_prazo(card))
        self.assertFalse(entregue_atrasado(card))

    def test_card_sem_conclusao_nao_esta_no_prazo_nem_atrasado(self):
        card = self._card(segundos_depois=None)
        self.assertFalse(entregue_no_prazo(card))
        self.assertFalse(entregue_atrasado(card))

    # -- a trava que impede a divergencia voltar -------------------------

    def test_o_orm_concorda_com_o_python(self):
        """As duas implementacoes da MESMA regra tem de dar a mesma resposta.

        A tela de Metricas conta pelo ORM (`q_entregue_atrasado`); os
        relatorios filtram em Python (`entregue_atrasado`). Se divergirem, o
        sistema responde duas coisas para a mesma pergunta — e foi a
        duplicacao da regra em oito lugares que criou o bug original.

        Os casos cobrem as duas bordas do minuto, que e onde uma diferenca de
        implementacao apareceria primeiro.
        """
        casos = [
            (0, 0, 'no instante'),
            (26, 989266, 'o caso relatado'),
            (59, 999999, 'ultimo instante do minuto'),
            (60, 0, 'minuto seguinte'),
            (3600, 0, 'uma hora'),
            (86400 * 3, 0, 'tres dias'),
        ]
        for segundos, micros, rotulo in casos:
            self._card(segundos_depois=segundos, microssegundos=micros,
                       nome='Card %s' % rotulo)

        via_python = {
            c.id for c in Card.objects.filter(status=CardStatus.FINALIZADO)
            if entregue_atrasado(c)
        }
        via_orm = set(
            Card.objects.filter(status=CardStatus.FINALIZADO)
            .filter(q_entregue_atrasado())
            .values_list('id', flat=True)
        )

        self.assertEqual(
            via_python, via_orm,
            'ORM e Python discordaram sobre quais cards estao atrasados — '
            'a tela de Metricas passaria a divergir dos relatorios')
        # E a resposta certa: 3 dos 6 passaram do minuto.
        self.assertEqual(len(via_orm), 3)

    def test_o_orm_ignora_card_sem_prazo_ou_sem_conclusao(self):
        """Card sem prazo ou sem conclusao fica fora da contagem de atrasados.

        ATENCAO AO QUE ESTE TESTE NAO FAZ: ele nao guarda os `isnull=False` do
        filtro. Removi-os de proposito para conferir, e o teste continuou
        passando — em SQL a comparacao com NULL da desconhecido e a linha ja sai
        do `WHERE`. As guardas ficam por clareza, nao por necessidade.

        O que este teste guarda e o COMPORTAMENTO: se alguem um dia trocar o
        filtro por algo que trate nulo como atrasado (um `COALESCE` mal posto,
        por exemplo), ele cai."""
        sem_prazo = Card.objects.create(
            nome='Sem prazo', projeto=self.projeto,
            status=CardStatus.FINALIZADO, criado_por=self.admin, data_fim=None)
        Card.objects.filter(pk=sem_prazo.pk).update(finalizado_em=timezone.now())
        self._card(segundos_depois=None, nome='Sem conclusao')
        atrasado = self._card(segundos_depois=7200, nome='Atrasado de verdade')

        ids = set(
            Card.objects.filter(q_entregue_atrasado()).values_list('id', flat=True))

        self.assertEqual(ids, {atrasado.id})
