"""Cobertura do recorte de PARTICIPAÇÃO no Geek Day.

Por que este arquivo existe: o app `geekday` não tinha nenhum `tests*.py`, e a
mudança que tira o visitante da roleta mexe justamente na fronteira mais fácil
de errar depois — a assimetria entre

  (A) ESCOLHER quem pode ser sorteado  -> recorta por `view_content`;
  (B) RESOLVER quem já foi sorteado    -> NÃO pode recortar, senão o histórico
      fica impossível de corrigir.

Quase toda tentativa de "simplificar" isto termina em um único filtro dentro de
`usuarios_do_grupo`, que quebra o (B) em silêncio: quem virou visitante depois
de ser sorteado sumiria da tela E ficaria travado como sorteado para sempre. Os
testes abaixo batem nas rotas REAIS por HTTP, então o que se afirma aqui é o que
a tela recebe.

DOIS LADOS SEMPRE. Cada regra é afirmada nas duas direções (quem entra E quem
não entra; recusa ao marcar E aceite ao desmarcar), porque um teste só do lado
negativo passa igualmente bem numa implementação que esvazia a roleta inteira.
"""
import tempfile

from django.contrib.auth.models import Permission
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.authtoken.models import Token

from apps.accounts.models import (CARGO_CHOICES_CACHE_KEY,
                                  SETOR_CHOICES_CACHE_KEY, Cargo,
                                  SetorCatalogo, User, UserSetor)
from apps.accounts.scoping import setor_primario_do_usuario

from .models import (GeekDayDraw, GeekDayGrupo, GeekDayGrupoSetor,
                     participantes_do_sorteio, usuarios_do_grupo)


