# Modelo de dados

> Parte da [Documentação de Arquitetura do BWA Tech](README.md).
> Levantada por leitura direta do código; o que não foi confirmado está
> em [Riscos e lacunas](12-riscos-e-lacunas.md).


## Modelo de dados

134 modelos foram catalogados. Abaixo, agrupados por app, com o papel de cada um
e os campos que importam. Onde dois passes descreveram o mesmo modelo, ficou a
descrição mais detalhada.

### `backend/apps/accounts/models.py`

#### BulkOperationAudit

Registro de uma operação em massa (cargo/setor/permissões) guardando o estado ANTERIOR de cada usuário afetado, para permitir reversão. `snapshot` = {str(user_id): {campo: valor_anterior}}.


**Campos**

- operador: FK User (SET_NULL, null, related_name='+')
- tipo: CharField(max_length=20, choices=['cargo','setor','permissions'])
- descricao: CharField(max_length=255, blank=True)
- snapshot: JSONField(default=dict)
- revertido: BooleanField(default=False)
- created_at: DateTimeField(auto_now_add)

**Relações**

- operador → User

**Constraints e regras**

- Meta.ordering = ['-created_at']
- NÃO existe endpoint de reversão em accounts/urls.py — o campo `revertido` nunca é escrito por nenhuma view deste app

#### Cargo

Catálogo de cargos atribuíveis. `permissoes_padrao` é FONTE DE AUTORIDADE (resolvida a cada has_perm pelo CargoPermissionBackend), não um template de conveniência.


**Campos**

- codename: SlugField(max_length=40, unique=True) — gerado por slugify do nome na criação via API (_unique_codename)
- nome: CharField(max_length=60)
- is_system: BooleanField(default=False) — a API força False em tudo que ela cria
- cor: CharField(max_length=7, default='#94a3b8')
- label_curto: CharField(max_length=16, blank=True) — badges compactos
- descricao: CharField(max_length=255, blank=True)
- permissoes_padrao: JSONField(default=list) — lista de codenames do PERMISSION_CATALOG
- created_at: DateTimeField(auto_now_add)

**Relações**

- Ligado a User apenas por `User.role == Cargo.codename` (string), NÃO por ForeignKey

**Constraints e regras**

- Meta.ordering = ['nome']
- `delete()` levanta ValidationError se is_system=True (defesa em profundidade: vale para shell e /admin, não só API)
- Cargos de sistema semeados: 'admin' (todos os codenames) e 'visitante' (lista vazia) — migration 0013

#### CompartilhamentoSetorBase (abstrata) + NivelCompartilhamento

Base dos vínculos 'o setor X enxerga este item, neste nível'. Abstrata de propósito: cada tipo de conteúdo (Sprint/Project/Card/Chamado) tem a sua tabela concreta, com FK de verdade indexada e CASCADE, em vez de uma tabela genérica com id solto.


**Campos**

- setor: FK SetorCatalogo (CASCADE, related_name='+') — o setor CONVIDADO
- nivel: CharField(max_length=10, choices=NivelCompartilhamento, default='leitura') — 'leitura' | 'edicao'
- compartilhado_em: DateTimeField(auto_now_add)
- compartilhado_por: FK User (SET_NULL, null, blank, related_name='+')

**Relações**

- Herdada por SprintCompartilhamento, ProjectCompartilhamento, CardCompartilhamento (apps/projects/models.py) e ChamadoCompartilhamento (apps/formularios/models.py)

**Constraints e regras**

- Meta.abstract = True
- O nível governa APENAS o que o compartilhamento concede: não amplia as permissões do cargo

#### SetorCatalogo

Catálogo de setores/departamentos — o eixo de segmentação. Distinto de `SetorSolicitante` (apps/projects/models.py), que é conceito não relacionado (setor do solicitante de um Score).


**Campos**

- codename: SlugField(max_length=40, unique=True)
- nome: CharField(max_length=60)
- is_system: BooleanField(default=False)
- cor: CharField(max_length=7, default='#94a3b8')
- label_curto: CharField(max_length=16, blank=True)
- descricao: CharField(max_length=255, blank=True)
- created_at: DateTimeField(auto_now_add)

**Relações**

- usuarios → User (M2M reverso via UserSetor)
- Referenciado por Sprint/Project/Card (PROTECT) e ChamadoSuporte (SET_NULL) — ver views.SetorViewSet.destroy

**Constraints e regras**

- Meta.ordering = ['nome']
- `delete()` levanta ValidationError se is_system=True
- Setor de sistema semeado: 'sem_setor' / 'Sem Setor' (migration 0016) — o balde dos não classificados

#### User

Usuário da plataforma (AbstractUser). `AUTH_USER_MODEL='accounts.User'`. `role` é um codename de Cargo (não um enum fechado) e `setor` é o espelho do vínculo primário — a autoridade do escopo é o M2M `setores`.


**Campos**

- role: CharField(max_length=40) — choices dinâmicas via callable get_cargo_choices (lidas da tabela Cargo), default Role.VISITANTE ('visitante')
- setor: CharField(max_length=40, null=True, blank=True, default='') — choices dinâmicas via get_setor_choices; setor PRIMÁRIO, só exibição/compatibilidade
- setores: M2M para SetorCatalogo através de UserSetor (through_fields=('user','setor')), related_name='usuarios' — a AUTORIDADE do escopo
- profile_picture: ImageField(upload_to='profiles/', null, blank)
- recovery_code: CharField(max_length=14, unique=True, null, blank) — formato XXXX-XXXX-XXXX, sem expiração por tempo
- created_at: DateTimeField(auto_now_add)
- updated_at: DateTimeField(auto_now)
- (+ todos os campos de AbstractUser: username, email, first_name, last_name, is_active, is_superuser, user_permissions, groups, date_joined)

**Relações**

- setores → SetorCatalogo (M2M via UserSetor)
- setor_links → UserSetor (related_name)
- user_permissions → auth.Permission (permissões personalizadas, resolvidas pelo ModelBackend)

**Constraints e regras**

- Meta.ordering = ['username']
- `save()` força role='admin' quando is_superuser=True
- `delete()` NÃO apaga: desativa (is_active=False), revoga todos os Tokens e chama `desatribuir_cards_de_usuario_desativado` com operador=None
- property `is_admin` = role == 'admin'; NÃO existem is_supervisor/is_gerente/is_desenvolvedor — comentário no código proíbe explicitamente comparar role

#### UserSetor

Vínculo N:N usuário↔setor. É a AUTORIDADE do escopo por setor (scoping.py lê daqui); `is_primary` é espelhado no CharField `User.setor`.


**Campos**

- user: FK User (CASCADE, related_name='setor_links')
- setor: FK SetorCatalogo (CASCADE, related_name='user_links')
- is_primary: BooleanField(default=False)
- added_by: FK User (SET_NULL, null, blank, related_name='+')
- added_at: DateTimeField(auto_now_add)

**Relações**

- user → User
- setor → SetorCatalogo
- added_by → User (quem criou o vínculo)

**Constraints e regras**

- unique_together = [('user','setor')]

### `backend/apps/accounts/permission_catalog.py`

#### PermissaoPlataforma

Modelo 'fantasma' SEM tabela própria (managed=False, default_permissions=()). Existe só para registrar, via Meta.permissions, as 29 permissões do PERMISSION_CATALOG em auth_permission. Todas as permissões da plataforma vivem sob app_label='accounts', model='permissaoplataforma'.

**Constraints e regras**

- managed = False (nenhuma tabela é criada)
- Cada mudança no catálogo vira uma migration AlterModelOptions (0012, 0017, 0018, 0021, 0023, 0025)

### `backend/apps/projects/models.py`

#### CARD_STATUS_FECHADOS (constante)

Tupla (FINALIZADO, INVIABILIZADO). 'Card aberto' é SEMPRE definido pela negativa (`.exclude(status__in=CARD_STATUS_FECHADOS)`) em ~9 pontos do projeto — é o lado seguro: status desconhecido cai em 'aberto', ou seja, continua sendo trabalho vivo.


**Campos**

- CardStatus.FINALIZADO
- CardStatus.INVIABILIZADO

#### CachedHoliday

Cache local de feriados de Natal/RN (Feriados API) usado pelo cálculo de dias úteis. Leitura local apenas — `business_time.py` nunca faz HTTP no caminho da request.


**Campos**

- date: DateField
- year: PositiveSmallIntegerField
- name: CharField(200)
- tipo: CharField(20)
- ibge: PositiveIntegerField(default=2408102) — Natal/RN
- synced_at: auto_now

**Constraints e regras**

- UniqueConstraint(['date','ibge'], name='projects_cachedholiday_date_ibge_uniq')
- ordering = ['date']

#### Card

A unidade de trabalho real do sistema: tem status, prazo, responsável, métricas de tempo e histórico. Card NÃO aponta para Sprint — ele pertence a um Project, e o Project é que pertence à Sprint.


**Campos**

- nome: CharField(200)
- descricao: TextField(blank=True)
- script_url: URLField(500), blank/null
- projeto: FK Project, CASCADE (related_name='cards')
- area: CharField(20), choices=CardArea, default='backend'
- tipo: CharField(30), choices=CardType, default='feature'
- responsavel: FK User, SET_NULL, null/blank (related_name='cards_assigned')
- criado_por: FK User, SET_NULL, null/blank (related_name='cards_created')
- status: CharField(20), choices=CardStatus, default='a_desenvolver'
- prioridade: CharField(20), choices=Priority, default='media'
- data_inicio: DateTimeField null/blank — instante em que ENTROU EM DESENVOLVIMENTO, não a criação
- data_fim: DateTimeField null/blank — o prazo; alimenta atraso, alertas 24h/1h/10min e métricas
- finalizado_em: DateTimeField null/blank — última vez que passou a finalizado (preenchido no pre_save)
- segundos_corridos_desenvolvimento: PositiveIntegerField null/blank
- dias_uteis_desenvolvimento: PositiveSmallIntegerField null/blank
- minutos_uteis_desenvolvimento: PositiveIntegerField null/blank
- complexidade_selected_items: JSONField(default=list) — array de ids de itens da estimativa
- complexidade_selected_development: CharField(50) null/blank
- complexidade_custom_items: JSONField(default=list) — [{id,label,hours}]
- card_comment: TextField blank/null — recado de andamento; alterá-lo notifica quem tem manage_others_cards
- links: JSONField(default=list) — [{'url':...,'label':...}]
- gerar_formulario_feedback: BooleanField(default=False)
- setor: FK SetorCatalogo, PROTECT, blank, db_index — ESPELHO do projeto, reescrito a cada save()
- created_at / updated_at

