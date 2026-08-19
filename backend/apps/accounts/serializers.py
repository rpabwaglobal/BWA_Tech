import re
import secrets
import string
import unicodedata

from django.core.cache import cache
from django.utils.text import slugify
from rest_framework import serializers
from .models import (
    User, Role, Cargo, SetorCatalogo, UserSetor,
    CARGO_CHOICES_CACHE_KEY, SETOR_CHOICES_CACHE_KEY,
)
from .permission_catalog import PERMISSION_CATALOG
from .permissions import ids_que_participam_do_trabalho, permissoes_por_usuario
from .profile_picture_utils import get_profile_picture_url
from .image_processing import process_profile_picture
from .scoping import SETOR_PADRAO_CODENAME, setor_padrao_do_sistema


def _setor_padrao_estrito():
    """O balde de NÃO CLASSIFICADOS ("Sem Setor"), resolvido SÓ pelo codename
    semeado em accounts/0016.

    Não reusa `setor_padrao_do_sistema()` de propósito: aquela função cai em "o
    primeiro setor do catálogo" quando o padrão não existe, fallback correto
    para não deixar conteúdo órfão sem dono e perigoso aqui, porque esta regra
    APAGA e CRIA vínculo de usuário. Com o fallback, um banco sem "Sem Setor"
    faria a regra expulsar gente do primeiro setor da lista — ou empurrar
    alguém para dentro dele, entregando de brinde o conteúdo daquele setor.
    Sem o balde de verdade, a regra simplesmente não roda.
    """
    return SetorCatalogo.objects.filter(codename=SETOR_PADRAO_CODENAME).first()


def _espelhar_setor_primario_no_charfield(user):
    """Reescreve `User.setor` a partir do vínculo primário atual.

    Só é chamado depois que a regra do setor padrão MEXEU nos vínculos. Fora
    disso o CharField pode estar vazio de propósito (o operador acabou de
    limpar o setor primário) e reescrevê-lo desfaria a decisão dele.
    """
    primario = (UserSetor.objects.filter(user=user, is_primary=True)
                .select_related('setor').first())
    codename = primario.setor.codename if primario else ''
    if (user.setor or '') != codename:
        user.setor = codename
        user.save(update_fields=['setor', 'updated_at'])


def aplicar_regra_do_setor_padrao(user, operador=None):
    """Mantém o invariante do balde de não classificados. Duas metades da mesma
    regra, porque as duas descrevem o mesmo estado proibido:

    1. quem passa a ter QUALQUER setor de verdade SAI do padrão. Estar nos dois
       é contraditório por definição — "Sem Setor" é onde mora o que ainda não
       foi classificado — e, com `SETOR_SCOPING_ENABLED` ligado, o vínculo
       residual entregaria a essa pessoa todo o conteúdo não classificado da
       empresa (ver scoping.setores_ids_do_usuario: os setores do usuário são
       somados, nunca interseccionados).
    2. ninguém fica com ZERO setores. O escopo é fail-closed (`qs.none()` quando
       não há setor), então um usuário sem vínculo nenhum abre a plataforma
       vazia — estado que quem opera lê como defeito do sistema, não como
       decisão de quem removeu o último setor. Sem setor real, o lugar dele é o
       balde, que é reversível e visível na tela.

    Ponto ÚNICO de aplicação: chamada no fim de `sincronizar_setor_primario`
    (por onde passam o PATCH do usuário, o `bulk-assign-setor` e o cadastro) e
    na remoção de setor (`UserViewSet.remover_setor`). Idempotente e barata —
    pode ser chamada depois de qualquer escrita em `UserSetor` sem checagem
    prévia do chamador.

    Devolve True se mexeu em algum vínculo (usado só internamente, para decidir
    se o espelho do CharField precisa ser reescrito).
    """
    padrao = _setor_padrao_estrito()
    if padrao is None:
        return False
    if not getattr(operador, 'is_authenticated', False):
        operador = None  # `added_by` é FK: anônimo/None não tem quem registrar

    vinculos = list(UserSetor.objects.filter(user=user))
    reais = [v for v in vinculos if v.setor_id != padrao.pk]
    no_padrao = [v for v in vinculos if v.setor_id == padrao.pk]
    mexeu = False

    if reais and no_padrao:
        # (1) Ganhou setor de verdade → sai do balde.
        perdeu_primario = any(v.is_primary for v in no_padrao)
        UserSetor.objects.filter(user=user, setor=padrao).delete()
        mexeu = True
        # Se o vínculo apagado era o primário, alguém precisa assumir; senão o
        # usuário ficaria com setores e nenhum principal, e o CharField (que é
        # o que a tela mostra) esvaziaria sem motivo. O mais antigo assume, o
        # mesmo critério que `remover_setor` já usa.
        if perdeu_primario and not any(v.is_primary for v in reais):
            proximo = UserSetor.objects.filter(user=user).order_by('added_at').first()
            if proximo is not None:
                proximo.is_primary = True
                proximo.save(update_fields=['is_primary'])
    elif not vinculos:
        # (2) Ficou sem setor nenhum → volta para o balde. NÃO existe branch
        # para "só tem o padrão": aí ele CONTINUA no padrão, que é justamente o
        # estado correto de quem não tem setor de verdade.
        UserSetor.objects.create(
            user=user, setor=padrao, is_primary=True, added_by=operador)
        mexeu = True

    if mexeu:
        _espelhar_setor_primario_no_charfield(user)
    return mexeu


