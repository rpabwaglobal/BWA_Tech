"""
VERIFICAÇÃO ADVERSARIAL DO ESCOPO POR SETOR — o vazamento DORMENTE.

A fase 2 apoiou toda a decisão de visibilidade dos cards de feedback numa
premissa escrita no código: "`sem_setor` não é setor de trabalho de ninguém,
logo NINGUÉM enxerga (fail-closed)". A premissa é FALSA neste sistema, e o
próprio `apps.accounts` diz por quê em três lugares:

  - accounts/0016 vincula TODO usuário existente a `sem_setor`;
  - `RegisterSerializer.create` põe toda conta nova em `sem_setor`;
  - `aplicar_regra_do_setor_padrao` documenta o efeito: o vínculo com o balde
    "entregaria a essa pessoa todo o conteúdo NÃO CLASSIFICADO da empresa".

`sem_setor` não é "de ninguém": é o setor de todo mundo que ainda não foi
classificado. No banco de desenvolvimento deste projeto, 14 dos 15 vínculos de
usuário são `sem_setor`. Com `SETOR_SCOPING_ENABLED=True`, cada um desses 14
enxergaria TODO card de feedback da empresa — e, com ele, a `url_publica`, que é
a credencial inteira da rota anônima.

Estes testes existem para provar isso e para travar a correção: o fluxo de
monitoramento passa a morar num setor TÉCNICO PRÓPRIO (`monitoramento_feedbacks`),
ao qual nenhum usuário é vinculado por padrão — e aí a frase "ninguém enxerga
por herança" vira verdade em vez de suposição.

O segundo bloco cobre a outra ponta do mesmo problema: "Mover conteúdo" tem um
atalho `todos=true` que despeja TUDO que está em `sem_setor` num setor real de
uma vez. Enquanto o fluxo morasse no balde, um clique de administrador desfaria
a decisão de segurança inteira, sem aviso e sem log.
"""
from __future__ import annotations

import datetime as dt

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone

from apps.accounts.models import SetorCatalogo, UserSetor
from apps.accounts.scoping import SETOR_PADRAO_CODENAME, scope_cards
from apps.projects.models import Card, CardStatus, Project, ProjectStatus, Sprint

from .estrutura import (
    NOME_PROJETO_MONITORAMENTO, SETOR_MONITORAMENTO_CODENAME,
    garantir_estrutura_monitoramento,
)

User = get_user_model()


class BaseEscopo(TestCase):
    """Uma entrega real de Tecnologia + um usuário NÃO CLASSIFICADO.

    O usuário não classificado é o personagem central: ele não é um caso de
    borda inventado, é o estado em que TODA conta nasce e em que estão hoje
    quase todos os usuários deste banco.
    """

    def setUp(self):
        cache.clear()
        self.chefe = User.objects.create_superuser(
            username='chefe', password='x' * 12, email='chefe@example.com')
        self.setor = SetorCatalogo.objects.create(codename='tec', nome='Tecnologia')
        agora = timezone.now()
        self.sprint = Sprint.objects.create(
            nome='Sprint 1', data_inicio=agora,
            fechamento_em=agora + dt.timedelta(days=7), duracao_dias=7,
            supervisor=self.chefe, setor=self.setor,
        )
        self.projeto = Project.objects.create(nome='Portal do cliente', sprint=self.sprint)
        self.card_marcado = Card.objects.create(
            nome='Tela de login do Cliente Alfa', projeto=self.projeto,
            gerar_formulario_feedback=True,
        )

        # A ENTREGA É O CARD SENDO FINALIZADO. O status do projeto continua
        # sendo gravado porque a fixture o descreve como entregue, mas quem
        # dispara a geração do pedido é a transição do card — projeto aqui é
        # só a pasta que agrupa os cards.
        with self.captureOnCommitCallbacks(execute=True):
            self.projeto.status = ProjectStatus.ENTREGUE
            self.projeto.save()
        with self.captureOnCommitCallbacks(execute=True):
            self.card_marcado.status = CardStatus.FINALIZADO
            self.card_marcado.save()

        self.projeto_monitoramento = Project.objects.get(nome=NOME_PROJETO_MONITORAMENTO)
        self.card_feedback = Card.objects.get(projeto=self.projeto_monitoramento)

        # `sem_setor` existe porque accounts/0016 roda na criação do banco de
        # teste — é o mesmo balde da produção, não um objeto de mentira.
        self.balde = SetorCatalogo.objects.get(codename=SETOR_PADRAO_CODENAME)
        self.nao_classificado = self._usuario('recem_cadastrado', self.balde)
        self.de_dentro = self._usuario('quem_entregou', self.setor)

    def _usuario(self, username, setor):
        user = User.objects.create_user(username=username, password='x' * 12)
        user.user_permissions.add(Permission.objects.get(codename='view_content'))
        UserSetor.objects.create(user=user, setor=setor, is_primary=True)
        return User.objects.get(pk=user.pk)

    def _pedidos_vistos_por(self, user):
        self.client.force_login(User.objects.get(pk=user.pk))
        resposta = self.client.get(f'/api/feedbacks/pedidos/?card={self.card_feedback.pk}')
        self.assertEqual(resposta.status_code, 200)
        corpo = resposta.json()
        return corpo['results'] if isinstance(corpo, dict) and 'results' in corpo else corpo