class _CenarioGeekDay(TestCase):
    """Fixture comum: um grupo de Geek Day com um participante e um visitante.

    Sem testes próprios de propósito — é só o cenário que as duas classes
    abaixo compartilham (o recorte em si e o comportamento do ciclo).
    """

    def setUp(self):
        # `get_cargo_choices`/`get_setor_choices` são cacheados em memória e o
        # LocMemCache sobrevive de um teste para o outro dentro do mesmo
        # processo; sem limpar, o catálogo montado aqui não apareceria nas
        # choices (e `role_display` cairia no codename).
        cache.delete(CARGO_CHOICES_CACHE_KEY)
        cache.delete(SETOR_CHOICES_CACHE_KEY)

        self.setor_tec = self._setor('tecnologia', 'Tecnologia')
        # O setor padrão do sistema fica FORA do grupo de propósito: assim o
        # roster só depende do vínculo primário montado aqui, e ninguém entra
        # de carona pelo fallback de "cadastro incompleto".
        self._setor('sem_setor', 'Sem Setor', is_system=True)

        Cargo.objects.get_or_create(
            codename='admin', defaults={'nome': 'Administrador', 'is_system': True})
        # Permissões fixadas explicitamente (e não herdadas do seed das
        # migrations) para o cenário não depender do estado do catálogo.
        # O visitante TEM `view_geekday`: ele assiste ao ritual e vê o
        # histórico — o que ele não tem é o piso de trabalho `view_content`.
        # É o caso mais difícil de propósito: se alguém confundir as duas
        # permissões, este visitante volta para a roleta.
        self._cargo('desenvolvedor', 'Desenvolvedor', ['view_content', 'view_geekday'])
        self._cargo('visitante', 'Visitante', ['view_geekday'])

        # A gestora é `role='admin'`: a autorização dela passa pelo
        # AdminRolePermissionBackend (caminho real) e ela sai do roster pelo
        # `exclude(role='admin')`, então não polui as asserções.
        self.gestora = User.objects.create_user(
            username='gestora', password='SenhaForte!123', role='admin')
        self.dev = self._usuario('dev', 'desenvolvedor',
                                 first_name='Davi', last_name='Dev')
        self.visitante = self._usuario('visitante', 'visitante',
                                       first_name='Vera', last_name='Visita')

        self.grupo = GeekDayGrupo.objects.create(nome='Tecnologia')
        GeekDayGrupoSetor.objects.create(grupo=self.grupo, setor=self.setor_tec)

        self.token = Token.objects.create(user=self.gestora).key

    # ---- helpers ----------------------------------------------------------

    def _setor(self, codename, nome, is_system=False):
        setor, _ = SetorCatalogo.objects.get_or_create(
            codename=codename, defaults={'nome': nome, 'is_system': is_system})
        return setor

    def _cargo(self, codename, nome, permissoes):
        """Cria (ou reconfigura) um cargo. `permissoes_padrao` é fonte de
        autoridade — `CargoPermissionBackend` resolve isso a cada `has_perm`,
        então mexer aqui muda o acesso de quem tem o cargo na hora."""
        cargo, _ = Cargo.objects.get_or_create(codename=codename, defaults={'nome': nome})
        cargo.permissoes_padrao = permissoes
        cargo.save(update_fields=['permissoes_padrao'])
        # O rótulo do cargo sai de choices CACHEADAS; cargo criado no meio do
        # teste não apareceria lá sem isto.
        cache.delete(CARGO_CHOICES_CACHE_KEY)
        return cargo

    def _usuario(self, username, role, **extra):
        user = User.objects.create_user(
            username=username, password='SenhaForte!123', role=role, **extra)
        # Vínculo primário no setor do grupo: é assim que `usuarios_do_grupo`
        # decide quem pertence à roleta.
        UserSetor.objects.create(user=user, setor=self.setor_tec, is_primary=True)
        return user

    def _auth(self):
        return {'authorization': f'Token {self.token}'}

    def _rota(self, nome):
        return f'/api/geekday-draws/{nome}/?grupo={self.grupo.pk}'

    def _post(self, nome, payload=None):
        return self.client.post(self._rota(nome), payload or {}, headers=self._auth())

    def _users_status(self):
        """`{username: item}` do que a aba Sorteio receberia."""
        resp = self.client.get(self._rota('users_status'), headers=self._auth())
        self.assertEqual(resp.status_code, 200, resp.content)
        return {item['username']: item for item in resp.json()}

    def _sorteado(self, resp):
        """Id de quem saiu no sorteio, normalizado para texto.

        O JSON devolve o pk CRU (inteiro hoje; UUID se a chave do usuário mudar
        um dia), enquanto `users_status` já manda `id` como string. Comparar
        sempre como texto é o que impede este arquivo de quebrar pelo TIPO da
        chave em vez de pela regra que ele afirma.
        """
        self.assertEqual(resp.status_code, 201, resp.content)
        return str(resp.json()['usuario'])

    def _item_da_tela(self, username):
        """Item de `users_status` com mensagem em vez de KeyError: sumir da
        tela É um dos defeitos que estes testes procuram, e um KeyError cru não
        diz isso para quem for ler a falha daqui a um ano."""
        itens = self._users_status()
        self.assertIn(username, itens, f'«{username}» sumiu da aba Sorteio')
        return itens[username]

    def _historico_nomes(self):
        resp = self.client.get(self._rota('historico'), headers=self._auth())
        self.assertEqual(resp.status_code, 200, resp.content)
        return [item['usuario_name'] for item in resp.json()]

    def _sortear(self, usuario):
        """Encena o PASSADO: alguém já sorteado no ciclo em andamento.

        Gravado direto no banco (e não pela rota) porque o cenário que interessa
        é o do sorteio que aconteceu ANTES desta regra existir — a rota de hoje
        recusaria o visitante, que é justamente o que se quer ter em mãos.
        """
        return GeekDayDraw.objects.create(
            grupo=self.grupo, usuario=usuario, sorteado_por=self.gestora,
            marcado_manual=True, cycle=self.grupo.current_cycle)