def sincronizar_setor_primario(user, setor_obj, operador=None):
    """Marca `setor_obj` como vínculo primário do usuário no M2M `UserSetor` —
    a autoridade do escopo, que o CharField `User.setor` apenas espelha.

    `setor_obj=None` REMOVE o usuário de todos os setores. Antes só zerava a
    marca de primário e preservava os vínculos, e o resultado era um estado que
    ninguém conseguia ler: a tela mostrava "sem setor definido" (ela lê o
    CharField) enquanto `UserSetor` — a autoridade do escopo — continuava
    dizendo que a pessoa era de Tecnologia. Quem limpa o campo está dizendo
    "esta pessoa não é de setor nenhum"; obedecer pela metade é pior que
    recusar. A regra do balde, logo abaixo, devolve a pessoa para "Sem Setor",
    que é reversível e visível na tela — ninguém fica com zero vínculos.

    Nos dois caminhos termina em `aplicar_regra_do_setor_padrao`: é aqui que
    passam TODAS as portas de atribuição de setor (PATCH do usuário, criação
    pela gestão, `bulk-assign-setor` e cadastro público), então é aqui que a
    regra do balde de não classificados vale para todas elas de uma vez."""
    if not getattr(operador, 'is_authenticated', False):
        operador = None  # `added_by` é FK: anônimo/None não tem quem registrar
    if setor_obj is None:
        UserSetor.objects.filter(user=user).delete()
    else:
        vinculo, created = UserSetor.objects.get_or_create(
            user=user, setor=setor_obj,
            defaults={'is_primary': True, 'added_by': operador})
        if not created and not vinculo.is_primary:
            vinculo.is_primary = True
            vinculo.save(update_fields=['is_primary'])
        UserSetor.objects.filter(user=user, is_primary=True).exclude(setor=setor_obj).update(is_primary=False)
    aplicar_regra_do_setor_padrao(user, operador=operador)