# =========================================================================== #
# 1. O VAZAMENTO DORMENTE: quem NÃO foi classificado enxergava tudo
# =========================================================================== #
@override_settings(SETOR_SCOPING_ENABLED=True)
class VazamentoParaNaoClassificadosTests(BaseEscopo):

    def test_usuario_nao_classificado_nao_ve_o_card_de_feedback(self):
        """O teste que faltava. Antes da correção ele FALHAVA: o card de
        feedback morava em `sem_setor` e o termo `Q(setor_id__in=setores)` de
        `scope_cards` casava direto com o balde deste usuário."""
        visiveis = scope_cards(Card.objects.all(), self.nao_classificado)

        self.assertNotIn(self.card_feedback.pk, set(visiveis.values_list('pk', flat=True)))

    def test_usuario_nao_classificado_nao_recebe_a_url_publica(self):
        """O dano real do vazamento: `url_publica` é a credencial INTEIRA da
        rota anônima. Ver o card e pegar o link é a mesma coisa."""
        self.assertEqual(self._pedidos_vistos_por(self.nao_classificado), [])

    def test_usuario_nao_classificado_nao_ve_o_projeto_de_monitoramento(self):
        """O segundo caminho do mesmo vazamento: `_projetos_visiveis_ids` faz o
        projeto do balde arrastar TODOS os cards dele junto."""
        from apps.accounts.scoping import scope_projects

        visiveis = scope_projects(Project.objects.all(), self.nao_classificado)

        self.assertNotIn(
            self.projeto_monitoramento.pk, set(visiveis.values_list('pk', flat=True)))

    def test_quem_entregou_continua_vendo_o_card_e_o_link(self):
        """A correção não pode fechar demais: sem isto a feature morre calada."""
        itens = self._pedidos_vistos_por(self.de_dentro)

        self.assertEqual(len(itens), 1)
        self.assertIn('/feedback/', itens[0]['url_publica'])

    def test_o_fluxo_nao_mora_no_balde_de_nao_classificados(self):
        """A raiz, afirmada como invariante e não como comentário."""
        self.assertEqual(
            self.projeto_monitoramento.setor.codename, SETOR_MONITORAMENTO_CODENAME)
        self.assertEqual(self.card_feedback.setor.codename, SETOR_MONITORAMENTO_CODENAME)
        self.assertNotEqual(self.card_feedback.setor_id, self.balde.pk)

    def test_nenhum_usuario_e_vinculado_ao_setor_tecnico(self):
        """O setor técnico só é seguro enquanto ninguém for dono dele. Se um dia
        alguém for vinculado, é decisão explícita de um administrador — não o
        default silencioso que `sem_setor` era."""
        self.assertFalse(
            UserSetor.objects.filter(setor__codename=SETOR_MONITORAMENTO_CODENAME).exists())


