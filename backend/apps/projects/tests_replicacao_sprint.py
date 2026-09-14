"""O card que atravessa a virada da sprint leva TUDO consigo.

Quando uma sprint e finalizada, o trabalho pendente e replicado para a sprint
seguinte. A copia nascia perdendo coisas em silencio: nao ha erro, nao ha log —
o card simplesmente aparece do outro lado sem os links que alguem anexou.

O teste que mais importa aqui NAO e nenhum dos que conferem um campo especifico.
E o `test_nenhum_campo_novo_escapa_da_replicacao`: ele compara o modelo INTEIRO
contra o que a replicacao copia, e falha quando alguem acrescenta um campo ao
`Card` e esquece de decidir se ele atravessa a virada. Foi exatamente assim que
`links` se perdeu — o campo entrou depois da funcao de replicacao, e nada avisou.

Campos derivados ficam numa lista explicita, e a lista existe para OBRIGAR a
decisao: para sair do teste, o campo novo precisa aparecer na replicacao ou ser
declarado aqui como derivado, com o porque.
"""
import datetime as dt

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import SetorCatalogo
from apps.projects.models import (
    Card, CardAnexo, CardStatus, Project, Sprint,
)
from apps.projects.services import _replicar_card_para_sprint

User = get_user_model()

# Campos que NAO devem ser copiados, e a razao de cada um. Mexer aqui e uma
# decisao de produto, nao um detalhe: tirar um campo desta lista sem po-lo na
# replicacao faz o dado sumir na virada da sprint.
DERIVADOS = {
    # Recalculado pelo `save()` a partir do projeto novo.
    'setor',
    # `auto_now`.
    'updated_at',
    # A copia NAO esta finalizada: ela existe justamente porque o trabalho
    # continua. O signal preenche quando ela for concluida de verdade.
    'finalizado_em',
    # Metricas de tempo, derivadas de `data_inicio` -> `finalizado_em`. Como
    # `data_inicio` atravessa, o calculo na conclusao ja cobre o periodo inteiro;
    # copiar o valor antigo contaria o mesmo tempo duas vezes.
    'segundos_corridos_desenvolvimento',
    'dias_uteis_desenvolvimento',
    'minutos_uteis_desenvolvimento',
}