**Relações**

- logs (CardLog), events (Event), anexos (CardAnexo), pins (CardPin), weekly_priorities (WeeklyPriority)
- score (OneToOne CardScore), score_historico (ScoreHistory)
- due_date_change_requests (CardDueDateChangeRequest), reopen_requests (CardReopenRequest)
- setores_compartilhados: M2M through CardCompartilhamento (related_name='cards_compartilhados')
- pedido_exibido: OneToOne reverso vindo de apps.feedbacks (usado sem importar aquele app)

**Constraints e regras**

- ordering = ['projeto','prioridade','created_at'] — ATENÇÃO: 'prioridade' ordena pela string gravada, em ordem alfabética
- nenhuma UniqueConstraint; a deduplicação por nome é feita por serviço (`dedupe_cards_mesmo_nome_no_projeto`)

#### CardAnexo

Arquivo anexado a um card (imagem, PDF, CSV, Excel, documento). Storage local em media/, servido por `config.views.serve_media`.


**Campos**

- card: FK Card, CASCADE (related_name='anexos')
- arquivo: FileField(upload_to=caminho_anexo_card) — nome no disco é uuid4().hex + extensão
- nome_original: CharField(255, blank=True) — o nome amigável mostrado na UI e no download
- tamanho: PositiveBigIntegerField(default=0)
- enviado_por: FK User, SET_NULL (related_name='card_anexos_enviados')
- criado_em: auto_now_add

**Constraints e regras**

- ordering = ['-criado_em']

#### CardCompartilhamento

Card avulso emprestado a outro setor, sem levar o projeto junto. Como `Card.setor` é espelho do projeto, esta é a ÚNICA forma de dar acesso a um card específico.


**Campos**

- card: FK Card, CASCADE (related_name='compartilhamentos')
- + os 4 campos herdados

**Constraints e regras**

- UniqueConstraint(['card','setor'], name='uniq_compartilhamento_card_setor')
- Index(['setor','nivel'], name='idx_compart_card_setor')

#### CardDateChangeRequestStatus (TextChoices)

Os três estados compartilhados pelas duas filas de solicitação.


**Campos**

- pending: 'Pendente' (default)
- approved: 'Aprovado'
- rejected: 'Recusado'

#### CardDueDateChangeRequest

Pedido de alteração do prazo (`Card.data_fim`), avaliado por quem tem a permissão. Aprovar substitui `data_fim` pela data solicitada — o card não muda de status.


**Campos**

- card: FK Card, CASCADE (related_name='due_date_change_requests')
- requested_by: FK User, SET_NULL, null/blank (related_name='due_date_change_requests_created')
- requested_date: DateTimeField — obrigatório
- reason: TextField blank/null
- status: CharField(20), choices=CardDateChangeRequestStatus, default='pending'
- reviewed_by: FK User, SET_NULL (related_name='due_date_change_requests_reviewed')
- reviewed_at: DateTimeField null/blank
- created_at / updated_at

**Constraints e regras**

- ordering = ['-created_at']
- Index(['status','-created_at']) — a fila de pendências
- Index(['card','status']) — a aba do card
- Index(['requested_by','-created_at']) — 'meus pedidos'

#### CardLog

Histórico imutável de eventos do card. tipo_evento cresceu ao longo das migrações 0008, 0015, 0033, 0044 e 0059.


**Campos**

- tipo_evento: CharField(30) choices CardLogEventType (8 valores, incluindo 'transferido_sprint' e 'reaberto')

**Relações**

- card: FK Card CASCADE
- usuario: FK User SET_NULL — null=True de propósito, para não obrigar a inventar autor em migração/shell

#### CardPin

Fixação pessoal de um card (atalho de acesso rápido em 'Meus Afazeres'). Removida automaticamente por signal quando o card fecha.


**Campos**

- user: FK User, CASCADE (related_name='pinned_cards')
- card: FK Card, CASCADE (related_name='pins')
- created_at: auto_now_add

**Constraints e regras**

- unique_together = [('user','card')]
- ordering = ['-created_at']
- Index(['user','-created_at'])

#### CardReopenRequest

Pedido de REABERTURA de um card fechado (finalizado ou inviabilizado). Irmão do CardDueDateChangeRequest de propósito: mesma anatomia, mesma fila, mesmo enum de status. O que muda é o efeito da aprovação — o card volta a 'a_desenvolver' e ganha o novo prazo, podendo ser reancorado na sprint em andamento.


**Campos**

- card: FK Card, CASCADE (related_name='reopen_requests')
- requested_by: FK User, SET_NULL, null/blank (related_name='reopen_requests_created')
- nova_data_entrega: DateTimeField — OBRIGATÓRIO (diferente de `reason`, que é opcional)
- reason: TextField blank/null
- status: CharField(20), choices=CardDateChangeRequestStatus, default='pending'
- reviewed_by: FK User, SET_NULL (related_name='reopen_requests_reviewed')
- reviewed_at: DateTimeField null/blank
- created_at / updated_at

**Constraints e regras**

- ordering = ['-created_at']
- Index(['status','-created_at'])
- Index(['card','status'])
- Index(['requested_by','-created_at'])

#### CardScoreValue

Valor escolhido para um critério dentro de um CardScore. Guarda o inteiro BRUTO, não uma FK para a opção.


**Campos**

- card_score: FK CardScore, CASCADE (related_name='valores')
- criterion: FK ScoreCriterion, CASCADE (related_name='valores_atribuidos')
- valor: IntegerField

**Constraints e regras**

- unique_together = [('card_score','criterion')]

#### CardStatus (TextChoices)

Os 6 estados do card. Os valores são idênticos às `KanbanStage.key` semeadas em 0028 — é essa igualdade que permite que a coluna do quadro e o status do card sejam a mesma string.


**Campos**

- a_desenvolver: 'A Desenvolver' (default)
- em_desenvolvimento: 'Em Desenvolvimento'
- parado_pendencias: 'Parado por Pendências'
- em_homologacao: 'Em Homologação'
- finalizado: 'Finalizado' (a etapa tem label 'Concluído')
- inviabilizado: 'Inviabilizado'

#### Event

Pendência/prioridade/tag/comentário do card. O evento pertence ao card, não a quem o registrou.

**Relações**

- card: FK Card CASCADE
- usuario: FK User SET_NULL

#### KanbanStage

Catálogo GLOBAL de etapas/colunas do Kanban. Uma linha por `key`; nenhuma coluna aparece em projeto nenhum só por existir aqui — quem coloca a coluna no quadro é `ProjectKanbanStageConfig`.


**Campos**

- key: CharField(50), unique=True — o valor que vai gravado em `Card.status`
- label: CharField(100) — o texto exibido; pode divergir da key (key 'finalizado' tem label 'Concluído')
- is_terminal: BooleanField(default=False) — rótulo de leitura da UI, NÃO trava movimento
- requires_required_data: BooleanField(default=False) — a UI exige responsável/datas para entrar na coluna
- oculta_no_catalogo: BooleanField(default=False) — tira a etapa do catálogo global e do seletor 'adicionar coluna'
- created_at / updated_at

**Relações**

- project_configs (reverse de ProjectKanbanStageConfig.stage, CASCADE)
- NÃO há FK de Card para KanbanStage — `Card.status` guarda a string da key

**Constraints e regras**

- key: UNIQUE global
- ordering = ['key']

#### NotificationType (TextChoices)

Tipos de notificação. `card_todo_updated` foi removido do enum, mas registros antigos continuam no banco para histórico.


**Campos**

- card_created, card_updated, card_deleted, card_moved
- sprint_created, project_created, role_changed
- card_overdue, card_due_24h, card_due_1h, card_due_10min
- log_created

#### Project

Pasta que agrupa cards por um denominador comum dentro de uma sprint. Tem campos de status e de datas de ciclo (avaliação, entrega, homologação, adiamento), mas NADA no produto os move automaticamente — ver armadilhas. `save()` herda o setor da sprint quando não definido.


**Campos**

- nome: CharField(200)
- descricao: TextField(blank=True)
- sprint: FK Sprint, CASCADE
- gerente_atribuido: FK User, SET_NULL, null/blank
- desenvolvedor: FK User, SET_NULL, null/blank
- status: CharField(20), choices=ProjectStatus, default='criado'
- data_criacao: auto_now_add
- data_avaliacao / data_atribuicao_gerente / data_inicio_desenvolvimento / data_entrega / data_homologacao: DateTimeField null/blank
- data_adiamento_solicitada: DateTimeField null/blank
- nova_data_prevista: DateField null/blank
- adiamento_aprovado: BooleanField(default=False)
- arquivado: BooleanField(default=False, db_index=True) — soft delete reversível
- arquivado_em: DateTimeField null/blank
- arquivado_por: FK User, SET_NULL (related_name='projetos_arquivados')
- is_system: BooleanField(default=False, db_index=True)
- setor: FK SetorCatalogo, PROTECT, blank=True, db_index=True
- created_at / updated_at

**Relações**

- cards (reverse de Card.projeto, CASCADE)
- kanban_stage_configs (reverse de ProjectKanbanStageConfig)
- setores_compartilhados: M2M through ProjectCompartilhamento (related_name='projetos_compartilhados')
- compartilhamentos (reverse de ProjectCompartilhamento)

**Constraints e regras**

- ordering = ['-created_at']
- unicidade de nome por sprint é validada no ProjectSerializer, não no banco

#### ProjectCompartilhamento

Projeto emprestado a outro setor; alcança os cards dele. É replicado (com o nível preservado) na virada da sprint e no reancoramento de card.


