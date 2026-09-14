# Riscos e lacunas

> Parte da [Documentação de Arquitetura do BWA Tech](README.md).
> Levantada por leitura direta do código; o que não foi confirmado está
> em [Riscos e lacunas](12-riscos-e-lacunas.md).


## Riscos conhecidos

Levantados durante o mapeamento. Nenhum deles foi corrigido aqui — este
documento os registra para que sejam decisão consciente, não descoberta futura.

### 1. O `.env` de produção está versionado no git

**Verificado.** `git ls-files .env` devolve o arquivo: ele está rastreado, apesar
de `.gitignore` listar `.env` e `.env.*` nas linhas 25–26. E não foi acidente —
o commit que o introduziu diz o que estava fazendo:

```
b4ae543 Versionar .env na raiz para deploy; ajustar .gitignore (só raiz)
```

A razão é operacional e compreensível: o deploy faz `git reset --hard
origin/main` na VPS, então o `.env` precisa vir junto com o repositório. O preço
é que **`SECRET_KEY`, `POSTGRES_PASSWORD`, `REDIS_PASSWORD` e `PORTAL_PASSWORD`
estão no histórico do git** — e histórico não se apaga com um commit de remoção.

O repositório é privado, o que reduz a exposição, mas não a elimina: qualquer
pessoa com acesso de leitura tem os segredos de produção, e eles continuam
recuperáveis em todo clone já feito.

Sair disso exige trocar a forma de entregar a configuração ao servidor — variável
de ambiente no host, secret do GitHub Actions, ou um arquivo colocado fora do
repositório — **e rotacionar as chaves**, porque as atuais devem ser consideradas
conhecidas. A `SECRET_KEY` do Django assina sessões e tokens; trocá-la desloga
todo mundo, o que é um custo pequeno perto do que ela protege.

### 2. Não há `CACHES` configurado

O rate limiting do DRF cai no `LocMemCache` padrão, que é **memória do processo**.
Com mais de um worker, cada um conta separado, e o limite efetivo é o
configurado multiplicado pelo número de processos.

### 3. O deploy declara sucesso antes das migrações terminarem

O workflow imprime o status final e encerra com o backend em
`health: starting` — as migrações rodam no `CMD` do container, depois disso. O
✅ do GitHub confirma que a imagem subiu, **não** que o banco migrou limpo.

### 4. Sem staging, sem testes no pipeline, sem rollback

A tag desplegada é sempre `latest`. Não há ambiente intermediário, o CI não roda
a suíte, e voltar atrás é manual.

### 5. Cobertura de teste ausente em cinco apps

`reports` (11 geradores, 9 templates), `formularios`, `suggestions`, `timeline` e
`teams` não têm teste nenhum — os três últimos têm só o scaffold de 3 linhas do
`startapp`.

---


## Lacunas deste mapeamento

O que **não** foi confirmado. Está aqui para que ninguém use este documento como
se cobrisse o que não cobre.

### Contas, autenticação, permissões e setores

- `realtime.py` diz no comentário (linha 41) que 'estas funções são chamadas de signals de `User`/`UserSetor`', mas não encontrei nenhum signal no app: um grep por receiver/post_save/pre_save em backend/apps/accounts/ não retorna nada além desse comentário, e todas as chamadas partem de views.py. O comentário parece descrever um estado anterior do código — a razão técnica que ele dá (não derrubar a request quando o Redis está fora) continua válida de qualquer forma.
- Não confirmei se o frontend usa `expires_at` para renovar/expirar sessão proativamente — o subsistema mapeado é o backend, e não abri frontend/src.
- Não verifiquei em qual ambiente as flags `SETOR_SCOPING_ENABLED` / `SETOR_WRITE_ENFORCEMENT_ENABLED` estão de fato ligadas: o default em código é false para as duas, mas o valor efetivo vem de variável de ambiente (arquivo .env não versionado/não inspecionado).
- O `CompartilhamentoSetorMixin` está em accounts/sharing.py, mas as rotas `<recurso>/{id}/compartilhar/` que ele cria pertencem aos viewsets de apps/projects e apps/formularios — não as listei entre os endpoints deste subsistema, e não conferi exaustivamente em quais viewsets o mixin está plugado (vi o import em apps/projects/views.py).
- Não abri todas as 26 migrations linha a linha; li as que carregam decisão (0007, 0009, 0011, 0013, 0016, 0019, 0020, 0021, 0022, 0024, 0026). As demais são alterações de schema ou de Meta.options do catálogo.
- `BulkOperationAudit.revertido` nunca é escrito por nenhuma view de accounts; não procurei se algum outro app ou script faz isso.
- A contagem de linhas do app que verifiquei foi 4399 (wc -l sobre os .py, migrations incluídas), diferente dos 4054 informados no enunciado — pode ser um recorte diferente de arquivos ou o repositório ter mudado desde a medição.

### Domínio central: projetos, sprints, cards, kanban

- Não cobri views/endpoints por instrução — permissões, filtros de queryset e rotas ficam com outro agente. Consequência: onde uma regra do ciclo de vida está implementada NA VIEW (ex.: o fluxo de aprovação de reabertura, `_card_edicao_restrita`, `_move_project_cards_status`), citei o arquivo e a linha mas não mapeei a superfície HTTP.
- Não li as 61 migrations uma a uma. Li integralmente 0027, 0028, 0053, 0055, 0056 e 0061. Índices ou constraints criados manualmente em alguma das outras não estão neste mapa — a lista de constraints/índices que reportei vem do `Meta` dos models, que é a fonte da verdade do estado atual.
- Não localizei NENHUM ponto do backend que preencha `Card.data_inicio` automaticamente ao entrar em desenvolvimento. Encontrei o auto-preenchimento apenas no frontend (`frontend/src/pages/ProjectDetails.tsx`). Se existe outro caminho (comando, task, integração), não achei — o comando `corrigir_data_inicio_cards.py` sugere que o problema já apareceu, mas não li o conteúdo dele.
- Não localizei nenhuma transição automática de `Project.status` nem preenchimento automático de `data_avaliacao`, `data_atribuicao_gerente`, `data_inicio_desenvolvimento`, `data_entrega`, `data_homologacao`, `data_adiamento_solicitada`, `nova_data_prevista` ou `adiamento_aprovado`. Pelo que li, são apenas campos graváveis via `ProjectSerializer`. O comentário em `feedbacks/signals.py` corrobora, mas não é prova de que nenhum outro app os escreva.
- Não verifiquei se o model `Event`/`EventType` (pendência/prioridade/tag/comentário) é efetivamente usado pela UI. Sei que existe um viewset (`views.py:1573`) e que ele é escopado pelo pai; não sei se alguma tela cria esses registros hoje.
- Não confirmei se `Sprint.duracao_dias` é consumido em algum cálculo além de exibição — encontrei apenas a escrita (serializer) e usos em testes/seeds.
- `WeeklyPriority.is_atrasado()` usa `timezone.make_aware(...)` sem informar timezone explícito e sem tratar `USE_TZ=False`; não testei o comportamento nem verifiquei se o método é chamado em produção.
- Não avaliei o volume de dados nem o desempenho real de `recompute_card_scores_on_criterion_change` — sinalizei o padrão (varredura total), não o impacto medido.

### API de projetos e regras de negócio

- Não verifiquei o agendamento real das tasks Celery (`CELERY_BEAT_SCHEDULE`): as periodicidades citadas (`a cada minuto`) vêm das docstrings de tasks.py, não da configuração. Confirmar em config/celery.py ou settings.py.
- Não li `signals.py` (50 KB) por inteiro — só o trecho de `_from_sprint_replication`. Efeitos colaterais de `Card.save()` (CardLog automático de diff, notificações, métricas de tempo, broadcast de movimento) são citados de segunda mão, a partir dos comentários em views.py/services.py.
- Não li `models.py` por inteiro (é o subsistema de outro agente). Onde cito comportamento de `Card.save()`/`pre_save` (zerar `data_inicio` em 'a_desenvolver', espelhar `setor_id` do projeto, limpar `finalizado_em`), estou repassando o que os comentários de views.py e services.py afirmam.
- `SprintSerializer`/`ProjectSerializer` expõem `setores_compartilhados` como M2M gravável com `through`. Não testei se o `.set()` do DRF funciona nessas classes through nem qual `nivel` acaba gravado — a afirmação de que há dois caminhos de escrita é por leitura de código, não por execução.
- A função `conflitos_ao_mover_sprints` (services.py) não é chamada de lugar nenhum dentro de apps/projects — o comentário indica que ela serve à movimentação de conteúdo entre setores (provavelmente `apps/accounts/views.py`, `atribuir-dados`). Não confirmei o chamador.
- Não confirmei quais permission codenames existem de fato no `PERMISSION_CATALOG` (apps/accounts/permission_catalog.py). Os codenames listados aqui foram extraídos literalmente das chamadas `has_perm`/`HasPerm` em views.py; se algum estiver fora do catálogo, ele nunca é concedido por cargo (só por role='admin').
- Não mapeei `consumers.py`/`routing.py` (WebSocket do kanban) além do que as views e o realtime.py usam.
- Não executei a suíte de testes (`tests.py`, `tests_realtime.py`) para confirmar empiricamente nenhuma das regras — tudo aqui é leitura de código.

### Feedbacks pós-entrega

- Não li em profundidade os ~9.000 linhas de testes do app (tests.py, tests_fase2.py, tests_e2e_fase2.py, tests_formulario_v2.py, tests_requisitos.py, tests_seguranca.py, tests_seguranca_tipos.py, tests_escopo_fase2.py, tests_multiplas_respostas.py, tests_encerramento.py, tests_exportacao.py, tests_sonda_verificacao.py). Consultei tests_multiplas_respostas.py apenas para confirmar o formato paginado do endpoint de pedidos. Se precisar do inventário de comportamentos cobertos por teste, é preciso um passe dedicado.
- A afirmação de que o modo `?cards=` perde resultados acima de 20 cards é uma DEDUÇÃO verificada em três pontos (ausência de `pagination_class` no viewset, `PAGE_SIZE=20` em settings, e o frontend lendo só `data.results` sem seguir `next`), mas NÃO a validei rodando o endpoint. Vale confirmar num board real com mais de 20 cards de feedback antes de tratar como bug confirmado.
- Não mapeei os componentes do frontend em detalhe (FeedbackPublico.tsx, CardFeedbackSection.tsx, FeedbackCardBloco.tsx, FeedbackConsolidadoDialog.tsx, RespostaFeedbackItens.tsx, PainelFeedbacks.tsx, lib/monitoramentoFeedback.ts). Confirmei apenas a rota /feedback/:token, as URLs chamadas pelos services e os tipos do PedidoFeedbackResumo.
- Não verifiquei se `SETOR_SCOPING_ENABLED` está ligado em algum ambiente real. O código está escrito para o dia em que ligar (scope_cards é no-op enquanto a flag está OFF), mas o efeito prático da segmentação sobre os cards de feedback não foi observado em execução.
- Não confirmei se existe algum outro consumidor de `resposta_legivel` ou dos serializers além de views.py e exportacao.py (grep cobriu apps.projects, apps.accounts, apps.reports e config; não varri apps.formularios, apps.suggestions, apps.geekday nem apps.teams).
- `estrutura.py` e a migration 0003 são descritos como 'gêmeos', mas a 0003 semeia apenas 3 etapas e a 0009 acrescenta a 4ª — não confirmei se algum banco existente ficou com o par sprint/projeto criado pela auto-cura ANTES da 0009 e portanto sem a config da quarta coluna (a 0009 cobre esse caso, mas só se sprint e projeto já existirem no momento em que ela roda).
- Não medi o custo real da exportação: `_linhas_e_colunas()` materializa TODOS os pedidos e TODAS as respostas em memória (sem paginação de banco) e a prévia refaz esse trabalho inteiro a cada rolagem. Está declarado no código como aceitável ('o volume é pequeno'), mas não há teto nem número medido no repositório.