class UserSerializer(serializers.ModelSerializer):
    role_display = serializers.CharField(source='get_role_display', read_only=True)
    setor_display = serializers.CharField(source='get_setor_display', read_only=True)
    setores = serializers.SerializerMethodField(read_only=True)
    profile_picture_url = serializers.SerializerMethodField(read_only=True)
    permissions = serializers.SerializerMethodField(read_only=True)
    participa_do_trabalho = serializers.SerializerMethodField(read_only=True)

    def get_profile_picture_url(self, obj):
        return get_profile_picture_url(obj, request=self.context.get('request'))

    def get_setores(self, obj):
        """TODOS os setores do usuário, não só o primário.

        `setor`/`setor_display` contam UM setor; quem está em Tecnologia e
        Comercial aparecia como sendo só de um deles. Este campo SOMA aos dois
        (não os substitui — são consumidos em várias telas) e carrega o que a
        tag precisa desenhar, no mesmo formato de `SetorBasico`
        (frontend/src/services/setorSharingService.ts), para a tela reaproveitar
        o chip que já existe em vez de inventar outro.

        Lê `setor_links` (a tabela de vínculo) em vez de `setores` (o M2M) para
        trazer `is_primary` junto, sem uma segunda consulta por usuário.

        `.all()` sem `filter`/`order_by` é deliberado: qualquer cláusula aqui
        descarta o `prefetch_related('setor_links__setor')` dos viewsets e a
        listagem (50 por página) volta a fazer uma consulta por usuário. A
        ordenação — primário na frente, depois alfabética — é feita em Python,
        sobre a lista que o prefetch já trouxe.
        """
        vinculos = sorted(
            obj.setor_links.all(),
            key=lambda v: (not v.is_primary, (v.setor.nome or '').lower()),
        )
        return [
            {
                'codename': v.setor.codename,
                'nome': v.setor.nome,
                'cor': v.setor.cor,
                'label_curto': v.setor.label_curto,
                'is_primary': v.is_primary,
            }
            for v in vinculos
        ]

    def get_permissions(self, obj):
        """Permissões só são visíveis para quem as gerencia e para o PRÓPRIO
        usuário (o frontend monta Sidebar/rotas com elas). Para os demais,
        lista vazia — usuário comum não enxerga as permissões dos colegas.

        Resolve por `has_perm`, não pela tabela `user_permissions`: um usuário
        com cargo Admin recebe o catálogo inteiro pelo backend de autenticação
        (accounts/auth_backends.py) sem ter linha nenhuma em user_permissions.
        Ler direto da tabela devolveria `[]` e esconderia a interface toda de
        um administrador legítimo."""
        request = self.context.get('request')
        viewer = getattr(request, 'user', None)
        pode_ver = viewer is not None and (
            getattr(viewer, 'is_superuser', False)
            or viewer.has_perm('accounts.manage_user_permissions')
            or viewer.has_perm('accounts.manage_users')
            or viewer.pk == obj.pk
        )
        if not pode_ver:
            return []

        # RESOLVE A PÁGINA INTEIRA DE UMA VEZ, e não usuário por usuário.
        #
        # O laço `has_perm` por linha custava uma carga de permissões por
        # usuário: medido em `/api/users/` com 15 usuários vistos por uma conta
        # que gerencia usuários, 49 consultas e ~616 ms. E como a tela do projeto
        # espera as quatro chamadas dela em `Promise.all`, esse número era o PISO
        # do carregamento — inclusive num projeto sem card nenhum.
        #
        # `permissoes_por_usuario` reproduz os três backends de autorização e é
        # comparada com `has_perm` em `tests_permissoes_massa`, usuário por
        # usuário: desempenho aqui não pode custar exatidão, porque o que esta
        # lista descreve é o mapa de poderes de cada pessoa.
        mapa = self._mapa_de_permissoes()
        if mapa is not None:
            return mapa.get(obj.pk, [])

        # Sem como descobrir o conjunto sendo serializado (uso avulso do
        # serializer), volta ao caminho por linha — correto, só mais caro.
        return sorted(
            codename for codename, _label, _area in PERMISSION_CATALOG
            if obj.has_perm(f'accounts.{codename}')
        )

    def _mapa_de_permissoes(self):
        """`{user_id: [codenames]}` de todos os usuários desta serialização.

        Em `many=True` o DRF cria UM serializer filho para a lista inteira, e é
        o pai (`ListSerializer`) que guarda a queryset — daí a busca por
        `self.parent.instance`. O resultado fica no próprio serializer, então a
        resolução acontece uma vez por resposta.
        """
        if hasattr(self, '_cache_mapa_permissoes'):
            return self._cache_mapa_permissoes

        origem = self.parent.instance if self.parent is not None else self.instance
        if origem is None:
            self._cache_mapa_permissoes = None
            return None

        usuarios = list(origem) if hasattr(origem, '__iter__') else [origem]
        self._cache_mapa_permissoes = permissoes_por_usuario(usuarios)
        return self._cache_mapa_permissoes

    def get_participa_do_trabalho(self, obj):
        """Esta pessoa enxerga sprint/projeto/card? (isto é: tem `view_content`)

        POR QUE precisa ser um campo do usuário, e não uma leitura de
        `permissions`: as telas de Dashboard e Métricas baixam a lista inteira
        (`userService.getAll()`) e cruzam com os cards no cliente para montar
        "quem está sem card". Só que `permissions` vem `[]` para quem não
        gerencia usuários — um desenvolvedor comum recebe lista vazia de TODOS
        os colegas —, então o frontend não tem como decidir sozinho quem
        participa do trabalho. Sem este campo, a única saída seria voltar a
        comparar nome de cargo no cliente, que é justamente o que a plataforma
        abandonou (cargo é dado de catálogo; autorização é permissão).

        POR QUE é visível para TODO MUNDO, diferente de `permissions`: o que ele
        revela é "esta pessoa participa do trabalho", não O QUE ela pode fazer.
        É a mesma informação que qualquer um já deduz ao ver a pessoa com cards
        no kanban — não expõe capacidade administrativa, nem permite inferir
        quem pode excluir projeto ou gerenciar usuários. `permissions` continua
        restrito porque ali sim está o mapa de poderes de cada um.

        Sobre o N+1: `has_perm` por linha custaria uma consulta por usuário (a
        listagem pagina 50), então o conjunto é resolvido UMA vez e guardado na
        instância do serializer. Com `many=True` o DRF reaproveita a MESMA
        instância-filha para todos os itens da página (`ListSerializer.child`),
        de modo que o cache atende a página inteira: uma consulta a mais na
        resposta, e não uma por usuário.

        Conta desativada responde False, porque `has_perm` de conta desativada é
        False para tudo — o campo não pode discordar do gate.
        """
        return obj.pk in self._ids_participantes()

    def _ids_participantes(self):
        """Cache por serialização (ver o `get_participa_do_trabalho`).

        Guardado no `__dict__` da instância — nunca em módulo: quem acabou de
        ganhar um cargo com `view_content` tem que aparecer certo já na próxima
        resposta, e um cache de processo só cairia no próximo restart.
        """
        ids = self.__dict__.get('_cache_ids_participantes')
        if ids is None:
            ids = ids_que_participam_do_trabalho()
            self.__dict__['_cache_ids_participantes'] = ids
        return ids

    def validate_setor(self, value):
        """Só admin/supervisor podem alterar o setor de um usuário, e nunca o
        próprio (setor é atribuído por quem gerencia, não autoatribuído).
        O valor precisa existir no catálogo (SetorCatalogo) — vazio é
        permitido (= sem setor definido)."""
        request = self.context.get('request')
        if not request:
            return value
        if not request.user.has_perm('accounts.manage_users'):
            raise serializers.ValidationError(
                'Você não tem permissão para alterar o setor de um usuário.'
            )
        if self.instance and self.instance.pk == request.user.pk:
            raise serializers.ValidationError('Você não pode alterar o próprio setor.')
        if value and not SetorCatalogo.objects.filter(codename=value).exists():
            raise serializers.ValidationError('Setor inválido.')
        # Mover para o balde de não classificados alguém que JÁ tem setor real é
        # um pedido que `aplicar_regra_do_setor_padrao` desfaz logo em seguida
        # (a regra "quem tem setor de verdade sai do padrão" é o invariante).
        # Sem esta recusa, a API respondia 200 e o vínculo voltava ao que era:
        # quem opera clicava, via sucesso, e nada acontecia. Recusar com o
        # motivo é o mínimo — um write silenciosamente ignorado é pior que um
        # erro, porque só aparece quando alguém confere.
        if value == SETOR_PADRAO_CODENAME and self.instance is not None:
            reais = self.instance.setores.exclude(codename=SETOR_PADRAO_CODENAME)
            if reais.exists():
                nomes = ', '.join(reais.values_list('nome', flat=True))
                raise serializers.ValidationError(
                    f'Este usuário já pertence a {nomes}. "Sem Setor" é onde fica quem '
                    'ainda não foi classificado — remova os setores atuais para que ele '
                    'volte para lá.'
                )
        return value

    def validate_role(self, value):
        """O cargo precisa existir no catálogo, e só quem gerencia usuários
        pode atribuí-lo.

        Mexer num usuário que é Admin fica restrito a outro Admin: caso
        contrário, quem tivesse `manage_users` poderia rebaixar todos os
        administradores e travar a plataforma."""
        request = self.context.get('request')
        if not request:
            return value

        user = request.user
        current_role = self.instance.role if self.instance else None

        if not Cargo.objects.filter(codename=value).exists():
            raise serializers.ValidationError('Cargo inválido.')

        if not user.has_perm('accounts.manage_users'):
            raise serializers.ValidationError(
                'Você não tem permissão para alterar o cargo de um usuário.'
            )

        mexe_com_admin = Role.ADMIN in (value, current_role)
        if mexe_com_admin and user.role != Role.ADMIN:
            raise serializers.ValidationError(
                'Apenas administradores podem promover ou rebaixar um administrador.'
            )

        return value

    def create(self, validated_data):
        """Criar usuário pela gestão (`POST /users/`) também precisa gravar o
        vínculo M2M, não só o CharField.

        A autoridade do escopo é `UserSetor`: um usuário criado com `setor`
        preenchido mas SEM vínculo abriria a plataforma vazia com a segmentação
        ligada — e ainda mostraria a tag do setor certo na tela, escondendo a
        causa. Sem `setor` no corpo, `sincronizar_setor_primario` cai na regra do
        balde de não classificados e o novo usuário entra em "Sem Setor", o
        mesmo destino do cadastro público (ver RegisterSerializer.create)."""
        user = super().create(validated_data)
        codename = validated_data.get('setor') or ''
        setor_obj = SetorCatalogo.objects.filter(codename=codename).first() if codename else None
        request = self.context.get('request')
        sincronizar_setor_primario(user, setor_obj, operador=getattr(request, 'user', None))
        return user

    def update(self, instance, validated_data):
        """Troca de setor mexe nos dois lados: o CharField (exibição) e o
        vínculo primário em `UserSetor`. Sem o M2M, o usuário continuaria
        enxergando exatamente o que enxergava antes (ver scoping.py) — só o
        rótulo na tela mudaria."""
        setor_alterado = 'setor' in validated_data
        user = super().update(instance, validated_data)
        if setor_alterado:
            codename = validated_data.get('setor') or ''
            setor_obj = SetorCatalogo.objects.filter(codename=codename).first() if codename else None
            request = self.context.get('request')
            sincronizar_setor_primario(user, setor_obj, operador=getattr(request, 'user', None))
        return user

    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'first_name', 'last_name',
            'role', 'role_display', 'setor', 'setor_display', 'setores',
            'is_active', 'permissions', 'participa_do_trabalho',
            'profile_picture_url', 'date_joined',
        ]
        # is_active só é editável via o endpoint dedicado /set-active/ (que
        # também revoga tokens) — mantido read_only aqui pra não permitir
        # burlar essa revogação e a checagem de alvo admin via PATCH genérico.
        read_only_fields = ['id', 'date_joined', 'is_active']


