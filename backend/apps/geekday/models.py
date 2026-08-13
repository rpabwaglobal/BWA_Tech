from django.conf import settings
from django.db import IntegrityError, models, transaction


class GeekDayGrupo(models.Model):
    """Conjunto de setores que sorteiam JUNTOS — a unidade do Geek Day.

    Decisão de produto: o Geek Day é POR SETOR, não da empresa inteira. O
    grupo existe para a exceção — o admin pode juntar dois ou mais setores que
    queiram fazer o ritual junto. A priori cada setor é o próprio grupo, e isso
    vale sem cadastro nenhum: `grupo_do_usuario` cria o grupo do setor na hora
    em que alguém abre a tela (ver lá).

    Este model era `GeekDayConfig`, um SINGLETON (pk=1) com um `current_cycle`
    único para toda a empresa. O ciclo agora é DO GRUPO, e é por isso que o
    rename foi feito de verdade (RenameModel, tabela preservada): resetar o
    sorteio de um setor não pode zerar a fila do setor vizinho, e o histórico
    de cada grupo tem de continuar de pé.
    """
    nome = models.CharField(max_length=80, verbose_name='Nome do grupo')
    setores = models.ManyToManyField(
        'accounts.SetorCatalogo',
        through='geekday.GeekDayGrupoSetor',
        related_name='geekday_grupos',
        blank=True,
        verbose_name='Setores do grupo',
    )
    current_cycle = models.PositiveIntegerField(default=1, verbose_name='Ciclo Atual')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='Atualizado em')

    class Meta:
        ordering = ['nome']
        verbose_name = 'Grupo de Geek Day'
        verbose_name_plural = 'Grupos de Geek Day'

    def __str__(self):
        return self.nome


class GeekDayGrupoSetor(models.Model):
    """Vínculo grupo↔setor.

    Existe como tabela explícita (em vez de deixar o Django criar a tabela do
    M2M) por UM motivo: `setor` é `OneToOneField`, ou seja, o banco carrega um
    UNIQUE em `setor_id` e um setor não consegue pertencer a dois grupos.

    Por que a garantia tem de estar no BANCO e não só na API: um setor em dois
    grupos colocaria o mesmo usuário em dois sorteios, com dois `current_cycle`
    diferentes — não haveria resposta para "esta pessoa já foi sorteada neste
    ciclo?". Preferi o `OneToOneField` a um `UniqueConstraint` sobre a tabela
    automática porque a tabela automática não é declarável em `Meta`, e a
    tabela explícita ainda deixa o vínculo auditável (`added_at`) e permite
    crescer depois (quem juntou, quando) sem outra migração de rename.
    """
    grupo = models.ForeignKey(
        GeekDayGrupo,
        on_delete=models.CASCADE,
        related_name='vinculos_setor',
        verbose_name='Grupo',
    )
    setor = models.OneToOneField(
        'accounts.SetorCatalogo',
        on_delete=models.CASCADE,
        related_name='geekday_vinculo',
        verbose_name='Setor',
    )
    added_at = models.DateTimeField(auto_now_add=True, verbose_name='Vinculado em')

    class Meta:
        verbose_name = 'Setor do grupo de Geek Day'
        verbose_name_plural = 'Setores dos grupos de Geek Day'

    def __str__(self):
        return f'{self.setor} → {self.grupo}'


def grupo_do_setor(setor):
    """Grupo que contém `setor`, criando um grupo só dele se não houver nenhum.

    É este `get_or_create` implícito que faz valer "a priori cada setor é o
    próprio grupo": setor novo passa a sortear sozinho no dia em que é criado,
    sem exigir que alguém lembre de configurar grupo para ele.
    """
    vinculo = (GeekDayGrupoSetor.objects
               .select_related('grupo')
               .filter(setor=setor)
               .first())
    if vinculo:
        return vinculo.grupo
    try:
        with transaction.atomic():
            grupo = GeekDayGrupo.objects.create(nome=setor.nome)
            GeekDayGrupoSetor.objects.create(grupo=grupo, setor=setor)
            return grupo
    except IntegrityError:
        # Corrida: duas requisições do mesmo setor chegaram juntas e o UNIQUE
        # de `setor` barrou a segunda. O `atomic` desfez o grupo órfão que ela
        # tinha acabado de criar, então basta reler o vínculo que venceu.
        vinculo = (GeekDayGrupoSetor.objects
                   .select_related('grupo')
                   .filter(setor=setor).first())
        if vinculo is None:
            # Não havia corrida — o IntegrityError é outro (foi assim que
            # apareceu a sequência de ids dessincronizada, corrigida em
            # geekday/0008). Deixar subir: engolir aqui trocaria a causa real
            # por um "não encontrado" enganoso.
            raise
        return vinculo.grupo