### Geração de relatórios

- Não existe NENHUM teste automatizado para o app reports — não há `tests.py` nem `tests_*.py` em `backend/apps/reports/`. Todo o comportamento descrito aqui foi lido do código, não verificado por execução. As armadilhas do cancelamento e da orientação landscape, em particular, mereciam teste antes de qualquer refatoração.
- Comentários desatualizados que contradizem o código atual: o docstring de `ReportJob` diz que a limpeza periódica 'não [foi] implementada nesta fase' (models.py linhas 20–23) e dois pontos de views.py falam em 'cleanup periódico (futuro)' (linhas 122 e 235) — a task `limpar_relatorios_expirados` e o Beat existem desde então. Não confirmei qual das duas fases é a mais recente; assumi que o código em tasks.py é a verdade.
- Não consegui confirmar quais registros do CELERY_BEAT_SCHEDULE estão de fato ativos em produção — há arquivos `celerybeat-schedule.*` versionados em `backend/`, mas não inspecionei o conteúdo nem sei se o Beat está de pé no ambiente atual.
- `frontend/src/components/reports/ReportConfigDialog.tsx` (527 linhas) e `frontend/src/components/reports/ReportCard.tsx` (49 linhas) não são importados por arquivo nenhum do `src/` — o único vestígio é um comentário em ReportConfigPanel.tsx dizendo que ele 'substitui o ReportConfigDialog'. Parecem código morto, mas não confirmei se há algum carregamento dinâmico.
- O botão 'Histórico' na página de Relatórios está `disabled` com title 'Em breve' (frontend/src/pages/Reports.tsx, linhas 245–252). Não há endpoint nem tela de histórico — e, como o /download/ apaga a linha do job, não está claro o que esse histórico mostraria.
- Não avaliei a qualidade da conversão HTML→DOCX do htmldocx 0.0.6 sobre os templates deste repositório (tabelas com colgroup, badges, KPI grid). O docstring avisa que 'DOCX herda muito menos CSS que PDF' e que o resultado é 'bom o suficiente pra um relatório editável', mas não há nada no código dizendo o que especificamente se perde.
- Não verifiquei se o logo `bwa-tech-black.png` existe em algum dos três caminhos que `_logo_path()` procura no ambiente de produção — se não existir, o header do PDF cai silenciosamente no fallback textual 'BWA Tech' sem nenhum aviso no log.
- O relatório `projects` documenta `project_ids` como lista, mas a UI usa um `FilterSelect` de seleção única para `projects_multi` (frontend/src/components/reports/ReportConfigPanel.tsx, linhas 761–770), que `serializeFilters` embrulha em array de um item. Não consegui determinar se a seleção múltipla era a intenção original que regrediu, ou se o nome do filtro é que ficou grande demais.

### Chamados, Geek Day, sugestões e apps mortos

- Contagem de migrations: o briefing diz 13/9/9/4/2, mas os diretórios têm 12 (formularios), 8 (geekday), 8 (teams), 3 (suggestions) e 1 (timeline) arquivos de migração — a diferença é o `__init__.py` de cada pasta, provavelmente incluído na contagem.
- NÃO existe nenhum teste para formularios, teams, suggestions nem timeline. `apps/formularios/` sequer tem arquivo tests.py; os outros três têm tests.py de 3 linhas (vazios). Todo o comportamento de segurança de formularios (2157 linhas: os três gates da resolução, o roteamento de grupos do WS, o proxy) é não coberto. A única suíte é apps/geekday/tests.py (645 linhas, 28 testes).
- Não abri o portal externo (api.bwa.global) nem tenho o contrato dele documentado. Tudo o que sei do schema de lá vem do que o proxy e o frontend assumem (o campo `anexo_suporte` em suporteService.ts, e o fato — codificado no 409 `portal_tipo_patch_not_supported` — de que o portal ainda NÃO aplica alteração de tipo/item no PATCH). Os campos reais do chamado no portal podem diferir do ChamadoSuporteReadSerializer local.
- Não li em profundidade frontend/src/pages/Support.tsx, GeekDay.tsx, MetricasSuporte.tsx nem suporteTimelineLog.ts. Sei que `logSuporteChamadoChanges` no frontend é quem grava os eventos `etapa_alterada` na timeline (mencionado na docstring de resolvido_em), mas não verifiquei a implementação — a lista exata de eventos que o frontend grava e em que condições fica em aberto.
- Não confirmei se as tabelas de teams/timeline de fato ainda têm dados em produção; o comentário em config/urls.py e o command export_hierarchy sugerem que sim, mas isso não é verificável a partir do código. A migração de drop mencionada no docstring de export_hierarchy ainda não foi escrita.
- Não verifiquei a implementação de `ids_que_participam_do_trabalho`, `setor_primario_do_usuario`, `setor_padrao_do_sistema`, `usuario_ve_tudo` nem `checar_escrita_no_pai` — todas vivem em apps/accounts/ (permissions.py e scoping.py), fora do meu subsistema. Li apenas `scope_chamados` e `scope_users`. A semântica que reporto para essas funções vem dos docstrings que as citam.
- Não sei se a página de sugestões existe no frontend: /api/suggestions/ está exposto, mas nenhum arquivo em frontend/src apareceu na busca por 'suggestions' além de arquivos que casaram por outros termos. Não confirmei se o endpoint tem consumidor.

### Configuração e roteamento

- Não existe CACHES no settings.py — não consegui confirmar se a ausência é deliberada ou esquecimento. O comentário da linha 291 ('o balde zera a cada restart do Redis') sugere que se pensava em um cache Redis, mas nenhum backend de cache foi declarado. Vale confirmar com quem escreveu antes de documentar como intencional.
- Sete variáveis lidas pelo código NÃO aparecem em nenhum dos arquivos .env.example: WS_ALLOWED_ORIGINS (config/asgi.py:40), FEEDBACK_PUBLIC_BASE_URL, FEEDBACK_ESPERA_DIAS, FEEDBACK_RETENCAO_DIAS, REPORT_RETENTION_DAYS, CELERY_TASK_ALWAYS_EAGER e FERIADOS_API_KEY. Quem configurar um ambiente novo pelos exemplos vai rodar sempre nos defaults dessas sete.
- Não li os arquivos .env reais (backend/.env e .env da raiz) por conterem segredos, então os valores EFETIVOS em uso hoje neste ambiente não estão confirmados — tudo o que documentei sobre defaults vem do código e dos .example.
- Não abri .github/workflows/docker-publish.yml. O que sei dele vem dos comentários do docker-compose.yml (publica ghcr.io/rpabwaglobal/bwa_tech:latest a cada push em `main`). Se houver --build-arg ou BuildKit secret com VITE_* passados lá, não está coberto aqui.
- Não verifiquei o conteúdo de deploy.sh, deploy.bat, backend/start_server.ps1 e backend/stop_server.ps1 — podem exportar ou sobrepor variáveis de ambiente que mudam o comportamento descrito (o docker-compose.yml menciona que 'deploy.sh em LAN pode exportar e sobrepôr' ALLOWED_HOSTS/CORS/CSRF).
- TOKEN_TTL de 24h está hardcoded em apps/accounts/authentication.py:7 — não é configurável por env var, e não achei nenhuma variável que o sobreponha.
- Não consegui confirmar quantos processos servem HTTP em produção (daphne é chamado sem flag de workers no CMD). Isso importa para avaliar o impacto real do throttle em LocMemCache — se for processo único, o problema fica restrito ao reset por deploy.

### Filas, agendamentos e tempo real

- Não consegui confirmar se existe algum agendador externo (cron do host, Task Scheduler do Windows, GitHub Actions) chamando os management commands que parecem periódicos por natureza — sync_feriados_natal, fetch_portal_suporte, portal_healthcheck, audit_profile_pictures, limpar_relatorios. Nenhum deles aparece no CELERY_BEAT_SCHEDULE nem no docker-compose; se rodam periodicamente, é por fora do repositório.
- Não li o corpo completo de card_created_or_updated (linhas 720-861 de apps/projects/signals.py, o trecho de complexidade, score e notificação de demanda atualizada). Descrevi os ramos de notificação e broadcast que confirmei; pode haver efeito colateral adicional nesse intervalo.
- Não verifiquei o conteúdo de apply_development_time_metrics (apps/projects/business_time.py), chamado pelo card_pre_save — se ele faz consultas ao banco ou I/O (por exemplo, à API de feriados), isso é custo dentro do pre_save de todo card e valeria documentar.
- Não confirmei quantos réplicas do serviço backend rodam em produção. Isso decide se o InMemoryChannelLayer seria funcional ao menos dentro de um processo, ou se já está quebrado hoje entre daphne e celery-worker. O valor real de CHANNEL_LAYER_BACKEND está no .env de produção, que não está no repositório.
- Não achei nenhum ponto que emita o tipo NotificationType.LOG_CREATED — o comentário nas linhas 966-967 diz que o signal de CardLog foi removido, então o valor parece órfão, mas não varri o repositório inteiro para confirmar.
- Não verifiquei se existe rate limiting ou heartbeat do lado do servidor nos WebSockets. O ping é iniciado pelo CLIENTE a cada 30s (frontend/src/hooks/useSprintKanbanWebSocket.ts); não localizei configuração de timeout de conexão ociosa no daphne nem no Traefik.
- Não li os testes (apps/projects/tests_realtime.py, apps/feedbacks/tests_fase2.py, tests_e2e_fase2.py). Eles provavelmente fixam contratos de payload e nomes de grupo que valeria conferir antes de renomear qualquer evento.

### Banco de dados

- O enunciado da tarefa fala em 139 migrações. Contei 130 arquivos de migração reais (140 incluindo os 10 __init__.py). Números por app: accounts 26, feedbacks 9, formularios 12, geekday 8, projects 61, reports 2, suggestions 3, teams 8, timeline 1. Não sei de onde vem a diferença — pode ser contagem de `showmigrations` incluindo apps do Django (admin, auth, contenttypes, sessions, authtoken), que não inspecionei.
- NÃO rodei migrate nem inspecionei o esquema real do banco. Tudo aqui vem da leitura dos arquivos de migração e models.py. Não verifiquei se o banco de produção está em dia com o grafo, nem se há migrações aplicadas com --fake.
- Não confirmei quais das 35 RunPython já rodaram em produção. O comentário de accounts/0020 diz que o arquivo "descreve o estado do banco em 2026-08", o que sugere que sim para as anteriores, mas não é prova.
- Não abri o dump em backend/dump_banco_prod/ nem backend/db.sqlite3 — portanto não sei quais seeds sobreviveram a edições manuais de admin depois de aplicados (vários usam update_or_create, que sobrescreve; outros usam get_or_create, que preserva).
- Não mapeei backend/seed_data.py e backend/seed_users.py (na raiz do backend, fora de apps/) nem os management commands de seed (accounts/seed_dados_users.py, seed_new_users.py, projects/migrar_tudo_para_tecnologia.py, projects/consolidar_projetos_sprint_atual.py). Eles também escrevem no banco mas não são migrações — se a pergunta for "que dados o sistema espera encontrar", pode haver dependências ali que não cobri.
- Não verifiquei os signals de projects (apps/projects/signals.py) além do que os comentários dos models afirmam — em particular a remoção de CardPin quando o card é finalizado, e se algum signal cria linhas em cascata que não estão declaradas como on_delete.
- As migrações de options de permissão (accounts/0017, 0018, 0021, 0023, 0025) só alteram Meta.options de PermissaoPlataforma; li duas delas e as tratei como equivalentes, mas não conferi arquivo por arquivo qual permissão cada uma acrescenta ao catálogo.
- Não conferi se as tasks de retenção (LGPD) de RespostaFeedback e de limpeza de ReportJob estão de fato agendadas no Celery beat — o docstring do ReportJob diz explicitamente "não implementado nesta fase", e para feedbacks não localizei o agendamento.