**Campos**

- project: FK Project, CASCADE (related_name='compartilhamentos')
- + os 4 campos herdados

**Constraints e regras**

- UniqueConstraint(['project','setor'], name='uniq_compartilhamento_project_setor')
- Index(['setor','nivel'], name='idx_compart_project_setor')

#### ProjectKanbanStageConfig

A junção que define QUAIS etapas o quadro de um projeto desenha e em que ordem. É também a fonte da lista de status legítimos de um card (`CardSerializer._etapas_do_projeto`).


**Campos**

- project: FK Project, CASCADE (related_name='kanban_stage_configs')
- stage: FK KanbanStage, CASCADE (related_name='project_configs')
- order: PositiveIntegerField(default=0)
- created_at / updated_at

**Constraints e regras**

- unique_together = [('project','stage')]
- ordering = ['order','stage__key']

#### ProjectStatus (TextChoices)

Estados do projeto: criado, em_avaliacao, aprovado, em_desenvolvimento, entregue, homologado, adiado.


**Campos**

- criado: 'Criado' (default)
- em_avaliacao: 'Em Avaliação'
- aprovado: 'Aprovado'
- em_desenvolvimento: 'Em Desenvolvimento'
- entregue: 'Entregue'
- homologado: 'Homologado'
- adiado: 'Adiado'

#### ScoreCriterion

Campo configurável do formulário de Score (ex.: 'Redução de esforço'). Cada critério carrega peso e sinal, o que torna a fórmula genérica: score = Σ ((-1 se negativo senão +1) * peso * valor).


**Campos**

- nome: CharField(120)
- peso: DecimalField(max_digits=5, decimal_places=2, default=0)
- negativo: BooleanField(default=False) — subtrai em vez de somar
- ordem: PositiveIntegerField(default=0)
- ativo: BooleanField(default=True) — inativo sai da fórmula mas os valores gravados ficam
- created_at / updated_at

**Constraints e regras**

- ordering = ['ordem','id']

#### ScoreCriterion / ScoreCriterionOption / CardScore / CardScoreValue / ScoreHistory

Sistema de Score configurável. A fórmula é genérica: score = Σ ((-1 se negativo senão +1) * peso * valor). CardScoreValue guarda o INT bruto, não FK para a opção, para o histórico sobreviver a edições de opção.


**Campos**

- ScoreCriterion.peso: DecimalField(5,2)
- ScoreCriterion.negativo: BooleanField
- CardScore.score_final: DecimalField(7,2)
- CardScore.setor_solicitante: CharField(40) SEM choices — vem do catálogo dinâmico (alargado de 30 para 40 em projects/0055)
- ScoreHistory.setor_solicitante: CharField(30) — NÃO foi alargado junto com CardScore
- ScoreHistory.snapshot: JSONField(default=list)

**Relações**

- CardScore.card: OneToOneField Card CASCADE
- CardScoreValue.card_score / .criterion: FK CASCADE
- ScoreHistory.card: FK Card CASCADE; .usuario: FK User SET_NULL

**Constraints e regras**

- CardScoreValue: unique_together (card_score, criterion)
- CardScore.card OneToOne = unique implícito

#### ScoreCriterionOption

Opção (valor + descrição) de um critério. Ex.: 0 = 'Não ajuda'.


**Campos**

- criterion: FK ScoreCriterion, CASCADE (related_name='opcoes')
- valor: IntegerField
- descricao: CharField(200)
- ordem: PositiveIntegerField(default=0)

**Constraints e regras**

- ordering = ['ordem','valor']

#### Sprint

Ciclo de trabalho com janela [data_inicio, fechamento_em] e a raiz da árvore de conteúdo do setor. É acervo: continua no histórico depois que quem a criou sai da empresa. `save()` agenda o fechamento automático no broker (Celery ETA) toda vez que `fechamento_em` muda.


**Campos**

- nome: CharField(100)
- data_inicio: DateTimeField — instante, não só dia
- fechamento_em: DateTimeField — NOT NULL; substituiu `data_fim` na migration 0030
- duracao_dias: IntegerField, MinValueValidator(1) — NÃO é digitado; o serializer calcula a partir de data_inicio/fechamento_em
- supervisor: FK User, on_delete=PROTECT
- finalizada: BooleanField(default=False)
- is_system: BooleanField(default=False, db_index=True)
- setor: FK accounts.SetorCatalogo, PROTECT, blank=True, db_index=True — NOT NULL no banco
- created_at: auto_now_add
- updated_at: auto_now

**Relações**

- projects (reverse de Project.sprint, CASCADE)
- supervisor → User (related_name='sprints_created')
- setor → SetorCatalogo (related_name='sprints')
- setores_compartilhados: M2M SetorCatalogo through SprintCompartilhamento (related_name='sprints_compartilhadas')
- compartilhamentos (reverse de SprintCompartilhamento)

**Constraints e regras**

- ordering = ['-data_inicio']
- sem constraints de banco; a regra 'uma sprint em andamento por setor' é validada no serializer/serviço, não no schema

#### SprintCompartilhamento

Sprint emprestada a outro setor. É o compartilhamento MAIS AMPLO: pela cascata de `accounts/scoping.py`, alcança os projetos e os cards de dentro dela.


**Campos**

- sprint: FK Sprint, CASCADE (related_name='compartilhamentos')
- + os 4 campos herdados (setor, nivel, compartilhado_em, compartilhado_por)

**Constraints e regras**

- UniqueConstraint(['sprint','setor'], name='uniq_compartilhamento_sprint_setor')
- Index(['setor','nivel'], name='idx_compart_sprint_setor') — a ordem segue a pergunta real ('quais itens o setor S enxerga?'), e `nivel` junto evita voltar à tabela no gate de escrita

#### SprintCompartilhamento / ProjectCompartilhamento / CardCompartilhamento

Tabelas through do empréstimo de conteúdo entre setores, com NÍVEL (leitura/edição). Herdam de CompartilhamentoSetorBase (abstrata, em accounts/models.py).


**Campos**

- nivel: CharField(10) choices NivelCompartilhamento (leitura|edicao), default leitura
- compartilhado_em: DateTimeField(auto_now_add)

**Relações**

- sprint/project/card: FK CASCADE
- setor: FK SetorCatalogo CASCADE related_name='+'
- compartilhado_por: FK User SET_NULL

**Constraints e regras**

- UniqueConstraint (sprint,setor) name='uniq_compartilhamento_sprint_setor'
- UniqueConstraint (project,setor) name='uniq_compartilhamento_project_setor'
- UniqueConstraint (card,setor) name='uniq_compartilhamento_card_setor'
- cada uma com índice (setor, nivel) — a ordem segue a pergunta 'quais itens o setor S enxerga?'

#### UserNote / UserNoteItem

Notas pessoais estilo Google Keep, que SUBSTITUÍRAM o antigo CardTodo. UserNoteItem é bloco (text ou todo) com árvore via parent.


**Campos**

- UserNote.color: CharField(20) choices UserNoteColor (6 valores; remapeado de 9 antigos em projects/0039)
- UserNoteItem.kind: CharField(10) text|todo
- UserNoteItem.order: IntegerField

**Relações**

- UserNote.user: FK User CASCADE
- UserNoteItem.note: FK UserNote CASCADE
- UserNoteItem.parent: FK self CASCADE — apagar o pai apaga a subárvore (intencional)

**Constraints e regras**

- UserNote: índices (user,archived,-updated_at) e (user,pinned,-updated_at)
- UserNoteItem: índices (note,order) e (parent)

#### UserNotificationPreference

Um registro por usuário (OneToOne). Quando o tipo está desligado, `send_notification()` nem cria a linha no banco. `is_enabled()` devolve True para tipo desconhecido, de propósito: um tipo novo não fica bloqueado antes de o campo existir.


**Campos**

- user: OneToOneField User, CASCADE (related_name='notification_preferences')
- ON por padrão (7): card_updated, card_deleted, project_created, card_overdue, card_due_24h, card_due_1h, card_due_10min
- OFF por padrão / opt-in (4): card_created, card_moved, sprint_created, role_changed
- updated_at: auto_now

#### WeeklyPriority

Prioridade da semana atribuída a um usuário para um card. `usuario` é o ALVO da prioridade; `definido_por` é o autor.


**Campos**

- usuario: FK User, on_delete=PROTECT (related_name='weekly_priorities')
- card: FK Card, CASCADE (related_name='weekly_priorities')
- semana_inicio: DateField — a segunda-feira
- semana_fim: DateField — a sexta-feira
- definido_por: FK User, SET_NULL, null/blank (related_name='weekly_priorities_defined')
- created_at / updated_at

**Relações**

- métodos: is_concluido() (card.status == 'finalizado'), is_atrasado() (não concluído após o horario_limite da sexta)

**Constraints e regras**

- unique_together = [['usuario','card','semana_inicio']]
- ordering = ['-semana_inicio','usuario']

#### WeeklyPriorityConfig

Configuração global (singleton via `get_config()` → get_or_create(pk=1)) do horário limite de sexta-feira e do fechamento automático da semana de prioridades.


**Campos**

- horario_limite: TimeField(default='09:00:00')
- fechamento_automatico: BooleanField(default=True)
- semana_fechada: JSONField(default=dict) — {'YYYY-MM-DD': True} por segunda-feira
- created_at / updated_at

**Relações**

- métodos: get_config() (classmethod), is_semana_fechada(), fechar_semana(), abrir_semana()

#### _CompartilhamentoProjects (abstrato)

Camada abstrata intermediária, herdada de `accounts.CompartilhamentoSetorBase`, só para não repetir a Meta abstrata nas três tabelas de compartilhamento.


**Campos**

- herdados de CompartilhamentoSetorBase: setor (FK SetorCatalogo, CASCADE, related_name='+'), nivel (CharField(10), choices=NivelCompartilhamento: leitura/edicao, default='leitura'), compartilhado_em (auto_now_add), compartilhado_por (FK User, SET_NULL, related_name='+')

### `backend/apps/projects/models.py:1074, 1064`

#### UserNote / UserNoteColor