def _unique_codename(model, nome: str) -> str:
    """Gera um codename slug único (`novos_negocios`) a partir do nome
    digitado, com sufixo numérico em caso de colisão."""
    base = slugify(nome, allow_unicode=False).replace('-', '_')[:40] or 'item'
    codename = base
    n = 2
    while model.objects.filter(codename=codename).exists():
        suffix = f'_{n}'
        codename = f'{base[: 40 - len(suffix)]}{suffix}'
        n += 1
    return codename


_HEX_RE = re.compile(r'^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$')


def _validate_hex(value):
    value = (value or '').strip()
    if value and not _HEX_RE.match(value):
        raise serializers.ValidationError('Cor deve ser um hex válido (ex.: #3b82f6).')
    return value


class CargoSerializer(serializers.ModelSerializer):
    user_count = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = Cargo
        fields = ['id', 'codename', 'nome', 'is_system', 'cor', 'label_curto',
                  'descricao', 'permissoes_padrao', 'user_count']
        read_only_fields = ['id', 'codename', 'is_system', 'user_count']

    def get_user_count(self, obj):
        return User.objects.filter(role=obj.codename).count()

    def validate_nome(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Nome é obrigatório.')
        qs = Cargo.objects.filter(nome__iexact=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError('Já existe um cargo com esse nome.')
        return value

    def validate_cor(self, value):
        return _validate_hex(value)

    def validate_permissoes_padrao(self, value):
        if not isinstance(value, list) or not all(isinstance(x, str) for x in value):
            raise serializers.ValidationError('permissoes_padrao deve ser uma lista de codenames.')
        invalid = sorted(set(value) - {c for c, _l, _a in PERMISSION_CATALOG})
        if invalid:
            raise serializers.ValidationError(f'Codenames inválidos: {", ".join(invalid)}')
        return value

    def create(self, validated_data):
        codename = _unique_codename(Cargo, validated_data['nome'])
        validated_data['codename'] = codename
        validated_data['is_system'] = False
        cargo = Cargo.objects.create(**validated_data)
        cache.delete(CARGO_CHOICES_CACHE_KEY)
        return cargo

    def update(self, instance, validated_data):
        # codename e is_system nunca mudam (já read_only); cor/label de sistema podem mudar.
        for attr, val in validated_data.items():
            setattr(instance, attr, val)
        instance.save()
        cache.delete(CARGO_CHOICES_CACHE_KEY)
        return instance


class SetorCatalogoSerializer(serializers.ModelSerializer):
    user_count = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = SetorCatalogo
        fields = ['id', 'codename', 'nome', 'is_system', 'cor', 'label_curto',
                  'descricao', 'user_count']
        read_only_fields = ['id', 'codename', 'is_system', 'user_count']

    def get_user_count(self, obj):
        return User.objects.filter(setor=obj.codename).count()

    def validate_nome(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Nome é obrigatório.')
        qs = SetorCatalogo.objects.filter(nome__iexact=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError('Já existe um setor com esse nome.')
        return value

    def validate_cor(self, value):
        return _validate_hex(value)

    def create(self, validated_data):
        codename = _unique_codename(SetorCatalogo, validated_data['nome'])
        validated_data['codename'] = codename
        validated_data['is_system'] = False
        setor = SetorCatalogo.objects.create(**validated_data)
        cache.delete(SETOR_CHOICES_CACHE_KEY)
        return setor

    def update(self, instance, validated_data):
        for attr, val in validated_data.items():
            setattr(instance, attr, val)
        instance.save()
        cache.delete(SETOR_CHOICES_CACHE_KEY)
        return instance


def _generate_recovery_code() -> str:
    """Gera código `XXXX-XXXX-XXXX` único no DB.

    Retenta caso ocorra colisão (estatisticamente improvável com 36^12 ≈ 4.7e18
    combinações, mas a unicidade é garantida explicitamente). Limite de 20
    tentativas: se chegasse lá teríamos um problema sistêmico, não aleatório.
    """
    alphabet = string.ascii_uppercase + string.digits
    for _ in range(20):
        raw = ''.join(secrets.choice(alphabet) for _ in range(12))
        code = f"{raw[0:4]}-{raw[4:8]}-{raw[8:12]}"
        if not User.objects.filter(recovery_code=code).exists():
            return code
    raise RuntimeError(
        'Não foi possível gerar um recovery_code único após 20 tentativas. '
        'Verifique pressão por colisão no DB.'
    )


SENHA_CARACTERES_ESPECIAIS = '!@#$%^&*()_+-=[]{}|;:,.<>?'


def _validate_password_strength(value):
    """Mínimo 8 caracteres, letra maiúscula, minúscula e pelo menos um caractere especial."""
    if len(value) < 8:
        raise serializers.ValidationError('A senha deve ter no mínimo 8 caracteres.')
    if not any(c.isupper() for c in value):
        raise serializers.ValidationError('A senha deve conter pelo menos uma letra maiúscula.')
    if not any(c.islower() for c in value):
        raise serializers.ValidationError('A senha deve conter pelo menos uma letra minúscula.')
    if not any(c in SENHA_CARACTERES_ESPECIAIS for c in value):
        raise serializers.ValidationError('A senha deve conter pelo menos um caractere especial.')


def _generate_strong_password(length: int = 16) -> str:
    """Senha aleatória que já nasce aprovada por `_validate_password_strength`.

    Sorteia um caractere de cada classe exigida e só então completa o resto,
    embaralhando no fim — assim a geração não depende de sorte nem de laço de
    tentativa-e-erro. Reusa `SENHA_CARACTERES_ESPECIAIS`, o mesmo conjunto que
    o validador cobra, para que os dois nunca divirjam.
    """
    obrigatorios = [
        secrets.choice(string.ascii_uppercase),
        secrets.choice(string.ascii_lowercase),
        secrets.choice(string.digits),
        secrets.choice(SENHA_CARACTERES_ESPECIAIS),
    ]
    alfabeto = string.ascii_letters + string.digits + SENHA_CARACTERES_ESPECIAIS
    tamanho = max(length, 12)
    senha = obrigatorios + [secrets.choice(alfabeto) for _ in range(tamanho - len(obrigatorios))]
    secrets.SystemRandom().shuffle(senha)
    return ''.join(senha)


class RegisterSerializer(serializers.Serializer):
    """Criação de conta: nome, login, e-mail @bwa.global, senha forte; foto opcional. Novo usuário vem como visitante (zero permissões)."""
    first_name = serializers.CharField(max_length=150)
    username = serializers.CharField(max_length=150)
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)
    profile_picture = serializers.ImageField(required=False, allow_null=True)

    def validate_username(self, value):
        if User.objects.filter(username=value).exists():
            raise serializers.ValidationError('Este nome de usuário já está em uso.')
        return value

    def validate_email(self, value):
        # NFKC normaliza variantes Unicode (ƅ → b, etc) e remove confusáveis. strip() remove espaços.
        # Rejeita null-byte (alguns parsers C truncam aí, permitindo bypass).
        if '\x00' in value:
            raise serializers.ValidationError('E-mail inválido.')
        value = unicodedata.normalize('NFKC', value).strip().lower()
        try:
            local, domain = value.rsplit('@', 1)
        except ValueError:
            raise serializers.ValidationError('E-mail inválido.')
        if domain != 'bwa.global':
            raise serializers.ValidationError('O e-mail deve ser do domínio @bwa.global.')
        if not local:
            raise serializers.ValidationError('E-mail inválido.')
        # Enumeration mitigation: mensagem genérica (mesma string usada em outras falhas).
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError('Não foi possível concluir o cadastro.')
        return value

    def validate_password(self, value):
        _validate_password_strength(value)
        return value

    def create(self, validated_data):
        profile_picture = validated_data.pop('profile_picture', None)
        recovery_code = _generate_recovery_code()
        # Conta nova entra no setor padrão do sistema: sem vínculo de setor o
        # escopo é fail-closed e o recém-cadastrado veria a plataforma vazia
        # até alguém reparar e atribuir um setor na mão.
        setor_padrao = setor_padrao_do_sistema()
        user = User.objects.create_user(
            username=validated_data['username'],
            email=validated_data['email'],
            password=validated_data['password'],
            first_name=validated_data.get('first_name', '').strip() or '',
            role=Role.VISITANTE,
            setor=setor_padrao.codename if setor_padrao else '',
            recovery_code=recovery_code,
        )
        sincronizar_setor_primario(user, setor_padrao)
        if profile_picture:
            processed = process_profile_picture(profile_picture)
            if processed is not None:
                user.profile_picture.save(processed.name, processed, save=False)
            else:
                user.profile_picture = profile_picture
            user.save(update_fields=['profile_picture'])
        return user


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)

    def validate(self, attrs):
        email = (attrs.get('email') or '').strip().lower()
        password = attrs.get('password')

        if email and password:
            user = User.objects.filter(email__iexact=email).first()
            if not (user and user.check_password(password)):
                raise serializers.ValidationError('Credenciais inválidas.')
            if not user.is_active:
                raise serializers.ValidationError('Usuário desativado.')
            attrs['user'] = user
        else:
            raise serializers.ValidationError('E-mail e senha são obrigatórios.')
        return attrs


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True, min_length=8)

    def validate_current_password(self, value):
        request = self.context.get('request')
        if not request or not request.user.check_password(value):
            raise serializers.ValidationError('Senha atual incorreta.')
        return value


class RecoverAccountSerializer(serializers.Serializer):
    recovery_code = serializers.CharField(max_length=14)
    new_password = serializers.CharField(write_only=True)
    confirm_password = serializers.CharField(write_only=True)

    def validate_new_password(self, value):
        _validate_password_strength(value)
        return value

    def validate(self, attrs):
        if attrs.get('new_password') != attrs.get('confirm_password'):
            raise serializers.ValidationError('As senhas não coincidem.')
        code = attrs.get('recovery_code', '').strip().upper()
        user = User.objects.filter(recovery_code=code).first()
        # Mensagem unificada para evitar enumeration via timing/distinção
        invalid_msg = 'Código de recuperação inválido.'
        if not user:
            raise serializers.ValidationError(invalid_msg)
        if not user.is_active:
            raise serializers.ValidationError(invalid_msg)
        attrs['user'] = user
        return attrs