### Frontend: rotas, estado, comunicação

- A contagem do enunciado (153 arquivos / 54 mil linhas) não bate exatamente: `find src -type f` devolve 157 arquivos e o total de linhas em .ts/.tsx/.css é 54.403. E `src/pages/` tem 20 arquivos, mas só 19 são páginas — o vigésimo é `GeekDay.css`.
- Não abri linha a linha as ~3.000 linhas de Metrics.tsx, ProjectDetails.tsx, SprintDetails.tsx, Support.tsx, Projects.tsx, MyTasks.tsx, Score.tsx, GeekDay.tsx e Priorities.tsx. As descrições dessas páginas vêm dos imports, dos títulos em JSX e dos trechos de estado/efeitos que li; pode haver subfluxos e chamadas de API dentro delas que não estão listados aqui.
- Não inventariei os ~50 arquivos de `src/components/` (incluindo os 26 de `components/ui/` e os 12 de `components/login-demo/`) — o pedido era rotas, páginas, estado, serviços e lib. Li apenas Layout.tsx, Sidebar.tsx (parcial), SprintEntryRedirect.tsx, NotificationsButton.tsx, LoginDemo.tsx (parcial) e ReportConfigPanel.tsx (só o polling).
- Não confirmei no backend se os endpoints listados existem com essas rotas exatas — a lista foi extraída das chamadas no frontend. Divergências entre o que o frontend chama e o que o Django expõe não seriam detectadas por esta análise.
- Não consegui confirmar quais variáveis `VITE_*` são de fato lidas em produção além das que aparecem em `.env.production` e `.env.development`: `VITE_FORMULARIOS_AUTH_SCHEME`, `VITE_FORMULARIOS_AUTH_TOKEN_KEY` e `VITE_FORMULARIOS_SUPORTE_CATALOGO_PATH` são lidas no código mas não aparecem em nenhum arquivo .env do repositório.
- Não verifiquei o conteúdo de `frontend/dist/` nem de `frontend/scripts/convert-gradients-to-webp.mjs` (script auxiliar de conversão de gradientes para webp, referenciado pelo npm script `gradients:webp`).
- Não há testes no frontend — não encontrei nenhum arquivo .test/.spec nem runner (vitest/jest) no package.json. Não sei se isso é intencional ou uma lacuna do projeto.
- Não rastreei todos os pontos de leitura/escrita de localStorage dentro das páginas grandes com chaves montadas dinamicamente; encontrei `bwa_sprint_list_columns_v1:<sprintId>` em SprintDetails, mas pode haver outras variantes por página que não apareceram no grep.

### Frontend: componentes e design system

- Não li integralmente os arquivos maiores: pages/ProjectDetails.tsx (4.328 linhas), pages/SprintDetails.tsx (3.725), pages/Metrics.tsx (3.308), pages/Support.tsx (3.090), pages/Projects.tsx (2.962), pages/MyTasks.tsx (2.274), pages/Priorities.tsx (1.677), pages/GeekDay.tsx (1.631), components/MetricasSuporte.tsx (1.537) e pages/Score.tsx (1.449). Li as seções de drag-and-drop, WebSocket e gráficos; formulários, filtros e modos de lista ficaram de fora.
- Não abri os 12 arquivos de login-demo/ um a um — li LoginDemo, useLoginDemoSequence, DemoBrowserFrame, DemoCursor, BrandFadeOverlay, DemoCard, DemoSidebar e o topo de demoData. As quatro views de cena (DemoDashboardView, DemoSprintsView, DemoSprintDetailView, DemoProjectDetailView) não foram lidas.
- Não li o corpo completo dos pickers de data (date-picker 275, datetime-picker 549, date-range-picker 605, datetime-input 251 linhas) — só as assinaturas e as funções de formatação. As regras de validação e de dias úteis dentro deles não estão documentadas aqui.
- Não verifiquei o lado servidor dos WebSockets (consumers do Channels): os nomes de evento e a forma dos payloads descritos vieram exclusivamente do que o cliente trata. Se o backend emite mais tipos, o cliente os ignora silenciosamente.
- Não confirmei em execução se `--color-desktop: hsl(var(--color-primary))` realmente produz valor inválido no navegador; a conclusão é por leitura (o token já contém a função hsl()). Nenhum gráfico usa essas vars, então na prática é inerte.
- As dependências `reactflow`, `react-chrono` e `react-roulette-pro` estão no package.json mas não apareceram em nenhum import de src/. Não verifiquei se são usadas em scripts, no diretório dist/ ou em código removido recentemente.
- Não avaliei acessibilidade além do que os componentes declaram (role/aria-*): não há testes nem verificação de navegação por teclado nos quadros — o único KeyboardSensor do dnd-kit está em MyTasks.
- Não há testes automatizados de frontend no repositório (nenhum vitest/jest/testing-library no package.json), então nenhuma afirmação aqui é respaldada por suíte de testes.
- Não mapeei o conteúdo de todos os 26 componentes de ui/: `image-crop.tsx`, `avatar.tsx` e `carousel.tsx` foram lidos parcialmente (primeiras ~50 linhas).

### Infraestrutura, Docker e CI/CD

- Não consegui inspecionar a VPS. Tudo que é 'estado do servidor' está apenas descrito em comentários: se o cron do backup está de fato instalado, se a rede Docker `web` existe, qual a configuração estática do Traefik, se os secrets do GitHub (VPS_HOST, VPS_USER, VPS_SSH_KEY, VPS_SSH_PORT, GHCR_PULL_TOKEN, GHCR_USERNAME) estão configurados, e se o pacote no GHCR está privado ou público.
- Não sei se `DOCKER.md`, `DEPLOY_REDE_LOCAL.md` e `DEPLOY_LOCAL.md` (referenciados pelo README) chegaram a existir e foram removidos, ou se nunca foram versionados. Não os procurei no histórico do git.
- O `backend/.env` existe na máquina mas não é versionado — descrevi apenas as CHAVES que ele contém (SECRET_KEY, USE_POSTGRES, DB_*, PORTAL_*, FERIADOS_API_KEY), não os valores. Não sei o que outros desenvolvedores têm no arquivo deles, e não há um `.env.example` do backend no repositório apesar do README mandar criar um 'baseado no .env.example'.
- Não confirmei experimentalmente a afirmação de que o HEALTHCHECK passa em cima do 301 do SECURE_SSL_REDIRECT — é uma leitura do código (SecurityMiddleware antes da view) somada à semântica do `curl -f` (falha só em HTTP >= 400, e sem `-L` não segue redirect). O ponto sobre `api_root` não tocar o banco está confirmado pela leitura de backend/config/views.py.
- Não há nenhum workflow de testes ou lint no `.github/workflows/` — só os dois de build e deploy. Não sei se a suíte de testes é rodada em algum lugar antes do merge; se é, é fora do CI.
- O escopo da checagem de 'o que roda na subida' cobriu o CMD do Dockerfile e o `command` de cada serviço do compose. Não auditei signals do Django nem `AppConfig.ready()` que possam executar trabalho no import — isso é do subsistema do backend.
- Não avaliei limites de recurso (não há `deploy.resources`, `mem_limit` nem `cpus` em nenhum serviço do compose) contra a capacidade real da VPS, porque não sei o tamanho da máquina.
- Não há observabilidade além do LOGGING para console (backend/config/settings.py:536-570) e do `docker compose logs`: não encontrei Sentry, métricas, agregador de logs nem rotação configurada. Se existe algo na VPS (ex.: driver de log do Docker), não está no repositório.

### Varredura de completude

- A SUÍTE DE TESTES não foi atribuída a nenhum dos doze escopos: 24 arquivos, ~11.400 linhas. Distribuição: feedbacks 7.940 linhas em 12 arquivos (tests_formulario_v2.py 1510, tests_requisitos.py 1208, tests_e2e_fase2.py 1161, tests_fase2.py 885, tests_seguranca_tipos.py 780, tests_seguranca.py 651, tests.py 476, tests_multiplas_respostas.py 428, tests_escopo_fase2.py 290, tests_encerramento.py 184, tests_sonda_verificacao.py 181, tests_exportacao.py 171), projects 1.781 (tests.py 863, tests_realtime.py 800, tests_business_time.py 83, tests_dev_time_format.py 35), accounts 801 (tests.py 322, tests_realtime.py 479), geekday 645. Os arquivos de feedbacks são adversariais e documentam vulnerabilidades específicas — tests_escopo_fase2.py descreve em 30 linhas de docstring um vazamento DORMENTE (o balde `sem_setor` como setor de todo usuário não classificado, 14 de 15 vínculos no banco de dev, que entregaria a url_publica de todo feedback da empresa quando SETOR_SCOPING_ENABLED for ligada). Isso merece um capítulo próprio na documentação e eu não tinha orçamento para ler os 24 arquivos.
- NÃO EXISTEM TESTES para os apps reports, formularios, suggestions, timeline e teams. suggestions/tests.py, timeline/tests.py e teams/tests.py têm 3 linhas cada (o scaffold do startapp). O app reports não tem arquivo de testes nenhum, apesar de 11 geradores de relatório e 9 templates HTML.
- NÃO HÁ EXECUÇÃO DE TESTES EM CI. Os dois workflows do GitHub Actions só buildam a imagem e fazem deploy — nenhum roda `manage.py test`. Também não há pytest.ini, pyproject.toml, setup.cfg, tox.ini, conftest.py nem Makefile no repositório. Como rodar a suíte (settings, DOTENV_OVERRIDE, banco isolado, --keepdb) não está documentado em lugar nenhum do repo.
- As 130 migrações (accounts 26, projects 61, formularios 12, feedbacks 9, geekday 8, teams 8, suggestions 3, reports 2, timeline 1) não foram lidas uma a uma nesta varredura. Várias são data migrations com lógica de negócio e comentários explicativos — accounts/0016 (vincula todo usuário a `sem_setor`), accounts/0020 (backfill da regra de setor padrão) e feedbacks/0003 (seed do monitoramento) são citadas por outros arquivos como fonte de decisão.
- Não verifiquei, arquivo por arquivo, quais fases do PLANO_SETORES_CARGOS.md realmente chegaram ao código. Confirmei que `apps/accounts/scoping.py` e `sharing.py` existem, que `SETOR_SCOPING_ENABLED` é lido com default False e que `migrar_tudo_para_tecnologia` e `export_hierarchy` (marco da Fase 6) foram implementados — mas o estado exato de cada uma das 6 fases em produção continua em aberto. As 9 perguntas da seção 8 do PLANO não têm resposta registrada no repositório.
- Não inspecionei os VALORES do `.env` versionado, de propósito — só confirmei quais chaves estão preenchidas e o tamanho. A auditoria de qual desses segredos é de produção e precisa de rotação fica para quem tiver o contexto operacional.
- Não li `deploy.bat` (7.967 bytes) e `deploy.sh` (10.548 bytes) na íntegra — só o cabeçalho e a estrutura de etapas (7 passos: git pull, verificar Docker, subir containers, ...). São os scripts de deploy manual antigos, hoje suplantados pelo workflow do GitHub Actions; vale confirmar se ainda são usados ou se devem ser removidos.
- `backend/media/` contém arquivos reais no disco de desenvolvimento: profiles (3 imagens), suporte_resolucao (PRD_BWA_Tech.pdf) e reports/2026. Não abri o PRD_BWA_Tech.pdf — pode ser documentação de produto relevante enviada pelo próprio app, mas é conteúdo de usuário, não do repositório.
- `frontend/dist/` existe na máquina local (build do Vite) e não está rastreado no git. Não auditei o que há lá — é artefato de build.
- `backend/celerybeat-schedule.{bak,dat,dir}` e `backend/db.sqlite3` estão presentes localmente e ignorados pelo git. São artefatos de runtime; o SQLite só é usado quando USE_POSTGRES não é `true` (backend/.env.example linha 15 avisa que sem a flag o Django ignora o dump restaurado no Postgres — uma pegadinha de setup comum).
- Não há LICENSE, CONTRIBUTING.md, CODEOWNERS nem configuração de Dependabot. O README declara 'Este projeto é privado'.
- O repositório tem uma branch remota `origin/security/auth-refactor-audit-hardening` que não foi inspecionada — pode conter trabalho de segurança não mesclado.