class RecorteDeParticipacaoGeekDayTests(_CenarioGeekDay):
    """Quem entra na roleta, quem não entra, e o que continua sendo desfeito."""

    # ---- (A) escolher: quem participa entra, quem só assiste não -----------

    def test_participante_aparece_no_roster_e_pode_ser_sorteado(self):
        """O lado POSITIVO da regra — sem ele, uma implementação que esvazia a
        roleta inteira passaria em todos os testes de exclusão."""
        itens = self._users_status()
        self.assertIn('dev', itens)
        self.assertIs(itens['dev']['participa_do_trabalho'], True)
        self.assertIs(itens['dev']['ja_sorteado'], False)

        resp = self._post('realizar_sorteio')

        self.assertEqual(self._sorteado(resp), str(self.dev.pk))
        self.assertIs(self._users_status()['dev']['ja_sorteado'], True)

    def test_visitante_fica_fora_do_roster(self):
        """O pedido do usuário, na sua forma mais direta: quem só assiste não
        entra na lista que vira a roleta.

        As asserções sobre `usuarios_do_grupo` são a prova de que a fixture não
        está mentindo: o visitante está ATIVO e PERTENCE ao grupo (o setor
        primário dele é o do grupo). O que o tirou da roleta foi a participação,
        não um vínculo mal montado — sem isto o teste passaria até com o
        visitante fora do grupo por engano.
        """
        self.assertTrue(self.visitante.is_active)
        self.assertEqual(setor_primario_do_usuario(self.visitante), self.setor_tec)
        self.assertIn(self.visitante, usuarios_do_grupo(self.grupo))
        self.assertNotIn(self.visitante, participantes_do_sorteio(self.grupo))

        itens = self._users_status()
        self.assertIn('dev', itens)
        self.assertNotIn('visitante', itens)

    def test_sorteio_repetido_nunca_cai_em_quem_nao_participa(self):
        """A lista pode estar certa e o sorteio errado: `realizar_sorteio` tem
        a sua própria fonte de candidatos.

        Repetido de propósito — uma rodada só não distingue "filtrado" de "deu
        sorte". Com 3 visitantes para 2 participantes, uma roleta sem recorte
        cairia num visitante em ~60% das rodadas; passar 25 vezes seguidas por
        acaso tem probabilidade da ordem de 1e-10.
        """
        dev2 = self._usuario('dev2', 'desenvolvedor')
        vis2 = self._usuario('visitante2', 'visitante')
        vis3 = self._usuario('visitante3', 'visitante')
        proibidos = {str(u.pk) for u in (self.visitante, vis2, vis3)}
        elegiveis = {str(u.pk) for u in (self.dev, dev2)}

        sorteados = set()
        for rodada in range(25):
            # Zera a fila a cada rodada para que TODA rodada seja um sorteio de
            # verdade (sem isto, a segunda já bateria em "todos foram sorteados").
            GeekDayDraw.objects.filter(grupo=self.grupo).delete()
            escolhido = self._sorteado(self._post('realizar_sorteio'))
            self.assertNotIn(
                escolhido, proibidos,
                f'rodada {rodada}: a roleta sorteou quem não participa do trabalho')
            sorteados.add(escolhido)

        # O contrapeso: a roleta continua VARIANDO entre os elegíveis. Um
        # recorte largo demais (que deixasse um só participante de pé) passaria
        # na asserção acima e cairia aqui.
        self.assertEqual(sorteados, elegiveis)

    def test_marcar_visitante_e_recusado_com_erro_proprio(self):
        """Marcar é ação NOVA, então recorta. E o erro precisa ser diferente do
        404 de "não é deste grupo": são dois problemas distintos."""
        resp = self._post('marcar_como_sorteado', {'usuario_id': str(self.visitante.pk)})

        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertIn('não participa do sorteio', resp.json()['detail'])
        self.assertEqual(GeekDayDraw.objects.filter(usuario=self.visitante).count(), 0)

    def test_marcar_participante_continua_funcionando(self):
        """O outro lado do anterior: a recusa não pode ter virado regra geral."""
        resp = self._post('marcar_como_sorteado', {'usuario_id': str(self.dev.pk)})

        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(
            GeekDayDraw.objects.filter(usuario=self.dev, marcado_manual=True).count(), 1)

    def test_payload_declara_participacao(self):
        """A tela não pode ter de adivinhar por CARGO quem entra na roleta —
        o campo vem pronto do backend, e o serializer precisa declará-lo (chave
        não declarada é descartada em silêncio)."""
        self.assertIs(self._users_status()['dev']['participa_do_trabalho'], True)

    # ---- o corte é por PERMISSÃO, nunca por nome de cargo ------------------

    def test_recorte_e_por_permissao_e_nao_por_nome_de_cargo(self):
        """A prova de que um cargo criado amanhã se resolve sozinho.

        O cargo continua se chamando 'visitante'; o que muda é a PERMISSÃO
        individual. Se alguém trocar o critério por `role == 'visitante'`, este
        teste cai — nas duas pontas, porque `users_status` e `realizar_sorteio`
        têm CADA UM a sua fonte de candidatos e podem divergir.
        """
        self.visitante.user_permissions.add(Permission.objects.get(
            codename='view_content', content_type__app_label='accounts'))

        itens = self._users_status()
        self.assertIn('visitante', itens)
        self.assertIs(itens['visitante']['participa_do_trabalho'], True)

        # Estar na lista não é ser sorteável. Com o dev fora da fila ele é o
        # único candidato: um recorte por nome de cargo devolveria 400 aqui e
        # passaria batido nas asserções acima.
        self._sortear(self.dev)
        resp = self._post('realizar_sorteio')

        self.assertEqual(self._sorteado(resp), str(self.visitante.pk))

    def test_cargo_novo_entra_ou_sai_pelo_que_ele_CONCEDE(self):
        """Dois cargos que não existiam quando este código foi escrito, com
        nomes que ninguém poderia ter previsto: o que dá `view_content` entra e
        PODE ser sorteado; o que só dá `view_geekday` (assistir) não aparece.

        É a exigência do projeto verificada nas duas direções — cargo novo tem
        de se resolver sozinho, sem ninguém tocar em código.
        """
        self._cargo('embaixador_do_cafe', 'Embaixador do Café', ['view_content'])
        self._cargo('platanista_de_ferias', 'Platanista de Férias', ['view_geekday'])
        trabalha = self._usuario('cafe', 'embaixador_do_cafe')
        so_assiste = self._usuario('platano', 'platanista_de_ferias')

        itens = self._users_status()
        self.assertIn('cafe', itens)
        self.assertIs(itens['cafe']['participa_do_trabalho'], True)
        self.assertNotIn('platano', itens)

        # Aparecer na lista não basta: ele tem de ser sorteável de fato. Com o
        # dev fora da fila, o cargo novo é o único candidato.
        self._sortear(self.dev)
        resp = self._post('realizar_sorteio')

        self.assertEqual(self._sorteado(resp), str(trabalha.pk))

        # E o par obrigatório disto: com o dev e o «cafe» já sorteados, a fila
        # tem de estar FECHADA. Se o critério fosse o NOME do cargo (excluir
        # 'visitante'), o «platanista» seria candidato — ou sairia no sorteio
        # acima, ou apareceria aqui como disponível e no denominador. É a
        # asserção que fecha a porta para um recorte por nome, que a lista
        # sozinha não fecha (`users_status` e `realizar_sorteio` têm fontes
        # de candidatos independentes).
        fechada = self._post('realizar_sorteio')

        self.assertEqual(fechada.status_code, 400, fechada.content)
        self.assertEqual(fechada.json()['total_usuarios'], 2)
        self.assertEqual(fechada.json()['usuarios_disponiveis'], 0)
        self.assertEqual(GeekDayDraw.objects.filter(usuario=so_assiste).count(), 0)

    # ---- (B) resolver o passado: nada pode sumir --------------------------

    def test_visitante_ja_sorteado_continua_na_lista_para_ser_desfeito(self):
        """O card só existe se a pessoa vier nesta resposta — e arrastá-lo de
        volta é o ÚNICO gatilho de desmarcar na tela. Recortar sem exceção aqui
        tiraria do gestor a capacidade de corrigir o ciclo."""
        self._sortear(self.visitante)

        item = self._users_status().get('visitante')

        self.assertIsNotNone(item, 'quem já foi sorteado no ciclo não pode sumir da tela')
        self.assertIs(item['ja_sorteado'], True)
        self.assertIs(item['participa_do_trabalho'], False)

    def test_desmarcar_visitante_continua_funcionando(self):
        """Desfazer o passado NÃO recorta: o sorteio já aconteceu."""
        draw = self._sortear(self.visitante)

        resp = self._post('desmarcar_como_sorteado', {'usuario_id': str(self.visitante.pk)})

        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertFalse(GeekDayDraw.objects.filter(pk=draw.pk).exists())

    def test_desfeito_o_sorteio_o_visitante_sai_da_lista(self):
        """A outra metade do anterior: ele estava lá pelo sorteio, não por
        participar. Sem o sorteio, não volta para a fila."""
        self._sortear(self.visitante)
        self._post('desmarcar_como_sorteado', {'usuario_id': str(self.visitante.pk)})

        self.assertNotIn('visitante', self._users_status())

    def test_historico_preserva_o_nome_de_quem_nao_participa(self):
        """O histórico nasce da FK do sorteio, não do roster: quem apresentou
        ontem continua nomeado hoje, tenha virado visitante ou não."""
        self._sortear(self.visitante)

        nomes = self._historico_nomes()

        self.assertIn('Vera Visita', nomes)

    # MEDIA_ROOT temporário: o teste GRAVA um arquivo, e sem isto ele sujaria a
    # pasta de mídia real do desenvolvedor a cada rodada.
    @override_settings(MEDIA_ROOT=tempfile.mkdtemp())
    def test_historico_preserva_tambem_a_FOTO_de_quem_nao_participa(self):
        """Não basta o nome: a linha do histórico mostra o AVATAR, e ele sai do
        mesmo `obj.usuario`. Resolver a foto pelo roster (em vez da FK) deixaria
        o histórico com nome e sem rosto, que é uma regressão que passa
        despercebida num teste que só olha texto."""
        png = (b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00'
               b'\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\n'
               b'IDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00'
               b'\x00IEND\xaeB`\x82')
        self.visitante.profile_picture = SimpleUploadedFile(
            'vera.png', png, content_type='image/png')
        self.visitante.save(update_fields=['profile_picture'])
        self._sortear(self.visitante)

        resp = self.client.get(self._rota('historico'), headers=self._auth())
        self.assertEqual(resp.status_code, 200, resp.content)
        linha = resp.json()[0]

        self.assertEqual(linha['usuario_name'], 'Vera Visita')
        self.assertTrue(linha['usuario_profile_picture'],
                        'o histórico perdeu o rosto de quem já apresentou')

    # ---- quem PERDEU a participação DEPOIS de ser sorteado -----------------
    #
    # Os dois testes abaixo são o coração do requisito: o sorteio antigo
    # continua tendo acontecido. Diferem no CAMINHO da perda — trocar o cargo
    # da pessoa e esvaziar as permissões do cargo são os dois jeitos reais de
    # alguém deixar de participar, e passam por consultas diferentes
    # (`Q(role__in=cargos_que_concedem(...))` só cobre o segundo).

    def test_historico_preserva_o_nome_de_quem_virou_visitante_depois(self):
        """Sorteado ONTEM como desenvolvedor, visitante HOJE. O nome dele tem
        de continuar no histórico — e o sorteio, na contagem do ciclo."""
        self.assertEqual(
            self._post('marcar_como_sorteado', {'usuario_id': str(self.dev.pk)}).status_code,
            201)

        self.dev.role = 'visitante'
        self.dev.save(update_fields=['role'])

        self.assertIn('Davi Dev', self._historico_nomes())

        item = self._item_da_tela('dev')
        self.assertIs(item['ja_sorteado'], True, 'o passado dele não pode ser esquecido')
        self.assertIs(item['participa_do_trabalho'], False)
        self.assertEqual(item['total_sorteios'], 1)

        # E o outro lado, na mesma pessoa: ação NOVA é recusada.
        resp = self._post('marcar_como_sorteado', {'usuario_id': str(self.dev.pk)})
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertIn('não participa do sorteio', resp.json()['detail'])

    def test_desmarcar_funciona_depois_que_o_CARGO_perdeu_view_content(self):
        """Ninguém mexeu no usuário: o CARGO dele deixou de dar `view_content`.

        Este é o caminho que trava de verdade se `_usuario_do_grupo` for
        recortado por participação — o gestor perderia o único jeito de
        corrigir o ciclo pela tela.
        """
        self.assertEqual(
            self._post('marcar_como_sorteado', {'usuario_id': str(self.dev.pk)}).status_code,
            201)

        self._cargo('desenvolvedor', 'Desenvolvedor', ['view_geekday'])

        item = self._item_da_tela('dev')
        self.assertIs(item['ja_sorteado'], True)
        self.assertIs(item['participa_do_trabalho'], False)

        resp = self._post('desmarcar_como_sorteado', {'usuario_id': str(self.dev.pk)})

        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(GeekDayDraw.objects.filter(usuario=self.dev).count(), 0)

    # ---- a terceira porta: o CRUD cru do ModelViewSet ---------------------
    #
    # `marcar_como_sorteado` não é o único jeito de GRAVAR um sorteio pela API:
    # o `GeekDayDrawViewSet` é um ModelViewSet e expõe `POST /geekday-draws/`
    # com `usuario` gravável. A tela não usa essa rota, mas ela existe e passa
    # com `manage_geekday` — recortar só a @action deixaria a regra valendo
    # para a tela e não para a API.

    def test_crud_cru_nao_grava_sorteio_de_quem_nao_participa(self):
        """A porta dos fundos: criar o sorteio direto no ModelViewSet, com o id
        do visitante no corpo. Tem de ser recusado pelo MESMO motivo (e com a
        mesma explicação) de `marcar_como_sorteado`."""
        resp = self.client.post('/api/geekday-draws/',
                                {'usuario': self.visitante.pk, 'grupo': self.grupo.pk},
                                headers=self._auth())

        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertIn('não participa do sorteio', str(resp.json()))
        self.assertEqual(GeekDayDraw.objects.filter(usuario=self.visitante).count(), 0)

        # E a mesma porta pelo outro lado: TROCAR o dono de um sorteio já
        # gravado para o visitante é escolha nova disfarçada de correção.
        draw = self._sortear(self.dev)
        troca = self.client.patch(
            f'/api/geekday-draws/{draw.pk}/?grupo={self.grupo.pk}',
            {'usuario': self.visitante.pk}, content_type='application/json',
            headers=self._auth())

        self.assertEqual(troca.status_code, 400, troca.content)
        draw.refresh_from_db()
        self.assertEqual(draw.usuario_id, self.dev.pk)

    def test_crud_cru_continua_gravando_sorteio_de_quem_participa(self):
        """O lado positivo: a recusa acima não pode ter fechado a rota inteira."""
        resp = self.client.post('/api/geekday-draws/',
                                {'usuario': self.dev.pk, 'grupo': self.grupo.pk},
                                headers=self._auth())

        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(GeekDayDraw.objects.filter(usuario=self.dev).count(), 1)

    def test_crud_cru_continua_editando_e_apagando_o_sorteio_do_passado(self):
        """A mesma assimetria de sempre, agora na rota CRUD: o sorteio JÁ
        gravado de quem não participa continua editável (anotar a data da
        apresentação que aconteceu) e apagável (desfazer). Só ESCOLHER é que
        recorta."""
        draw = self._sortear(self.visitante)
        # `?grupo=` porque o queryset do detalhe é filtrado pelo grupo da
        # requisição, e a gestora não tem setor neste cenário (o grupo dela
        # seria o do setor padrão).
        detalhe = f'/api/geekday-draws/{draw.pk}/?grupo={self.grupo.pk}'

        edicao = self.client.patch(detalhe, {'observacoes': 'apresentou em 2024'},
                                   content_type='application/json',
                                   headers=self._auth())
        self.assertEqual(edicao.status_code, 200, edicao.content)

        # E o PUT que REENVIA o mesmo `usuario` também passa: é o passado sendo
        # preservado, não uma escolha nova.
        reenvio = self.client.put(detalhe,
                                  {'usuario': self.visitante.pk, 'grupo': self.grupo.pk,
                                   'observacoes': 'apresentou em 2024'},
                                  content_type='application/json',
                                  headers=self._auth())
        self.assertEqual(reenvio.status_code, 200, reenvio.content)

        remocao = self.client.delete(detalhe, headers=self._auth())
        self.assertEqual(remocao.status_code, 204, remocao.content)
        self.assertFalse(GeekDayDraw.objects.filter(pk=draw.pk).exists())

    def test_marcar_alguem_de_outro_grupo_continua_404(self):
        """A trava de "não escreva na fila alheia" não pode ter sido perdida no
        meio do recorte de participação."""
        outro_setor = self._setor('financeiro', 'Financeiro')
        outro_grupo = GeekDayGrupo.objects.create(nome='Financeiro')
        GeekDayGrupoSetor.objects.create(grupo=outro_grupo, setor=outro_setor)

        resp = self.client.post(
            f'/api/geekday-draws/marcar_como_sorteado/?grupo={outro_grupo.pk}',
            {'usuario_id': str(self.dev.pk)}, headers=self._auth())

        self.assertEqual(resp.status_code, 404, resp.content)