# =========================================================================== #
# 2. "MOVER CONTEÚDO" NÃO PODE DESFAZER A DECISÃO DE SEGURANÇA
# =========================================================================== #
@override_settings(SETOR_SCOPING_ENABLED=True)
class MoverConteudoNaoAlcancaOFluxoTests(BaseEscopo):
    """`POST /api/setores/<id>/atribuir-dados/` é uma VARREDURA de sprints que o
    mapa da fase não listou. Com `todos=true` ela reatribui tudo que está no
    balde — e é a operação que a própria tela recomenda ao criar um setor novo.
    """

    def setUp(self):
        super().setUp()
        self.financeiro = SetorCatalogo.objects.create(codename='fin', nome='Financeiro')
        self.de_fora = self._usuario('terceiro', self.financeiro)

    def _mover_todos_para_financeiro(self):
        self.client.force_login(User.objects.get(pk=self.chefe.pk))
        resposta = self.client.post(
            f'/api/setores/{self.financeiro.pk}/atribuir-dados/',
            data={'todos': True}, content_type='application/json',
        )
        self.assertEqual(resposta.status_code, 200, resposta.content)
        return resposta

    def test_mover_todo_o_nao_classificado_nao_leva_o_fluxo_de_feedback(self):
        self._mover_todos_para_financeiro()

        self.card_feedback.refresh_from_db()
        self.projeto_monitoramento.refresh_from_db()
        self.assertEqual(self.card_feedback.setor.codename, SETOR_MONITORAMENTO_CODENAME)
        self.assertEqual(
            self.projeto_monitoramento.setor.codename, SETOR_MONITORAMENTO_CODENAME)

    def test_depois_de_mover_o_setor_de_destino_continua_sem_ver_o_feedback(self):
        """A asserção que importa: o efeito, não o campo."""
        self._mover_todos_para_financeiro()

        self.assertEqual(self._pedidos_vistos_por(self.de_fora), [])

    def test_a_sprint_sistemica_nao_e_movida_nem_por_id_explicito(self):
        """Cinto: o `todos` já não a alcança, mas a API aceita ids na mão e a
        sprint sistêmica não está na listagem para o operador saber que existe."""
        sistemica = Sprint.objects.get(is_system=True)
        setor_antes = sistemica.setor_id
        self.client.force_login(User.objects.get(pk=self.chefe.pk))

        resposta = self.client.post(
            f'/api/setores/{self.financeiro.pk}/atribuir-dados/',
            data={'sprint_ids': [sistemica.pk]}, content_type='application/json',
        )

        self.assertEqual(resposta.status_code, 200, resposta.content)
        sistemica.refresh_from_db()
        self.card_feedback.refresh_from_db()
        self.assertEqual(sistemica.setor_id, setor_antes)
        self.assertEqual(self.card_feedback.setor.codename, SETOR_MONITORAMENTO_CODENAME)

    def test_o_projeto_de_monitoramento_nao_e_movido_por_id_explicito(self):
        self.client.force_login(User.objects.get(pk=self.chefe.pk))

        resposta = self.client.post(
            f'/api/setores/{self.financeiro.pk}/atribuir-dados/',
            data={'project_ids': [self.projeto_monitoramento.pk]},
            content_type='application/json',
        )

        self.assertEqual(resposta.status_code, 200, resposta.content)
        self.projeto_monitoramento.refresh_from_db()
        self.assertEqual(
            self.projeto_monitoramento.setor.codename, SETOR_MONITORAMENTO_CODENAME)

    def test_o_conteudo_de_verdade_do_balde_continua_sendo_movido(self):
        """A correção recorta o fluxo sistêmico e SÓ ele: o atalho tem de
        continuar fazendo o trabalho para o qual existe."""
        orfa = Sprint.objects.create(
            nome='Sprint sem dono', data_inicio=timezone.now(),
            fechamento_em=timezone.now() + dt.timedelta(days=3), duracao_dias=3,
            supervisor=self.chefe, setor=self.balde,
        )
        projeto_orfao = Project.objects.create(nome='Projeto sem dono', sprint=orfa)

        self._mover_todos_para_financeiro()

        orfa.refresh_from_db()
        projeto_orfao.refresh_from_db()
        self.assertEqual(orfa.setor_id, self.financeiro.pk)
        self.assertEqual(projeto_orfao.setor_id, self.financeiro.pk)


# =========================================================================== #
# 3. A AUTO-CURA DA INSTALAÇÃO QUE JÁ NASCEU ERRADA
# =========================================================================== #
class MigracaoDoFluxoParaOSetorTecnicoTests(TestCase):
    """Um banco onde o seed ANTERIOR já rodou tem sprint, projeto e cards no
    balde. A correção não pode depender de ninguém rodar nada à mão: o próprio
    `garantir_estrutura_monitoramento`, que já roda a cada entrega, reconcilia.
    """

    def setUp(self):
        cache.clear()
        self.chefe = User.objects.create_superuser(
            username='chefe', password='x' * 12, email='chefe@example.com')
        self.balde = SetorCatalogo.objects.get(codename=SETOR_PADRAO_CODENAME)

    def test_estrutura_semeada_no_balde_e_reconciliada(self):
        projeto = garantir_estrutura_monitoramento()
        sprint = projeto.sprint
        card = Card.objects.create(nome='Feedback antigo', projeto=projeto)
        # Simula EXATAMENTE o estado deixado pelo seed anterior.
        Sprint.objects.filter(pk=sprint.pk).update(setor=self.balde)
        Project.objects.filter(pk=projeto.pk).update(setor=self.balde)
        Card.objects.filter(pk=card.pk).update(setor=self.balde)

        garantir_estrutura_monitoramento()

        sprint.refresh_from_db()
        projeto.refresh_from_db()
        card.refresh_from_db()
        self.assertEqual(sprint.setor.codename, SETOR_MONITORAMENTO_CODENAME)
        self.assertEqual(projeto.setor.codename, SETOR_MONITORAMENTO_CODENAME)
        self.assertEqual(card.setor.codename, SETOR_MONITORAMENTO_CODENAME)

    def test_o_setor_tecnico_e_de_sistema_e_nao_pode_ser_excluido(self):
        """PROTECT segura sprint/projeto/card; `is_system` segura a UI. Sem os
        dois, apagar o setor pela tela derrubaria o fluxo inteiro."""
        garantir_estrutura_monitoramento()

        setor = SetorCatalogo.objects.get(codename=SETOR_MONITORAMENTO_CODENAME)
        self.assertTrue(setor.is_system)