def grupo_do_usuario(user):
    """Grupo de Geek Day do usuário: o grupo do seu setor PRIMÁRIO.

    Sem setor primário cai no setor padrão do sistema ("Sem Setor"), que é
    exatamente onde `usuarios_do_grupo` vai procurá-lo — as duas pontas
    precisam concordar, senão a pessoa abriria uma roleta em que ela mesma não
    aparece.
    """
    from apps.accounts.scoping import (setor_padrao_do_sistema,
                                       setor_primario_do_usuario)

    setor = setor_primario_do_usuario(user) or setor_padrao_do_sistema()
    if setor is None:
        # Catálogo de setores vazio — só acontece em base recém-criada, antes
        # do seed. Sem setor não há como nomear o grupo por ele; devolve o
        # grupo que existir para não deixar a tela sem ciclo.
        return (GeekDayGrupo.objects.order_by('id').first()
                or GeekDayGrupo.objects.create(nome='Geek Day'))
    return grupo_do_setor(setor)


def usuarios_do_grupo(grupo):
    """Quem PERTENCE ao grupo: usuários ATIVOS, sem admin, cujo setor PRIMÁRIO
    está no grupo.

    >>> ATENÇÃO: pertencer ao grupo NÃO é o mesmo que poder ser sorteado. <<<
    Quem entra na roleta é `participantes_do_sorteio` (mais estreito). Esta
    função responde "esta pessoa é deste Geek Day?" — pergunta de PERTINÊNCIA,
    usada para resolver um id recebido pela API e, principalmente, para
    DESFAZER o passado: quem foi sorteado ontem e hoje não participa mais
    continua tendo de ser encontrável, senão o gestor perde o único caminho de
    corrigir o próprio histórico. Recortar participação aqui quebraria os dois
    lados de uma vez.

    PRIMÁRIO, e não "qualquer setor do usuário", porque é assim que
    `grupo_do_usuario` decide o grupo da pessoa — e as duas pontas têm de dar a
    mesma resposta. Alguém com vínculo em dois setores de grupos diferentes
    apareceria em duas roletas, com dois `current_cycle`, e "já foi sorteado
    neste ciclo?" deixaria de ter resposta. É a mesma ambiguidade que o UNIQUE
    de `GeekDayGrupoSetor.setor` fecha do lado do setor.

    A regra de qual é o primário é a de
    `apps.accounts.scoping.setor_primario_do_usuario` (vínculo `is_primary`,
    senão o mais antigo, senão o CharField legado `User.setor`, senão o setor
    padrão do sistema), resolvida aqui em memória: a tabela de vínculos é
    pequena e uma consulta só evita repetir a decisão usuário a usuário.

    NÃO passa por `scope_users`: a pergunta aqui não é "o que posso ver" e sim
    "quem participa" — segmentação de PRODUTO, que vale com as flags de escopo
    desligadas.
    """
    from django.db.models import Q

    from apps.accounts.models import SetorCatalogo, User, UserSetor
    from apps.accounts.scoping import setor_padrao_do_sistema

    setores_ids = set(grupo.setores.values_list('id', flat=True))
    codenames = set(grupo.setores.values_list('codename', flat=True))

    primario_por_usuario = {}
    for user_id, setor_id in (UserSetor.objects
                              .order_by('-is_primary', 'added_at')
                              .values_list('user_id', 'setor_id')):
        primario_por_usuario.setdefault(user_id, setor_id)
    com_vinculo = set(primario_por_usuario)
    do_grupo = {uid for uid, sid in primario_por_usuario.items() if sid in setores_ids}

    # Sem vínculo M2M nenhum, o primário é o CharField legado; e se ele também
    # estiver vazio, o setor padrão do sistema. Mesmo encadeamento de
    # `setor_primario_do_usuario` — cadastro incompleto não pode fazer alguém
    # sumir do sorteio.
    condicao = Q(pk__in=do_grupo) | (Q(setor__in=codenames) & ~Q(pk__in=com_vinculo))

    padrao = setor_padrao_do_sistema()
    if padrao is not None and padrao.pk in setores_ids:
        # Cai no setor padrão quem não tem vínculo M2M E cujo CharField legado
        # não resolve para nenhum setor do catálogo — é literalmente o "return
        # None" de `setor_primario_do_usuario`, e portanto onde
        # `grupo_do_usuario` coloca essa pessoa.
        #
        # O caso do codename MORTO não é teórico: excluir um setor do catálogo
        # derruba os `UserSetor` por CASCADE, mas `User.setor` é CharField
        # (espelho, não FK) e fica com o texto do setor que já não existe. Sem
        # este `~Q(setor__in=...)` a pessoa abriria o Geek Day do grupo padrão
        # e não se encontraria na roleta — as duas pontas discordariam.
        catalogo = set(SetorCatalogo.objects.values_list('codename', flat=True))
        condicao |= ((Q(setor__isnull=True) | Q(setor='') | ~Q(setor__in=catalogo))
                     & ~Q(pk__in=com_vinculo))

    return (User.objects
            .filter(is_active=True)
            .exclude(role='admin')
            .filter(condicao))