---


## Arquivos-chave, por subsistema

Onde procurar cada coisa.

### Contas, autenticação, permissões e setores

| Arquivo | Papel |
|---|---|
| `backend/apps/accounts/models.py` | User, Cargo, SetorCatalogo, UserSetor, BulkOperationAudit, NivelCompartilhamento, CompartilhamentoSetorBase (abstrata), Role (TextChoices) e as choices dinâmicas cacheadas. |
| `backend/apps/accounts/permission_catalog.py` | Fonte única da verdade do catálogo de 29 permissões (PERMISSION_CATALOG) + modelo fantasma PermissaoPlataforma (managed=False) que registra as linhas em auth_permission via Meta.permissions. |
| `backend/apps/accounts/permissions.py` | Gates DRF (HasPerm, HasQualquerPerm, HasPermOrReadOnly, PodeVerConteudo, NaoVisitanteEscreve, SetorPermiteEscrita, CanManage*) e o resolvedor em massa invertido (usuarios_com_perm_qs, ids_que_participam_do_trabalho, permissoes_concediveis_por). |
| `backend/apps/accounts/auth_backends.py` | CargoPermissionBackend (concede Cargo.permissoes_padrao em tempo de has_perm) e AdminRolePermissionBackend (catálogo inteiro para role='admin'). |
| `backend/apps/accounts/authentication.py` | ExpiringTokenAuthentication: token DRF com TOKEN_TTL = 24h; apaga o token expirado e devolve 401. |
| `backend/apps/accounts/scoping.py` | Recorte por setor: scope_* para cada tipo de conteúdo, nivel_de_acesso/pode_editar/checar_escrita_no_pai e os querysets de campo gravável (sprints_editaveis, projetos_editaveis, cards_editaveis). |
| `backend/apps/accounts/views.py` | UserViewSet (CRUD + gestão + bulk), CargoViewSet, SetorViewSet e as views avulsas Register/Login/Logout/LogoutAll/RecoverAccount. |
| `backend/apps/accounts/serializers.py` | UserSerializer (campos derivados permissions/participa_do_trabalho/setores), CargoSerializer, SetorCatalogoSerializer, serializers de auth e a regra do balde de não classificados (aplicar_regra_do_setor_padrao / sincronizar_setor_primario). |
| `backend/apps/accounts/realtime.py` | Push WebSocket sem payload (permissions_changed, account_deactivated) em lotes de 100 para o grupo user_{id}. |
| `backend/apps/accounts/sharing.py` | CompartilhamentoSetorMixin: action `compartilhar` (GET/POST) e acoplamento de SetorPermiteEscrita a toda rota de detalhe via check_object_permissions. |
| `backend/apps/accounts/urls.py` | Router (users, cargos, setores) + rotas públicas de register/login/logout/logout-all/recover-account. |
| `backend/config/settings.py` | AUTHENTICATION_BACKENDS (a soma de permissões), SETOR_SCOPING_ENABLED, SETOR_WRITE_ENFORCEMENT_ENABLED, DEFAULT_AUTHENTICATION_CLASSES e os throttles login/register/recovery. |
| `backend/apps/accounts/migrations/0013_reconcile_system_cargos_and_seed.py` | Semeia o catálogo inicial: só os cargos de sistema 'admin' (catálogo inteiro) e 'visitante' (vazio); joga todos os não-superusers em visitante. |
| `backend/apps/accounts/migrations/0016_seed_setor_padrao.py` | Semeia o setor de sistema 'sem_setor' (Sem Setor) e vincula todos os usuários existentes a ele. |

### Domínio central: projetos, sprints, cards, kanban

| Arquivo | Papel |
|---|---|
| `backend/apps/projects/models.py` | Os 27 models do domínio central + 12 TextChoices + a constante CARD_STATUS_FECHADOS. 1.466 linhas. Contém `Sprint.save()` (agendamento do fechamento por ETA), `Project.save()` (herança de setor) e `Card.save()` (espelho de setor + zeramento de data_inicio). |
| `backend/apps/projects/services.py` | Regras de negócio fora da request: replicação/finalização de sprint, dedupe de cards por nome, conflito de janela entre sprints do mesmo setor, reancoramento de card em outra sprint, desatribuição de cards de conta desativada. |
| `backend/apps/projects/signals.py` | 1.006 linhas. `card_pre_save` guarda o estado anterior e recalcula métricas; `card_created_or_updated` escreve o CardLog de diff e dispara notificações/broadcast; remove CardPin ao fechar o card; recalcula todos os CardScore quando um critério muda. |
| `backend/apps/projects/business_time.py` | Cálculo de tempo em desenvolvimento (segundos corridos, dias úteis, minutos úteis). Expediente 07:30–12:30 e 13:30–17:30 America/Sao_Paulo, sem fins de semana e feriados. |
| `backend/apps/projects/tasks.py` | Celery: alertas de prazo do card, fechamento automático da semana de prioridades, fechamento de sprint por ETA e o fallback por data. |
| `backend/apps/projects/migrations/0028_seed_kanban_stages.py` | Seed das 6 etapas padrão do Kanban e criação da config default em todos os projetos existentes. É a origem da coincidência entre `KanbanStage.is_terminal` e `CARD_STATUS_FECHADOS`. |
| `backend/apps/projects/migrations/0061_feedback_fase2.py` | Adiciona `Sprint.is_system`, `Card.gerar_formulario_feedback` e `KanbanStage.oculta_no_catalogo`. O docstring explica por que os três nascem juntos e por que o seed da estrutura fica em `feedbacks/0003_seed_monitoramento` (para `projects` não conhecer `feedbacks`). |
| `backend/apps/projects/migrations/0053_setor_non_null.py` | Backfill + NOT NULL + PROTECT em `setor` de Sprint/Project/Card. Faz o backfill sozinha para o `migrate` do entrypoint rodar sem passo manual. |
| `backend/apps/accounts/models.py` | `SetorCatalogo` (linha 111), `NivelCompartilhamento` (272) e `CompartilhamentoSetorBase` (283) — a base abstrata das três tabelas de compartilhamento de projects. |
| `backend/apps/projects/serializers.py` | Onde moram validações que o model não faz: `_validar_status_no_board` (status tem de ser etapa configurada NO PROJETO), conflito de janela de sprint, cálculo de `duracao_dias`, herança de setor na criação da sprint. |
| `backend/apps/projects/realtime.py` | Broadcasts efêmeros de WebSocket (kanban_changed, card_moved, solicitacoes_changed). Nada persiste; o payload nunca leva conteúdo. |
| `backend/apps/feedbacks/signals.py` | O gatilho de `gerar_formulario_feedback` mora AQUI, não em projects: `post_save` com `sender='projects.Card'` (string, para não importar projects) disparando na TRANSIÇÃO para 'finalizado'. |

### API de projetos e regras de negócio

| Arquivo | Papel |
|---|---|
| `backend/apps/projects/urls.py` | Registro do DefaultRouter com os 15 basenames. Única rota fora do router: `notifications/preferences/`, declarada ANTES do include para não ser capturada pelo detail-route do router. |
| `backend/apps/projects/views.py` | 3.052 linhas com todos os viewsets, as constantes de mensagem do fluxo de feedback e os helpers de regra (`_card_edicao_restrita`, `_sprint_efetivamente_fechada`, `_projeto_do_fluxo_de_feedback`, `_move_project_cards_status`, `_avisar_painel_de_solicitacoes`). |
| `backend/apps/projects/serializers.py` | 1.907 linhas. Gates de setor de campos graváveis (`_checar_destino_do_setor`, `_checar_pessoa_do_setor`), validação de status contra as colunas do board (`_validar_status_no_board`), regra de sobreposição de janelas da sprint e allowlist de anexos. |
| `backend/apps/projects/services.py` | 600 linhas. Replicação na virada da sprint, eleição da sprint destino, regras de janela por setor, reancoramento de card reaberto e desatribuição de cards de conta desativada. |
| `backend/apps/projects/tasks.py` | Tasks Celery que chamam `finalizar_sprint_replicacao` (ETA por sprint e varredura por data) e as de deadline/fechamento de semana. |
| `backend/apps/projects/realtime.py` | Broadcasts WebSocket usados pelas views (painel de solicitações e kanban). |
| `backend/apps/accounts/permissions.py` | Fonte das permission classes usadas aqui: HasPerm, PodeVerConteudo (`view_content`), NaoVisitanteEscreve, SetorPermiteEscrita. |
| `backend/apps/accounts/sharing.py` | `CompartilhamentoSetorMixin` — dá a action `<recurso>/<id>/compartilhar/` a Sprint/Project/Card e acopla `SetorPermiteEscrita` a QUALQUER rota de detalhe via `check_object_permissions`. |
| `backend/apps/accounts/scoping.py` | `scope_*`, `*_editaveis` e `checar_escrita_no_pai` — os helpers de escopo por setor consumidos por views e serializers. |

### Feedbacks pós-entrega