Nota pessoal estilo Google Keep, privada por usuário. Substituiu o antigo CardTodo (subtarefas por card), removido na migration 0037 por gerar ruído demais no banco.


**Campos**

- user: FK User, CASCADE (related_name='notes')
- title: CharField(200, blank=True)
- color: CharField(20), choices=UserNoteColor (default, lilas, rosa, verde, azul, bege), default='default'
- pinned: BooleanField(default=False)
- archived: BooleanField(default=False)
- order: IntegerField(default=0)
- created_at / updated_at

**Constraints e regras**

- ordering = ['-pinned','order','-updated_at']
- Index(['user','archived','-updated_at'])
- Index(['user','pinned','-updated_at'])

### `backend/apps/projects/models.py:1118, 1113`

#### UserNoteItem / UserNoteItemKind

Bloco dentro de uma UserNote: parágrafo de texto ou item de checklist, livremente intercalados. Suporta indentação em árvore.


**Campos**

- note: FK UserNote, CASCADE (related_name='items')
- kind: CharField(10), choices=(text, todo), default='text'
- text: TextField(blank=True)
- done: BooleanField(default=False) — só faz sentido com kind='todo'
- order: IntegerField(default=0)
- parent: FK 'self', CASCADE, null/blank (related_name='children') — apagar o pai apaga a sub-árvore, intencional
- created_at / updated_at

**Constraints e regras**

- ordering = ['order','created_at']
- Index(['note','order'])
- Index(['parent'])

### `backend/apps/projects/models.py:1276, 1204`

#### CardScore / SetorSolicitante

Score de valor atribuído a um card (OneToOne). `score_final` é denormalizado e recalculado por `calcular_score()` e pelo signal de mudança de critério.


**Campos**

- card: OneToOneField Card, CASCADE (related_name='score')
- setor_solicitante: CharField(40), null/blank — SEM `choices` no model (ver decisões e armadilhas)
- score_final: DecimalField(max_digits=7, decimal_places=2, default=0)
- criado_por / atualizado_por: FK User, SET_NULL (related_names 'scores_criados' / 'scores_atualizados')
- created_at / updated_at

**Relações**

- valores (reverse de CardScoreValue)
- SetorSolicitante (TextChoices, models.py:1204): fiscal, contabil, marketing, legalizacao, pessoal, diretoria, novos_negocios, rh — não está ligada ao campo, mas é usada como whitelist em views.py:2844

**Constraints e regras**

- ordering = ['-updated_at']

### `backend/apps/projects/models.py:1379, 1373`

#### ScoreHistory / ScoreHistoryAction

Histórico de alterações do Score de um card, com snapshot JSON dos critérios/valores no momento.


**Campos**

- card: FK Card, CASCADE (related_name='score_historico')
- acao: CharField(20), choices=(criado, editado, excluido)
- score_final: DecimalField(7,2, default=0)
- setor_solicitante: CharField(30) null/blank — NOTE: 30, enquanto CardScore usa 40
- snapshot: JSONField(default=list)
- usuario: FK User, SET_NULL (related_name='score_historico_entries')
- data: auto_now_add

**Constraints e regras**

- ordering = ['-data']

### `backend/apps/projects/models.py:326, 333, 342`

#### Priority / CardArea / CardType (TextChoices)

Vocabulários de classificação do card.


**Campos**

- Priority: baixa, media (default), alta, absoluta
- CardArea: rpa, frontend, backend (default), script, sistema, automacao
- CardType (17): nova_robotizacao, nova_automacao, feature (default), bug, refact_completo, refact_pontual, otimizacao_processo, melhoria_fluxo, novo_script, ferramenta, qualidade, teste_software, raspagem_dados, novo_painel, ia, auditoria, manutencao

### `backend/apps/projects/models.py:601, 608`

#### Event / EventType

Registro manual pendurado no card: pendência, prioridade, tag ou comentário, com motivo. O evento pertence ao card, não a quem o registrou — a autoria some com a conta (SET_NULL), o registro fica.


**Campos**

- card: FK Card, CASCADE (related_name='events')
- tipo: CharField(20), choices=EventType (pendencia, prioridade, tag, comentario)
- descricao: TextField
- motivo: TextField(blank=True)
- usuario: FK User, SET_NULL (related_name='events_created')
- data: auto_now_add

**Constraints e regras**

- ordering = ['-data']

### `backend/apps/projects/models.py:644, 661`

#### CardLog / CardLogEventType

A timeline do card. Escrito automaticamente pelos signals (criação, diff de campos, troca de responsável) e explicitamente pelos serviços (transferência de sprint, reabertura, desatribuição por conta desativada).


**Campos**

- card: FK Card, CASCADE (related_name='logs')
- tipo_evento: CharField(30), choices=CardLogEventType
- descricao: TextField — o texto de diff ('Responsável: Fulano → Ninguém')
- usuario: FK User, SET_NULL, null/blank (related_name='card_logs') — null quando não há ator humano (shell, task, migration)
- data: auto_now_add

**Relações**

- CardLogEventType: criado, movimentado, transferido_sprint, pendencia, atualizado, alteracao, responsavel_alterado, comentario, reaberto

**Constraints e regras**

- ordering = ['-data']

### `backend/apps/projects/models.py:981-1014`

#### Notification

Linha persistida por send_notification antes do push WebSocket. É o que o usuário vê ao abrir /api/notifications/ — e por isso o recorte por setor tem de acontecer na ESCOLHA DO DESTINATÁRIO, já que ali o filtro é só usuario=request.user.


**Campos**

- usuario: FK AUTH_USER_MODEL (CASCADE, related_name='notifications')
- tipo: CharField(30) com choices de NotificationType
- titulo: CharField(200)
- mensagem: TextField
- lida: BooleanField default False
- data_criacao: DateTimeField auto_now_add
- card_id / sprint_id / project_id: IntegerField nulos — referências SOLTAS, não são ForeignKey
- metadata: JSONField default dict

**Relações**

- usuario → User

**Constraints e regras**

- ordering ['-data_criacao']
- Index (usuario, lida, -data_criacao)
- Index (usuario, -data_criacao)

### `backend/apps/feedbacks/models.py`

#### FeedbackFormulario

A DEFINIÇÃO dos campos guardada como DADO (JSON), versionada. É isso que faz trocar o formulário ser uma data migration e não uma migration de schema. Trocar os campos cria uma LINHA NOVA (versao+1) e desativa a anterior; a linha antiga NUNCA é editada, para que uma resposta gravada há meses continue legível contra a definição que a pessoa de fato viu na tela.


**Campos**

- slug: CharField(max_length=50, default='padrao') — família do formulário; é o que criar_pedido_feedback recebe, para que trocar o formulário não mude a assinatura
- versao: PositiveSmallIntegerField(default=1)
- titulo: CharField(max_length=120) — cabeçalho da página pública, texto fixo nosso, nunca dado do projeto
- subtitulo: CharField(max_length=300, blank, default='') — intro da página; fica no BANCO e não num .tsx porque é conteúdo do formulário e precisa congelar com a versão
- campos: JSONField(default=list) — [{key, label, tipo, obrigatorio, max_length, ...}]. Tipos: 'texto', 'texto_longo', 'escala' (minimo/maximo/rotulos) e 'escolha_unica' (opcoes). Chave opcional 'secao' agrupa campos CONSECUTIVOS sob um cabeçalho. A ORDEM é a da lista
- ativo: BooleanField(default=True, db_index=True) — qual versão nasce nos pedidos novos
- criado_em: DateTimeField(auto_now_add=True)

**Relações**

- pedidos: reverse de PedidoFeedback.formulario (FK PROTECT — apagar a definição tornaria as respostas ilegíveis)

**Constraints e regras**

- UniqueConstraint(fields=['slug','versao'], name='uniq_formulario_slug_versao')
- UniqueConstraint(fields=['slug'], condition=Q(ativo=True), name='uniq_formulario_ativo_por_slug') — constraint PARCIAL e NÃO DEFERRABLE; é ela que garante que services.formulario_ativo() nunca encontre duas
- Meta.ordering = ['slug', '-versao']

#### PedidoFeedback

Um pedido de feedback — UM POR CARD MARCADO. Cinco cards marcados no mesmo projeto = cinco pedidos e cinco links distintos. É a FONTE DA VERDADE da máquina de estados; a coluna do kanban é PROJEÇÃO dele, nunca o contrário.


**Campos**

- token: CharField(max_length=64, unique=True, editable=False) — a credencial INTEIRA da rota anônima; secrets.token_urlsafe(32) = 256 bits, 43 chars. unique=True também deixa o tempo de resposta igual para token existente e inexistente
- data_referencia: DateField(db_index=True) — a data de entrega JÁ convertida para data LOCAL. DateField de propósito: a granularidade é DIA e o motor não faz conta de fuso
- estado: CharField(max_length=20, choices=EstadoPedido, default='aguardando_prazo', db_index=True)
- referencia_publica: CharField(max_length=200) — CÓPIA congelada do card.nome, o rótulo seguro que a página anônima exibe. 200 é exatamente o max_length de Card.nome; com 120 (o valor original) cortava em silêncio
- criado_em: DateTimeField(auto_now_add=True)
- atualizado_em: DateTimeField(auto_now=True) — serve de 'há quanto tempo está nesta coluna'
- respondido_em: DateTimeField(null, blank, db_index=True) — separado de atualizado_em porque é o CORTE DA RETENÇÃO e não pode ser reiniciado por um save qualquer

**Relações**

- card: OneToOneField('projects.Card', CASCADE, related_name='pedido_feedback') — o card MARCADO. O índice único É a idempotência da criação. FK por STRING para não importar apps.projects
- card_kanban: OneToOneField('projects.Card', null, blank, SET_NULL, related_name='pedido_exibido') — o card de EXIBIÇÃO no board de monitoramento. SET_NULL e não CASCADE: apagar o card de exibição não pode destruir a resposta
- formulario: ForeignKey(FeedbackFormulario, PROTECT, related_name='pedidos')
- respostas: reverse de RespostaFeedback.pedido

**Constraints e regras**

