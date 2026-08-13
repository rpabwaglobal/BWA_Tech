from rest_framework import serializers
from django.utils import timezone
import os
import re
import unicodedata
from apps.accounts.models import SetorCatalogo
from .models import (
    Sprint,
    Project,
    KanbanStage,
    ProjectKanbanStageConfig,
    Card,
    CardAnexo,
    CardStatus,
    # CardTodo removido — substituído por UserNote
    UserNote,
    UserNoteItem,
    UserNoteItemKind,
    CardPin,
    Event,
    CardLog,
    Notification,
    UserNotificationPreference,
    WeeklyPriority,
    WeeklyPriorityConfig,
    CardArea,
    CardDueDateChangeRequest,
    CardReopenRequest,
    ScoreCriterion,
    ScoreCriterionOption,
    CardScore,
    CardScoreValue,
    ScoreHistory,
)
from apps.accounts.serializers import UserSerializer
from apps.accounts.profile_picture_utils import get_profile_picture_url
# Import de módulo (não de app): `apps.accounts.scoping` só importa os models de
# projects DENTRO das funções, então não há ciclo de import aqui.
from apps.accounts.scoping import (cards_editaveis, projetos_editaveis,
                                   scope_cards, scope_projects, scope_sprints,
                                   scope_users, sprints_editaveis)
from .dev_time_format import format_minutos_uteis, format_segundos_corridos
from .services import sprint_conflitante_na_janela


class DevTimeFormattedMixin(serializers.Serializer):
    """Expõe valores brutos no banco e campos formatados para exibição."""
    dias_corridos_desenvolvimento = serializers.SerializerMethodField()
    horas_uteis_desenvolvimento = serializers.SerializerMethodField()

    def get_dias_corridos_desenvolvimento(self, obj):
        return format_segundos_corridos(obj.segundos_corridos_desenvolvimento)

    def get_horas_uteis_desenvolvimento(self, obj):
        return format_minutos_uteis(obj.minutos_uteis_desenvolvimento)


def format_user_name(user):
    """Formata o nome do usuário com first_name e last_name"""
    if not user:
        return None
    if user.first_name and user.last_name:
        return f"{user.first_name} {user.last_name}"
    elif user.first_name:
        return user.first_name
    elif user.last_name:
        return user.last_name
    return user.username


def _checar_destino_do_setor(serializer, valor, campo_id, scope_fn, editaveis_fn,
                             msg_fora_do_escopo, msg_somente_leitura=None):
    """Gate de setor de um campo GRAVÁVEL que aponta para outro objeto.

    POR QUE AQUI, e não no `queryset=` do campo: o queryset de um
    `PrimaryKeyRelatedField` é avaliado UMA vez, quando a classe é definida —
    ali não existe request nenhum para escopar. Validar no `validate_<campo>`
    faz a pergunta no momento em que o usuário já é conhecido (via
    `context['request']`) e ainda devolve uma mensagem legível em vez do
    genérico "objeto inválido" do DRF.

    São DUAS perguntas, cada uma presa à SUA flag, porque o furo tem dois lados:

    - Visibilidade (`scope_*`, `SETOR_SCOPING_ENABLED`): a resposta do POST/PATCH
      devolve o alvo serializado (`projeto_detail`, `sprint_detail`,
      `card_detail`). Aceitar um alvo de outro setor entrega o objeto inteiro na
      resposta da própria escrita — vazamento que escopar a LISTAGEM não fecha,
      porque esse caminho não passa por listagem nenhuma.
    - Escrita (`*_editaveis`, `SETOR_WRITE_ENFORCEMENT_ENABLED`): pendurar
      conteúdo dentro do item de outro setor é escrita cruzada, e item
      emprestado apenas para LEITURA não recebe conteúdo novo. Quando apontar
      para o alvo não é escrever DENTRO dele (o pin, que é marcador pessoal),
      passa-se `editaveis_fn=None` e fica só o gate de visibilidade.

    Ambos os helpers são fail-open com a flag correspondente desligada — com as
    duas OFF (hoje) esta função não recusa absolutamente nada.
    """
    request = serializer.context.get('request')
    user = getattr(request, 'user', None)
    # Sem request não há usuário para escopar. O serializer também roda fora da
    # API (task, shell, script de dados); explodir nesses caminhos seria pior que
    # o furo — o gate existe para quem chega pela API, e lá o request sempre vem.
    if valor is None or user is None:
        return valor
    # Update que NÃO muda a relação não passa pelo gate. O item pode ter sido
    # emprestado sozinho (card sem o projeto, projeto sem a sprint) e nesse caso
    # o pai legitimamente fica fora do escopo de quem edita: barrar aqui
    # impediria de salvar um item recebido só porque o payload repete o pai atual.
    if (serializer.instance is not None
            and getattr(serializer.instance, campo_id, None) == valor.pk):
        return valor
    # `_default_manager` em vez do model literal: a mesma função serve Card,
    # Project e Sprint, e o alvo já veio resolvido pelo campo do DRF.
    alvo = type(valor)._default_manager.filter(pk=valor.pk)
    if not scope_fn(alvo, user).exists():  # fail-open enquanto flag OFF
        raise serializers.ValidationError(msg_fora_do_escopo)
    if (editaveis_fn is not None
            and not editaveis_fn(user).filter(pk=valor.pk).exists()):  # fail-open enquanto flag OFF
        raise serializers.ValidationError(msg_somente_leitura)
    return valor


def _checar_pessoa_do_setor(serializer, valor, campo_id, msg_fora_do_escopo):
    """Gate de setor de um campo GRAVÁVEL que aponta para uma PESSOA.

    Irmão de `_checar_destino_do_setor` (leia aquele primeiro): mesma disciplina,
    outro eixo. Lá o alvo é CONTEÚDO — tem `setor` dono e pode ser emprestado com
    nível ('leitura'/'edicao'), então cabem duas perguntas ("enxergo?" e "posso
    escrever dentro?"), cada uma presa à sua flag. Aqui o alvo é gente, e gente
    não tem setor dono nem compartilhamento: o vínculo é o M2M `UserSetor`, e é
    por ele que `scope_users` cruza ("compartilhamos algum setor?"). Passar um
    usuário para o outro helper obrigaria a distorcer `scope_fn`/`editaveis_fn`
    para um modelo que não tem `setor_id` — daí a função separada.

    POR QUE SÓ O GATE DE VISIBILIDADE: não existe "usuário editável". Apontar um
    card para alguém não escreve nada DENTRO dessa pessoa — o que está sendo
    escrito é o CARD, e quem responde pelo direito de escrita ali já é o gate do
    próprio card (`validate_projeto`, `SetorPermiteEscrita`, `checar_escrita_no_pai`).
    Exigir aqui algo como "poder editar a pessoa" responderia a uma pergunta que
    o domínio não faz e recusaria atribuições legítimas. Também NÃO se checa se a
    pessoa é do mesmo setor do card: o modelo prevê justamente o contrário —
    alguém emprestado a um card compartilhado (ver a docstring de
    `scope_weekly_priorities`, que trata o alvo de outro setor como caso normal).
    A pergunta certa, e a única, é se o OPERADOR enxerga aquela pessoa.

    O furo que isto fecha: os serializers ANINHAM dados da pessoa na resposta
    (`responsavel_name`, `responsavel_role`, `responsavel_profile_picture_url`,
    `usuario_name`, `usuario_role`, ...). Como o campo é gravável e o queryset
    implícito do `ModelSerializer` é `User.objects.all()`, um `PATCH` repetido
    com ids em sequência devolvia nome, cargo e foto de qualquer funcionário —
    enumeração do quadro inteiro da empresa, um id por vez, sem passar por
    listagem nenhuma (que é onde `scope_users` já atuava). E ainda pendurava
    trabalho no nome de alguém que o operador não deveria nem enxergar.

    Consequência aceita quando `SETOR_SCOPING_ENABLED` subir: só é atribuível
    quem COMPARTILHA algum setor com o operador. Conta sem nenhum vínculo
    `UserSetor` é invisível para todo mundo (menos para ela mesma) e passa a ser
    recusada aqui — o conserto é dar setor à conta, não afrouxar o gate.

    Fail-open com a flag desligada, porque `scope_users` é fail-open: hoje esta
    função não recusa absolutamente nada.
    """
    request = serializer.context.get('request')
    user = getattr(request, 'user', None)
    # Idem `_checar_destino_do_setor`: sem request não há de quem escopar, e o
    # serializer também roda fora da API (task, shell, script de dados) — onde
    # explodir seria pior que o furo.
    if valor is None or user is None:
        return valor
    # Update que NÃO troca a pessoa não passa pelo gate. O registro pode ter sido
    # criado por outro setor, ou a pessoa pode ter mudado de setor depois de ser
    # atribuída; barrar o payload que apenas repete o valor atual impediria de
    # salvar QUALQUER outro campo do mesmo objeto.
    if (serializer.instance is not None
            and getattr(serializer.instance, campo_id, None) == valor.pk):
        return valor
    # `_default_manager` (o `UserManager` padrão, sem filtro) em vez do model
    # literal: evita importar o User aqui e segue o mesmo molde do irmão.
    alvo = type(valor)._default_manager.filter(pk=valor.pk)
    if not scope_users(alvo, user).exists():  # fail-open enquanto flag OFF
        raise serializers.ValidationError(msg_fora_do_escopo)
    return valor