| Arquivo | Papel |
|---|---|
| `backend/apps/feedbacks/models.py` | As 3 tabelas (FeedbackFormulario, PedidoFeedback, RespostaFeedback), o enum EstadoPedido, as constantes ESTADOS_QUE_PROMOVEM / ESTADOS_SEM_LINK / MAX_RESPOSTAS_POR_PEDIDO e a função link_ativo(). O cabeçalho do arquivo explica a divisão entre as três tabelas. |
| `backend/apps/feedbacks/signals.py` | O GATILHO. pre_save relê o status anterior do Card e o pendura na instância; post_save detecta a TRANSIÇÃO para 'finalizado' e agenda a geração via transaction.on_commit. |
| `backend/apps/feedbacks/estrutura.py` | O projeto de sistema 'Monitoramento de Feedbacks': setor técnico, sprint sistêmica, projeto oculto, as 4 etapas do board (auto-cura idempotente) e a criação do pedido + card de exibição de um card recém-finalizado. |
| `backend/apps/feedbacks/services.py` | Fronteira do motor: gerar_token, mascara_token, formulario_ativo, criar_pedido_feedback (idempotente por OneToOne), mover_pedido_do_card_kanban (o arraste) e notificar_transicao (projeta o estado na coluna). |
| `backend/apps/feedbacks/views.py` | FeedbackPublicoView (a rota anônima: GET devolve o formulário, POST grava a resposta), PedidoFeedbackViewSet (link para copiar, singular e em lote), ExportarFeedbacksView e PreviaFeedbacksView. |
| `backend/apps/feedbacks/serializers.py` | campos_publicos() (reduz a definição ao mínimo que o anônimo vê), validar_valores() (whitelist estrita com dispatch por tipo), resposta_legivel() (casa label↔valor contra a versão daquele pedido) e os 3 serializers. |
| `backend/apps/feedbacks/tasks.py` | liberar_pedidos_no_prazo (a varredura dos 30 dias + _reconciliar_colunas_do_kanban) e limpar_respostas_expiradas (retenção LGPD, desligada por padrão). |
| `backend/apps/feedbacks/exportacao.py` | _linhas_e_colunas() (união de todas as versões do formulário), exportar_csv, exportar_xlsx e previa(). É onde mora a neutralização de prefixo de fórmula. |
| `backend/apps/feedbacks/throttling.py` | FeedbackIPThrottle (por IP), FeedbackTokenThrottle (leitura, chave = SHA-256 do texto do token) e FeedbackEnvioThrottle (escrita, balde separado com prefixo próprio). |
| `backend/apps/feedbacks/urls.py` | Rotas AUTENTICADAS (router de /feedbacks/pedidos/ + as duas de exportação). A rota pública NÃO está aqui de propósito. |
| `backend/config/urls.py` | Onde a rota PÚBLICA é registrada (linha 41), ANTES dos include(), porque o urlconf termina no catch-all serve_spa. |
| `backend/config/settings.py` | FEEDBACK_ESPERA_DIAS / FEEDBACK_RETENCAO_DIAS / FEEDBACK_PUBLIC_BASE_URL (linhas 463-485), as 3 taxas de throttle (linhas 284-293) e o CELERY_BEAT_SCHEDULE das duas tasks (linhas 509-532). |
| `backend/apps/feedbacks/migrations/0003_seed_monitoramento.py` | Gêmeo congelado de estrutura.py: semeia setor técnico, sprint sistêmica, projeto oculto e as 3 primeiras etapas com apps.get_model. |
| `backend/apps/feedbacks/migrations/0005_seed_formulario_v2.py` | O exemplo real e comentado do procedimento de 2 passos de troca de versão, com o formulário definitivo de 11 perguntas e 6 seções. |
| `backend/apps/feedbacks/migrations/0007_seed_formulario_v3.py` | A versão ATIVA do formulário (v3): a v2 com o campo 'setor_respondente' inserido na Identificação. |
| `backend/apps/feedbacks/migrations/0009_etapa_feedback_encerrado.py` | Acrescenta a 4ª etapa 'feedback_encerrado' às choices e cria a KanbanStage amarrada só ao projeto de monitoramento. |
| `backend/apps/projects/views.py` | Consumidor externo: _mover_card_do_fluxo_de_feedback (linhas 1213-1258) recorta o PATCH do card de feedback e delega a mover_pedido_do_card_kanban; as mensagens de bloqueio estão nas linhas 125-156. |
| `backend/apps/feedbacks/_apoio_testes.py` | Apoio: deriva um payload de resposta VÁLIDO a partir da definição ativa, para os testes de motor não quebrarem a cada versão nova do formulário. |
| `frontend/src/services/pedidoFeedbackService.ts` | Lado autenticado no cliente: busca por card, busca em lote, download da planilha e prévia. Separado de feedbackService.ts (anônimo, axios sem interceptors) de propósito. |

### Geração de relatórios

| Arquivo | Papel |
|---|---|
| `backend/apps/reports/models.py` | Modelo `ReportJob` (o único do app): status, progress, filters JSON, FileField, file_size, error, timestamps. Docstring descreve o contrato do ciclo de vida. |
| `backend/apps/reports/views.py` | `ReportJobViewSet` — create com lock 409, destroy (cancela ou remove), actions `download`, `preview`, `preview-table`. Contém `_serve_file_and_delete_on_success` (stream + auto-delete) e `_serve_file`. |
| `backend/apps/reports/tasks.py` | Task `reports.generate_report` (gera e salva o arquivo) e `reports.limpar_relatorios_expirados` (expurgo de vencidos + órfãos). |
| `backend/apps/reports/serializers.py` | `ReportJobCreateSerializer` (valida `type` contra o registry e `format` contra as choices) e `ReportJobSerializer` (resposta do polling, com `download_url`/`preview_url` derivados). |
| `backend/apps/reports/urls.py` | DefaultRouter registrando `reports` com basename `reports`; incluído em `backend/config/urls.py` sob o prefixo `api/`. |
| `backend/apps/reports/generators/__init__.py` | REGISTRY de geradores: `_MODULES` lista os 8 módulos, `_populate_registry()` importa cada um e pega o atributo `Report`, `resolve(type_id)` e `available_types()`. Imports tolerantes a ImportError. |
| `backend/apps/reports/generators/base.py` | `BaseReport` (425 linhas, o coração): fontes de dados escopadas, `set_progress`, `paginate_with_progress`, `filename`, `_logo_path`, `_common_context`, `render_html` e os quatro renderizadores `_render_pdf/_render_docx/_render_xlsx/_render_csv`. Também os dataclasses `TableColumn` e `FilterDisplay`. |
| `backend/apps/reports/generators/dev_time_stats.py` | Agregação de tempo em desenvolvimento a partir dos campos persistidos do Card: `_new_bucket`, `accumulate_card_dev_time`, `bucket_averages`, `aggregate_dev_time`. |
| `backend/apps/reports/generators/metrics.py` | Gerador `metrics` (332 linhas, o maior): KPIs, ranking por usuário, throughput por sprint, volume por área, tempo de dev e operação geral. |
| `backend/apps/reports/generators/cards.py` | Gerador `cards` — o mais filtrável (sprint, projeto, status, área, tipo, responsável, prioridade, período). |
| `backend/apps/reports/generators/sprint.py` | Gerador `sprint` — exige `sprint_id`; projetos e cards agrupados por projeto + KPIs da sprint. |
| `backend/apps/reports/generators/projects.py` | Gerador `projects` — cards agrupados por projeto, `project_ids` opcional. |
| `backend/apps/reports/generators/user.py` | Gerador `user` — exige `user_id`; entregas, on-time %, tempo de dev, distribuição por área. |
| `backend/apps/reports/generators/bottlenecks.py` | Gerador `bottlenecks` — entregues fora do prazo + em aberto com prazo vencido + tempo de dev por área. |
| `backend/apps/reports/generators/executive.py` | Gerador `executive` — página única de KPIs. `table_columns()` retorna [] (sem export tabular). |
| `backend/apps/reports/generators/backlog.py` | Gerador `backlog` — cards não finalizados/não inviabilizados agrupados por projeto. |
| `backend/apps/reports/templates/reports/base.html` | Template pai (266 linhas): paleta BWA, `@page` A4 com cabeçalho/rodapé, KPI cards, badges de status/prioridade, header com logo e bloco de filtros aplicados. Define o bloco `extra_styles` e o bloco `content`. |
| `backend/apps/reports/templates/reports/` | Um template por gerador (backlog, bottlenecks, cards, executive, metrics, projects, sprint, user), todos `{% extends 'reports/base.html' %}`. |
| `backend/apps/reports/templatetags/reports_extras.py` | Filtros de template: `get_item`, `format_segundos_corridos_filter`, `format_minutos_uteis_filter`, `initials`. |
| `backend/apps/reports/management/commands/limpar_relatorios.py` | Comando `limpar_relatorios` (com `--dry-run`) para rodar o expurgo na mão quando esperar as 03h30 não serve. |
| `backend/apps/reports/migrations/0002_alter_reportjob_user.py` | Troca `user` de CASCADE para SET_NULL + null/blank — apagar o usuário não pode apagar o registro de que o relatório foi emitido. |
| `backend/config/settings.py` | `REPORT_RETENTION_DAYS` (linha 461), entrada `limpar-relatorios-expirados` em `CELERY_BEAT_SCHEDULE` (linhas 496–502), `CELERY_TASK_ALWAYS_EAGER` (452) e a paginação global do DRF (PAGE_SIZE=20). |
| `backend/config/views.py` | `serve_media` — bloqueia o prefixo `reports/` em `_MEDIA_BLOQUEADA` (linhas 34–46), com 404 em vez de 403 de propósito. |
| `Dockerfile` | Instala as libs nativas do WeasyPrint (libpango, libpangoft2, libcairo2, libgdk-pixbuf, libffi8, shared-mime-info, fonts-liberation, fonts-noto-color-emoji). |
| `frontend/src/services/reportService.ts` | Cliente HTTP: create/getById/list/cancel/downloadFile/previewTable + parsing de Content-Disposition (RFC 5987 e legacy) e sanitização de filename. |
| `frontend/src/pages/Reports.tsx` | Página `/relatorios`: catálogo `REPORT_DEFS` (título, descrição, categoria, filtros, obrigatórios e grupos mutuamente exclusivos de cada relatório), retomada de job ativo após reload e roteamento do job concluído (PDF→preview, resto→download). |
| `frontend/src/components/reports/ReportConfigPanel.tsx` | Painel de configuração (866 linhas): filtros, formato, `include_header`, submit, polling (`POLL_INTERVAL_MS = 1500`), adoção do job em 409, cancelar, e `serializeFilters` (mapeia as chaves da UI para as do backend). |
| `frontend/src/components/reports/ReportPreviewDialog.tsx` | Modal de preview do PDF: busca via axios como blob (iframe não manda Authorization), força `application/pdf`, e no botão Baixar dispara DELETE fire-and-forget. |
| `frontend/src/components/reports/ReportTablePreviewDialog.tsx` | Modal de preview tabular XLSX/CSV com scroll infinito (`PAGE_SIZE = 100`) sobre `POST /api/reports/preview-table/`. |
| `frontend/src/lib/reportSettings.ts` | Persistência em localStorage da preferência `include_header` por formato tabular (chave `reports:include-header:<fmt>`). |

### Chamados, Geek Day, sugestões e apps mortos

| Arquivo | Papel |
|---|---|
| `backend/apps/formularios/models.py` | Catálogo de suporte (SuporteTipo/Item/Motivo), ChamadoSuporte, timeline local, anexo de resolução e compartilhamento por setor. 195 linhas. |
| `backend/apps/formularios/views.py` | Coração do app: 3 viewsets + o helper `_user_can_access_chamado`, que é a ÚNICA porta de acesso da timeline e da resolução. 576 linhas. |
| `backend/apps/formularios/realtime.py` | Publicação dos eventos do Kanban: decide EM QUAIS grupos do channel layer o evento entra (recorte na origem, não na ponta). 208 linhas. |
| `backend/apps/formularios/consumers.py` | `SuporteKanbanConsumer` — autentica por Token e decide, no connect, em que grupos o socket se inscreve. 186 linhas. |
| `backend/apps/formularios/portal_proxy_views.py` | `PortalFormulariosProxyView`: proxy GET/POST/PATCH/PUT/DELETE para `{PORTAL_BASE_URL}/api/formularios/<path>`, com defesa SSRF, retry em 401 e broadcast WS por heurística. 349 linhas. |
| `backend/apps/formularios/portal_auth.py` | Login no portal externo e cache do JWT `access` (TTL 240s, variável de módulo). |
| `backend/apps/formularios/serializers.py` | Read/Write/Patch de chamado, catálogo aninhado, validação do arquivo de resolução (extensões + 10 MB) e timeline. |
| `backend/apps/geekday/models.py` | GeekDayGrupo, GeekDayGrupoSetor, GeekDayDraw e as três funções que definem quem pertence/quem pode ser sorteado. 299 linhas. |
| `backend/apps/geekday/views.py` | GeekDayGrupoViewSet e GeekDayDrawViewSet com as actions de sorteio, marcar/desmarcar, reset e histórico. 524 linhas. |
| `backend/apps/geekday/tests.py` | 645 linhas — a única suíte de testes dos cinco apps. Cobre o recorte de participação, ciclo e reset. |
| `backend/apps/geekday/__init__.py` | Arquivo de 14 linhas cujo comentário documenta um bug real: sem ele o diretório virava namespace package e `manage.py test apps` PULAVA a suíte inteira em silêncio. |
| `backend/apps/teams/management/commands/export_hierarchy.py` | Dump JSON de Team/TeamMember/Hierarchy/NodePosition antes do drop das tabelas — o app está deprecado desde a Fase 6. |
| `backend/config/urls.py` | Registra `api/formularios/`, `api/suggestions/`, `api/geekday-*` e as duas rotas do portal. É aqui que se vê que teams e timeline NÃO são expostos. |
| `backend/apps/projects/routing.py` | Rota do WebSocket `ws/suporte/` (o app formularios não tem routing.py próprio). |
| `frontend/src/services/formulariosApi.ts` | Cliente axios que decide entre os 4 modos de acesso ao suporte (proxy Vite, proxy Django, URL direta do portal, backend Django local). |