- Index(fields=['estado','data_referencia']) — exatamente o WHERE da varredura dos 30 dias
- Meta.ordering = ['-criado_em']
- property url_publica: f'{FEEDBACK_PUBLIC_BASE_URL}/feedback/{token}' — guardamos só o TOKEN, nunca a URL, para que trocar de domínio não invalide nada já gravado

#### RespostaFeedback

UMA resposta. Três campos, e nenhum deles identifica quem respondeu (sem IP, sem user agent, sem e-mail). Tabela separada porque é ela que concentra o dado pessoal (LGPD): a retenção apaga a LINHA inteira e o PedidoFeedback sobrevive com estado='respondido' + respondido_em — o FATO e a DATA ficam, o conteúdo some. VÁRIAS respostas por pedido, uma LINHA por pessoa.


**Campos**

- valores: JSONField(default=dict) — {'<key>': <valor>} validado ESTRITAMENTE. Texto e escolha_unica gravam STRING; escala grava INTEIRO (7, não '7'), para a leitura render média e distribuição sem parsing. Campo OPCIONAL não respondido fica AUSENTE do dicionário
- enviado_em: DateTimeField(auto_now_add=True) — é o corte de retenção POR LINHA, nunca o respondido_em do pedido

**Relações**

- pedido: ForeignKey(PedidoFeedback, CASCADE, related_name='respostas') — era OneToOne até a migration 0008; a unicidade foi removida DE PROPÓSITO

**Constraints e regras**

- Meta.ordering = ['-enviado_em', '-id'] — o '-id' é DESEMPATE, não enfeite: enviado_em é auto_now_add e duas respostas no mesmo instante deixariam 'a mais recente' não-determinística
- SEM índice único: o freio que substitui o OneToOne é MAX_RESPOSTAS_POR_PEDIDO=100, conferido no POST (política, não banco)

### `backend/apps/formularios/models.py`

#### ChamadoCompartilhamento

Chamado encaminhado a outro setor. Herda de accounts.CompartilhamentoSetorBase (que traz `nivel` leitura/edicao, `compartilhado_por`, `compartilhado_em`).


**Campos**

- nivel: CharField(10) — 'leitura' | 'edicao' (herdado da base)
- compartilhado_em: DateTimeField (herdado)

**Relações**

- chamado: FK ChamadoSuporte, CASCADE, related_name='compartilhamentos'
- setor: FK accounts.SetorCatalogo (herdado)
- compartilhado_por: FK AUTH_USER_MODEL, SET_NULL (herdado)

**Constraints e regras**

- UniqueConstraint(chamado, setor) = uniq_compartilhamento_chamado_setor
- Index(setor, nivel) = idx_compart_chamado_setor

#### ChamadoSuporte

Chamado de suporte. usuario_setor (texto livre do solicitante) é coisa DIFERENTE de setor (FK ao catálogo, usada pelo escopo).


**Campos**

- status: CharField(20) choices com valores CAPITALIZADOS ('Aberto','Em andamento','Resolvido','Cancelado') — diferente do padrão snake_case do resto do sistema

**Relações**

- tipo / item / motivo: FK PROTECT — catálogo não sai debaixo de chamado existente
- setor: FK SetorCatalogo SET_NULL (db_index)
- setores_compartilhados: M2M através de ChamadoCompartilhamento

**Constraints e regras**

- 3 índices nomeados à mão: suporte_email_idx (usuario_email), suporte_tipo_status_idx (tipo,status), suporte_aberta_desc_idx (-data_abertura) — criados em formularios/0007

#### ChamadoSuporteResolucao

Link + arquivo anexados ao CONCLUIR o chamado. Um registro por chamado; o POST faz upsert. Guardado localmente por `chamado_id` (inteiro solto, não FK) justamente para funcionar quando o chamado vive no portal.


**Campos**

- chamado_id: PositiveIntegerField(unique=True, db_index=True) — NÃO é FK
- link: URLField(blank, null)
- arquivo: FileField(upload_to=caminho_resolucao_suporte, blank, null)
- criado_em / atualizado_em: DateTimeField

**Relações**

- usuario: FK AUTH_USER_MODEL, SET_NULL, related_name='chamado_suporte_resolucoes'

**Constraints e regras**

- unique em chamado_id

#### ChamadoSuporteResolucao / ChamadoSuporteTimeline

Anexos de resolução e timeline do chamado. Ambos guardam chamado_id como PositiveIntegerField SOLTO, não FK — funciona quando o chamado vive no portal externo e a tabela local está vazia.


**Campos**

- ChamadoSuporteResolucao.chamado_id: PositiveIntegerField(unique=True, db_index=True) — um registro por chamado; a conclusão faz upsert
- ChamadoSuporteTimeline.chamado_id: PositiveIntegerField(db_index=True), sem unique
- tipo_evento: CharField(30) choices, expandido em formularios/0004 e 0005

**Relações**

- usuario: FK User SET_NULL nos dois

**Constraints e regras**

- unique em ChamadoSuporteResolucao.chamado_id
- NÃO há FK para ChamadoSuporte — integridade referencial deliberadamente ausente

#### ChamadoSuporteTimeline

Eventos/comentários do chamado, SEMPRE gravados no BWA mesmo em modo proxy. É a fonte confiável para medir SLA.


**Campos**

- chamado_id: PositiveIntegerField(db_index=True) — NÃO é FK
- tipo_evento: CharField(30) — criado / etapa_alterada / responsavel_alterado / notificacao / pendencia / comentario (default: comentario)
- descricao: TextField
- data: DateTimeField(auto_now_add)

**Relações**

- usuario: FK AUTH_USER_MODEL, SET_NULL, related_name='chamado_suporte_timeline_entries'

**Constraints e regras**

- ordering = ['-data']

#### SuporteItem

Item dentro de um tipo. O serializer valida que item.tipo_id == tipo informado.


**Campos**

- nome: CharField(200)
- ativo: BooleanField(default=True)

**Relações**

- tipo: FK SuporteTipo, CASCADE, related_name='itens'

**Constraints e regras**

- ordering = ['tipo_id', 'nome']

#### SuporteMotivo

Motivo do chamado (Bug, Dúvida operacional, Melhoria urgente no seed).


**Campos**

- nome: CharField(200)
- ativo: BooleanField(default=True)

**Relações**

- chamados: reverse de ChamadoSuporte.motivo (PROTECT)

#### SuporteTipo

Categoria do chamado. As 3 tabs do frontend são RPA, Easy e Dashboards; 'Infraestrutura' existe no banco (seed 0002) mas não é tab.


**Campos**

- nome: CharField(200)
- ativo: BooleanField(default=True)

**Relações**

- itens: reverse de SuporteItem.tipo
- chamados: reverse de ChamadoSuporte.tipo (PROTECT)

**Constraints e regras**

- ordering = ['nome']

### `backend/apps/reports/models.py`

#### ReportJob

Job de exportação de relatório. É simultaneamente a fila de trabalho (status/progress lidos pelo polling), o ponteiro para o arquivo gerado e o registro de auditoria de quem emitiu o quê e quando. É o ÚNICO modelo do app.


**Campos**

- type: CharField(max_length=50, db_index=True) — id do tipo de relatório; resolve para um gerador no REGISTRY
- format: CharField(max_length=10, choices=Format) — pdf | docx | xlsx | csv
- filters: JSONField(default=dict, blank=True) — filtros aplicados; SEM schema validado, cada gerador lê as chaves que conhece
- include_header: BooleanField(default=True) — só afeta XLSX/CSV: primeira linha = nomes das colunas. Independente do cabeçalho contextual (logo/data/usuário/filtros), que é SEMPRE gravado
- user: FK(AUTH_USER_MODEL, SET_NULL, null=True, blank=True, related_name='report_jobs')
- status: CharField(max_length=20, choices=Status, default=pending, db_index=True) — pending | running | completed | failed
- progress: PositiveSmallIntegerField(default=0) — 0–100
- progress_message: CharField(max_length=200, blank=True) — texto mostrado sob a barra de progresso
- file: FileField(upload_to='reports/%Y/%m/', null=True, blank=True)
- file_size: PositiveIntegerField(null=True, blank=True) — cache do tamanho para evitar storage.size em loop de listagem
- error: TextField(blank=True) — str(exc) + stacktrace, truncado em 5000 chars
- created_at: DateTimeField(auto_now_add=True)
- updated_at: DateTimeField(auto_now=True)
- completed_at: DateTimeField(null=True, blank=True) — preenchido só no sucesso; é o campo usado pelo corte de retenção

**Relações**

- user → settings.AUTH_USER_MODEL (on_delete=SET_NULL, related_name='report_jobs')

**Constraints e regras**

- Meta.ordering = ['-created_at']
- Meta.indexes = [Index(fields=['user', 'status'])] — serve o lock e a listagem por status
- db_index em `type` e em `status`
- Nenhuma UniqueConstraint; o lock de 1 job ativo por usuário é feito na view, não no banco
- Property `is_terminal` = status in {completed, failed}

### `backend/apps/geekday/models.py`

#### GeekDayDraw

Um sorteio registrado. Sempre pertence a um grupo e a um ciclo.


**Campos**

- data_sorteio: DateTimeField(auto_now_add)
- data_apresentacao: DateField(blank, null)
- marcado_manual: BooleanField(default=False)
- observacoes: TextField(blank, null)
- cycle: PositiveIntegerField(default=1) — permite reset sem apagar histórico

**Relações**

- grupo: FK GeekDayGrupo, PROTECT, related_name='sorteios' — NOT NULL desde geekday/0007
- usuario: FK AUTH_USER_MODEL, SET_NULL, null — a linha sobrevive ao offboarding
- sorteado_por: FK AUTH_USER_MODEL, SET_NULL, null

**Constraints e regras**

- ordering = ['-data_sorteio']
- o unique_together ('usuario','data_sorteio') do 0001 foi REMOVIDO em geekday/0002

#### GeekDayGrupo

Conjunto de setores que sorteia JUNTO — a unidade do Geek Day. Era `GeekDayConfig`, um singleton pk=1 da empresa inteira; virou grupo via RenameModel em geekday/0005 (tabela preservada).