class SprintSerializer(serializers.ModelSerializer):
    supervisor_name = serializers.SerializerMethodField()
    # Sem input_formats restritivos: usa o padrão DRF (ISO 8601 / parse_datetime),
    # igual a fechamento_em — aceita strings do browser (ex.: ...Z de toISOString()).
    data_inicio = serializers.DateTimeField()
    fechamento_em = serializers.DateTimeField()
    # Compatível com telas antigas: só o dia final (derivado de fechamento_em)
    data_fim = serializers.SerializerMethodField(read_only=True)
    projects_count = serializers.IntegerField(source='projects.count', read_only=True)
    cards_total = serializers.IntegerField(read_only=True)
    cards_finalizados = serializers.IntegerField(read_only=True)
    cards_inviabilizados = serializers.IntegerField(read_only=True)
    cards_em_andamento = serializers.IntegerField(read_only=True)
    cards_em_atraso = serializers.IntegerField(read_only=True)
    cards_entregues_atrasados = serializers.IntegerField(read_only=True)
    cards_abertos_atrasados = serializers.IntegerField(read_only=True)
    setor = serializers.SlugRelatedField(
        slug_field='codename', queryset=SetorCatalogo.objects.all(), required=False, allow_null=True)
    setores_compartilhados = serializers.SlugRelatedField(
        slug_field='codename', queryset=SetorCatalogo.objects.all(), many=True, required=False)

    def get_supervisor_name(self, obj):
        return format_user_name(obj.supervisor)

    def validate_supervisor(self, supervisor):
        """Só aceita como supervisor alguém que quem edita já enxerga.

        `supervisor` é gravável e a resposta devolve `supervisor_name`, então um
        PATCH varrendo ids transformava a sprint num diretório de funcionários da
        empresa inteira. Além disso a sprint é a raiz da árvore de conteúdo do
        setor: pendurar nela o nome de alguém de fora não é só ruído de tela.
        """
        return _checar_pessoa_do_setor(
            self, supervisor, 'supervisor_id', 'Supervisor não encontrado.')

    def _check_setor_perm(self, attrs):
        request = self.context.get('request')
        if request and ('setor' in attrs or 'setores_compartilhados' in attrs):
            if not request.user.has_perm('accounts.manage_setor_sharing'):
                raise serializers.ValidationError(
                    'Você não tem permissão para alterar o setor ou o compartilhamento.')

    def get_data_fim(self, obj):
        if obj.fechamento_em:
            return timezone.localtime(obj.fechamento_em).date().isoformat()
        return None

    @staticmethod
    def _duracao_dias(data_inicio, fechamento_em):
        fe = fechamento_em
        if timezone.is_naive(fe):
            fe = timezone.make_aware(fe, timezone.get_current_timezone())
        di = data_inicio
        if di is not None and timezone.is_naive(di):
            di = timezone.make_aware(di, timezone.get_current_timezone())
        end_d = timezone.localtime(fe).date()
        start_d = timezone.localtime(di).date() if di is not None else None
        if start_d is None:
            return 1
        return max(1, (end_d - start_d).days + 1)

    def validate(self, attrs):
        self._check_setor_perm(attrs)
        di = attrs.get('data_inicio')
        fe = attrs.get('fechamento_em')
        if self.instance:
            di = di if di is not None else self.instance.data_inicio
            fe = fe if fe is not None else self.instance.fechamento_em
        if di and fe:
            if timezone.is_naive(fe):
                fe = timezone.make_aware(fe, timezone.get_current_timezone())
            if timezone.is_naive(di):
                di = timezone.make_aware(di, timezone.get_current_timezone())
            if fe < di:
                raise serializers.ValidationError(
                    {'fechamento_em': 'A data/hora de fechamento não pode ser anterior ao início da sprint.'}
                )

        # Quantas sprints PLANEJADAS o setor quiser; uma EM ANDAMENTO por vez.
        # A checagem é de sobreposição de janelas, não de "está em andamento
        # agora" — ver `sprint_conflitante_na_janela` para o porquê. O setor
        # precisa ser resolvido aqui, e não só no create(): a validação roda
        # antes, e sem ele a regra voltaria a valer para a empresa inteira.
        inst = self.instance
        finalizada = attrs.get('finalizada', inst.finalizada if inst else False)
        if not finalizada and di and fe:
            setor = self._resolver_setor_efetivo(attrs)
            if setor is not None:
                other = sprint_conflitante_na_janela(
                    setor_id=setor.pk, data_inicio=di, fechamento_em=fe,
                    exclude_pk=inst.pk if inst else None)
                if other is not None:
                    inicio = timezone.localtime(other.data_inicio).strftime('%d/%m/%Y')
                    fim = timezone.localtime(other.fechamento_em).strftime('%d/%m/%Y')
                    raise serializers.ValidationError(
                        f'O setor {setor.nome} já tem a sprint «{other.nome}» '
                        f'ocupando o período de {inicio} a {fim}. Uma sprint só '
                        'pode começar depois que a anterior fechar — agende esta '
                        'para depois de ' + fim + ' ou finalize a atual.'
                    )
        return attrs

    def _resolver_setor_efetivo(self, attrs):
        """Setor ao qual a sprint pertence(rá): o informado, o que ela já tem,
        ou o setor primário de quem está operando. `None` quando não há de onde
        herdar — o `create()` transforma isso em erro de validação."""
        setor = attrs.get('setor')
        if setor is not None:
            return setor
        if self.instance is not None:
            return self.instance.setor
        from apps.accounts.scoping import setor_primario_do_usuario
        request = self.context.get('request')
        return setor_primario_do_usuario(request.user) if request else None

    def create(self, validated_data):
        validated_data['duracao_dias'] = self._duracao_dias(
            validated_data['data_inicio'], validated_data['fechamento_em']
        )
        # Toda sprint pertence a um setor. Quando não vem no payload, assume o
        # setor primário de quem está criando; se essa pessoa não tiver setor,
        # a criação é RECUSADA em vez de cair no setor padrão — uma sprint que
        # nasce em "Sem Setor" some do time que deveria enxergá-la e contamina
        # o depósito de conteúdo não classificado.
        if not validated_data.get('setor'):
            setor = self._resolver_setor_efetivo(validated_data)
            if setor is None:
                raise serializers.ValidationError({
                    'setor': ['Informe o setor da sprint. Sua conta não tem setor '
                              'definido, então não há de qual herdar.'],
                })
            validated_data['setor'] = setor
        return super().create(validated_data)

    def update(self, instance, validated_data):
        inst = super().update(instance, validated_data)
        if 'data_inicio' in validated_data or 'fechamento_em' in validated_data:
            inst.duracao_dias = self._duracao_dias(inst.data_inicio, inst.fechamento_em)
            inst.save(update_fields=['duracao_dias'])
        return inst

    class Meta:
        model = Sprint
        fields = ['id', 'nome', 'data_inicio', 'fechamento_em', 'data_fim', 'duracao_dias',
                 'supervisor', 'supervisor_name', 'projects_count',
                 'cards_total', 'cards_finalizados', 'cards_inviabilizados',
                 'cards_em_andamento', 'cards_em_atraso',
                 'cards_entregues_atrasados', 'cards_abertos_atrasados',
                 'setor', 'setores_compartilhados',
                 'finalizada', 'is_system', 'created_at', 'updated_at']
        read_only_fields = [
            'created_at',
            'updated_at',
            'finalizada',
            'data_fim',
            'duracao_dias',  # calculado em create/update a partir de data_inicio e fechamento_em
            # `is_system` é gerenciado pelo backend (data migration + seed do
            # fluxo de monitoramento) — nunca editável via API, pela mesma razão
            # de `Project.is_system`: marcar uma sprint arbitrária a tiraria das
            # métricas e do fechamento automático. Exposto porque o frontend
            # precisa dele para achar a sprint do atalho e para cortá-la das
            # listas de "sprint em andamento".
            'is_system',
        ]


class ProjectSerializer(serializers.ModelSerializer):
    sprint_detail = SprintSerializer(source='sprint', read_only=True)
    gerente_name = serializers.SerializerMethodField()
    desenvolvedor_name = serializers.SerializerMethodField()
    arquivado_por_name = serializers.SerializerMethodField()

    def get_gerente_name(self, obj):
        return format_user_name(obj.gerente_atribuido)

    def get_desenvolvedor_name(self, obj):
        return format_user_name(obj.desenvolvedor)

    def get_arquivado_por_name(self, obj):
        return format_user_name(obj.arquivado_por) if obj.arquivado_por_id else None

    status_display = serializers.CharField(source='get_status_display', read_only=True)
    cards_count = serializers.IntegerField(source='cards.count', read_only=True)
    cards_entregues_count = serializers.IntegerField(read_only=True)
    cards_em_desenvolvimento_count = serializers.IntegerField(read_only=True)
    setor = serializers.SlugRelatedField(
        slug_field='codename', queryset=SetorCatalogo.objects.all(), required=False, allow_null=True)
    setores_compartilhados = serializers.SlugRelatedField(
        slug_field='codename', queryset=SetorCatalogo.objects.all(), many=True, required=False)

    def validate(self, attrs):
        request = self.context.get('request')
        if request and ('setor' in attrs or 'setores_compartilhados' in attrs):
            if not request.user.has_perm('accounts.manage_setor_sharing'):
                raise serializers.ValidationError(
                    'Você não tem permissão para alterar o setor ou o compartilhamento.')
        return attrs

    def validate_gerente_atribuido(self, gerente):
        """Gerente do projeto só entre as pessoas que quem edita enxerga.

        A resposta traz `gerente_name`: sem o gate, `PATCH {"gerente_atribuido":
        <id>}` devolvia o nome de qualquer funcionário — um id por vez, sem
        passar por listagem nenhuma. E o vínculo grava: o projeto passa a
        aparecer como responsabilidade de alguém de outro setor, que nem enxerga
        o projeto para se livrar dele.
        """
        return _checar_pessoa_do_setor(
            self, gerente, 'gerente_atribuido_id', 'Gerente não encontrado.')

    def validate_desenvolvedor(self, desenvolvedor):
        """Desenvolvedor do projeto só entre as pessoas que quem edita enxerga.

        Mesmo furo do `gerente_atribuido` — campo gravável, `desenvolvedor_name`
        na resposta. Os dois estão em `filterset_fields` do ProjectViewSet, então
        o par (gravar id, filtrar por id) também confirma quem existe. E o
        vínculo sobrevive à virada da sprint: `finalizar_sprint_replicacao` copia
        `gerente_atribuido` e `desenvolvedor` para o projeto recriado na sprint
        seguinte, então uma atribuição errada se propaga sozinha.
        """
        return _checar_pessoa_do_setor(
            self, desenvolvedor, 'desenvolvedor_id', 'Desenvolvedor não encontrado.')

    def validate_sprint(self, sprint):
        """Recusa pendurar o projeto numa sprint de outro setor.

        O `checar_escrita_no_pai` só roda no `perform_create` do viewset; no
        PATCH, o `SetorPermiteEscrita` valida apenas o objeto ANTIGO (o projeto,
        que é do setor de quem edita) e ninguém olhava o DESTINO. Com isso,
        `PATCH /api/projects/<meu>/ {"sprint": <sprint do setor B>}` devolvia o
        `sprint_detail` completo da sprint alheia — nome, datas, supervisor,
        `projects_count`, setores — e ainda movia o projeto para dentro dela,
        inflando os agregados que o setor B vê sem que ele pudesse tirar o
        intruso de lá (o projeto não aparece na listagem escopada dele).
        """
        return _checar_destino_do_setor(
            self, sprint, 'sprint_id', scope_sprints, sprints_editaveis,
            'Sprint não encontrada.',
            'Esta sprint pertence a outro setor e foi compartilhada apenas para '
            'visualização — não é possível mover o projeto para dentro dela.')

    def validate_nome(self, value):
        """
        Permite nomes duplicados desde que estejam em sprints diferentes.
        """
        if self.instance:
            # Se está editando, verificar se há outro projeto com o mesmo nome em sprint diferente
            existing = Project.objects.filter(nome=value).exclude(id=self.instance.id)
        else:
            # Se está criando, verificar se há outro projeto com o mesmo nome
            existing = Project.objects.filter(nome=value)
        
        if existing.exists():
            sprint_id = self.initial_data.get('sprint')
            if sprint_id:
                # Verificar se algum projeto existente está na mesma sprint
                same_sprint = existing.filter(sprint_id=sprint_id)
                if same_sprint.exists():
                    raise serializers.ValidationError(
                        f"Já existe um projeto com o nome '{value}' nesta sprint."
                    )
        
        return value

    class Meta:
        model = Project
        fields = ['id', 'nome', 'descricao', 'sprint', 'sprint_detail', 'gerente_atribuido',
                 'gerente_name', 'desenvolvedor', 'desenvolvedor_name', 'status', 'status_display',
                 'data_criacao', 'data_avaliacao', 'data_atribuicao_gerente',
                 'data_inicio_desenvolvimento', 'data_entrega', 'data_homologacao',
                 'data_adiamento_solicitada', 'nova_data_prevista', 'adiamento_aprovado',
                 'arquivado', 'arquivado_em', 'arquivado_por', 'arquivado_por_name',
                 'is_system', 'setor', 'setores_compartilhados',
                 'cards_count', 'cards_entregues_count', 'cards_em_desenvolvimento_count',
                 'created_at', 'updated_at']
        # `arquivado_em` e `arquivado_por` SÃO preenchidos pelo backend nas actions
        # archive/unarchive. O campo `arquivado` é também read-only para clientes —
        # mudanças passam pelas actions dedicadas (permitem audit + permission check).
        # `is_system` é gerenciado pelo backend (migração + futura action admin) —
        # nunca editável via API pública para evitar marcar projetos arbitrários.
        read_only_fields = ['created_at', 'updated_at', 'data_criacao',
                            'arquivado', 'arquivado_em', 'arquivado_por', 'arquivado_por_name',
                            'is_system']