### Configuração e roteamento

| Arquivo | Papel |
|---|---|
| `backend/config/settings.py` | Settings único (571 linhas). Carrega dois .env, decide dev vs prod, define INSTALLED_APPS, MIDDLEWARE, DRF, CORS/CSRF, CHANNEL_LAYERS, Celery + beat schedule, flags de setor e LOGGING. |
| `backend/config/urls.py` | Roteamento raiz. Rotas públicas antes dos include() (para não serem capturadas pelo router), sete include() de apps, /media/ e catch-all da SPA no fim. |
| `backend/config/views.py` | Três views de infraestrutura: api_root (JSON público, usado pelo HEALTHCHECK do Docker), serve_media (gate de acesso por prefixo + cache imutável + 304) e serve_spa (serve o build do Vite). |
| `backend/config/asgi.py` | ProtocolTypeRouter: HTTP no handler Django, WebSocket com LoggingOriginValidator + AuthMiddlewareStack + URLRouter. Monta a lista de origens WS a partir de WS_ALLOWED_ORIGINS + ALLOWED_HOSTS + CSRF_TRUSTED_ORIGINS. |
| `backend/config/celery.py` | App Celery 'bwaproj'. Faz django.setup() ANTES de instanciar o Celery e reescreve os env vars CELERY_* com o valor pós-processamento do settings. |
| `backend/config/wsgi.py` | WSGI padrão do Django. Existe mas não é o caminho de produção (o CMD do Dockerfile usa daphne + config.asgi). |
| `backend/config/__init__.py` | Importa celery_app dentro de try/except ImportError — se o Celery não estiver instalado, celery_app vira None em vez de quebrar o boot. |
| `backend/apps/projects/routing.py` | websocket_urlpatterns — as três rotas WS do sistema. Não vive em config/, mas é o que asgi.py importa. |
| `Dockerfile` | Multi-stage. Fixa DOTENV_OVERRIDE=false e PYTHONUNBUFFERED=1, roda como usuário não-root 10001, e o CMD encadeia migrate + collectstatic + daphne. |
| `docker-compose.yml` | Cinco serviços (db, redis, backend, celery-worker, celery-beat). Todos usam env_file: .env da raiz. Volume backend_media compartilhado entre backend e worker. |
| `docker-compose.override.yml` | Gitignored, só dev: expõe 127.0.0.1:6379 do Redis para o Celery rodado nativo no host conseguir conectar. |
| `.env.docker.example` | Modelo do .env da RAIZ (produção/compose). Inclui as variáveis do Traefik, Postgres, Redis e as duas flags de setor com a ordem de ativação comentada. |
| `backend/.env.example` | Modelo do backend/.env (dev local: banco no Docker + runserver nativo). |
| `backend/apps/accounts/authentication.py` | ExpiringTokenAuthentication — a classe de autenticação padrão do DRF. TOKEN_TTL = 24 horas, hardcoded (não é env var). |
| `backend/apps/feedbacks/throttling.py` | Define os escopos feedback_ip, feedback_token e feedback_envio cujas taxas estão em DEFAULT_THROTTLE_RATES. |

### Filas, agendamentos e tempo real

| Arquivo | Papel |
|---|---|
| `backend/config/celery.py` | Instancia a app Celery ('bwaproj'). Faz django.setup() ANTES de instanciar e reescreve os env vars CELERY_BROKER_URL/CELERY_RESULT_BACKEND com o valor pós-reescrita do settings, porque o Celery prioriza env vars sobre config_from_object. Define broker_connection_retry_on_startup=False e a debug_task. |
| `backend/config/settings.py` | Linhas 388-418 CHANNEL_LAYERS; 420-453 config Celery; 487-533 CELERY_BEAT_SCHEDULE completo; 456-485 os settings que as tasks leem (REPORT_RETENTION_DAYS, FEEDBACK_ESPERA_DIAS, FEEDBACK_RETENCAO_DIAS). |
| `backend/config/asgi.py` | ProtocolTypeRouter http/websocket. Define LoggingOriginValidator (OriginValidator que loga a origem rejeitada) e monta a lista de origens permitidas a partir de WS_ALLOWED_ORIGINS + ALLOWED_HOSTS + CSRF_TRUSTED_ORIGINS. |
| `backend/apps/projects/routing.py` | websocket_urlpatterns — as 3 rotas WS do sistema inteiro (inclusive a do app formularios, importada aqui). |
| `backend/apps/projects/consumers.py` | NotificationConsumer (grupo user_<id>) e SprintKanbanConsumer (grupo sprint_<id>_kanban), com autenticação por Token e checagem de escopo por setor. |
| `backend/apps/formularios/consumers.py` | SuporteKanbanConsumer — o único consumer cujo escopo é resolvido por INSCRIÇÃO em múltiplos grupos, não por descarte no push. |
| `backend/apps/projects/realtime.py` | broadcast_kanban_changed, broadcast_card_moved e broadcast_solicitacoes_changed. Contém _sprint_is_active, que faz todo broadcast de kanban virar no-op fora da sprint em andamento. |
| `backend/apps/accounts/realtime.py` | Push de mudança de acesso no grupo user_<id>: notify_permissions_changed, notify_cargo_permissions_changed, notify_account_deactivated e o wrapper público notify_users. Envio em lotes de 100 com asyncio.gather. |
| `backend/apps/formularios/realtime.py` | broadcast_chamado + a taxonomia de grupos do kanban de suporte (5 grupos), com a tabela de correspondência grupo→ramo de scope_chamados no docstring do módulo. |
| `backend/apps/projects/notification_utils.py` | send_notification / send_notification_to_multiple_users: grava a Notification no banco (respeitando UserNotificationPreference) e empurra o payload completo para o grupo user_<id>. |
| `backend/apps/projects/tasks.py` | 4 tasks: check_card_deadlines, verificar_fechamento_automatico_semana, fechar_sprint_em_hora (ETA) e finalizar_sprints_por_data (fallback). |
| `backend/apps/feedbacks/tasks.py` | 2 tasks nomeadas (feedbacks.*): liberar_pedidos_no_prazo (com a reconciliação do kanban no fim) e limpar_respostas_expiradas (retenção LGPD). |
| `backend/apps/reports/tasks.py` | 2 tasks nomeadas (reports.*): generate_report (enfileirada pela view) e limpar_relatorios_expirados (beat). |
| `backend/apps/projects/signals.py` | 1005 linhas, 10 receivers. Concentra CardLog, notificações e os disparos de broadcast do kanban. |
| `backend/apps/feedbacks/signals.py` | Gatilho do motor de feedback: pre_save/post_save em 'projects.Card' declarados por STRING (resolução preguiçosa) para não importar apps.projects no carregamento. |
| `backend/apps/projects/models.py` | Sprint.save() (linhas 71-121) — o agendamento por ETA de fechar_sprint_em_hora, publicado numa thread daemon dentro de transaction.on_commit. |
| `backend/apps/projects/management/commands/agendar_fechamento_sprints_abertas.py` | Republica os ETAs de todas as sprints abertas. Roda no deploy (o broker perde os ETAs pendentes). |
| `docker-compose.yml` | Serviços celery-worker (concurrency=1, prefetch-multiplier=1) e celery-beat (schedule em /tmp), ambos reusando a imagem do backend e montando o volume backend_media. |

### Banco de dados

| Arquivo | Papel |
|---|---|
| `backend/config/settings.py` | Linhas 147-166: chave USE_POSTGRES decide entre Postgres e SQLite. Linhas 78-104: INSTALLED_APPS com os 9 apps locais que têm migrações. |
| `backend/apps/projects/models.py` | 26 modelos — o núcleo do esquema (Sprint, Project, Card e satélites). Concentra a maior parte dos comentários de decisão sobre on_delete e sobre o que é 'card fechado'. |
| `backend/apps/accounts/models.py` | User (AbstractUser), Cargo, SetorCatalogo, UserSetor e a base abstrata CompartilhamentoSetorBase reusada por 4 tabelas de compartilhamento. Contém o override de User.delete() que substitui exclusão por desativação. |
| `backend/apps/accounts/permission_catalog.py` | PERMISSION_CATALOG com 29 permissões e o modelo fantasma PermissaoPlataforma (managed=False, sem tabela) cujo Meta.permissions gera as linhas em auth_permission. |
| `backend/apps/feedbacks/models.py` | Única constraint PARCIAL do repositório (uniq_formulario_ativo_por_slug) e o modelo de formulário versionado como DADO (JSON), não como esquema. |
| `backend/apps/accounts/migrations/0013_reconcile_system_cargos_and_seed.py` | Seed dos cargos de sistema (admin + visitante) e realocação de TODOS os usuários existentes. |
| `backend/apps/accounts/migrations/0016_seed_setor_padrao.py` | Seed do setor 'sem_setor' (is_system=True) e vínculo de todos os usuários existentes; apaga os setores do seed antigo. |
| `backend/apps/projects/migrations/0028_seed_kanban_stages.py` | Seed das 6 KanbanStage globais e criação de ProjectKanbanStageConfig para todos os projetos já existentes. |
| `backend/apps/projects/migrations/0053_setor_non_null.py` | Backfill + fechamento de setor como NOT NULL/PROTECT em Sprint, Project e Card. Aborta com RuntimeError se sobrar órfão. |
| `backend/apps/feedbacks/migrations/0003_seed_monitoramento.py` | Seed da estrutura sistêmica de feedback (setor técnico + sprint is_system + projeto is_system + 3 etapas ocultas). Gêmea de apps/feedbacks/estrutura.py. |
| `backend/apps/feedbacks/estrutura.py` | Gêmeo em runtime da migração 0003: auto-cura que recria a estrutura de monitoramento na primeira entrega quando o seed pulou por falta de usuário. |
| `backend/apps/projects/migrations/0060_desatribuir_cards_de_inativos.py` | Migração de dados IRREVERSÍVEL: solta o responsável dos cards abertos de contas já desativadas e grava um CardLog por card. |
| `backend/apps/projects/services.py` | desatribuir_cards_de_usuario_desativado (linha 478) — dono único da regra 'conta desativada não segura card aberto', chamado por User.delete() e por UserViewSet.set_active. |
| `backend/apps/accounts/scoping.py` | SETOR_PADRAO_CODENAME='sem_setor' (linha 42) e setor_padrao_do_sistema() (linha 83) — a constante que as migrações de setor replicam. |

### Frontend: rotas, estado, comunicação