**Campos**

- nome: CharField(80)
- current_cycle: PositiveIntegerField(default=1) — a fila DESTE grupo; só anda por `resetar_sorteios`
- updated_at: DateTimeField(auto_now)

**Relações**

- setores: M2M accounts.SetorCatalogo through GeekDayGrupoSetor
- sorteios: reverse de GeekDayDraw.grupo (PROTECT)

**Constraints e regras**

- ordering = ['nome']

#### GeekDayGrupo / GeekDayGrupoSetor / GeekDayDraw

Sorteio do Geek Day POR GRUPO DE SETORES. GeekDayGrupo é o antigo GeekDayConfig singleton, renomeado de verdade (RenameModel, tabela preservada) em geekday/0005.


**Campos**

- GeekDayGrupo.current_cycle: PositiveIntegerField(default=1) — o ciclo é DO GRUPO, não da empresa
- GeekDayDraw.cycle: PositiveIntegerField(default=1)
- GeekDayDraw.marcado_manual: BooleanField

**Relações**

- GeekDayGrupoSetor.setor: OneToOneField SetorCatalogo CASCADE — o UNIQUE do banco é o que impede um setor em dois grupos
- GeekDayGrupoSetor.grupo: FK GeekDayGrupo CASCADE
- GeekDayDraw.grupo: FK GeekDayGrupo PROTECT (nasceu null em 0005, backfill em 0006, NOT NULL em 0007)
- GeekDayDraw.usuario / sorteado_por: FK User SET_NULL (usuario era CASCADE até geekday/0004)

**Constraints e regras**

- OneToOne em GeekDayGrupoSetor.setor = UNIQUE de banco
- GeekDayDraw NÃO tem unique_together — o (usuario, data_sorteio) original foi REMOVIDO em geekday/0002

#### GeekDayGrupoSetor

Vínculo grupo↔setor, tabela explícita e não automática.


**Campos**

- added_at: DateTimeField(auto_now_add)

**Relações**

- grupo: FK GeekDayGrupo, CASCADE, related_name='vinculos_setor'
- setor: OneToOneField accounts.SetorCatalogo, CASCADE, related_name='geekday_vinculo'

**Constraints e regras**

- OneToOne em `setor` = UNIQUE no banco: um setor não pode estar em dois grupos

### `backend/apps/suggestions/models.py`

#### ProjectSuggestion

Sugestão de projeto no backlog. Sobrevive anônima à saída de quem pediu.

**Relações**

- solicitante / avaliado_por: FK User SET_NULL (ambos eram CASCADE/obrigatórios até suggestions/0002 e 0003)

### `backend/apps/teams/models.py`

#### Hierarchy

DEPRECADO. Trio Supervisor → Gerente → Desenvolvedor. Gerente e desenvolvedor são opcionais; o serializer exige ao menos um dos dois.


**Campos**

- created_at: DateTimeField(auto_now_add)

**Relações**

- supervisor: FK AUTH_USER_MODEL, CASCADE, related_name='supervised_hierarchies'
- gerente: FK AUTH_USER_MODEL, CASCADE, null/blank, related_name='managed_hierarchies'
- desenvolvedor: FK AUTH_USER_MODEL, CASCADE, null/blank, related_name='developer_hierarchies'

**Constraints e regras**

- unique_together = ['supervisor', 'gerente', 'desenvolvedor']

#### NodePosition

DEPRECADO. Coordenada do node de um usuário no canvas de hierarquia.


**Campos**

- x: FloatField
- y: FloatField
- updated_at: DateTimeField(auto_now)

**Relações**

- user: OneToOneField AUTH_USER_MODEL, CASCADE, related_name='node_position'

**Constraints e regras**

- OneToOne em user

#### Team

DEPRECADO. Equipe desenhada como sticky note num canvas ReactFlow.


**Campos**

- nome: CharField(100)
- tipo: CharField(20) — portal/rpa/ia/dados/processos/front/back
- cor: CharField(20, default='yellow')
- posicao_x, posicao_y, largura(200), altura(150): FloatField
- ordem: IntegerField(default=0) — camada no canvas
- created_at / updated_at

**Relações**

- supervisor: FK AUTH_USER_MODEL, CASCADE, related_name='teams_supervised'
- members: reverse de TeamMember.team

**Constraints e regras**

- ordering = ['nome']

#### Team / TeamMember / Hierarchy / NodePosition

Equipes e organograma no canvas. É o app com o CASCADE mais agressivo: todas as FKs de usuário são CASCADE.


**Campos**

- Team.tipo: CharField(20) choices TeamType (7, redefinidos em teams/0006)
- Team.posicao_x/y, largura, altura: FloatField (sticky note no canvas)
- Team.ordem: IntegerField (camada no canvas, teams/0007)

**Relações**

- Team.supervisor: FK User CASCADE
- TeamMember.user / .team: FK CASCADE
- Hierarchy.supervisor / .gerente / .desenvolvedor: FK User CASCADE (gerente e desenvolvedor null=True)
- NodePosition.user: OneToOneField User CASCADE

**Constraints e regras**

- TeamMember: unique_together ('user','team')
- Hierarchy: unique_together ('supervisor','gerente','desenvolvedor') — com NULLs permitidos, o que no Postgres NÃO impede duplicatas parciais

#### TeamMember

DEPRECADO. Pessoa dentro de uma equipe.


**Campos**

- role: CharField(20) — 'gerente' | 'desenvolvedor' (default desenvolvedor)
- created_at: DateTimeField(auto_now_add)

**Relações**

- user: FK AUTH_USER_MODEL, CASCADE, related_name='team_memberships'
- team: FK Team, CASCADE, related_name='members'

**Constraints e regras**

- unique_together = ['user', 'team']

### `backend/apps/timeline/models.py`

#### TimelineEntry

CÓDIGO MORTO. Linha do tempo de um projeto. Nenhum outro módulo do backend importa este model (só o próprio app e config/settings.py o mencionam) e não há rota exposta.


**Campos**

- tipo_evento: CharField(30) — criacao/avaliacao/atribuicao_gerente/inicio_desenvolvimento/evento/pendencia/prioridade/tag/entrega/homologacao/adiamento_solicitado/adiamento_aprovado/adiamento_rejeitado
- data: DateTimeField (informada, não auto)
- descricao: TextField
- created_at: DateTimeField(auto_now_add)

**Relações**

- projeto: FK projects.Project, CASCADE, related_name='timeline_entries'
- usuario: FK AUTH_USER_MODEL, SET_NULL, null

**Constraints e regras**

- ordering = ['projeto', 'data']

### `backend/config/settings.py`

#### CONFIG — Variáveis de ambiente: núcleo Django

Bloco de configuração (não é model Django). Formato: NOME: default — nota.


**Campos**

- DOTENV_OVERRIDE: 'true' — se o backend/.env sobrepõe o ambiente. Falso para '0'/'false'/'no'. O Dockerfile fixa false para o env_file do Compose vencer o .env baked na imagem (settings.py:23)
- SECRET_KEY: SEM DEFAULT — OBRIGATÓRIA. Ausente levanta ImproperlyConfigured no import do settings; prefixo 'django-insecure-' só emite warnings.warn (settings.py:38-47)
- DEBUG: 'False' — só vira True com a string exata 'true' (case-insensitive). Sem .strip(), então 'true\r' do Windows NÃO liga (settings.py:50)
- ALLOWED_HOSTS: 'localhost,127.0.0.1' — CSV. Atrás de Traefik o Host costuma ser só o domínio; se expuser :8000 pelo IP, incluir também a forma 'IP:8000' (settings.py:52-54)
- BEHIND_HTTPS_PROXY: '' (vazio = False) — aceita true/1/yes. Chave mestra do modo produção: liga SECURE_PROXY_SSL_HEADER, USE_X_FORWARDED_HOST, os headers de segurança, os cookies Secure e torna CORS_ALLOWED_ORIGINS obrigatório (settings.py:57)
- WS_ALLOWED_ORIGINS: '' — CSV de origens aceitas no handshake WebSocket. Lida em config/asgi.py:40, NÃO no settings

### `backend/config/settings.py:106-119`

#### CONFIG — MIDDLEWARE (ordem exata)

Bloco de configuração. NENHUM middleware é custom deste repositório — a busca por middleware*.py em backend/ não retorna nada. Todos são Django ou terceiros.


**Campos**

- 1. django.middleware.security.SecurityMiddleware — aplica SECURE_SSL_REDIRECT/HSTS/nosniff quando ativos
- 2. whitenoise.middleware.WhiteNoiseMiddleware — serve STATIC_ROOT em produção (CSS/JS do admin). Logo após o Security, como manda a doc do WhiteNoise
- 3. django.contrib.sessions.middleware.SessionMiddleware
- 4. corsheaders.middleware.CorsMiddleware — antes do CommonMiddleware, para o preflight não ser redirecionado
- 5. django.middleware.common.CommonMiddleware
- 6. django.middleware.csrf.CsrfViewMiddleware — protege endpoints de sessão. Endpoints DRF com ExpiringTokenAuthentication (header Authorization) ficam isentos naturalmente; views públicas (register/login/recover) usam @csrf_exempt
- 7. django.contrib.auth.middleware.AuthenticationMiddleware
- 8. django.contrib.messages.middleware.MessageMiddleware
- 9. django.middleware.clickjacking.XFrameOptionsMiddleware

### `backend/config/settings.py:147-166`

#### CONFIG — Variáveis de ambiente: banco de dados

Bloco de configuração. Se USE_POSTGRES for falso, TODAS as DB_* são ignoradas e o Django usa SQLite em backend/db.sqlite3.


**Campos**

- USE_POSTGRES: 'False' — aceita true/1/yes. Tem .strip() explícito porque .env no Windows traz \r e impedia o reconhecimento
- DB_NAME: 'bwaproj_db'
- DB_USER: 'postgres' — o .env.docker.example usa 'bwaproj'
- DB_PASSWORD: 'postgres'
- DB_HOST: 'localhost' — 'db' dentro do compose
- DB_PORT: '5432' — o backend/.env.example de dev usa 5433 (mapeamento do compose no host)