class ReplicacaoDeCardEntreSprintsTests(APITestCase):

    def setUp(self):
        self.admin = User.objects.create_user(
            username='admin_repl', email='admin.repl@example.com',
            password='x' * 12, role='admin', is_superuser=True, is_staff=True)
        self.dev = User.objects.create_user(
            username='dev_repl', email='dev.repl@example.com',
            password='x' * 12, role='desenvolvedor')
        self.setor = SetorCatalogo.objects.create(
            codename='setor_repl', nome='Replicacao')
        self.outro_setor = SetorCatalogo.objects.create(
            codename='setor_convidado', nome='Convidado')

        agora = timezone.now()
        self.sprint_velha = Sprint.objects.create(
            nome='Sprint que encerra', data_inicio=agora - dt.timedelta(days=10),
            fechamento_em=agora - dt.timedelta(days=1), duracao_dias=9,
            supervisor=self.admin, setor=self.setor)
        self.sprint_nova = Sprint.objects.create(
            nome='Sprint seguinte', data_inicio=agora - dt.timedelta(hours=1),
            fechamento_em=agora + dt.timedelta(days=7), duracao_dias=8,
            supervisor=self.admin, setor=self.setor)

        self.projeto_velho = Project.objects.create(
            nome='Projeto', sprint=self.sprint_velha, setor=self.setor)
        self.projeto_novo = Project.objects.create(
            nome='Projeto', sprint=self.sprint_nova, setor=self.setor)

    def _card(self, **extra):
        campos = dict(
            nome='Card que atravessa', descricao='segue na proxima sprint',
            projeto=self.projeto_velho, status=CardStatus.EM_DESENVOLVIMENTO,
            responsavel=self.dev, criado_por=self.admin,
        )
        campos.update(extra)
        return Card.objects.create(**campos)

    def _replicar(self, card):
        return _replicar_card_para_sprint(
            card, self.projeto_novo, self.sprint_velha, self.sprint_nova,
            usuario_fechamento=self.admin,
        )

    # -- o que foi relatado ----------------------------------------------

    def test_os_links_atravessam_a_virada(self):
        """O bug relatado: links anexados ao card ficavam para tras."""
        links = [
            {'url': 'https://docs.google.com/spreadsheets/d/abc', 'label': 'Planilha'},
            {'url': 'https://exemplo.com/prd.pdf', 'label': 'PRD'},
        ]
        novo = self._replicar(self._card(links=links))

        self.assertEqual(novo.links, links)

    def test_card_sem_links_atravessa_com_lista_vazia(self):
        """O caso comum: a maioria dos cards nao tem link nenhum.

        Escrevi este teste primeiro com `links=None`, imaginando linhas antigas
        anteriores ao campo. O banco recusou: `links` e `JSONField(default=list)`
        e NOT NULL, entao esse estado nao existe. O cenario real e a lista vazia.
        """
        novo = self._replicar(self._card())
        self.assertEqual(novo.links, [])

    # -- anexos ----------------------------------------------------------

    def test_os_anexos_atravessam_apontando_para_o_mesmo_arquivo(self):
        """A linha e nova; o arquivo em disco e o mesmo.

        Copiar os bytes duplicaria dezenas de megabytes a cada virada de sprint
        para um conteudo identico.
        """
        card = self._card()
        CardAnexo.objects.create(
            card=card,
            arquivo=SimpleUploadedFile('prd.txt', b'conteudo do anexo'),
            nome_original='prd.txt', tamanho=17, enviado_por=self.dev)

        novo = self._replicar(card)

        self.assertEqual(novo.anexos.count(), 1)
        copia = novo.anexos.first()
        original = card.anexos.first()
        self.assertNotEqual(copia.pk, original.pk, 'a linha deveria ser nova')
        self.assertEqual(copia.arquivo.name, original.arquivo.name,
                         'deveria apontar para o MESMO arquivo')
        self.assertEqual(copia.nome_original, 'prd.txt')
        self.assertEqual(copia.enviado_por, self.dev)

    def test_o_card_de_origem_mantem_os_anexos(self):
        """A sprint encerrada e historico; um historico sem o anexo mente."""
        card = self._card()
        CardAnexo.objects.create(
            card=card, arquivo=SimpleUploadedFile('nota.txt', b'x'),
            nome_original='nota.txt', tamanho=1)

        self._replicar(card)

        self.assertEqual(card.anexos.count(), 1)

    # -- compartilhamento por setor --------------------------------------

    def test_os_setores_compartilhados_atravessam(self):
        """Sem isto, quem via o card por compartilhamento o perde de vista na
        virada — e nao ha aviso nenhum de que deixou de enxergar."""
        card = self._card()
        card.setores_compartilhados.set([self.outro_setor])

        novo = self._replicar(card)

        self.assertEqual(
            list(novo.setores_compartilhados.values_list('codename', flat=True)),
            ['setor_convidado'])

    # -- a trava que pega o proximo campo esquecido ----------------------

    def test_nenhum_campo_novo_escapa_da_replicacao(self):
        """Compara o modelo INTEIRO contra o que a replicacao copia.

        Este e o teste que importa. Os outros conferem campos que ja sabemos que
        faltavam; este falha no dia em que alguem acrescentar um campo ao `Card`
        e nao decidir se ele atravessa a virada da sprint — que foi exatamente
        como `links` se perdeu.

        Para faze-lo passar ha dois caminhos honestos: copiar o campo na
        replicacao, ou declara-lo em `DERIVADOS` aqui em cima, com o porque.
        """
        import inspect
        import re

        from apps.projects import services

        fonte = inspect.getsource(services._replicar_card_para_sprint)
        copiados = set(re.findall(r'^\s{8}(\w+)=', fonte, re.M))
        copiados |= set(re.findall(r'update\((\w+)=', fonte))
        copiados |= set(re.findall(r'novo\.(\w+)\.set\(', fonte))

        esquecidos = []
        for campo in Card._meta.get_fields():
            if campo.auto_created and not campo.concrete:
                continue  # relacao reversa, nao e campo do card
            if not (campo.concrete or campo.many_to_many):
                continue
            if campo.name == 'id':
                continue
            if campo.name in copiados or campo.name in DERIVADOS:
                continue
            esquecidos.append(campo.name)

        self.assertEqual(
            esquecidos, [],
            'Campo(s) do Card fora da replicacao de sprint: %s. Copie em '
            '`_replicar_card_para_sprint` ou declare em DERIVADOS explicando '
            'por que nao atravessa a virada.' % ', '.join(esquecidos))

    # -- o que ja funcionava, para nao regredir --------------------------

    def test_o_essencial_do_card_continua_atravessando(self):
        card = self._card(
            descricao='texto', card_comment='comentario',
            complexidade_custom_items=[{'nome': 'x'}],
            gerar_formulario_feedback=True)

        novo = self._replicar(card)

        self.assertEqual(novo.nome, card.nome)
        self.assertEqual(novo.descricao, 'texto')
        self.assertEqual(novo.card_comment, 'comentario')
        self.assertEqual(novo.complexidade_custom_items, [{'nome': 'x'}])
        self.assertTrue(novo.gerar_formulario_feedback)
        self.assertEqual(novo.responsavel, self.dev)
        self.assertEqual(novo.projeto, self.projeto_novo)
        self.assertEqual(novo.created_at, card.created_at)