def participantes_do_sorteio(grupo):
    """Quem PODE SER SORTEADO no grupo: pertence a ele E participa do trabalho.

    É a outra metade da assimetria de `usuarios_do_grupo`:

      (A) ESCOLHER quem entra na roleta  -> aqui;
      (B) RESOLVER alguém já gravado     -> `usuarios_do_grupo` (mais amplo).

    O corte de participação é por PERMISSÃO, nunca por nome de cargo: quem não
    tem `view_content` não enxerga sprint, projeto nem card, então não tem o
    que apresentar no Geek Day — é o "visitante só assiste". Fazendo assim, um
    cargo criado amanhã sem essa permissão some da roleta sozinho, sem ninguém
    tocar em código. `view_geekday` NÃO serve para isto: ela é sobre ASSISTIR
    ao ritual (e ver o histórico), não sobre participar dele.

    O critério vem inteiro de `ids_que_participam_do_trabalho` — que já soma
    permissão individual, grupos, superuser e `Cargo.permissoes_padrao`. NÃO
    reimplementar nada disso aqui: duas definições de "participa" divergiriam
    em silêncio.

    Devolve QUERYSET, como `usuarios_do_grupo`, porque os chamadores encadeiam
    `.count()` e `.exclude()` em cima.
    """
    from apps.accounts.permissions import ids_que_participam_do_trabalho

    return usuarios_do_grupo(grupo).filter(pk__in=ids_que_participam_do_trabalho())


class GeekDayDraw(models.Model):
    """Modelo para rastrear sorteios do Geek Day"""
    # O sorteio pertence ao GRUPO: é o grupo que tem fila, ciclo e histórico.
    # PROTECT porque apagar um grupo não pode levar junto a memória de quem já
    # apresentou (a API recusa excluir grupo com sorteio; ver GeekDayGrupoViewSet).
    grupo = models.ForeignKey(
        GeekDayGrupo,
        on_delete=models.PROTECT,
        related_name='sorteios',
        verbose_name='Grupo do Geek Day',
    )
    # O histórico de sorteios é registro do ciclo, não do indivíduo: manter a
    # linha (data, ciclo) mesmo sem o usuário evita reabrir um ciclo já fechado.
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='geekday_draws',
        null=True,
        blank=True,
        verbose_name='Usuário Sorteado'
    )
    sorteado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='geekday_draws_made',
        null=True,
        blank=True,
        verbose_name='Sorteado Por'
    )
    data_sorteio = models.DateTimeField(
        auto_now_add=True,
        verbose_name='Data do Sorteio'
    )
    data_apresentacao = models.DateField(
        blank=True,
        null=True,
        verbose_name='Data de Apresentação'
    )
    marcado_manual = models.BooleanField(
        default=False,
        verbose_name='Marcado Manualmente',
        help_text='Indica se foi marcado manualmente como sorteado'
    )
    observacoes = models.TextField(
        blank=True,
        null=True,
        verbose_name='Observações'
    )
    cycle = models.PositiveIntegerField(
        default=1,
        verbose_name='Ciclo',
        help_text='Ciclo do sorteio para permitir reset sem apagar histórico'
    )

    class Meta:
        verbose_name = 'Sorteio Geek Day'
        verbose_name_plural = 'Sorteios Geek Day'
        ordering = ['-data_sorteio']

    def __str__(self):
        # `usuario` é SET_NULL: a linha sobrevive ao offboarding de quem
        # apresentou (é isso que preserva o ciclo). O rótulo, portanto, não
        # pode assumir que há usuário — o admin do Django chama `__str__` ao
        # listar e ao confirmar exclusões, e quebraria com AttributeError.
        nome = self.usuario.username if self.usuario else 'usuário removido'
        return f"{nome} - {self.data_sorteio.strftime('%d/%m/%Y %H:%M')}"