### `backend/config/settings.py:191-236, 376-377`

#### CONFIG — Estáticos, mídia, i18n e autenticação

Bloco de configuração.


**Campos**

- STATIC_URL: '/static/'
- STATIC_ROOT: BASE_DIR/'staticfiles' — o CMD do Dockerfile roda collectstatic; WhiteNoise serve daqui
- STATICFILES_STORAGE / STORAGES: NÃO configurados — WhiteNoise roda no modo default, sem compressão nem manifest de hashes
- FRONTEND_BUILD_DIR: BASE_DIR.parent/'frontend'/'dist' — consumido só por config/views.py:serve_spa
- MEDIA_URL: '/media/'
- MEDIA_ROOT: BASE_DIR/'media' — volume Docker backend_media, compartilhado entre backend e celery-worker
- LANGUAGE_CODE: definido DUAS vezes — 'en-us' na linha 191 e 'pt-br' na 376. Vale 'pt-br'
- TIME_ZONE: definido DUAS vezes — 'UTC' na linha 193 e 'America/Sao_Paulo' na 377. Vale 'America/Sao_Paulo'
- USE_I18N: True / USE_TZ: True
- DEFAULT_AUTO_FIELD: django.db.models.BigAutoField
- AUTH_USER_MODEL: 'accounts.User'
- AUTHENTICATION_BACKENDS: ModelBackend + apps.accounts.auth_backends.CargoPermissionBackend + AdminRolePermissionBackend
- CACHES: NÃO configurado — cai no LocMemCache padrão do Django
- LOGGING: handler único 'console'; django=INFO, django.server=INFO (propagate False), django.request=DEBUG (propagate False)

### `backend/config/settings.py:238-249, 461-485`

#### CONFIG — Variáveis de ambiente: flags de feature e regras de negócio

Bloco de configuração. As duas flags de setor são o rollout gradual da segmentação; as demais são prazos de negócio.


**Campos**

- SETOR_SCOPING_ENABLED: 'false' — FEATURE FLAG. Ligada, cada pessoa só enxerga conteúdo dos próprios setores. Desligada, os helpers de apps/accounts/scoping.py são fail-open (nada é filtrado). Só ligar após confirmar zero órfãos de setor em sprints/projetos/cards
- SETOR_WRITE_ENFORCEMENT_ENABLED: 'false' — FEATURE FLAG separada. Recusa ESCRITA em item compartilhado só-leitura. Deliberadamente separada da anterior para ligar visibilidade primeiro e escrita depois
- REPORT_RETENTION_DAYS: '7' (int) — dias que o ARQUIVO de relatório sobrevive. A linha do ReportJob fica para sempre (auditoria)
- FEEDBACK_ESPERA_DIAS: '30' (int) — dias entre a entrega do projeto e a promoção do pedido para 'Aguardando Feedback'. Não existe coluna com a data derivada, então mudar o número move também os pedidos já criados
- FEEDBACK_RETENCAO_DIAS: '0' (int) — 0 DESLIGA a limpeza (default proposital: prazo é decisão de negócio). Ligada, apaga a RespostaFeedback inteira mas preserva estado='respondido' e respondido_em no PedidoFeedback (métrica fica, dado pessoal some)
- FEEDBACK_PUBLIC_BASE_URL: '' — base do link público de feedback. Se vazia, cai no fallback https://{PUBLIC_HOST}
- PUBLIC_HOST: '' — usado só como fallback de FEEDBACK_PUBLIC_BASE_URL no Django; o docker-compose.yml também o expande na label Host() do Traefik

### `backend/config/settings.py:252-295`

#### CONFIG — REST_FRAMEWORK

Bloco de configuração do DRF.


**Campos**

- DEFAULT_AUTHENTICATION_CLASSES: apps.accounts.authentication.ExpiringTokenAuthentication (TTL 24h, apaga o token ao expirar e devolve 401) + rest_framework.authentication.SessionAuthentication
- DEFAULT_PERMISSION_CLASSES: rest_framework.permissions.IsAuthenticated — fechado por padrão; o que é público abre explicitamente com AllowAny
- DEFAULT_PAGINATION_CLASS: rest_framework.pagination.PageNumberPagination
- PAGE_SIZE: 20 — vários ViewSets desligam com pagination_class = None
- DEFAULT_THROTTLE_CLASSES: AnonRateThrottle + UserRateThrottle
- TAXA anon: 120/min
- TAXA user: 1200/min
- TAXA login: 10/min — classe LoginRateThrottle em apps/accounts/views.py:63
- TAXA register: 5/min — RegisterRateThrottle, views.py:67
- TAXA recovery: 5/hour — RecoveryRateThrottle, views.py:71
- TAXA feedback_ip: 30/min — por IP (FeedbackIPThrottle)
- TAXA feedback_token: 120/hour — LEITURA por token, balde separado
- TAXA feedback_envio: 10/hour — ESCRITA por token, balde separado do de leitura
- NÃO definidos: DEFAULT_FILTER_BACKENDS, DEFAULT_RENDERER_CLASSES, DEFAULT_VERSIONING_CLASS, EXCEPTION_HANDLER

### `backend/config/settings.py:297-373`

#### CONFIG — CORS, CSRF e cookies

Bloco de configuração. Tudo pivota em _IS_DEV_RUNTIME = DEBUG or not _BEHIND_HTTPS_PROXY.


**Campos**

- CORS_ALLOWED_ORIGINS: em dev-runtime, união de 10 origens locais fixas (localhost/127.0.0.1 nas portas 8000, 3000, 5173, 5174, 5175) com as do env; em produção, SÓ as do env — e vazio levanta ImproperlyConfigured
- CORS_ALLOW_CREDENTIALS: True
- CORS_EXPOSE_HEADERS: ['Content-Type', 'Authorization']
- CORS_PREFLIGHT_MAX_AGE: 60s em dev, 86400s (24h) em prod
- CSRF_TRUSTED_ORIGINS: env CSV OU (não união — operador `or`) a mesma lista de 10 origens locais
- SESSION_COOKIE_HTTPONLY: True (fixo)
- SESSION_COOKIE_SAMESITE: 'Lax' (fixo)
- CSRF_COOKIE_SAMESITE: 'Lax' (fixo)
- CSRF_COOKIE_HTTPONLY: False — deliberado, para o front acessar se precisar
- SESSION_COOKIE_SECURE / CSRF_COOKIE_SECURE: env var com default derivado de _BEHIND_HTTPS_PROXY
- Bloco só quando _BEHIND_HTTPS_PROXY and not DEBUG: SECURE_SSL_REDIRECT=True, SECURE_HSTS_SECONDS=31536000, HSTS_INCLUDE_SUBDOMAINS, HSTS_PRELOAD, CONTENT_TYPE_NOSNIFF, BROWSER_XSS_FILTER, REFERRER_POLICY='strict-origin-when-cross-origin', X_FRAME_OPTIONS='DENY'

### `backend/config/settings.py:379-386`

#### CONFIG — Variáveis de ambiente: integrações externas

Bloco de configuração. Credenciais de terceiros; nenhuma é obrigatória para o boot, cada consumidor degrada sozinho quando falta.


**Campos**

- PORTAL_BASE_URL: '' — host do portal externo (sem barra final). Vazia derruba o proxy /api/portal-formularios/ com 503 (apps/formularios/portal_proxy_views.py:202-205)
- PORTAL_USERNAME: '' — usuário de serviço para obter o JWT do portal
- PORTAL_PASSWORD: '' — senha (única das três sem .strip())
- FERIADOS_API_KEY: '' — chave da API de feriados de Natal/RN. Vazia só emite warning e ignora o sync (apps/projects/holiday_sync.py:49-51)

### `backend/config/settings.py:388-453`

#### CONFIG — Variáveis de ambiente: Redis, Channels e Celery

Bloco de configuração. Redis serve a três papéis: channel layer, broker Celery e result backend — configurados por variáveis SEPARADAS.


**Campos**

- CHANNEL_LAYER_BACKEND: '' — só o valor literal 'redis' liga o RedisChannelLayer. Qualquer outra coisa (inclusive vazio) cai no InMemoryChannelLayer
- CHANNEL_REDIS_HOST: fallback REDIS_HOST, depois '127.0.0.1'
- CHANNEL_REDIS_PORT: fallback REDIS_PORT, depois '6379'
- REDIS_HOST: '127.0.0.1' — usado só como fallback de CHANNEL_REDIS_HOST
- REDIS_PORT: '6379' — idem
- REDIS_PASSWORD: '' — se preenchida, o host do channels_redis vira a URL redis://:SENHA@host:porta/0; se vazia, vira a tupla (host, porta)
- CELERY_BROKER_URL: 'redis://127.0.0.1:6379/0'
- CELERY_RESULT_BACKEND: 'redis://127.0.0.1:6379/0'
- CELERY_TASK_ALWAYS_EAGER: 'False' — aceita 1/true/yes. Roda .delay() inline na request, sem broker. NUNCA em produção (bloqueia a request). CELERY_TASK_EAGER_PROPAGATES espelha esta

### `backend/config/settings.py:78-104`

#### CONFIG — INSTALLED_APPS (ordem exata)

Bloco de configuração. A posição de 'daphne' é significativa; o resto é ordem convencional.


**Campos**

- daphne — PRIMEIRO de propósito: precisa vir antes de django.contrib.staticfiles para o runserver usar o handler ASGI (WebSocket via Channels) em vez do WSGI puro
- django.contrib.admin / auth / contenttypes / sessions / messages / staticfiles
- rest_framework
- rest_framework.authtoken — tabela do Token usado por ExpiringTokenAuthentication
- corsheaders
- django_filters — instalado, mas NÃO há DEFAULT_FILTER_BACKENDS; cada ViewSet declara o seu filter_backends
- channels
- apps.accounts
- apps.projects
- apps.teams — instalado (tabelas guardam histórico) mas SEM API exposta
- apps.timeline — idem: instalado, urls.py existe, mas não está no include()
- apps.suggestions
- apps.geekday
- apps.formularios
- apps.reports
- apps.feedbacks