class CicloEmAndamentoGeekDayTests(_CenarioGeekDay):
    """O que acontece com um ciclo JÁ EM ANDAMENTO no instante em que esta
    regra sobe.

    O roster encolhe, e é o roster que decide quando a fila fecha. As perguntas
    que estes testes respondem são: o ciclo ainda FECHA? Ele fecha CEDO DEMAIS?
    E existe algum estado impossível (sorteados > total) enquanto isso?
    """

    def test_o_ciclo_fecha_quando_os_participantes_acabam(self):
        """Sai gente do denominador, mas a MESMA gente sai dos pendentes —
        então o ciclo continua fechando, e fecha certo."""
        self._usuario('dev2', 'desenvolvedor')

        self.assertEqual(self._post('realizar_sorteio').status_code, 201)
        self.assertEqual(self._post('realizar_sorteio').status_code, 201)
        resp = self._post('realizar_sorteio')

        self.assertEqual(resp.status_code, 400, resp.content)
        corpo = resp.json()
        self.assertEqual(corpo['detail'], 'Todos os usuários já foram sorteados.')
        self.assertEqual(corpo['total_usuarios'], 2)
        self.assertEqual(corpo['usuarios_sorteados'], 2)
        self.assertEqual(corpo['usuarios_disponiveis'], 0)
        # O visitante nunca segurou o ciclo aberto nem entrou nele.
        self.assertEqual(GeekDayDraw.objects.filter(usuario=self.visitante).count(), 0)

    def test_ciclo_com_visitante_ja_sorteado_nao_entra_em_estado_impossivel(self):
        """O cenário exato do deploy: o visitante foi sorteado ANTES da regra.

        O sorteio dele continua de pé (ninguém apaga histórico), mas ele não
        conta no denominador — e é essa mistura que produzia
        "sorteados: 2 de um total de 1".
        """
        self._sortear(self.visitante)

        self.assertEqual(self._post('realizar_sorteio').status_code, 201)  # sobra o dev
        resp = self._post('realizar_sorteio')

        self.assertEqual(resp.status_code, 400, resp.content)
        corpo = resp.json()
        self.assertEqual(corpo['total_usuarios'], 1)
        self.assertEqual(corpo['usuarios_sorteados'], 1)
        self.assertLessEqual(corpo['usuarios_sorteados'], corpo['total_usuarios'])
        self.assertEqual(
            GeekDayDraw.objects.filter(usuario=self.visitante,
                                       cycle=self.grupo.current_cycle).count(), 1,
            'o sorteio antigo do visitante não pode ser apagado pela mudança')

    def test_ciclo_ja_nasce_fechado_quando_so_faltavam_visitantes(self):
        """A borda que vale avisar ao gestor: se os únicos pendentes eram
        visitantes, no instante do deploy a fila já está fechada — sem ninguém
        ter sorteado nada desde ontem. É correto, e é surpreendente."""
        self._sortear(self.dev)  # o único participante já tinha ido

        resp = self._post('realizar_sorteio')

        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertEqual(resp.json()['usuarios_disponiveis'], 0)
        self.assertIs(self._users_status()['dev']['ja_sorteado'], True)
        self.assertNotIn('visitante', self._users_status())

    def test_reset_reabre_a_fila_sem_apagar_o_historico(self):
        """A saída oferecida pela tela nessa borda. Depois do reset: o
        participante volta para a fila, o visitante NÃO volta (ele estava lá
        pelo sorteio, não por participar) e o histórico dos dois continua."""
        self._sortear(self.visitante)
        self._sortear(self.dev)
        self.assertEqual(self._post('realizar_sorteio').status_code, 400)

        resp = self._post('resetar_sorteios')

        self.assertEqual(resp.status_code, 200, resp.content)
        self.grupo.refresh_from_db()
        self.assertEqual(resp.json()['cycle'], self.grupo.current_cycle)

        itens = self._users_status()
        self.assertIs(itens['dev']['ja_sorteado'], False)
        self.assertNotIn('visitante', itens)

        nomes = self._historico_nomes()
        self.assertIn('Vera Visita', nomes)
        self.assertIn('Davi Dev', nomes)

        novo = self._post('realizar_sorteio')
        self.assertEqual(self._sorteado(novo), str(self.dev.pk))
        self.assertEqual(novo.json()['cycle'], self.grupo.current_cycle)

    def test_reset_nao_ressuscita_o_visitante_como_sorteavel(self):
        """Ciclo novo não é anistia: o critério continua sendo participar."""
        self._sortear(self.visitante)
        self._post('resetar_sorteios')
        self.grupo.refresh_from_db()

        for _ in range(10):
            # Só a fila do ciclo NOVO é zerada — o sorteio do visitante, que
            # ficou no ciclo anterior, permanece no banco durante toda a rodada.
            GeekDayDraw.objects.filter(grupo=self.grupo,
                                       cycle=self.grupo.current_cycle).delete()
            self.assertEqual(self._sorteado(self._post('realizar_sorteio')),
                             str(self.dev.pk))

    def test_sorteio_de_CICLO_ANTIGO_atravessa_varios_resets(self):
        """O caso de verdade é o do sorteio VELHO: apresentou em março, virou
        visitante em agosto, e no meio o grupo resetou a fila várias vezes.

        Os outros testes de histórico olham o ciclo CORRENTE, onde a pessoa
        ainda aparece em `users_status` — ou seja, passariam mesmo numa
        implementação que só preservasse o ciclo aberto. Aqui ela já não está
        na tela do sorteio, e o nome tem de continuar no histórico assim mesmo.
        """
        marco = self._sortear(self.dev)
        GeekDayDraw.objects.filter(pk=marco.pk).update(cycle=1)
        for _ in range(3):
            self.assertEqual(self._post('resetar_sorteios').status_code, 200)
        self.dev.role = 'visitante'
        self.dev.save(update_fields=['role'])

        linhas = self.client.get(self._rota('historico'), headers=self._auth()).json()
        antigas = [linha for linha in linhas if linha['cycle'] == 1]

        self.assertEqual(len(antigas), 1, linhas)
        self.assertEqual(antigas[0]['usuario_name'], 'Davi Dev')
        self.assertEqual(str(antigas[0]['usuario']), str(self.dev.pk))
        # E o ciclo NOVO não o herda de volta: histórico não é fila.
        self.assertNotIn('dev', self._users_status())