| Arquivo | Papel |
|---|---|
| `frontend/vite.config.ts` | Build. Alias `@` → ./src; sourcemap desligado só em produção (`sourcemap: mode !== 'production'`); PWA com manifest BWA Tech; proxy de dev `/__formularios` → VITE_FORMULARIOS_PROXY_TARGET (só se a env existir; `ws: false` de propósito). |
| `frontend/tsconfig.app.json` | Compilador do app: target ES2022, jsx react-jsx, strict, verbatimModuleSyntax, erasableSyntaxOnly, paths `@/*` → ./src/*. `noUnusedLocals`/`noUnusedParameters` são FALSE aqui (true em tsconfig.node.json). |
| `frontend/postcss.config.js` | Único plugin: `@tailwindcss/postcss`. É todo o pipeline de CSS. |
| `frontend/src/index.css` | Todo o design system: `@import "tailwindcss"`, bloco `@theme` com as variáveis de cor/raio/espaçamento do modo claro, bloco `.dark` que redefine as mesmas variáveis, `@layer base`, scrollbar, e as classes utilitárias próprias (bg-app-mesh, bg-sidebar-gradient, bg-projeto-sistema, bg-feedback-mesh, painel-vidro, border-header-gradient, animações fluxo-sistema / feedback-tela / feedback-bloco / required-ring-blink). |
| `frontend/src/main.tsx` | Bootstrap: registerSW({immediate:true}) do PWA, ReactDOM.createRoot, StrictMode → ThemeProvider → App. ThemeProvider fica FORA do Router (o tema vale também nas telas públicas). |
| `frontend/src/App.tsx` | Router inteiro. Define PrivateRoute, PublicRoute, PermissionRoute e a tela SemAcesso; monta AuthProvider > Router > Routes, e dentro de `/` o trio NotificationProvider > SidebarProvider > Layout. |
| `frontend/src/routes.ts` | Constante ROUTES com todos os caminhos em português (+ construtores sprintPorId/sprintCard/projeto/projetoCard) e `isNavRouteActive` (destaque do item de menu por prefixo). |
| `frontend/src/components/layout/Layout.tsx` | Shell autenticado: Sidebar + header sticky de 64px (título da página derivado do pathname, logo que troca com o tema, switch de tema, NotificationsButton) + <Outlet/>. Margem esquerda 64/256px conforme SidebarContext. |
| `frontend/src/components/layout/Sidebar.tsx` | Menu lateral. Cada item tem `requires` (codename) e é filtrado por `hasPermission`; o item Sprints resolve href dinamicamente para a sprint em andamento. |
| `frontend/src/context/AuthContext.tsx` | Sessão: user, loading, isAuthenticated, profilePictureUrl, login/register/finalizeAuth/logout/refreshUser. Agenda logout automático por `auth_expires_at`, revalida em `visibilitychange`, e popula o cache de cor/rótulo de cargos e setores. |
| `frontend/src/context/NotificationContext.tsx` | Notificações paginadas (DRF), contador de não lidas com refresh a cada 30s, filtro all/unread, e é quem monta o `useWebSocket` global. Reemite eventos como CustomEvent de window (`notificationReceived`, `solicitacoesChanged`). |
| `frontend/src/context/ThemeContext.tsx` | Tema light/dark. Persiste em localStorage['bwa-theme'], aplica/remove a classe `.dark` em document.documentElement e só segue `prefers-color-scheme` enquanto o usuário não escolheu explicitamente. |
| `frontend/src/context/SidebarContext.tsx` | Estado colapsado/expandido do menu. 30 linhas, sem persistência — recolher o menu não sobrevive a um F5. |
| `frontend/src/hooks/useWebSocket.ts` | Socket global `/ws/notifications/`. Ping 30s, backoff sem limite de tentativas (teto 30s), reconexão imediata em `online`/`visibilitychange`, e ressincronização de permissões/solicitações a cada RE-conexão. |
| `frontend/src/hooks/useSprintKanbanWebSocket.ts` | Socket `/ws/sprints/<id>/kanban/`. Eventos `card_moved` e `kanban_changed`; máx. 8 reconexões. Usado por Dashboard, SprintDetails e ProjectDetails. |
| `frontend/src/hooks/useSuporteKanbanWebSocket.ts` | Socket `/ws/suporte/` (só quando os chamados vivem no Django local). Eventos chamado_created/updated/deleted; revive na volta da aba. |
| `frontend/src/services/api.ts` | Cliente axios padrão. baseURL = VITE_API_URL ?? (dev ? http://127.0.0.1:8000/api : /api), timeout 60s; interceptor injeta `Authorization: Token <auth_token>` exceto em register/login/recover-account e remove Content-Type em FormData; interceptor de resposta limpa a sessão e redireciona para /entrar em 401 (com guarda `redirectInFlight` contra loop). Exporta `PaginatedResponse<T>` e `fetchAllPaginated<T>`. |
| `frontend/src/services/formulariosApi.ts` | Cliente axios dos chamados de suporte. Resolve baseURL em 4 modos (proxy Vite /__formularios, proxy via Django /api/portal-formularios, URL absoluta do portal, Django local) e o esquema de auth (Token BWA vs Bearer JWT do portal). |
| `frontend/src/services/feedbackService.ts` | Cliente axios PRÓPRIO, sem interceptors, da rota anônima GET\|POST /api/feedback/<token>/. Também normaliza o formulário público, classifica falhas (404/410/429/400/rede), valida e guarda rascunho. |
| `frontend/src/lib/cachedFetch.ts` | Cache SWR caseiro (Map em memória + localStorage sob `cache:<key>`), com dedup de requisições em voo e escrita adiada por requestIdleCallback. Exporta METRICS_BUNDLE_CACHE_KEY ('metrics:bundle:v2'). |
| `frontend/src/lib/permissions.ts` | `hasPermission(user, codename)` — a ÚNICA forma de autorização no frontend. 15 linhas. |
| `frontend/src/lib/utils.ts` | `cn()` (clsx + tailwind-merge) e `normalizeExternalUrl()`. |

### Frontend: componentes e design system

| Arquivo | Papel |
|---|---|
| `frontend/src/lib/utils.ts` | Define `cn(...inputs) = twMerge(clsx(inputs))` — a base de composição de classes de TODO o sistema de design. Também `normalizeExternalUrl`, que prefixa https:// em links sem protocolo para não virarem URL relativa. |
| `frontend/src/index.css` | Único arquivo de tema. Bloco `@theme` com o modo claro, bloco `.dark` com o escuro, classes utilitárias da marca (`bg-sidebar-gradient`, `bg-app-mesh`, `bg-feedback-mesh`, `bg-projeto-sistema`, `painel-vidro`, `border-header-gradient`) e os keyframes/animações do produto, todos com variante `prefers-reduced-motion`. |
| `frontend/src/components/ui/dialog.tsx` | O padrão de modal do sistema — implementação própria com dois `createPortal` (backdrop e conteúdo) em document.body. Exporta Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription. É importado por 31 arquivos. |
| `frontend/src/components/ui/button.tsx` | cva com 6 variantes (default, destructive, outline, secondary, ghost, link) e 4 tamanhos (default, sm, lg, icon). Exporta `buttonVariants` para reuso fora do componente. |
| `frontend/src/components/ui/dropdown-menu.tsx` | Dropdown próprio (sem Radix) com contexto interno, click-outside via wrapperRef e medição de `max-height` em useLayoutEffect. Traz o prop `closeOnSelect` para itens de alternância. |
| `frontend/src/components/ui/chart.tsx` | Wrapper recharts no formato shadcn: ChartContainer (injeta `--color-<chave>` do ChartConfig e estiliza os seletores `.recharts-*` via arbitrary variants), ChartTooltip (= Recharts Tooltip) e ChartTooltipContent. |
| `frontend/src/hooks/useWebSocket.ts` | Socket global de `/ws/notifications/`. Trata notification, permissions_changed, account_deactivated, solicitacoes_changed. Backoff linear com teto de 30s e SEM limite de tentativas. |
| `frontend/src/hooks/useSprintKanbanWebSocket.ts` | Socket por sprint (`/ws/sprints/<id>/kanban/`). Dispara onCardMoved (card_moved) e onKanbanChanged (kanban_changed). Máximo de 8 reconexões. |
| `frontend/src/hooks/useSuporteKanbanWebSocket.ts` | Socket de suporte (`/ws/suporte/`). Faz upsert/delete de chamados; reabre imediatamente ao voltar para a aba (visibilitychange). |
| `frontend/src/context/NotificationContext.tsx` | Único consumidor de useWebSocket. Traduz eventos do socket em estado (lista/contador) e em CustomEvents de `window` (`notificationReceived`, `solicitacoesChanged`). |
| `frontend/src/context/ThemeContext.tsx` | Alterna a classe `dark` em document.documentElement, persiste em localStorage sob `bwa-theme` e segue `prefers-color-scheme` apenas enquanto o usuário não escolheu explicitamente. |
| `frontend/src/pages/ProjectDetails.tsx` | O quadro Kanban canônico (4.328 linhas): DndContext + pointerWithin, KanbanColumn (useDroppable), KanbanCard (useSortable), DragOverlayCard e todo o handleDragEnd com suas regras de negócio. |
| `frontend/src/components/KanbanCardPreview.tsx` | Card do Kanban 1:1 para uso FORA do quadro (ConclusaoModal, Cards Fixados). Mesmas cores, badges e layout do card real. |
| `frontend/src/components/layout/Layout.tsx` | Casca da aplicação: sidebar fixa + header de 64px com o título derivado do pathname, o toggle de tema e o sino de notificações; `<Outlet/>` no main. |
| `frontend/src/lib/priorityColors.ts` | Cores pastel de prioridade do card (`getPriorityStyle` como estilo inline) e as classes de badge de área/tipo que mudam quando o fundo é pastel. |
| `frontend/src/lib/catalog-style.ts` | Cache client-side do catálogo de cargos/setores vindo do backend (cor + rótulo) e `chipStyle(cor)`, que gera badge translúcido a partir de um hex. |
| `frontend/src/App.tsx` | Rotas, guardas (PrivateRoute, PublicRoute, PermissionRoute) e a hierarquia de providers: AuthProvider > Router > (NotificationProvider > SidebarProvider > Layout). |

### Infraestrutura, Docker e CI/CD

| Arquivo | Papel |
|---|---|
| `Dockerfile` | Imagem única do sistema. Estágio 1 buildar frontend com `npx vite build`; estágio 2 Python 3.12-slim com deps do WeasyPrint, usuário appuser (10001), HEALTHCHECK em /api/ e CMD `migrate && collectstatic && daphne -b 0.0.0.0 -p 8000 config.asgi:application`. |
| `docker-compose.yml` | Stack de produção: db, redis, backend, celery-worker, celery-beat. Define portas (todas em 127.0.0.1), volumes nomeados, healthchecks de db/redis, labels do Traefik e a rede externa `web`. Nenhum serviço tem `build:` — a imagem vem sempre do GHCR. |
| `docker-compose.override.yml` | Override de DEV, GITIGNORED. Faz uma coisa só: publica 127.0.0.1:6379 do Redis para o worker Celery rodado nativamente fora do compose. Em produção o arquivo não existe. |
| `.dockerignore` | Exclui node_modules, dist, venv, media, staticfiles, testes e `frontend/.env*` — com exceção explícita de `!frontend/.env.production`, que o Vite lê durante o build da imagem. |
| `.env.docker.example` | Template do `.env` da raiz. Documenta Traefik/HOST_BIND, credenciais Postgres/Redis, SECRET_KEY, ALLOWED_HOSTS/CORS/CSRF, PORTAL_*, as duas alternativas de configuração do VITE_FORMULARIOS_* e as flags SETOR_SCOPING_ENABLED / SETOR_WRITE_ENFORCEMENT_ENABLED. |
| `.env` | Arquivo real de configuração, lido pelo Compose (expansão de ${...} nas labels/portas) e injetado em runtime via `env_file` em TODOS os serviços. ESTÁ VERSIONADO NO GIT apesar da regra no .gitignore. |
| `.github/workflows/docker-publish.yml` | Build e push da imagem para ghcr.io a cada push em main (paths: Dockerfile, backend/**, frontend/**, .env, .dockerignore, o próprio workflow) ou por workflow_dispatch. Tags: `latest` e `sha-<curto>`. Cache de layers em `:buildcache` no próprio GHCR. |
| `.github/workflows/hostinger-deploy.yml` | Deploy na VPS via SSH. Dispara por workflow_run (build concluído com sucesso), por push que toque docker-compose.yml ou o próprio workflow, ou manualmente. Faz docker login no ghcr, clona/atualiza /opt/bwa_tech com `git reset --hard origin/main`, `docker compose pull`, `up -d --remove-orphans`, `image prune -f` e `ps`. |
| `iniciar-dev.bat` | Fluxo de dev local no Windows: abre Docker Desktop se preciso, `docker compose up -d db redis`, espera o container `bwa_tech-db-1` ficar healthy, e abre 4 janelas cmd — backend (migrate + runserver 127.0.0.1:8000), celery worker (--pool=solo), celery beat, e Vite (npm run dev) — abrindo http://localhost:5173. |
| `deploy.sh` | Deploy manual em Linux (git pull, checa Docker, cria a rede `web`, escolhe porta livre 8000–8010, `docker compose down` + `up -d --build`, migrate com até 10 tentativas, espera /api/ responder 200, cria superadmin, roda ensure_superadmin_role e agendar_fechamento_sprints_abertas). Exige ADMIN_USERNAME/PASSWORD/EMAIL no ambiente. Loga tudo em deploy_full_*.log + symlink deploy_latest.log. |
| `deploy.bat` | Equivalente Windows do deploy.sh, mesma sequência de 7 passos. Diferença: quando a porta 8000 está ocupada, ajusta CORS_ALLOWED_ORIGINS/CSRF_TRUSTED_ORIGINS para a porta alternativa (o deploy.sh não faz isso). |
| `scripts/compose-project-name.sh` | Resolve COMPOSE_PROJECT_NAME quando não exportado: detecta containers `bwa_tech-db-*` (prod) ou `bwaproj-db-*` (local), senão deduz pelo basename de ROOT ou por /opt/bwa_tech; default `bwaproj`. Existe exatamente porque prod e dev usam nomes de projeto diferentes. |
| `scripts/backup-diario.sh` | Backup automático na VPS (cron 03:00 do root). `pg_dump -Fc --no-owner --no-acl` dentro do container, gzip, grava em backups/bwa_tech_diario_AAAAMMDD_HHMMSS.dump.gz, valida tamanho mínimo (50 KiB) e queda >30% em relação ao anterior, aplica retenção de 14 dias, poda o próprio log em 5000 linhas. Usa flock, umask 0077 e PATH explícito. |
| `scripts/dump-prod-postgres.sh` | Dump avulso sob demanda (backups/bwaproj_prod_*.dump.gz). Suporta 3 modos: serviço do compose (default), container solto via PG_DUMP_CONTAINER, ou Postgres nativo via DUMP_USE_HOST_PG=1. |
| `scripts/restore-prod-docker.sh` | Restaura um .dump/.dump.gz na VPS: para backend + celery-worker + celery-beat, copia para /tmp do container db, `pg_restore --clean --if-exists --no-owner --no-acl`, sobe os serviços de volta. |
| `scripts/fetch-prod-dump.ps1` | Windows: por SSH gera o dump na VPS (exportando COMPOSE_PROJECT_NAME=bwa_tech), baixa por scp para backend/dump_banco_prod/ e opcionalmente já restaura com -Restore. |
| `scripts/restore-local-docker.ps1` | Windows: restaura um dump no Postgres local. Descompacta .gz usando um container alpine:3.19 descartável (não exige gzip no Windows), para backend/workers, pg_restore --clean --if-exists e sobe tudo de volta em bloco finally. |
| `scripts/restore-dump-banco-prod.ps1` | Wrapper: escolhe o .dump.gz/.dump mais recente em backend/dump_banco_prod/ e delega para restore-local-docker.ps1. |
| `backend/config/settings.py` | Carrega dois .env (backend/.env com override conforme DOTENV_OVERRIDE, depois o .env da raiz sem override), decide Postgres vs SQLite por USE_POSTGRES, monta CHANNEL_LAYERS/Celery a partir do Redis e contém as heurísticas de detecção dev-vs-prod (resolução DNS do hostname `redis`). |
| `backend/config/views.py` | `api_root` (linha 121) é o alvo do HEALTHCHECK do Dockerfile — JsonResponse estático, sem tocar no banco. Também tem `serve_spa` (serve frontend/dist) e `serve_media`. |
| `.claude/launch.json` | Config de preview do Claude Code: um único servidor `frontend` (npm run dev, porta 5173, cwd frontend). |
| `README.md` | Documento de entrada. Cobre instalação nativa, deploy com Docker, backup e restore. Contém links quebrados e informações desatualizadas (ver armadilhas). |

### Varredura de completude

| Arquivo | Papel |
|---|---|
| `PLANO_SETORES_CARGOS.md` | Documento de engenharia de 501 linhas com o rollout Setores/Cargos em 6 fases. Contém as DECISÕES FIXADAS com justificativa (seção 2), o passo a passo de migrations/commands de produção (seção 3), 18 riscos com mitigação (seção 7) e 9 perguntas de produto ainda em aberto (seção 8). É a fonte de 'por quê' mais densa do repositório. |
| `README.md` | Documentação de entrada — desatualizada. Diz React 18, `npm start`, lista só 5 apps e aponta para DOCKER.md, DEPLOY_REDE_LOCAL.md e DEPLOY_LOCAL.md, que NÃO existem no repositório. A única parte confiável é a seção de backup (linhas 170-194). |
| `scripts/backup-diario.sh` | Backup automático do Postgres na VPS, agendado no crontab do root. 220 linhas com validação de tamanho, lock por flock, escrita em .parcial, retenção de 14 dias e poda do próprio log. |
| `scripts/dump-prod-postgres.sh` | Dump avulso na VPS (formato custom -Fc, gzip). Suporta Postgres no compose, container solto (PG_DUMP_CONTAINER) ou Postgres nativo (DUMP_USE_HOST_PG=1). |
| `scripts/restore-prod-docker.sh` | Restaura dump na VPS. Para backend/celery-worker/celery-beat, roda pg_restore --clean --if-exists e sobe tudo de volta. DESTRUTIVO. |
| `scripts/restore-local-docker.ps1` | Mesma restauração no PC de dev (Windows). Descompacta .gz via container alpine (não exige gzip no Windows). |
| `scripts/fetch-prod-dump.ps1` | Gera o dump na VPS por SSH e baixa para backend/dump_banco_prod/. Com -Restore encadeia a restauração local. |
| `scripts/restore-dump-banco-prod.ps1` | Atalho: escolhe o dump mais recente em backend/dump_banco_prod/ e delega a restore-local-docker.ps1. |
| `scripts/compose-project-name.sh` | Resolve COMPOSE_PROJECT_NAME: `bwa_tech` na VPS (/opt/bwa_tech), `bwaproj` em dev local. Detecta pelo nome dos containers rodando, depois pelo basename da raiz. |
| `backend/apps/projects/management/commands/sprint_merge_recover.py` | 489 linhas — o command mais complexo do repositório. Recuperação pós fechamento automático incorreto: funde N sprints abertas numa destino, reabre sprint finalizada, funde projetos homônimos e restaura projetos para sprints fechadas via CSV. Dry-run por padrão (exige --commit). |
| `backend/apps/projects/management/commands/consolidar_projetos_sprint_atual.py` | Consolida projetos duplicados por nome na sprint em andamento, funde o Kanban, move cards para um canônico, apaga vazios e deduplica cards. Dry-run por padrão. |
| `backend/apps/projects/management/commands/agendar_fechamento_sprints_abertas.py` | Reagenda o ETA de fechamento (Celery `fechar_sprint_em_hora`) de todas as sprints não finalizadas. Roda no deploy — reconstrói agendamentos perdidos quando o broker é limpo. |
| `backend/apps/projects/management/commands/migrar_tudo_para_tecnologia.py` | Backfill do rollout de setores: joga sprints/projetos/cards órfãos e todos os usuários para o setor Tecnologia. Atômico, idempotente, com assert de zero órfãos no fim. |
| `backend/apps/accounts/management/commands/migrate_legacy_cargos.py` | Migra cargos legados (gerente/dados/processos) para desenvolvedor SEM tocar em user_permissions. Pula superusers. --dry-run e --delete-empty-cargos. |
| `backend/apps/teams/management/commands/export_hierarchy.py` | Exporta Team/TeamMember/Hierarchy/NodePosition para JSON antes do drop das tabelas. Marca explicitamente o app `teams` como DEPRECADO na Fase 6. |
| `backend/apps/formularios/management/commands/portal_healthcheck.py` | Diagnóstico do proxy do portal em produção: valida PORTAL_BASE_URL/USERNAME/PASSWORD, testa login JWT e, com --probe, faz um GET real. Códigos de saída distintos por tipo de falha (2 a 5). |
| `backend/apps/reports/management/commands/limpar_relatorios.py` | Limpeza manual de arquivos de relatório (o Beat já roda às 3h30). O --dry-run reimplementa a regra de propósito, para não desviar do caminho real. |
| `backend/apps/projects/management/commands/sync_feriados_natal.py` | Sincroniza feriados de Natal/RN para o cache local (CachedHoliday). MANUAL e por ano — nada no Celery Beat o dispara. |
| `.github/workflows/docker-publish.yml` | Build da imagem e push para ghcr.io a cada push em main, com paths-filter (docs e scripts não disparam build) e cache de layers no próprio GHCR. |
| `.github/workflows/hostinger-deploy.yml` | Deploy por SSH na VPS após o build. git reset --hard origin/main em /opt/bwa_tech, docker compose pull + up -d --remove-orphans + image prune. Lista os 6 secrets exigidos. |
| `iniciar-dev.bat` | Lançador do ambiente de dev no Windows: espera o Docker Desktop, sobe db+redis, aguarda healthcheck do container bwa_tech-db-1 e abre 4 janelas (backend, celery worker --pool=solo, celery beat, vite). |
| `docker-compose.override.yml` | Override de dev, GITIGNORED. Faz uma coisa só: publica a porta 6379 do Redis em 127.0.0.1 para o worker Celery rodado nativamente fora do compose. |
| `.dockerignore` | Notável pela exceção `!frontend/.env.production` — sem ela o Vite não lê VITE_FORMULARIOS_API_BASE no build e a página de Suporte quebra em runtime. |
| `frontend/scripts/convert-gradients-to-webp.mjs` | Script órfão: converte PNGs de public/gradients/{baixa,media,alta,absoluta} para WebP. O diretório foi removido no commit 5924346 ('remoção dos gradients'); o script e o npm run gradients:webp ficaram. |
| `backend/apps/feedbacks/_apoio_testes.py` | Helper de testes que deriva o payload de resposta da definição ativa do formulário. Nome sem prefixo `test` de propósito: o runner do Django coleta por `test*.py`. |
| `backend/seed_users.py` | Seed de usuários com senhas geradas por secrets.token_urlsafe(18) e impressas uma vez. É o seed SEGURO — ao contrário dos commands seed_new_users/seed_dados_users. |
| `.cursor/rules/django-python-cursor-rules.mdc` | Regras de estilo para agentes no backend. Contradiz o código real: pede 'lógica de negócio em models e forms', mas o projeto concentra regra em services.py e views.py. |
| `.claude/launch.json` | Config do Claude Code: um único alvo `frontend` (npm run dev, porta 5173, cwd frontend). Não há alvo de backend. |