### `docker-compose.yml`

#### CONFIG — Variáveis lidas pelo docker-compose, NÃO pelo Django

Bloco de configuração. Moram no mesmo .env da raiz, por isso confundem — mas o settings.py nunca as lê.


**Campos**

- POSTGRES_DB: 'bwaproj_db' — usado no healthcheck do serviço db e pela imagem oficial do Postgres
- POSTGRES_USER: 'bwaproj' — idem
- POSTGRES_PASSWORD: sem default no compose — imagem do Postgres
- POSTGRES_PORT: '5433' — porta publicada no host, sempre bindada em 127.0.0.1
- HOST_BIND: '127.0.0.1' — interface onde a porta do backend é publicada
- APP_PORT: '8000' — porta no host
- TRAEFIK_NETWORK: 'web' — rede Docker externa
- TRAEFIK_CERT_RESOLVER: 'letsencrypt'
- PUBLIC_HOST: 'tech.bwa.global' — vira a regra Host() do router Traefik (e é fallback do FEEDBACK_PUBLIC_BASE_URL no Django)

### `frontend/src/components/KanbanCardPreview.tsx`

#### KanbanCardPreviewData

Subconjunto do Card suficiente para desenhar o card do Kanban fora do quadro. `ConclusaoModalCard` é apenas um alias deste tipo.


**Campos**

- id: string
- nome: string
- prioridade?/status?/area?/area_display?/tipo?/tipo_display?: string
- descricao?: string
- data_fim?: string | null
- responsavel_name?/responsavel_role?: string
- script_url?: string | null
- score_final?: string | number | null

### `frontend/src/components/login-demo/useLoginDemoSequence.ts`

#### Scene (login demo)

Máquina de estados da animação de login, avançada por setTimeout em ciclo.


**Campos**

- dashboard 2800ms
- sprints 3200ms
- sprint-detail 2800ms
- project-detail 2500ms
- drag 2800ms
- fade 3000ms
- reset 1000ms

**Constraints e regras**

- Com prefers-reduced-motion o hook congela em 'project-detail' e não agenda timers

### `frontend/src/components/ui/badge.tsx`

#### badgeVariants (cva)

Variantes de badge.


**Campos**

- variant: default | secondary | destructive | outline | success | warning

**Constraints e regras**

- `success` e `warning` usam bg-green-100/bg-amber-100 e text-*-800 FIXOS — não têm variante dark, ao contrário das outras

### `frontend/src/components/ui/button.tsx`

#### buttonVariants (cva)

Fonte das variantes de botão. Exportado junto com o componente para estilizar elementos que não são <button>.


**Campos**

- variant: default | destructive | outline | secondary | ghost | link
- size: default (h-9 px-4) | sm (h-8) | lg (h-10) | icon (h-9 w-9)

**Constraints e regras**

- defaultVariants: variant=default, size=default
- Todas as cores saem de var(--color-*) — nenhuma cor literal

### `frontend/src/components/ui/chart.tsx`

#### ChartConfig

Mapa chave-da-série -> {label, icon, color, theme}. O ChartContainer transforma cada `color` na CSS var `--color-<chave>` no style do container, que o `<Bar fill="var(--color-count)">` consome.


**Campos**

- label?: ReactNode
- icon?: ComponentType
- color?: string
- theme?: Record<string,string>

**Relações**

- Consumido via useChart() dentro de ChartTooltipContent para resolver nome e cor de cada item do payload

### `frontend/src/components/ui/dialog.tsx`

#### DialogProps

Contrato do modal.


**Campos**

- open: boolean
- onOpenChange: (open: boolean) => void
- containerClassName?: string — largura do wrapper, padrão max-w-lg
- reserveRightPx?: number — faixa à direita que o backdrop NÃO cobre

**Constraints e regras**

- `if (!open) return null` — os filhos desmontam ao fechar, o estado interno se perde
- Sem trap de foco, sem fechar no Escape, sem travar o scroll do body

### `frontend/src/components/ui/filter-select.tsx`

#### FilterSelectOption

Opção do select com busca. `role` opcional pinta o badge de cargo à esquerda.


**Campos**

- value: string
- label: string
- role?: string

### `frontend/src/hooks/useSprintKanbanWebSocket.ts`

#### CardMovedEvent

Payload de movimentação de card no quadro da sprint.


**Campos**

- card_id: number
- old_status: string
- new_status: string
- actor_user_id: number | null

**Constraints e regras**

- O autor da movimentação TAMBÉM recebe o evento — quem consome precisa comparar actor_user_id com o usuário logado (anti-eco)

### `frontend/src/hooks/useWebSocket.ts`

#### WebSocketMessage (notificações)

Envelope recebido no socket global.


**Campos**

- type: 'notification' | 'pong' | 'permissions_changed' | 'account_deactivated' | 'solicitacoes_changed'
- data?: Notification (só quando type='notification')

**Constraints e regras**

- 'pong' é sinal de vida sem efeito colateral

### `frontend/src/lib/utils.ts`

#### cn()

Composição de classes. `twMerge(clsx(...))`: clsx resolve condicionais/arrays, twMerge resolve conflitos de utilitários Tailwind (a última classe vence). É o que permite todo componente aceitar `className` do chamador e sobrescrever o padrão.


**Campos**

- inputs: ClassValue[] — strings, objetos condicionais, arrays

**Constraints e regras**

- A ordem importa: nos componentes ui/ a classe base vem ANTES de `className`, então o chamador sempre ganha o conflito

### `frontend/src/routes.ts`

#### ROUTES

Mapa canônico dos caminhos da SPA. Comentário no topo: a API REST continua em inglês, só o roteamento do frontend é em português.


**Campos**

- entrar: '/entrar'
- cadastro: '/cadastro'
- recuperarConta: '/recuperar-conta'
- painel: '/painel'
- sprint: '/sprint' — entrada do menu, redireciona para a sprint em andamento
- sprintGerenciar: '/sprint/gerenciar' — lista completa
- sprintPorId(id) / sprintCard(sprintId, cardId)
- projetos: '/projetos'
- projeto(id) / projetoCard(id, cardId)
- prioridades: '/prioridades'
- meusAfazeres: '/meus-afazeres'
- pessoas: '/pessoas'
- metricas: '/metricas'
- relatorios: '/relatorios'
- suporte: '/suporte'
- diaGeek: '/dia-geek'
- score: '/score'
- configuracoes: '/configuracoes'
- perfil: '/perfil'

**Constraints e regras**

- `as const` — os literais são o tipo
- `isNavRouteActive` trata projetos/sprint/metricas/relatorios por prefixo; os demais por igualdade exata

### `frontend/src/services/authService.ts`

#### User (authService)

Usuário logado devolvido por /users/me/ e pelo login. É o objeto que o AuthContext guarda.


**Campos**

- id: string (UUID)
- username, email, first_name, last_name: string
- role: string / role_display: string
- setor?: string|null — codename do setor PRIMÁRIO
- setor_display?: string|null
- setores?: SetorDoUsuario[] — todos, primário primeiro
- is_active?: boolean
- permissions?: string[] — codenames granulares
- profile_picture_url?: string|null
- date_joined: string

**Relações**

- `setores` é o mesmo payload de userService.User (mesmo UserSerializer no backend)

### `frontend/src/services/feedbackService.ts`

#### FormularioPublico / CampoFeedback

Definição do formulário público de feedback, como o backend expõe em `campos_publicos`.


**Campos**

- FormularioPublico: titulo, subtitulo, referencia, dataEntrega (ISO cru), campos[]
- CampoFeedback sempre: key, label, tipo, obrigatorio, max_length
- CampoFeedback condicionais: secao?, opcoes? (escolha_unica), minimo?/maximo?/rotulos? (escala)

**Constraints e regras**

- Tipos: texto, texto_longo, escala, escolha_unica; tipo desconhecido degrada para texto simples
- Todas as chaves novas são OPCIONAIS porque a versão 1 do formulário manda exatamente as 5 originais

### `frontend/src/services/pedidoFeedbackService.ts`

#### PedidoFeedback / EstadoPedido

Lado autenticado do feedback — o link público de um card.


**Campos**

- EstadoPedido: aguardando_prazo | aguardando_resposta | respondido | feedback_encerrado (é também a KEY da coluna do kanban de monitoramento)

**Constraints e regras**

- Não existe rota de detalhe: `url_publica` contém o token, que é a credencial INTEIRA da rota anônima — por isso o link também não vem no CardSerializer

### `frontend/src/services/setorSharingService.ts`

#### CompartilhamentoSetores

Estado de compartilhamento de um item entre setores.


**Campos**

- id: number|string
- setor: SetorBasico|null — o dono
- setores_compartilhados: SetorCompartilhado[] (setor + nivel 'leitura'|'edicao')
- meu_acesso: 'dono'|'leitura'|'edicao'|null — vem pronto do backend

**Constraints e regras**

- Recursos: sprints, projects, cards, chamados-suporte (este último sob `formularios/suporte`)
- Acesso é hierárquico: a sprint arrasta projetos e cards; por isso não existe endpoint de propagar
- Um convite em edição NÃO dá permissão que a pessoa não tenha no próprio setor

### `frontend/src/services/userService.ts`

#### SetorDoUsuario

Um setor de que a pessoa faz parte. Superset de SetorBasico.


**Campos**

- codename, nome, cor (de SetorBasico)
- label_curto: string — pode vir ""
- is_primary: boolean

#### User (userService)

Usuário nas listagens. Superset do de authService com o campo que decide quem entra em lista de trabalho.


**Campos**

- id: string|number — comentário manda SEMPRE normalizar com String() em find/get
- permissions?: string[] — vem [] para quem não gerencia usuários; NÃO serve para decidir se a pessoa trabalha
- participa_do_trabalho?: boolean — read-only, visível a todos; true quando tem `view_content`
- setores?: SetorDoUsuario[]
- profile_picture_url?, date_joined?

**Constraints e regras**

- helper `participaDoTrabalho` falha em aberto (payloads em cache anteriores ao campo voltam sem ele)

---