class UserNoteItemSerializer(serializers.ModelSerializer):
    # `parent` é o PK do item-pai no DB. Read-only no output (IDs trocam a
    # cada save por causa da replace-strategy); na entrada usa-se
    # `parent_client_id` (ver UserNoteSerializer).
    parent = serializers.PrimaryKeyRelatedField(read_only=True)
    # Inputs auxiliares pra referência cruzada dentro do MESMO payload:
    # cada item pode declarar um `client_id` (string opaca) e referenciar
    # outro item via `parent_client_id`. O serializer resolve depois de criar.
    client_id = serializers.CharField(required=False, allow_blank=True, write_only=True)
    parent_client_id = serializers.CharField(
        required=False, allow_blank=True, allow_null=True, write_only=True,
    )

    class Meta:
        model = UserNoteItem
        fields = [
            'id', 'kind', 'text', 'done', 'order', 'parent',
            'client_id', 'parent_client_id',
            'created_at', 'updated_at',
        ]
        # `id` precisa ser read-only — o backend usa estratégia de replace (delete + create)
        # nos updates aninhados, então ids vindos do cliente seriam ignorados ou
        # piores: causariam IntegrityError ao tentar inserir com PK já existente.
        read_only_fields = ['id', 'created_at', 'updated_at']


class UserNoteSerializer(serializers.ModelSerializer):
    items = UserNoteItemSerializer(many=True, required=False)

    class Meta:
        model = UserNote
        fields = [
            'id', 'title', 'color', 'pinned', 'archived', 'order',
            'items', 'created_at', 'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at']

    def _create_items(self, note, items_data):
        """Cria itens em DUAS passadas pra suportar parent_client_id.

        Pass 1: cria todos os itens sem parent, guarda um mapa
        client_id → PK gerado.
        Pass 2: para cada item com `parent_client_id`, resolve o PK via
        o mapa e atualiza `parent` em bulk.
        """
        client_id_to_pk: dict[str, int] = {}
        created: list[tuple[UserNoteItem, dict]] = []
        for idx, item in enumerate(items_data):
            payload = {
                k: v for k, v in item.items()
                if k not in ('order', 'client_id', 'parent_client_id')
            }
            # `done` só faz sentido pra todos — zero para texto evita confusão no admin.
            if payload.get('kind') != UserNoteItemKind.TODO:
                payload['done'] = False
            obj = UserNoteItem.objects.create(
                note=note, order=item.get('order', idx), **payload,
            )
            client_id = (item.get('client_id') or '').strip()
            if client_id:
                client_id_to_pk[client_id] = obj.pk
            created.append((obj, item))

        # Pass 2: linka pais
        for obj, item in created:
            ref = (item.get('parent_client_id') or '').strip() if item.get('parent_client_id') else ''
            if ref and ref in client_id_to_pk:
                parent_pk = client_id_to_pk[ref]
                # Defesa: item não pode ser pai de si mesmo (defesa).
                if parent_pk != obj.pk:
                    obj.parent_id = parent_pk
                    obj.save(update_fields=['parent'])

    def create(self, validated_data):
        items_data = validated_data.pop('items', [])
        user = self.context['request'].user
        note = UserNote.objects.create(user=user, **validated_data)
        self._create_items(note, items_data)
        return note

    def update(self, instance, validated_data):
        items_data = validated_data.pop('items', None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if items_data is not None:
            # Replace strategy: deleta todos os blocos atuais e recria com os
            # enviados. O frontend manda a lista completa em cada PATCH com `items`.
            instance.items.all().delete()
            self._create_items(instance, items_data)
        return instance


class CardPinSerializer(serializers.ModelSerializer):
    """Serializer de CardPin com `card_detail` aninhado para uso direto em
    listagens — evita um round-trip extra para buscar os campos do Card."""
    card_detail = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = CardPin
        fields = ['id', 'card', 'card_detail', 'created_at']
        read_only_fields = ['created_at', 'card_detail']

    def get_card_detail(self, obj):
        # Import tardio para evitar referência circular (CardSerializer está abaixo).
        return CardSerializer(obj.card, context=self.context).data

    def validate_card(self, card):
        """Aceita apenas cards do escopo do usuário, da sprint atual e ainda
        não concluídos."""
        # O setor vem ANTES dos gates de estado: card de outro setor tem que
        # parecer inexistente, não "finalizado". Sem isto, um POST com o id de
        # qualquer card ativo devolvia o `card_detail` inteiro na resposta 201
        # (e continuava devolvendo em todo GET /card-pins/, que é o queryset do
        # próprio usuário) — um oráculo de leitura de card alheio, um id por vez.
        #
        # Só o gate de VISIBILIDADE (`editaveis_fn=None`): fixar é um marcador
        # PESSOAL, não escreve nada dentro do card. Um card emprestado ao setor
        # apenas para leitura continua fixável por quem já o enxerga — negar
        # seria restringir mais do que o compartilhamento pediu.
        _checar_destino_do_setor(
            self, card, 'card_id', scope_cards, None, 'Card não encontrado.')
        if card.status in (CardStatus.FINALIZADO, CardStatus.INVIABILIZADO):
            raise serializers.ValidationError(
                'Não é possível fixar um card finalizado ou inviabilizado.'
            )
        if card.projeto_id and getattr(card.projeto, 'arquivado', False):
            raise serializers.ValidationError(
                'Não é possível fixar cards de projetos arquivados.'
            )
        sprint = getattr(card.projeto, 'sprint', None) if card.projeto_id else None
        if sprint is None:
            raise serializers.ValidationError('O card precisa estar vinculado a uma sprint.')
        if sprint.finalizada:
            raise serializers.ValidationError('A sprint do card já foi finalizada.')
        now = timezone.now()
        if sprint.fechamento_em and sprint.fechamento_em < now:
            raise serializers.ValidationError('A sprint do card já encerrou.')
        return card

    def create(self, validated_data):
        user = self.context['request'].user
        # get_or_create torna a operação idempotente.
        pin, _ = CardPin.objects.get_or_create(user=user, card=validated_data['card'])
        return pin


class CardSerializer(DevTimeFormattedMixin, serializers.ModelSerializer):
    projeto_detail = ProjectSerializer(source='projeto', read_only=True)
    # `setor` é espelho do projeto e `setores_compartilhados` só muda pelo
    # endpoint `cards/<id>/compartilhar/` (que exige manage_setor_sharing) —
    # por isso ambos são read-only aqui, e não repetimos o gate de permissão.
    setor = serializers.SlugRelatedField(slug_field='codename', read_only=True)
    setores_compartilhados = serializers.SlugRelatedField(
        many=True, slug_field='codename', read_only=True)
    responsavel_name = serializers.SerializerMethodField()
    responsavel_role = serializers.SerializerMethodField()
    responsavel_profile_picture_url = serializers.SerializerMethodField()
    criado_por_name = serializers.SerializerMethodField()
    criado_por_profile_picture_url = serializers.SerializerMethodField()

    def get_responsavel_name(self, obj):
        return format_user_name(obj.responsavel)

    def get_responsavel_role(self, obj):
        return getattr(obj.responsavel, 'role', None) if obj.responsavel else None
    
    def get_responsavel_profile_picture_url(self, obj):
        return get_profile_picture_url(obj.responsavel, request=self.context.get('request'))

    def get_criado_por_name(self, obj):
        return format_user_name(obj.criado_por)

    def get_criado_por_profile_picture_url(self, obj):
        return get_profile_picture_url(obj.criado_por, request=self.context.get('request'))
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    prioridade_display = serializers.CharField(source='get_prioridade_display', read_only=True)
    area_display = serializers.CharField(source='get_area_display', read_only=True)
    tipo_display = serializers.CharField(source='get_tipo_display', read_only=True)
    # Anotado no queryset via Count('events') — evita N+1 (uma query por card).
    # Fallback `obj.events.count()` apenas quando o objeto não vier do queryset
    # anotado (ex.: testes ou criação manual em scripts).
    events_count = serializers.SerializerMethodField()
    score_final = serializers.SerializerMethodField()

    def get_events_count(self, obj):
        # Quando o queryset usa .annotate(events_count=Count('events')),
        # o atributo já existe no objeto. Verificação explícita pra não
        # confundir 0 (falsy mas válido) com ausência do atributo.
        annotated = getattr(obj, 'events_count', None)
        if annotated is not None:
            return annotated
        return obj.events.count()

    def get_score_final(self, obj):
        # Score visível para TODOS os usuários (badge nos cards). A restrição a
        # admin/supervisor vale apenas para a PÁGINA de Score (atribuir/editar),
        # garantida nos endpoints /card-scores/ e /score-criterios/.
        try:
            return obj.score.score_final
        except CardScore.DoesNotExist:
            return None

    # Permite status que existam em `KanbanStage` (novo sistema), mantendo compatibilidade
    # com os status legados já persistidos.
    status = serializers.CharField(required=False, allow_blank=False)
    
    # Campos explícitos para garantir que sejam sempre processados
    complexidade_selected_items = serializers.JSONField(required=False, allow_null=False, default=list)
    complexidade_selected_development = serializers.CharField(required=False, allow_null=True, max_length=50, default=None)
    complexidade_custom_items = serializers.JSONField(required=False, allow_null=False, default=list)
    
    def validate_complexidade_selected_items(self, value):
        """Garantir que sempre seja uma lista"""
        if value is None:
            return []
        return value

    def validate_status(self, value):
        # A checagem REAL mudou para `validate()` (ver `_validar_status_no_board`):
        # aqui não existe o PROJETO do card, e "este status é válido?" só tem
        # resposta certa em função do board dele. Antes esta função aprovava
        # qualquer key que existisse em `KanbanStage` GLOBALMENTE, sem olhar o
        # projeto — o que deixava um card comum parar numa coluna que o board
        # dele não desenha.
        return value

    def _etapas_do_projeto(self, projeto):
        """Keys que o BOARD deste projeto realmente desenha.

        `ProjectKanbanStageConfig` é quem decide as colunas de um projeto (é dela
        que saem `kanban-config` e o `bundle` da sprint), então é ela — e não o
        catálogo global — a lista de status legítimos.

        ESCAPE PARA PROJETO LEGADO: quando o projeto não tem NENHUMA config, cai
        na lista de status legados. Projetos normais já receberam as 6 keys pela
        migration 0028, então nada regride; o escape existe só para o projeto
        criado direto no banco/shell que ainda não passou por
        `_ensure_project_default_kanban_config`.
        """
        keys = set(
            ProjectKanbanStageConfig.objects.filter(project=projeto)
            .values_list('stage__key', flat=True)
        )
        return keys or {choice for choice, _ in CardStatus.choices}

    def _validar_status_no_board(self, attrs):
        novo_status = attrs.get('status')
        if novo_status is None:
            return

        # 1) O card de MONITORAMENTO é uma PROJEÇÃO do PedidoFeedback: quem manda
        #    na coluna dele é o estado do pedido (a promoção dos 30 dias é uma
        #    varredura do Celery e a resposta chega de um anônimo — nenhuma das
        #    duas é "alguém arrastou o card"). Arrastar à mão criaria divergência
        #    que a varredura seguinte desfaria em silêncio.
        #    `pedido_exibido` é o related_name do OneToOne de `apps.feedbacks`, o
        #    que permite perguntar isso a partir do Card SEM importar aquele app.
        if (
            self.instance is not None
            and novo_status != self.instance.status
            and Card.objects.filter(
                pk=self.instance.pk, pedido_exibido__isnull=False).exists()
        ):
            raise serializers.ValidationError({'status': [
                'A coluna deste card é definida pelo pedido de feedback e não pode '
                'ser alterada à mão.'
            ]})

        # 2) O status tem de ser uma etapa CONFIGURADA NO PROJETO do card. Uma
        #    regra só fecha os dois lados: card comum não entra em coluna de
        #    feedback E card de feedback não vai parar em 'finalizado'.
        projeto = attrs.get('projeto') or (self.instance.projeto if self.instance else None)
        if projeto is None:
            return
        if novo_status not in self._etapas_do_projeto(projeto):
            # Sempre sob a chave 'status': virar `non_field_errors` mudaria a
            # forma do payload de erro que o frontend já trata.
            raise serializers.ValidationError({'status': ['Status inválido.']})

    def validate(self, attrs):
        self._validar_status_no_board(attrs)
        status = attrs.get('status')
        if status is None and self.instance is not None:
            status = self.instance.status
        if status == CardStatus.A_DESENVOLVER:
            attrs['data_inicio'] = None
        return attrs
    
    def validate_complexidade_custom_items(self, value):
        """Garantir que sempre seja uma lista"""
        if value is None:
            return []
        return value
    
    def validate_area(self, value):
        """Garantir que área seja sempre um valor válido"""
        if not value or (isinstance(value, str) and value.strip() == ''):
            # Se estiver vazio, usar o valor padrão do modelo
            return CardArea.BACKEND
        return value
    
    def create(self, validated_data):
        """Garantir valores padrão para campos de complexidade ao criar"""
        # Garantir que os campos sempre tenham valores
        validated_data.setdefault('complexidade_selected_items', [])
        validated_data.setdefault('complexidade_selected_development', None)
        validated_data.setdefault('complexidade_custom_items', [])
        
        # Passar usuário da requisição para o signal via thread-local (ANTES de criar)
        usuario = None
        try:
            from apps.projects import signals
            if self.context.get('request') and hasattr(self.context['request'], 'user'):
                usuario = self.context['request'].user
                signals._thread_locals.user = usuario
        except (ImportError, AttributeError):
            pass
        
        instance = super().create(validated_data)

        # LIMPA O THREAD-LOCAL assim que ele cumpriu o papel: o valor existe SÓ
        # para atravessar o `post_save` que acabou de rodar dentro do `create()`
        # acima.
        #
        # `threading.local` vive na THREAD, não na requisição, e o servidor
        # reaproveita threads entre requisições — um valor deixado aqui é lido
        # pela PRÓXIMA criação de card que NÃO passe por este serializer
        # (replicação de sprint, aprovação de sugestão, shell, task) e o CardLog
        # sai assinado por quem não fez nada. Pior: o usuário pode nem existir
        # mais quando o log for gravado.
        #
        # `_request_user` logo abaixo continua sendo o portador para o resto
        # DESTA requisição, e o signal já o consulta primeiro — ele mora na
        # instância, que ninguém compartilha.
        try:
            from apps.projects import signals as _signals

            if hasattr(_signals._thread_locals, 'user'):
                del _signals._thread_locals.user
        except (ImportError, AttributeError):
            pass

        # Também passar como atributo da instância (fallback)
        if usuario:
            instance._request_user = usuario

        # Criar log diretamente aqui como garantia (o signal pode não estar sendo executado)
        try:
            from apps.projects.models import CardLog, CardLogEventType
            
            # Construir descrição completa
            def format_user_name(user):
                if not user:
                    return None
                if user.first_name and user.last_name:
                    return f"{user.first_name} {user.last_name}"
                elif user.first_name:
                    return user.first_name
                elif user.last_name:
                    return user.last_name
                return user.username
            
            prioridade_labels = {
                'baixa': 'Baixa', 'media': 'Média', 'alta': 'Alta', 'absoluta': 'Absoluta',
            }
            area_labels = {
                'rpa': 'RPA',
                'frontend': 'Frontend',
                'backend': 'Backend',
                'script': 'Script',
                'sistema': 'Sistema',
                'automacao': 'Automação',
            }
            tipo_labels = {
                'nova_robotizacao': 'Nova Robotização',
                'nova_automacao': 'Nova Automação',
                'feature': 'Feature',
                'bug': 'Bug',
                'refact_completo': 'Refact Completo',
                'refact_pontual': 'Refact Pontual',
                'otimizacao_processo': 'Otimização de Processo',
                'melhoria_fluxo': 'Melhoria de Fluxo',
                'novo_script': 'Novo Script',
                'ferramenta': 'Ferramenta',
                'qualidade': 'Qualidade',
                'teste_software': 'Teste de Software',
                'raspagem_dados': 'Raspagem de Dados',
                'novo_painel': 'Novo Painel',
                'ia': 'IA',
                'auditoria': 'Auditoria',
                'manutencao': 'Manutenção',
            }
            status_labels = {
                'a_desenvolver': 'A Desenvolver', 'em_desenvolvimento': 'Em Desenvolvimento',
                'parado_pendencias': 'Parado por Pendências', 'em_homologacao': 'Em Homologação',
                'finalizado': 'Concluído', 'inviabilizado': 'Inviabilizado',
            }
            
            descricao_parts = [f'Card "{instance.nome}" criado com os seguintes dados:']
            descricao_parts.append(f'• Nome: {instance.nome}')
            if instance.descricao:
                descricao_parts.append(f'• Descrição: {instance.descricao[:100]}{"..." if len(instance.descricao) > 100 else ""}')
            descricao_parts.append(f'• Status: {status_labels.get(instance.status, instance.status)}')
            descricao_parts.append(f'• Prioridade: {prioridade_labels.get(instance.prioridade, instance.prioridade)}')
            descricao_parts.append(f'• Área: {area_labels.get(instance.area, instance.area)}')
            descricao_parts.append(f'• Tipo: {tipo_labels.get(instance.tipo, instance.tipo)}')
            if instance.responsavel:
                descricao_parts.append(f'• Responsável: {format_user_name(instance.responsavel)}')
            else:
                descricao_parts.append('• Responsável: Não atribuído')
            if instance.data_inicio:
                descricao_parts.append(f'• Data de Início: {instance.data_inicio.strftime("%d/%m/%Y %H:%M")}')
            if instance.data_fim:
                descricao_parts.append(f'• Data de Fim: {instance.data_fim.strftime("%d/%m/%Y %H:%M")}')
            if instance.script_url:
                descricao_parts.append(f'• Script URL: {instance.script_url}')
            
            # Mapeamento de complexidade (ID -> label e horas)
            complexidade_map = {
                'ler_script': {'label': 'Ler script e conferir informações do video', 'hours': 1},
                'solicitar_usuario': {'label': 'Solicitar criação de usuário / vm', 'hours': 1},
                'testes_iniciais': {'label': 'Testes iniciais na maquina', 'hours': 3},
                'configurar_projeto': {'label': 'Configurar projeto na vm', 'hours': 1},
                'desenvolvimento_basico': {'label': 'Desenvolvimento básico', 'hours': 8},
                'desenvolvimento_medio': {'label': 'Desenvolvimento médio', 'hours': 24},
                'desenvolvimento_dificil': {'label': 'Desenvolvimento difícil', 'hours': 40},
            }
            
            # Complexidade do projeto
            has_complexidade = (
                instance.complexidade_selected_items or 
                instance.complexidade_selected_development or 
                instance.complexidade_custom_items
            )
            if has_complexidade:
                descricao_parts.append('• Complexidade do projeto:')
                
                # Itens selecionados
                if instance.complexidade_selected_items:
                    for item_id in instance.complexidade_selected_items:
                        if item_id in complexidade_map:
                            item_info = complexidade_map[item_id]
                            descricao_parts.append(f'  - {item_info["label"]}: {item_info["hours"]}h')
                        else:
                            # Fallback se não estiver no mapeamento
                            label = item_id.replace('_', ' ').title()
                            descricao_parts.append(f'  - {label}')
                
                # Desenvolvimento selecionado (como item de complexidade)
                if instance.complexidade_selected_development:
                    dev_id = instance.complexidade_selected_development
                    if dev_id in complexidade_map:
                        dev_info = complexidade_map[dev_id]
                        descricao_parts.append(f'  - {dev_info["label"]}: {dev_info["hours"]}h')
                    else:
                        # Fallback se não estiver no mapeamento
                        label = dev_id.replace('_', ' ').title()
                        descricao_parts.append(f'  - {label}')
                
                # Itens personalizados
                if instance.complexidade_custom_items:
                    for custom_item in instance.complexidade_custom_items:
                        if isinstance(custom_item, dict):
                            label = custom_item.get('label', 'Item personalizado')
                            hours = custom_item.get('hours', 0)
                            descricao_parts.append(f'  - {label}: {hours}h')
                        else:
                            descricao_parts.append(f'  - {custom_item}')
            
            descricao_completa = '\n'.join(descricao_parts)
            
            # Verificar se já existe um log (para evitar duplicação se o signal também criar)
            if not CardLog.objects.filter(card=instance, tipo_evento=CardLogEventType.CRIADO).exists():
                CardLog.objects.create(
                    card=instance,
                    tipo_evento=CardLogEventType.CRIADO,
                    descricao=descricao_completa,
                    usuario=usuario
                )
        except Exception as e:
            import logging
            logger = logging.getLogger(__name__)
            logger.error(f'Erro ao criar CardLog no serializer para card {instance.id}: {str(e)}', exc_info=True)
        
        # Bloco antigo de auto-criação de CardTodo removido — o sistema de
        # subtarefas por card foi descontinuado em favor de UserNote
        # (notas pessoais estilo Google Keep, geridas pela página /meus-afazeres).
        if False:
            todos_by_area = {
                'backend': [
                    {'id': 'modelagem_banco', 'label': 'Modelagem Do Banco De Dados (Models)'},
                    {'id': 'criacao_interfaces_repositories', 'label': 'Criação De Interfaces E Implementação De Repositories'},
                    {'id': 'criacao_use_cases', 'label': 'Criação De Use Cases'},
                    {'id': 'registro_dependencias', 'label': 'Registro De Dependências Em Containers (Di)'},
                    {'id': 'criacao_serializers', 'label': 'Criação De Serializers'},
                    {'id': 'criacao_views_urls', 'label': 'Criação De Views E Urls'},
                    {'id': 'criacao_permissoes', 'label': 'Criação E Aplicação De Permissões'},
                    {'id': 'testes_unitarios', 'label': 'Testes Unitários E De Cobertura'},
                    {'id': 'testes_manuais', 'label': 'Testes Manuais (Postman / Insomnia)'},
                    {'id': 'atualizacao_documentacao', 'label': 'Atualização Da Documentação Da Api'},
                    {'id': 'criacao_pr_code_review', 'label': 'Criação De Pr E Ajustes De Code Review'},
                    {'id': 'build_deploy_testes', 'label': 'Build E Deploy Em Ambiente De Testes'},
                    {'id': 'build_deploy_producao', 'label': 'Build E Deploy Em Produção'},
                    {'id': 'pull_aplicacao_vm', 'label': 'Pull Da Aplicação Na Vm'},
                ],
                'frontend': [
                    {'id': 'definicao_validacao_contratos', 'label': 'Definição E Validação De Contratos - Interfaces'},
                    {'id': 'construcao_repository_service', 'label': 'Construção Do Repository / Service'},
                    {'id': 'construcao_usecases', 'label': 'Construção Dos Usecases'},
                    {'id': 'garantir_independencia_ui', 'label': 'Garantir Independência Da Ui Em Relação Aos Usecases'},
                    {'id': 'implementacao_testes_unitarios', 'label': 'Implementação De Testes Unitários (Usecases / Services / Repositories)'},
                    {'id': 'ajustes_contratos_regras', 'label': 'Ajustes De Contratos E Regras De Negócio (Se Necessário)'},
                    {'id': 'construcao_componentes_complementares', 'label': 'Construção De Componentes Complementares (Shared / Design System)'},
                    {'id': 'construcao_tela', 'label': 'Construção Da Tela'},
                    {'id': 'tratamento_estados', 'label': 'Tratamento De Estados (Loading, Erro, Empty)'},
                    {'id': 'ajustes_responsividade', 'label': 'Ajustes De Responsividade'},
                    {'id': 'integracao_backend', 'label': 'Integração Com O Backend'},
                    {'id': 'mapeamento_dto_adapter', 'label': 'Mapeamento Dto, Via Adapter'},
                    {'id': 'testar_funcionalidades', 'label': 'Testar Funcionalidades (Fluxos Principais E Edge Cases)'},
                    {'id': 'validacao_visual_ux', 'label': 'Validação Visual E De Ux'},
                    {'id': 'code_review', 'label': 'Code Review'},
                    {'id': 'aplicar_correcoes_code_review', 'label': 'Aplicar Correções Do Code Review'},
                    {'id': 'build_deploy_producao', 'label': 'Build E Deploy Em Produção'},
                    {'id': 'pull_aplicacao_vm', 'label': 'Pull Da Aplicação Na Vm'},
                ],
                'rpa': [
                    {'id': 'ler_script_conferir', 'label': 'Ler Script E Conferir Informações Do Vídeo'},
                    {'id': 'solicitar_usuario_vm', 'label': 'Solicitar Usuário Para Acessar A Vm'},
                    {'id': 'testes_iniciais_local', 'label': 'Testes Iniciais Na Máquina Local'},
                    {'id': 'configurar_projeto_vm', 'label': 'Configurar Projeto Na Vm'},
                    {'id': 'desenvolvimento_basico', 'label': 'Desenvolvimento (Básico)'},
                    {'id': 'desenvolvimento_medio', 'label': 'Desenvolvimento (Médio)'},
                    {'id': 'desenvolvimento_dificil', 'label': 'Desenvolvimento (Dificl)'},
                    {'id': 'testes_homologacao_mapeamento', 'label': 'Testes/Homologação E Mapeamento De Erros'},
                    {'id': 'documentacao', 'label': 'Documentação'},
                    {'id': 'correcoes_code_review', 'label': 'Correções Code Review'},
                ],
                # Automação compartilha o mesmo conjunto de TODOs de RPA por enquanto.
                'automacao': [
                    {'id': 'ler_script_conferir', 'label': 'Ler Script E Conferir Informações Do Vídeo'},
                    {'id': 'solicitar_usuario_vm', 'label': 'Solicitar Usuário Para Acessar A Vm'},
                    {'id': 'testes_iniciais_local', 'label': 'Testes Iniciais Na Máquina Local'},
                    {'id': 'configurar_projeto_vm', 'label': 'Configurar Projeto Na Vm'},
                    {'id': 'desenvolvimento_basico', 'label': 'Desenvolvimento (Básico)'},
                    {'id': 'desenvolvimento_medio', 'label': 'Desenvolvimento (Médio)'},
                    {'id': 'desenvolvimento_dificil', 'label': 'Desenvolvimento (Dificl)'},
                    {'id': 'testes_homologacao_mapeamento', 'label': 'Testes/Homologação E Mapeamento De Erros'},
                    {'id': 'documentacao', 'label': 'Documentação'},
                    {'id': 'correcoes_code_review', 'label': 'Correções Code Review'},
                ],
                'sistema': [
                    {'id': 'ler_script_conferir', 'label': 'Ler Script E Conferir Informações Do Vídeo'},
                    {'id': 'solicitar_usuario_vm', 'label': 'Solicitar Usuário Para Acessar A Vm'},
                    {'id': 'testes_iniciais_local', 'label': 'Testes Iniciais Na Máquina Local'},
                    {'id': 'configurar_projeto_vm', 'label': 'Configurar Projeto Na Vm'},
                    {'id': 'desenvolvimento_basico', 'label': 'Desenvolvimento (Básico)'},
                    {'id': 'desenvolvimento_medio', 'label': 'Desenvolvimento (Médio)'},
                    {'id': 'desenvolvimento_dificil', 'label': 'Desenvolvimento (Dificl)'},
                    {'id': 'testes_homologacao_mapeamento', 'label': 'Testes/Homologação E Mapeamento De Erros'},
                    {'id': 'documentacao', 'label': 'Documentação'},
                    {'id': 'correcoes_code_review', 'label': 'Correções Code Review'},
                ],
                'script': [
                    {'id': 'ler_script_conferir', 'label': 'Ler Script E Conferir Informações Do Vídeo'},
                    {'id': 'solicitar_usuario_vm', 'label': 'Solicitar Usuário Para Acessar A Vm'},
                    {'id': 'testes_iniciais_local', 'label': 'Testes Iniciais Na Máquina Local'},
                    {'id': 'configurar_projeto_vm', 'label': 'Configurar Projeto Na Vm'},
                    {'id': 'desenvolvimento_basico', 'label': 'Desenvolvimento (Básico)'},
                    {'id': 'desenvolvimento_medio', 'label': 'Desenvolvimento (Médio)'},
                    {'id': 'desenvolvimento_dificil', 'label': 'Desenvolvimento (Dificl)'},
                    {'id': 'testes_homologacao_mapeamento', 'label': 'Testes/Homologação E Mapeamento De Erros'},
                    {'id': 'documentacao', 'label': 'Documentação'},
                    {'id': 'correcoes_code_review', 'label': 'Correções Code Review'},
                ],
            }
            
            # Obter lista de TODOs para a área do card
            area = instance.area
            todos_list = todos_by_area.get(area, [])
            
            # IDs de desenvolvimento que devem ser verificados se foram selecionados
            development_ids = ['desenvolvimento_basico', 'desenvolvimento_medio', 'desenvolvimento_dificil']
            
            # Criar TODOs para todos os itens da área
            # Todos os TODOs devem aparecer, exceto os de desenvolvimento que só aparecem se selecionados
            order = 0
            selected_items = instance.complexidade_selected_items or []
            selected_development = instance.complexidade_selected_development
            
            for todo_item in todos_list:
                todo_id = todo_item['id']
                todo_label = todo_item['label']
                
                # Verificar se é um TODO de desenvolvimento
                is_development = todo_id in development_ids
                
                # Se for desenvolvimento, verificar se foi selecionado na complexidade
                # Se não for desenvolvimento, sempre criar
                should_create = True
                if is_development:
                    # Só criar se foi selecionado em complexidade_selected_items ou complexidade_selected_development
                    should_create = todo_id in selected_items or todo_id == selected_development
                
                if should_create:
                    order += 1
        # fim do bloco descontinuado (CardTodo removido)

        return instance
    
    def update(self, instance, validated_data):
        """Atualizar card e passar usuário para o signal"""
        # Passar usuário da requisição para o signal
        if self.context.get('request') and hasattr(self.context['request'], 'user'):
            instance._request_user = self.context['request'].user
        return super().update(instance, validated_data)

    def validate_responsavel(self, responsavel):
        """Recusa atribuir o card a quem quem edita não enxerga.

        É o campo mais exposto desta família: a resposta devolve
        `responsavel_name`, `responsavel_role` E `responsavel_profile_picture_url`
        — nome, cargo e foto. Como `responsavel` é gravável sobre
        `User.objects.all()`, repetir o PATCH trocando o id enumerava o quadro
        inteiro da empresa sem tocar em nenhuma listagem escopada.

        O outro lado é operacional: o card passa a contar na carga de trabalho da
        pessoa, dispara notificação e aparece nos relatórios dela — trabalho
        pendurado no nome de alguém de outro setor, que não tem como se livrar
        dele (o card não aparece na listagem escopada de quem foi atribuído).
        """
        return _checar_pessoa_do_setor(
            self, responsavel, 'responsavel_id', 'Responsável não encontrado.')

    def validate_projeto(self, projeto):
        """Recusa mover o card para um projeto de outro setor.

        O gate de pai (`checar_escrita_no_pai`) só roda no `perform_create` do
        CardViewSet; no PATCH, o `SetorPermiteEscrita` valida apenas o card
        ANTIGO (do setor de quem edita) e o DESTINO passava livre. O furo tinha
        dois lados: (1) leitura — a resposta traz `projeto_detail` e, dentro
        dele, `sprint_detail`, então repetir o PATCH com ids diferentes enumerava
        projeto e sprint de toda a empresa; (2) escrita — `Card.save()` espelha o
        `setor_id` do projeto, então o card passava a PERTENCER ao setor B e
        aparecia no kanban, nas sprints e nas métricas dele sem que B aceitasse.
        """
        return _checar_destino_do_setor(
            self, projeto, 'projeto_id', scope_projects, projetos_editaveis,
            'Projeto não encontrado.',
            'Este projeto pertence a outro setor e foi compartilhado apenas para '
            'visualização — não é possível mover o card para dentro dele.')

    def validate_nome(self, value):
        """
        Nome é apenas exibição; o identificador único do card é o id.
        Nomes duplicados são permitidos.
        """
        return value

    class Meta:
        model = Card
        fields = ['id', 'nome', 'descricao', 'script_url', 'projeto', 'projeto_detail', 
                 'area', 'area_display', 'tipo', 'tipo_display',
                 'responsavel', 'responsavel_name', 'responsavel_role', 'responsavel_profile_picture_url',
                 'criado_por', 'criado_por_name', 'criado_por_profile_picture_url',
                 'status', 'status_display', 'prioridade', 'prioridade_display',
                 'data_inicio', 'data_fim', 'finalizado_em',
                 'segundos_corridos_desenvolvimento', 'dias_corridos_desenvolvimento',
                 'dias_uteis_desenvolvimento',
                 'minutos_uteis_desenvolvimento', 'horas_uteis_desenvolvimento',
                 'complexidade_selected_items', 'complexidade_selected_development', 'complexidade_custom_items',
                 'card_comment', 'links', 'events_count', 'score_final',
                 'gerar_formulario_feedback',
                 'setor', 'setores_compartilhados', 'created_at', 'updated_at']
        read_only_fields = [
            'created_at', 'updated_at', 'criado_por', 'finalizado_em',
            'segundos_corridos_desenvolvimento', 'dias_corridos_desenvolvimento',
            'dias_uteis_desenvolvimento',
            'minutos_uteis_desenvolvimento', 'horas_uteis_desenvolvimento',
        ]


class CardKanbanSerializer(DevTimeFormattedMixin, serializers.ModelSerializer):
    """
    Serializer otimizado pra renderizar cards no KANBAN da SprintDetails.

    Diferenças vs CardSerializer:
    - Sem `projeto_detail` aninhado (a página já tem a lista de projects).
      Economiza ~70% do tamanho de cada card e elimina queries de cards.count
      do ProjectSerializer aninhado (chamado 1x por card).
    - Sem campos `criado_por_*` (Kanban não exibe quem criou — evita 2 leituras
      filesystem por card pra checar profile picture).
    - `events_count` lido via annotation (sem N+1).

    Mantém todos os campos visuais do Kanban: nome, descrição, badges (área/
    tipo/prioridade/status display), responsável + foto, datas, complexidade,
    links, comentário.
    """
    area_display = serializers.CharField(source='get_area_display', read_only=True)
    tipo_display = serializers.CharField(source='get_tipo_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    prioridade_display = serializers.CharField(source='get_prioridade_display', read_only=True)
    responsavel_name = serializers.SerializerMethodField()
    responsavel_role = serializers.SerializerMethodField()
    responsavel_profile_picture_url = serializers.SerializerMethodField()
    events_count = serializers.SerializerMethodField()
    score_final = serializers.SerializerMethodField()

    def get_responsavel_name(self, obj):
        return format_user_name(obj.responsavel) if obj.responsavel_id else None

    def get_responsavel_role(self, obj):
        return obj.responsavel.role if obj.responsavel_id else None

    def get_responsavel_profile_picture_url(self, obj):
        return get_profile_picture_url(obj.responsavel, request=self.context.get('request'))

    def get_events_count(self, obj):
        annotated = getattr(obj, 'events_count', None)
        if annotated is not None:
            return annotated
        return obj.events.count()

    def get_score_final(self, obj):
        # Score visível para TODOS os usuários (badge nos cards). A restrição a
        # admin/supervisor vale apenas para a PÁGINA de Score (atribuir/editar),
        # garantida nos endpoints /card-scores/ e /score-criterios/.
        try:
            return obj.score.score_final
        except CardScore.DoesNotExist:
            return None

    class Meta:
        model = Card
        fields = [
            'id', 'nome', 'descricao', 'script_url', 'projeto',
            'area', 'area_display', 'tipo', 'tipo_display',
            'responsavel', 'responsavel_name', 'responsavel_role',
            'responsavel_profile_picture_url',
            'status', 'status_display', 'prioridade', 'prioridade_display',
            'data_inicio', 'data_fim', 'finalizado_em',
            'segundos_corridos_desenvolvimento', 'dias_corridos_desenvolvimento',
            'dias_uteis_desenvolvimento',
            'minutos_uteis_desenvolvimento', 'horas_uteis_desenvolvimento',
            'complexidade_selected_items', 'complexidade_selected_development',
            'complexidade_custom_items',
            'card_comment', 'links', 'events_count', 'score_final',
            # Só LEITURA aqui: o kanban da SprintDetails precisa saber se o
            # checkbox está marcado para exibi-lo no diálogo; a escrita continua
            # sendo a do `CardSerializer`.
            'gerar_formulario_feedback',
            'created_at', 'updated_at',
        ]
        read_only_fields = fields


class CardMetricsSerializer(DevTimeFormattedMixin, serializers.ModelSerializer):
    """
    Serializer SLIM do Card para a página de Métricas.

    Retorna APENAS os campos usados pelos cálculos de métricas + o mínimo
    necessário para o modal de drill-down (clique em barra → lista de cards).
    Sem nested completos, sem SerializerMethodField, sem display_X. Reduz o
    payload em ~70% vs CardSerializer e elimina o N+1 do events_count.

    Campos denormalizados via select_related('projeto', 'projeto__sprint'):
    - projeto_nome, projeto_is_system, projeto_arquivado
    - sprint (id da sprint do projeto)

    display_X e nomes de área/tipo são derivados no frontend a partir de
    CARD_AREAS/CARD_TYPES (constantes), evitando duplicação no payload.
    """
    projeto_nome = serializers.CharField(source='projeto.nome', read_only=True)
    projeto_is_system = serializers.BooleanField(source='projeto.is_system', read_only=True)
    projeto_arquivado = serializers.BooleanField(source='projeto.arquivado', read_only=True)
    sprint = serializers.PrimaryKeyRelatedField(source='projeto.sprint', read_only=True)

    class Meta:
        model = Card
        fields = [
            'id',
            'nome',
            'status',
            'area',
            'tipo',
            'responsavel',
            'projeto',
            'projeto_nome',
            'projeto_is_system',
            'projeto_arquivado',
            'sprint',
            'data_inicio',
            'data_fim',
            'finalizado_em',
            'segundos_corridos_desenvolvimento',
            'dias_corridos_desenvolvimento',
            'dias_uteis_desenvolvimento',
            'minutos_uteis_desenvolvimento',
            'horas_uteis_desenvolvimento',
            'created_at',
            'updated_at',
        ]
        read_only_fields = fields


class EventSerializer(serializers.ModelSerializer):
    card_detail = CardSerializer(source='card', read_only=True)
    usuario_name = serializers.SerializerMethodField()
    
    def get_usuario_name(self, obj):
        return format_user_name(obj.usuario)
    tipo_display = serializers.CharField(source='get_tipo_display', read_only=True)

    def validate_card(self, card):
        """Evento (pendência/prioridade/tag/comentário) só em card do escopo.

        Escrever um evento é escrever DENTRO do card: a pendência aparece na
        tela do setor dono. E a resposta do POST já devolve o `card_detail`
        inteiro, então aceitar um card de outro setor vazava o card na própria
        resposta da criação — sem depender da listagem, que é escopada à parte.
        """
        return _checar_destino_do_setor(
            self, card, 'card_id', scope_cards, cards_editaveis,
            'Card não encontrado.',
            'Este card pertence a outro setor e foi compartilhado apenas para '
            'visualização — não é possível registrar eventos nele.')

    def validate_usuario(self, usuario):
        """Autoria do evento só entre as pessoas que quem escreve enxerga.

        O `perform_create` do viewset preenche `usuario` com o autor da requisição
        APENAS quando o campo vem vazio — mandar um id qualquer no payload
        sobrepõe isso. Sem o gate, dava para (1) ler `usuario_name` de qualquer
        funcionário na própria resposta do POST e (2) assinar a pendência/o
        comentário com o nome de alguém de outro setor, que apareceria na tela do
        time dono do card como se tivesse escrito aquilo.
        """
        return _checar_pessoa_do_setor(
            self, usuario, 'usuario_id', 'Usuário não encontrado.')

    class Meta:
        model = Event
        fields = ['id', 'card', 'card_detail', 'tipo', 'tipo_display', 'descricao', 
                 'motivo', 'usuario', 'usuario_name', 'data']
        read_only_fields = ['data']


class CardLogSerializer(serializers.ModelSerializer):
    usuario_name = serializers.SerializerMethodField()
    usuario_role = serializers.SerializerMethodField()
    usuario_role_display = serializers.SerializerMethodField()
    tipo_evento_display = serializers.CharField(source='get_tipo_evento_display', read_only=True)
    
    def get_usuario_name(self, obj):
        return format_user_name(obj.usuario)
    
    def get_usuario_role(self, obj):
        return obj.usuario.role if obj.usuario else None
    
    def get_usuario_role_display(self, obj):
        return obj.usuario.get_role_display() if obj.usuario else None

    def validate_card(self, card):
        """Linha de timeline só em card do escopo de quem escreve.

        Último satélite do card que faltava fechar: `Event`, `CardAnexo`,
        `WeeklyPriority` e `CardDueDateChangeRequest` já validam o destino aqui,
        e o `CardLog` era o único que dependia só do `checar_escrita_no_pai` do
        `perform_create`. A diferença importa no meio da migração: aquele gate
        obedece à flag de ESCRITA, então com apenas `SETOR_SCOPING_ENABLED`
        ligada um `POST /api/card-logs/ {"card": <id do setor B>}` ainda gravava
        uma linha na timeline alheia — e o 201 confirmava a existência do id
        (card inexistente responde "pk inválida", card de outro setor respondia
        criado), que é o mesmo oráculo que os irmãos fecham.

        Gate de escrita também, e não só de visibilidade: o log é conteúdo do
        time dono e aparece na tela dele, então card emprestado apenas para
        LEITURA não recebe linha nova — mesma regra de `checar_escrita_no_pai`,
        só que aplicada antes, para virar 400 no campo em vez de 403 genérico.
        """
        return _checar_destino_do_setor(
            self, card, 'card_id', scope_cards, cards_editaveis,
            'Card não encontrado.',
            'Este card pertence a outro setor e foi compartilhado apenas para '
            'visualização — não é possível registrar histórico nele.')

    def validate_usuario(self, usuario):
        """Autoria do log só entre as pessoas que quem escreve enxerga.

        Igual ao EventSerializer — o `perform_create` só preenche `usuario` quando
        o payload o omite —, com dois agravantes. Na leitura, este serializer
        devolve `usuario_name`, `usuario_role` E `usuario_role_display`: o POST
        vira um oráculo de nome + cargo de qualquer funcionário. Na escrita, o log
        é a TIMELINE do card, criada por append e sem PATCH/DELETE justamente para
        servir de prova do que aconteceu — assinar uma linha com o nome de alguém
        de outro setor corrompe exatamente aquilo que o histórico deveria garantir.
        """
        return _checar_pessoa_do_setor(
            self, usuario, 'usuario_id', 'Usuário não encontrado.')

    class Meta:
        model = CardLog
        fields = ['id', 'card', 'tipo_evento', 'tipo_evento_display', 
                 'descricao', 'usuario', 'usuario_name', 'usuario_role', 'usuario_role_display', 'data']
        read_only_fields = ['data']


class NotificationSerializer(serializers.ModelSerializer):
    tipo_display = serializers.CharField(source='get_tipo_display', read_only=True)

    class Meta:
        model = Notification
        fields = ['id', 'tipo', 'tipo_display', 'titulo', 'mensagem', 'lida',
                 'data_criacao', 'card_id', 'sprint_id', 'project_id', 'metadata']
        read_only_fields = ['data_criacao']


class NotificationPreferenceSerializer(serializers.ModelSerializer):
    """Preferências do usuário sobre quais tipos de notificação receber.
    Read/write nos 11 booleans (4 default OFF + 7 default ON)."""

    class Meta:
        model = UserNotificationPreference
        fields = [
            # 7 default ON
            'card_updated', 'card_deleted', 'project_created',
            'card_overdue', 'card_due_24h', 'card_due_1h', 'card_due_10min',
            # 4 default OFF
            'card_created', 'card_moved', 'sprint_created', 'role_changed',
            # read-only
            'updated_at',
        ]
        read_only_fields = ['updated_at']


class WeeklyPriorityConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = WeeklyPriorityConfig
        fields = ['id', 'horario_limite', 'fechamento_automatico', 'semana_fechada', 'created_at', 'updated_at']
        read_only_fields = ['created_at', 'updated_at']


class WeeklyPrioritySerializer(serializers.ModelSerializer):
    card_detail = CardSerializer(source='card', read_only=True)
    usuario_name = serializers.SerializerMethodField()
    definido_por_name = serializers.SerializerMethodField()
    is_concluido = serializers.BooleanField(read_only=True)
    is_atrasado = serializers.BooleanField(read_only=True)
    
    def get_usuario_name(self, obj):
        return format_user_name(obj.usuario)
    
    def get_definido_por_name(self, obj):
        return format_user_name(obj.definido_por)

    def validate_usuario(self, usuario):
        """Prioridade da semana só para pessoa que quem define enxerga.

        `usuario` é o ALVO da prioridade e vem inteiro do cliente (o modal manda
        `{usuario, card, semana_*}`). A resposta devolve `usuario_name`, então o
        POST já vazava o nome; e a prioridade fica pendurada na agenda da pessoa,
        que a vê na tela dela sem poder removê-la. `manage_weekly_priorities`
        (a única checagem que existia, no `perform_create`) não fecha isso: é
        permissão de cargo, vale em todo lugar e não implica `view_cross_setor` —
        um supervisor de um setor podia definir a semana de gente de outro.
        """
        return _checar_pessoa_do_setor(
            self, usuario, 'usuario_id', 'Usuário não encontrado.')

    def validate_definido_por(self, definido_por):
        """Autor da prioridade só entre as pessoas que quem define enxerga.

        Hoje é cinto e suspensório: `perform_create`/`perform_update` sempre
        passam `definido_por=request.user` para o `save()`, e o kwarg vence o que
        veio no payload — o valor do cliente é descartado antes de gravar. O gate
        fica porque o campo É gravável no serializer (está em `fields`, fora de
        `read_only_fields`) e a garantia vive hoje só no viewset: se um caminho
        novo salvar este serializer sem o override, o campo volta a aceitar
        qualquer id de usuário. Rejeição legítima nunca acontece — o único valor
        que o produto grava é o próprio operador, e `scope_users` sempre inclui
        quem pergunta.
        """
        return _checar_pessoa_do_setor(
            self, definido_por, 'definido_por_id', 'Usuário não encontrado.')

    def validate_card(self, card):
        """Prioridade da semana só sobre card do escopo de quem define.

        Mesma família dos outros satélites do card (evento, anexo, pedido de
        prazo): `card` é gravável e o serializer devolve `card_detail` completo,
        então o 201 do POST já entregava o card de outro setor — com
        `projeto_detail` e `sprint_detail` aninhados — mesmo com o
        `get_queryset` do viewset escopado por `scope_weekly_priorities` (a
        resposta da própria escrita não passa por listagem nenhuma). Só
        `manage_weekly_priorities` não fecha isto: é permissão de cargo e não
        implica `view_cross_setor`.

        Gate de escrita também, e não só de visibilidade: a prioridade fica
        pendurada NO card e aparece para o setor dono, ou seja, é conteúdo do
        time — diferente do pin, que é marcador pessoal. Card emprestado apenas
        para LEITURA não recebe conteúdo novo, como em `checar_escrita_no_pai`.
        """
        return _checar_destino_do_setor(
            self, card, 'card_id', scope_cards, cards_editaveis,
            'Card não encontrado.',
            'Este card pertence a outro setor e foi compartilhado apenas para '
            'visualização — não é possível defini-lo como prioridade da semana.')

    class Meta:
        model = WeeklyPriority
        fields = ['id', 'usuario', 'usuario_name', 'card', 'card_detail', 
                 'semana_inicio', 'semana_fim', 'definido_por', 'definido_por_name',
                 'is_concluido', 'is_atrasado', 'created_at', 'updated_at']
        read_only_fields = ['created_at', 'updated_at', 'is_concluido', 'is_atrasado']


class CardDueDateChangeRequestSerializer(serializers.ModelSerializer):
    card_detail = CardSerializer(source='card', read_only=True)
    requested_by_name = serializers.SerializerMethodField()
    reviewed_by_name = serializers.SerializerMethodField()
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    def get_requested_by_name(self, obj):
        return format_user_name(obj.requested_by)

    def get_reviewed_by_name(self, obj):
        return format_user_name(obj.reviewed_by) if obj.reviewed_by else None

    def validate_card(self, card):
        """Pedido de prazo só para card do escopo de quem pede.

        A resposta do POST devolve o `card_detail` completo (mais
        `projeto_detail` e `sprint_detail`), então criar o pedido sobre um card
        alheio já vazava o card. E o registro entra na FILA de aprovação do setor
        dono: aprovado, ele muda o `data_fim` de um card que o solicitante nem
        deveria enxergar.
        """
        return _checar_destino_do_setor(
            self, card, 'card_id', scope_cards, cards_editaveis,
            'Card não encontrado.',
            'Este card pertence a outro setor e foi compartilhado apenas para '
            'visualização — não é possível solicitar alteração de prazo nele.')

    class Meta:
        model = CardDueDateChangeRequest
        fields = [
            'id',
            'card', 'card_detail',
            'requested_by', 'requested_by_name',
            'requested_date',
            'reason',
            'status', 'status_display',
            'reviewed_by', 'reviewed_by_name', 'reviewed_at',
            'created_at', 'updated_at',
        ]
        # requested_by deve ser preenchido pelo backend (perform_create).
        read_only_fields = ['requested_by', 'status', 'reviewed_by', 'reviewed_at', 'created_at', 'updated_at']


class CardReopenRequestSerializer(serializers.ModelSerializer):
    """Solicitação de reabertura de card fechado.

    Espelha `CardDueDateChangeRequestSerializer` (leia aquele primeiro): mesma
    forma de resposta para que a fila de pendências renderize as duas abas com
    o mesmo componente. A diferença de contrato é o campo obrigatório
    `nova_data_entrega` no lugar de `requested_date`.
    """
    card_detail = CardSerializer(source='card', read_only=True)
    requested_by_name = serializers.SerializerMethodField()
    reviewed_by_name = serializers.SerializerMethodField()
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    def get_requested_by_name(self, obj):
        return format_user_name(obj.requested_by)

    def get_reviewed_by_name(self, obj):
        return format_user_name(obj.reviewed_by) if obj.reviewed_by else None

    def validate_card(self, card):
        """Pedido de reabertura só para card do escopo de quem pede.

        Mesmas duas razões do irmão de prazo: a resposta do POST devolve o
        `card_detail` completo (criar o pedido sobre card alheio já vazaria o
        card), e o registro entra na FILA do setor dono — aprovado, ele MUDA O
        STATUS de um card que o solicitante nem deveria enxergar.
        """
        return _checar_destino_do_setor(
            self, card, 'card_id', scope_cards, cards_editaveis,
            'Card não encontrado.',
            'Este card pertence a outro setor e foi compartilhado apenas para '
            'visualização — não é possível solicitar a reabertura dele.')

    class Meta:
        model = CardReopenRequest
        fields = [
            'id',
            'card', 'card_detail',
            'requested_by', 'requested_by_name',
            'nova_data_entrega',
            'reason',
            'status', 'status_display',
            'reviewed_by', 'reviewed_by_name', 'reviewed_at',
            'created_at', 'updated_at',
        ]
        # requested_by é preenchido pelo backend (perform_create); status e a
        # avaliação só mudam pelas actions approve/reject.
        read_only_fields = ['requested_by', 'status', 'reviewed_by', 'reviewed_at', 'created_at', 'updated_at']


class KanbanStageSerializer(serializers.ModelSerializer):
    # `key` é gerada a partir do `label` quando não for enviada pelo frontend.
    key = serializers.CharField(required=False, allow_blank=True)

    class Meta:
        model = KanbanStage
        fields = [
            'id',
            'key',
            'label',
            'is_terminal',
            'requires_required_data',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def validate(self, attrs):
        label = attrs.get('label')
        key = attrs.get('key')
        if label and (not key or not str(key).strip()):
            # slug simples compatível com status atuais (underscore + lowercase)
            normalized = unicodedata.normalize('NFKD', label)
            without_accents = ''.join(ch for ch in normalized if not unicodedata.combining(ch))
            slug = re.sub(r'[^a-zA-Z0-9]+', '_', without_accents).strip('_').lower()
            attrs['key'] = slug
        return attrs


class ProjectKanbanStageConfigSerializer(serializers.ModelSerializer):
    stage = KanbanStageSerializer(read_only=True)
    stage_key = serializers.CharField(source='stage.key', read_only=True)
    stage_label = serializers.CharField(source='stage.label', read_only=True)

    class Meta:
        model = ProjectKanbanStageConfig
        fields = [
            'id',
            'project',
            'order',
            'stage',
            'stage_key',
            'stage_label',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'project', 'created_at', 'updated_at', 'stage']


# ============================================================================
# Score (Pontuação de valor dos cards)
# ============================================================================

class ScoreCriterionOptionSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(required=False)

    class Meta:
        model = ScoreCriterionOption
        fields = ['id', 'valor', 'descricao', 'ordem']


class ScoreCriterionSerializer(serializers.ModelSerializer):
    """Critério configurável do formulário de Score, com suas opções aninhadas."""
    opcoes = ScoreCriterionOptionSerializer(many=True)

    class Meta:
        model = ScoreCriterion
        fields = ['id', 'nome', 'peso', 'negativo', 'ordem', 'ativo', 'opcoes',
                  'created_at', 'updated_at']
        read_only_fields = ['created_at', 'updated_at']

    def create(self, validated_data):
        opcoes = validated_data.pop('opcoes', [])
        criterion = ScoreCriterion.objects.create(**validated_data)
        for op in opcoes:
            op.pop('id', None)
            ScoreCriterionOption.objects.create(criterion=criterion, **op)
        return criterion

    def update(self, instance, validated_data):
        opcoes = validated_data.pop('opcoes', None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        # Sincroniza as opções substituindo o conjunto (não quebra scores já
        # atribuídos, pois CardScoreValue guarda o valor bruto, não uma FK).
        if opcoes is not None:
            instance.opcoes.all().delete()
            for op in opcoes:
                op.pop('id', None)
                ScoreCriterionOption.objects.create(criterion=instance, **op)
        return instance


class CardScoreValueSerializer(serializers.ModelSerializer):
    criterion_nome = serializers.CharField(source='criterion.nome', read_only=True)
    criterion_negativo = serializers.BooleanField(source='criterion.negativo', read_only=True)
    criterion_peso = serializers.DecimalField(
        source='criterion.peso', max_digits=5, decimal_places=2, read_only=True
    )

    class Meta:
        model = CardScoreValue
        fields = ['id', 'criterion', 'criterion_nome', 'criterion_negativo',
                  'criterion_peso', 'valor']


class ScoreHistorySerializer(serializers.ModelSerializer):
    # `usuario` está em `fields` sem `read_only`, mas este serializer só é usado
    # ANINHADO em `CardScoreSerializer.historico` com `read_only=True`: não há
    # endpoint que o alimente, e serializer read-only nunca roda `validate_*`.
    # Por isso ele não carrega o `_checar_pessoa_do_setor` dos campos de usuário
    # graváveis. Se um dia virar entrada (viewset próprio ou nested gravável),
    # `usuario` precisa do gate, como em EventSerializer/CardLogSerializer.
    usuario_nome = serializers.SerializerMethodField()
    acao_display = serializers.CharField(source='get_acao_display', read_only=True)

    class Meta:
        model = ScoreHistory
        fields = ['id', 'acao', 'acao_display', 'score_final', 'setor_solicitante',
                  'snapshot', 'usuario', 'usuario_nome', 'data']

    def get_usuario_nome(self, obj):
        return format_user_name(obj.usuario)


class CardScoreSerializer(serializers.ModelSerializer):
    """Serializer de leitura para a tabela de Score (7.4).

    `card` aparece em `fields` sem `read_only`, mas NENHUM dado do cliente passa
    por aqui: o `CardScoreViewSet` sobrescreve `create`, `update`,
    `partial_update` e `destroy` inteiros, lê o id direto de `request.data` e
    resolve o card com `scope_cards(...)` antes de gravar — o serializer só é
    instanciado sobre uma instância já persistida, para montar a resposta. Por
    isso ele não carrega o `_checar_destino_do_setor` dos irmãos. Se algum dia
    esses métodos voltarem ao padrão do DRF (`is_valid()` + `save()`), `card`
    precisa do gate: a resposta traz `card_nome`, `card_status`,
    `responsavel_name`, `responsavel_role`, `sprint_nome` e o `historico` inteiro.
    """
    valores = CardScoreValueSerializer(many=True, read_only=True)
    card_nome = serializers.CharField(source='card.nome', read_only=True)
    card_status = serializers.CharField(source='card.status', read_only=True)
    card_status_display = serializers.CharField(source='card.get_status_display', read_only=True)
    setor_solicitante_display = serializers.CharField(
        source='get_setor_solicitante_display', read_only=True
    )
    criado_por_nome = serializers.SerializerMethodField()
    atualizado_por_nome = serializers.SerializerMethodField()
    sprint_nome = serializers.SerializerMethodField()
    sprint_em_andamento = serializers.SerializerMethodField()
    responsavel = serializers.IntegerField(source='card.responsavel_id', read_only=True)
    responsavel_name = serializers.SerializerMethodField()
    responsavel_role = serializers.SerializerMethodField()
    historico = ScoreHistorySerializer(source='card.score_historico', many=True, read_only=True)

    class Meta:
        model = CardScore
        fields = [
            'id', 'card', 'card_nome', 'card_status', 'card_status_display',
            'setor_solicitante', 'setor_solicitante_display',
            'score_final', 'valores', 'historico',
            'sprint_nome', 'sprint_em_andamento',
            'responsavel', 'responsavel_name', 'responsavel_role',
            'criado_por', 'criado_por_nome', 'atualizado_por', 'atualizado_por_nome',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['score_final', 'criado_por', 'atualizado_por',
                            'created_at', 'updated_at']

    def get_criado_por_nome(self, obj):
        return format_user_name(obj.criado_por)

    def get_atualizado_por_nome(self, obj):
        return format_user_name(obj.atualizado_por)

    def get_responsavel_name(self, obj):
        return format_user_name(obj.card.responsavel) if obj.card.responsavel_id else None

    def get_responsavel_role(self, obj):
        return obj.card.responsavel.role if obj.card.responsavel_id else None

    def _sprint(self, obj):
        projeto = getattr(obj.card, 'projeto', None)
        return getattr(projeto, 'sprint', None) if projeto else None

    def get_sprint_nome(self, obj):
        sprint = self._sprint(obj)
        return sprint.nome if sprint else None

    def get_sprint_em_andamento(self, obj):
        sprint = self._sprint(obj)
        if not sprint or sprint.finalizada:
            return False
        agora = timezone.now()
        return sprint.data_inicio <= agora < sprint.fechamento_em


class CardPickerSerializer(serializers.ModelSerializer):
    """Serializer LEVE para o seletor de cards do modal de Score.

    Sem ``projeto_detail`` aninhado, fotos de perfil, métricas ou events_count —
    apenas o necessário para o preview do kanban e os filtros. Servido sem
    paginação (uma única request), com ``select_related`` no queryset.

    Serializer de SAÍDA: é instanciado só na action ``pickable-cards``, para
    serializar um queryset já escopado. `responsavel` e `projeto` aparecem em
    `fields` sem `read_only`, mas nenhum dado do cliente passa por aqui — daí a
    ausência dos `validate_*` de setor que CardSerializer carrega. Se um dia esta
    classe virar `serializer_class` de algum viewset, os dois campos precisam dos
    gates (`_checar_pessoa_do_setor` e `_checar_destino_do_setor`).
    """
    area_display = serializers.CharField(source='get_area_display', read_only=True)
    tipo_display = serializers.CharField(source='get_tipo_display', read_only=True)
    responsavel_name = serializers.SerializerMethodField()
    responsavel_role = serializers.SerializerMethodField()
    projeto_nome = serializers.CharField(source='projeto.nome', read_only=True)
    sprint = serializers.SerializerMethodField()
    sprint_nome = serializers.SerializerMethodField()
    score_final = serializers.SerializerMethodField()

    class Meta:
        model = Card
        fields = [
            'id', 'nome', 'descricao', 'prioridade', 'status',
            'area', 'area_display', 'tipo', 'tipo_display',
            'data_fim', 'script_url',
            'responsavel', 'responsavel_name', 'responsavel_role',
            'projeto', 'projeto_nome', 'sprint', 'sprint_nome', 'score_final',
        ]

    def get_responsavel_name(self, obj):
        return format_user_name(obj.responsavel) if obj.responsavel_id else None

    def get_responsavel_role(self, obj):
        return obj.responsavel.role if obj.responsavel_id else None

    def get_sprint(self, obj):
        return obj.projeto.sprint_id if (obj.projeto_id and obj.projeto.sprint_id) else None

    def get_sprint_nome(self, obj):
        sprint = getattr(obj.projeto, 'sprint', None) if obj.projeto_id else None
        return sprint.nome if sprint else None

    def get_score_final(self, obj):
        # Score visível para TODOS os usuários (badge nos cards). A restrição a
        # admin/supervisor vale apenas para a PÁGINA de Score (atribuir/editar),
        # garantida nos endpoints /card-scores/ e /score-criterios/.
        try:
            return obj.score.score_final
        except CardScore.DoesNotExist:
            return None


# Extensões aceitas em anexos de card: imagem, PDF, planilha, documento, texto,
# apresentação e zip (allowlist). Executáveis/scripts e SVG (vetor de XSS quando
# servido inline) ficam de fora por segurança.
CARD_ANEXO_ALLOWED_EXTENSIONS = frozenset({
    # imagem
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp',
    # pdf
    'pdf',
    # planilha
    'csv', 'xls', 'xlsx', 'ods',
    # documento / texto
    'doc', 'docx', 'txt', 'rtf', 'odt', 'md',
    # apresentação
    'ppt', 'pptx', 'odp',
    # compactado
    'zip',
})
CARD_ANEXO_MAX_FILE_SIZE = 25 * 1024 * 1024  # 25 MB


class CardAnexoSerializer(serializers.ModelSerializer):
    """Anexo de arquivo de um card. `arquivo` é write-only; a leitura expõe
    `arquivo_url` (URL absoluta), `nome` e `tamanho`."""

    arquivo_url = serializers.SerializerMethodField()
    nome = serializers.SerializerMethodField()
    enviado_por_nome = serializers.SerializerMethodField()

    class Meta:
        model = CardAnexo
        fields = [
            'id', 'card', 'arquivo', 'arquivo_url', 'nome',
            'tamanho', 'enviado_por_nome', 'criado_em',
        ]
        read_only_fields = ['id', 'tamanho', 'criado_em']
        extra_kwargs = {'arquivo': {'write_only': True}}

    def get_arquivo_url(self, obj):
        if not obj.arquivo:
            return None
        request = self.context.get('request')
        url = obj.arquivo.url
        return request.build_absolute_uri(url) if request else url

    def get_nome(self, obj):
        return obj.nome_original or os.path.basename(obj.arquivo.name)

    def get_enviado_por_nome(self, obj):
        return format_user_name(obj.enviado_por) if obj.enviado_por_id else None

    def validate_card(self, card):
        """Anexo só em card do escopo de quem envia.

        O `create` do viewset resolve o card direto em `Card.objects` e a única
        checagem que existia (`_pode_mutar`) pergunta se o card está TRAVADO,
        nunca de que setor ele é — este é o ponto onde o setor entra no fluxo de
        upload. Sem isto, um POST multipart com o id de um card do setor B
        gravava um arquivo de até 25 MB dentro dele, e a resposta 201 devolvia a
        `arquivo_url` absoluta (que `/media/` serve a qualquer autenticado).
        """
        return _checar_destino_do_setor(
            self, card, 'card_id', scope_cards, cards_editaveis,
            'Card não encontrado.',
            'Este card pertence a outro setor e foi compartilhado apenas para '
            'visualização — não é possível anexar arquivos nele.')

    def validate_arquivo(self, value):
        ext = os.path.splitext(value.name)[1].lower().lstrip('.')
        if ext not in CARD_ANEXO_ALLOWED_EXTENSIONS:
            raise serializers.ValidationError(
                'Tipo de arquivo não suportado. Envie imagem, PDF, CSV, Excel, '
                'documento, texto, apresentação ou zip.',
            )
        if value.size > CARD_ANEXO_MAX_FILE_SIZE:
            raise serializers.ValidationError('Arquivo muito grande (máx 25 MB).')
        return value
