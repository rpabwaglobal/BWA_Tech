# Frontend

> Parte da [Documentação de Arquitetura do BWA Tech](README.md).
> Levantada por leitura direta do código; o que não foi confirmado está
> em [Riscos e lacunas](12-riscos-e-lacunas.md).


## Frontend

SPA React 19 + TypeScript compilada por Vite 7, servida como PWA (vite-plugin-pwa, autoUpdate). O roteamento é client-side com react-router-dom 7 em BrowserRouter, com URLs em português (`src/routes.ts`) e redirects das URLs antigas em inglês; todas as páginas são importadas de forma estática (não há `React.lazy`/code-splitting). O estado global mora em 4 contextos (Auth, Notification, Sidebar, Theme) — não há Redux/Zustand/React Query. A comunicação com o backend é feita por 3 instâncias de axios deliberadamente separadas (`api.ts` autenticado, `formulariosApi.ts` para o portal de chamados, `feedbackService.ts` para a rota anônima) mais 4 WebSockets. O token fica em `localStorage['auth_token']` e é injetado pelo interceptor de request de `api.ts`. Cache é caseiro: um SWR mem+localStorage em `src/lib/cachedFetch.ts` usado só por Métricas e SprintDetails. Tailwind v4 é configurado via CSS (`@import "tailwindcss"` + `@theme` em `src/index.css`) — não existe `tailwind.config.js`.

### Rotas da SPA

| Rota | Página | Proteção | Observação |
|---|---|---|---|
| `/entrar` | pages/Login.tsx | pública | Login. Fora do Layout; PublicRoute redireciona para /painel se já autenticado. |
| `/cadastro` | pages/Register.tsx | pública | Cadastro. Mostra o código de recuperação num modal ANTES de autenticar (por isso register não chama setUser). |
| `/recuperar-conta` | pages/RecoverAccount.tsx | pública | Redefinição de senha por código de recuperação (formato XXXX-XXXX-XXXX). |
| `/feedback/:token` | pages/FeedbackPublico.tsx | anônima (token na URL) | Formulário público de feedback. Única rota ANÔNIMA de conteúdo: fica fora de PublicRoute E fora do bloco `/` (sem sidebar, sem notificações, sem WebSocket). Caminho literal, não usa ROUTES. |
| `/login → /entrar, /register → /cadastro` | App.tsx | pública | Redirects de URLs antigas em inglês (Navigate replace). |
| `/ (index)` | App.tsx | PrivateRoute | Navigate replace para /painel. |
| `/painel` | pages/Dashboard.tsx | PermissionRoute view_content | Dashboard: saudação, KPIs da sprint em andamento, cards do usuário, criação rápida. |
| `/sprint` | components/SprintEntryRedirect.tsx | PrivateRoute (sem PermissionRoute — só redireciona) | Entrada do menu Sprints. SprintEntryRedirect busca as sprints e vai para a em andamento; sem ativa (ou em erro) cai em /sprint/gerenciar. |
| `/sprint/gerenciar` | pages/Sprints.tsx | PermissionRoute view_content | Lista de todas as sprints, prazos e histórico. Só uma sprint pode estar em andamento por vez. |
| `/sprint/:sprintId` | pages/SprintDetails.tsx | PermissionRoute view_content | Kanban/lista da sprint com colunas configuráveis, export, WebSocket de kanban. |
| `/sprint/:sprintId/card/:cardId` | pages/SprintDetails.tsx | PermissionRoute view_content | Mesma página, com o card aberto (deep-link). |
| `/projetos` | pages/Projects.tsx | PermissionRoute view_content | Demandas/Solicitações + Projetos Criados. |
| `/projeto/:id e /projeto/:id/card/:cardId` | pages/ProjectDetails.tsx | PermissionRoute view_content | Kanban do projeto e deep-link para um card. |
| `/prioridades` | pages/Priorities.tsx | PermissionRoute view_content | Cards em desenvolvimento de cada pessoa + filas de solicitações (reabertura, mudança de prazo). |
| `/meus-afazeres` | pages/MyTasks.tsx | PermissionRoute view_content | Anotações, listas e lembretes pessoais (só o dono vê). Notas com cores, checklists aninhadas e cards fixados, com drag-and-drop. |
| `/pessoas` | pages/People.tsx | PermissionRoute view_content | Mural read-only da equipe agrupado por setor (substituiu o organograma). |
| `/metricas` | pages/Metrics.tsx | PermissionRoute view_metrics | KPIs, rankings, tempo de desenvolvimento, gráficos recharts, aba de métricas de suporte. Usa cache SWR de 60s. |
| `/relatorios` | pages/Reports.tsx | PermissionRoute view_metrics | Catálogo de 8 relatórios geráveis + painel de Feedbacks (que não gera arquivo). |
| `/suporte` | pages/Support.tsx | PrivateRoute apenas — SEM PermissionRoute | Kanban de chamados com abas por tipo (Todos/RPA/Easy/Dashboards/IA), timeline, resolução, seleção múltipla. |
| `/score` | pages/Score.tsx | PermissionRoute manage_score | Pontuação de cards por critérios ponderados, com ranking e configuração de critérios. |
| `/dia-geek` | pages/GeekDay.tsx | PermissionRoute view_geekday | Sorteio do Geek Day por grupo de setores (roleta + confete), status dos participantes e histórico. |
| `/configuracoes` | pages/Settings.tsx | PrivateRoute apenas (a filtragem é interna, por aba) | Abas Usuários / Cargos / Setores — cada aba exige a permissão que a própria API cobra; sem nenhuma, mostra aviso. |
| `/perfil` | pages/Perfil.tsx | PrivateRoute apenas | Dados da própria conta, senha e código de recuperação. Aberta pela engrenagem do menu; todo usuário acessa, inclusive visitante. |
| `legado: /dashboard, /people, /priorities, /mytasks, /metrics, /reports, /support, /geekday, /settings, /projects, /projects/:id, /projects/:id/card/:cardId, /iteracoes, /iteracao/:sprintId, /sprints, /sprints/:sprintId, /sprints/:sprintId/card/:cardId` | App.tsx (LegacyProjectToProjeto, LegacySprintPorIdRedirect, LegacyProjectCardRedirect, LegacySprintCardRedirect) | PrivateRoute | Redirects para as rotas em português. Ficam FORA das guardas de permissão de propósito — apontam para rotas que já têm a guarda. |
| `/api/users/login/ \| /register/ \| /logout/ \| /recover-account/` | services/authService.ts | — | Autenticação. register e login persistem token + auth_expires_at; logout nunca falha (catch, não finally). |
| `/api/users/me/` | authService.getCurrentUser | — | Usuário logado. Chamado no bootstrap, em cada `refreshUser` e a cada reconexão do WebSocket. |
| `/api/users/recovery-code/` | authService.getRecoveryCode / regenerateRecoveryCode | — | Lê e regenera o código de recuperação. |
| `/api/users/change-password/ \| /api/users/profile-picture/` | services/authService.ts | — | Troca de senha e upload de foto (FormData). |
| `/api/users/ \| /api/users/?participa_do_trabalho=true \| /api/users/all/` | userService.getAll / getParticipantes / getAllManagement | — | Diretório (exclui admin), lista de quem participa do trabalho, e listagem de gestão (inclui admins). Todos via fetchAllPaginated. |
| `/api/users/<id>/` | userService.getById / update | — | Detalhe e atualização de usuário. |
| `/api/users/permissions-catalog/` | userService.getPermissionsCatalog | — | Catálogo de permissões granulares. |
| `/api/users/<id>/set-permissions/ \| /set-active/ \| /reset-password/` | services/userService.ts | — | Substitui permissões, ativa/desativa (revoga tokens) e redefine senha (sem body → backend sorteia e devolve `senha_gerada` uma única vez). |
| `/api/users/bulk-assign-cargo/ \| bulk-assign-setor/ \| bulk-set-permissions/` | services/userService.ts | — | Operações em massa da tela de gestão de usuários. |
| `/api/cargos/ e /api/setores/ (+ /api/setores/<id>/atribuir-dados/)` | services/userService.ts | — | CRUD do catálogo de cargos e setores; `atribuir-dados` move conteúdo para um setor. |
| `/api/cards/ (+ ?projeto=, ?projeto=&status=, ?responsavel=), /api/cards/<id>/` | services/cardService.ts | — | CRUD de cards. As listagens fazem paginação manual (não usam fetchAllPaginated) e filtram os cards do projeto 'Sugestões' salvo opt-in. |
| `/api/cards/metrics/` | cardService.getForMetrics | — | Payload achatado para Métricas: 1 request, sem nested, sem paginação (~75% mais leve que getAll, ~30x mais rápido). |
| `/api/projects/, /api/projects/<id>/` | services/projectService.ts | — | CRUD de projetos; listagens via fetchAllPaginated (`?sprint=`, `?arquivado=true`). |
| `/api/projects/bulk-archive/ \| bulk-unarchive/ \| bulk-delete-preview/ \| bulk-delete/` | services/projectService.ts | — | Arquivamento e exclusão em massa, com prévia do impacto antes de apagar. |
| `/api/projects/<id>/kanban-config/ (+ /reorder/, /add/, /remove/, /move-cards/)` | services/projectService.ts | — | Colunas do kanban do projeto: ler, reordenar, adicionar, remover e mover os cards da coluna removida. |
| `/api/sprints/, /api/sprints/<id>/` | services/sprintService.ts | — | CRUD de sprints (getAll via fetchAllPaginated). |
| `/api/sprints/<id>/finalizar/` | sprintService.finalizar | — | Fecha a sprint; a resposta informa a próxima sprint criada e quantos projetos/cards foram copiados. |
| `/api/sprints/<id>/bundle/` | sprintService.getBundle | — | Sprint + projetos + cards num único payload. É o que a página da sprint carrega, com cache SWR de 60s sob `sprint-bundle:<id>`. |
| `/api/kanban-stages/` | services/kanbanStageService.ts | — | Catálogo de etapas do kanban (key, label, is_terminal, requires_required_data). Aceita resposta paginada ou array. |
| `/api/card-anexos/, /api/card-anexos/<id>/` | services/cardAnexoService.ts | — | Anexos de card (25 MB, lista de extensões espelhando o backend). |
| `/api/card-logs/?card=<id>, /api/card-logs/` | services/cardLogService.ts | — | Histórico de eventos do card. |
| `/api/card-pins/, /api/card-pins/by-card/<cardId>/` | services/cardPinService.ts | — | Fixar/desfixar card no painel pessoal (o DELETE é por card, não por id do pin). |
| `/api/card-reopen-requests/ (+ /<id>/approve/, /<id>/reject/)` | services/cardReopenRequestService.ts | — | Fila de reabertura de card fechado. `nova_data_entrega` é OBRIGATÓRIO. |
| `/api/card-date-change-requests/ (+ /<id>/approve/, /<id>/reject/)` | services/cardDateChangeRequestService.ts | — | Fila de mudança de prazo. Mesma forma de objeto da fila de reabertura, mas o campo da data se chama `requested_date`. |
| `/api/notifications/ (+ /unread_count/, /<id>/mark_as_read/, /mark_all_as_read/, /preferences/)` | services/notificationService.ts | — | Notificações paginadas, contador, marcação e preferências (11 tipos). |
| `/api/reports/, /api/reports/<id>/, /api/reports/<id>/download/, /api/reports/<id>/preview/` | services/reportService.ts | — | Cria job, faz polling, baixa (blob + Content-Disposition sanitizado) e cancela/apaga. |
| `/api/reports/preview-table/` | reportService.previewTable | — | Prévia paginada de XLSX/CSV sem criar job — janela [offset, offset+limit], re-executa fetch_data a cada chamada. |
| `/api/feedback/<token>/` | feedbackService.carregarFormulario | — | Definição do formulário público. Token codificado com encodeURIComponent para que um token inválido caia no mesmo 404. |
| `/api/feedback/<token>/` | feedbackService.enviarResposta | — | Envia a resposta. Só funciona UMA vez — depois a rota responde 404. |
| `/api/feedbacks/pedidos/?card=<id> e ?cards=<id,id,...>` | pedidoFeedbackService.buscarPedidoDoCard / buscarPedidosDosCards | — | Link público de um card / mapa de vários cards. Não há rota de detalhe porque a url_publica contém o token. |
| `/api/feedbacks/exportar/?formato=xlsx\|csv e /api/feedbacks/exportar/previa/?offset&limit` | services/pedidoFeedbackService.ts | — | Planilha de todos os feedbacks (responseType blob, obrigatório) e prévia paginada reusando o tipo ReportTablePreview. |
| `/api/<recurso>/<id>/compartilhar/` | services/setorSharingService.ts | — | Lê e grava o compartilhamento entre setores. Recursos: sprints, projects, cards e formularios/suporte. |
| `/api/portal/formularios-access/` | services/portalFormulariosTokenService.ts | — | Django (com o usuário já logado) autentica no portal e devolve `{access}` — o JWT que vai como Bearer para a API de chamados. |
| `suporte/catalogo/, suporte/por-usuario/, suporte/, suporte/<id>/, suporte/<id>/notificar-usuario/ (baseURL do formulariosApi)` | services/suporteService.ts | — | Chamados de suporte. O caminho do catálogo é sobrescrevível por VITE_FORMULARIOS_SUPORTE_CATALOGO_PATH. |
| `/api/formularios/suporte-timeline/ (?chamado_id=)` | services/suporteTimelineService.ts | — | Timeline local (Django) do chamado — 6 tipos de evento. Independe de o chamado viver no portal. |
| `/api/formularios/suporte-resolucao/` | services/suporteResolucaoService.ts | — | Link + arquivo de resolução (10 MB), um por chamado, indexado por chamado_id. |
| `/api/score-criterios/ (+ /reorder/), /api/card-scores/ (+ /pickable-cards/)` | services/scoreService.ts | — | Critérios ponderados e pontuação de cards. |
| `/api/weekly-priorities/ (+ /current_week/, /priorities_view/, /define_priority_options/) e /api/weekly-priority-config/ (+ /close-week/, /clear-priorities/)` | services/weeklyPriorityService.ts | — | Prioridades semanais e a configuração de fechamento automático da semana. |
| `/api/geekday-draws/users_status/, /realizar_sorteio/, /marcar_como_sorteado/, /historico/ e /api/geekday-grupos/ (+ /meu/, /<id>/adicionar-setor/, /remover-setor/)` | services/geekdayService.ts | — | Sorteio do Geek Day por grupo de setores. |
| `/api/notes/` | services/userNoteService.ts | — | Notas pessoais com blocos text/todo aninhados (parent_client_id no write, parent resolvido no read). |
| `/api/teams/, /api/hierarchies/, /api/node-positions/` | services/teamService.ts | — | DEPRECADO (Fase 6). Nenhum componente consome mais — o organograma virou o mural por setor em People.tsx. |

### Bootstrap e restauração de sessão

1. main.tsx registra o service worker (registerSW immediate) e monta StrictMode > ThemeProvider > App
2. ThemeProvider lê localStorage['bwa-theme'] (ou prefers-color-scheme) e aplica/remove a classe .dark em <html>
3. AuthProvider entra com loading=true e roda checkAuth
4. authService.isLoggedIn() checa auth_token e auth_expires_at — se o prazo passou, limpa os dois e devolve false
5. Havendo token válido: GET /users/me/ → setUser; em paralelo dispara loadCatalogStyles (GET /cargos/ + /setores/) que popula os Maps de cor/rótulo em lib/catalog-style.ts
6. scheduleExpiryLogout agenda um setTimeout de logout para msUntilExpiry()
7. loading=false; PrivateRoute/PublicRoute/PermissionRoute deixam de mostrar o spinner

### Login

1. Login.tsx chama useAuth().login(email, senha)
2. authService.login → POST /users/login/ (o interceptor NÃO manda Authorization: a rota está em publicPaths)
3. persistSession grava auth_token e auth_expires_at (expires_at do servidor; fallback local de 24h)
4. setUser(response.user), loadCatalogStyles e scheduleExpiryLogout
5. isAuthenticated vira true → PublicRoute redireciona para /painel
6. O Layout monta, NotificationProvider carrega a 1ª página de notificações e abre o WebSocket global

### Cadastro (por que register não autentica)

1. Register.tsx valida e-mail @bwa.global e senha (mín. 12 chars, maiúscula/minúscula/dígito/especial)
2. useAuth().register → POST /users/register/ (FormData se houver foto). persistSession já grava o token
3. O AuthContext NÃO chama setUser: se chamasse, isAuthenticated viraria true e PublicRoute redirecionaria antes de a pessoa ver o código de recuperação
4. A página mostra o modal com o recovery_code e só então chama finalizeAuth(user), que faz o setUser e agenda a expiração

### Requisição autenticada e 401

1. Qualquer service importa `api` de services/api.ts
2. Interceptor de request: se a URL não está em publicPaths, lê localStorage['auth_token'] e injeta `Authorization: Token <t>`; se o body é FormData, remove o Content-Type para o axios pôr o boundary
3. Resposta 401 (fora das rotas públicas): remove auth_token e auth_expires_at
4. Se a página atual não é /entrar, /cadastro ou /recuperar-conta e não há redirect em voo, faz window.location.href = '/entrar' e marca redirectInFlight (impede que N requisições paralelas em 401 causem N reloads)

### Mudança de permissão em tempo real

1. Um admin altera cargo/permissões/setor de alguém no backend
2. O backend empurra `permissions_changed` pelo /ws/notifications/
3. useWebSocket chama onPermissionsChanged → NotificationContext chama refreshUser()
4. AuthContext refaz GET /users/me/, atualiza `user` e recarrega o catálogo de cargos/setores
5. Sidebar, PermissionRoute e todo `hasPermission(user, ...)` reagem por re-render — sem F5
6. Redes de segurança: (a) todo RE-open do socket dispara onPermissionsChanged + onSolicitacoesChanged porque o servidor não reenvia o que empurrou durante a queda; (b) o `visibilitychange` do AuthContext chama refreshUser ao voltar para a aba
7. `account_deactivated` no mesmo socket chama logout() imediatamente (o token já foi revogado no servidor)

### Kanban de sprint em tempo real

1. A página passa sprintId + enabled ao useSprintKanbanWebSocket
2. O hook lê auth_token do localStorage e abre /ws/sprints/<sprintId>/kanban/?token=...
3. `card_moved` chama onCardMoved E onKanbanChanged; `kanban_changed` chama só onKanbanChanged
4. O AUTOR da ação também recebe o evento — quem usa o hook deve filtrar por `actor_user_id === currentUser.id` para não atualizar duas vezes
5. Ping a cada 30s; reconexão com backoff linear até 8 tentativas

### Carregamento da sprint com SWR

1. SprintDetails monta e chama cachedFetch(`sprint-bundle:<id>`, () => sprintService.getBundle(id), 60_000)
2. Cache fresco (<60s) → render imediato, sem requisição
3. Cache stale → render imediato com o valor velho E revalidação em background (GET /sprints/<id>/bundle/)
4. Sem cache → aguarda a requisição
5. Toda mutação de card chama invalidateCache do bundle da sprint E de METRICS_BUNDLE_CACHE_KEY, para a página de Métricas não servir dado velho por até 60s
6. A escrita no localStorage é adiada por requestIdleCallback: JSON.stringify + setItem de bundles grandes é síncrono e travaria a navegação seguinte

### Geração de relatório

1. Reports.tsx lista 9 itens (8 ReportType + o painel 'feedbacks', que não gera arquivo)
2. ReportConfigPanel monta os filtros do relatório (inclusive grupos mutuamente exclusivos, ex. Sprints OU Período)
3. POST /reports/ cria o job e dispara o Celery no backend
4. Se vier 409, o painel ADOTA o job existente (existing_id) em vez de criar outro
5. Polling de GET /reports/<id>/ a cada 1500 ms até status completed/failed, atualizando progress/progress_message
6. Concluído: reportService.downloadFile faz GET /reports/<id>/download/ com responseType blob (window.open não funcionaria — o browser não manda o Authorization), lê o filename do Content-Disposition (RFC 5987 + legacy), sanitiza contra path traversal e dispara um <a download>

### Chamados de suporte (4 modos de conexão)

1. formulariosApi resolve a baseURL no interceptor de request, a cada chamada
2. Dev com VITE_FORMULARIOS_USE_PROXY=true → /__formularios/api/formularios (o Vite encaminha; mesma origem, sem CORS)
3. VITE_FORMULARIOS_PROXY_THROUGH_DJANGO=true (produção hoje) → <VITE_API_URL>/portal-formularios; o Django obtém o Bearer do portal e repassa, e o browser nunca fala com api.bwa.global
4. VITE_FORMULARIOS_API_BASE definido → chamada direta ao portal com Bearer obtido em /api/portal/formularios-access/ e cacheado em sessionStorage['portal_formularios_jwt']
5. Sem nada disso, em dev → <VITE_API_URL>/formularios (Django local). Em produção sem config, getFormulariosApiBase LANÇA erro
6. usesLocalFormulariosBackend() decide se o WebSocket /ws/suporte/ vale; quando não vale, Support.tsx abre um socket próprio /ws/formularios-novos/ e cai em polling (15s no modo proxy-Django, 4s nos demais, só com a aba visível)

### Formulário público de feedback

1. O link /feedback/<token> é copiado e enviado À MÃO — não há e-mail
2. FeedbackPublico monta fora de qualquer provider de sessão
3. feedbackService usa uma instância própria de axios SEM interceptors: (1) evita emprestar o Token de um funcionário logado no mesmo navegador à chamada anônima; (2) evita que um 401 apague o localStorage e deslogue quem só abriu o link
4. GET /api/feedback/<token>/ → normaliza e agrupa campos por seção com agruparPorSecao (runs consecutivos, preservando a ordem da lista)
5. Rascunho é salvo/lido localmente; POST envia os valores. Falhas são classificadas por status: 404 indisponivel, 410 encerrado, 429 limite, 400 validacao, resto rede

### Conta sem acesso

1. Usuário autentica com sucesso mas não tem `view_content` (sem cargo/setor atribuídos)
2. PermissionRoute detecta a falta da permissão da rota
3. Fallback normal seria Navigate para /painel — mas /painel também exige view_content, o que daria laço infinito
4. Por isso, se a pessoa não tem view_content, PermissionRoute renderiza a tela SemAcesso explicando que falta liberar cargo e setor

### Componentes e design system

O frontend do BWA Tech é um SPA React 19 + TypeScript servido por Vite 7, com Tailwind v4 (sem tailwind.config — tokens declarados em `@theme` dentro de `frontend/src/index.css`) e react-router-dom 7. `frontend/src/components/` tem 75 arquivos (73 `.tsx` + 2 `.ts`), organizados em uma raiz de componentes de domínio (21) e cinco subpastas: `ui/` (26, o sistema de design), `login-demo/` (12, a animação da tela de login), `settings/` (8), `reports/` (6) e `layout/` (2). O sistema de design é shadcn/ui reescrito à mão: só `ui/tabs.tsx` usa Radix de fato (`@radix-ui/react-tabs`); Dialog, DropdownMenu, Checkbox, Switch, Avatar e Separator são reimplementações próprias com `cn()` (clsx + tailwind-merge) e `class-variance-authority` nos que têm variantes (button, badge, label). O quadro Kanban usa dnd-kit e vive nas páginas, não em `components/` — o quadro canônico é `frontend/src/pages/ProjectDetails.tsx`, com variantes em Support, MyTasks, GeekDay e Score. Tempo real é feito por três hooks de WebSocket distintos (`useWebSocket` para notificações/permissões, `useSprintKanbanWebSocket` e `useSuporteKanbanWebSocket` para os quadros), todos com token na query string e ping de 30s. Gráficos são recharts (`ui/chart.tsx` + Metrics + MetricasSuporte) e framer-motion aparece só na demo do login e no arrastar de notas de Meus Afazeres.

#### Arrastar um card entre colunas do Kanban (quadro de projeto)

1. `DndContext` em ProjectDetails.tsx (~linha 2886) com `sensors={useSensors(useSensor(PointerSensor, {activationConstraint:{distance:5}}))}` e `collisionDetection={pointerWithin}`.
2. Cada coluna é um `useDroppable({id: stage.id})` dentro de `KanbanColumn`; quando `isOver` a coluna ganha borda e fundo primary/5.
3. Cada card é um `useSortable({id: card.id, disabled: isDragDisabled})` dentro de um `SortableContext` com `verticalListSortingStrategy`. `isDragDisabled` = sprint finalizada OU card finalizado/inviabilizado OU modo seleção.
4. `onDragStart` guarda o card em `activeCard`; o `<DragOverlay>` renderiza `DragOverlayCard` (clone com `rotate-2`, `shadow-2xl`, largura fixa 300px). O card original recebe `opacity: 0` e `transition: 'none'` enquanto arrasta.
5. `onDragEnd` resolve a coluna destino: se `over.id` é uma stage, é ela; senão procura o card sobre o qual soltou e usa o `status` dele.
6. Barreiras, nesta ordem: sprint finalizada -> return; sem `over` -> return; card finalizado/inviabilizado -> return; mesmo status -> return.
7. Projeto de monitoramento: só aceita destinos do fluxo de feedback (`ehEtapaDoFluxoFeedback`), atualiza otimista, faz `cardService.update(id,{status})` puro e incrementa `setSeloPedidos` para rebuscar os pedidos. Em erro, reverte a coluna na hora e chama `loadData()`.
8. Destino `parado_pendencias` -> abre `PendenciaModal` (exige motivo) e sai sem gravar.
9. Destino `finalizado` -> valida responsável + data_inicio + data_fim; faltando algo, guarda `pendingStatusChange`, mostra alerta e abre o modal de edição; completo, abre `ConclusaoModal`.
10. Destino com `requires_required_data` (vindo da kanban-config) -> mesma validação, mas preenche `data_inicio` automaticamente quando entra em `em_desenvolvimento`.
11. Caso comum: atualiza `cards` no estado ANTES do await (evita a animação de retorno), faz `cardService.update`, grava o log 'movimentado'; em erro chama `loadData()`.

#### Arrastar um chamado no Kanban de Suporte

1. `DndContext` com `collisionDetection={closestCorners}` e PointerSensor `distance: 8` (pages/Support.tsx ~1586).
2. IDs de drag são prefixados: `dragId(id) = "suporte-<id>"`, e `parseDragId` desfaz. `resolveDropStage` aceita tanto o id de uma stage quanto o de outro card.
3. `handleDragEnd`: chamado encerrado (finalizado/inviabilizado) não move; mesma etapa não move.
4. `parado_pendencias` abre modal de pendência; `inviabilizado` abre confirmação; `finalizado` NÃO é permitido por arraste — mostra o erro pedindo para abrir o ticket e preencher a descrição da resolução.
5. Nos demais casos monta o patch com `patchForStage(target, chamado, assigneeName)` e chama `applyPatchAndRefresh`, que faz `suporteService.patch`, atualiza `items`, registra na timeline e incrementa o nonce de refresh.
6. `<DragOverlay dropAnimation={null}>` — sem animação de queda.

#### Reordenar notas em Meus Afazeres (masonry arrastável)

1. Duas seções (Fixadas e outras), cada uma com o próprio `DndContext` e `collisionDetection={closestCenter}`; sensores: PointerSensor `distance: 6` + KeyboardSensor com `sortableKeyboardCoordinates`.
2. `SortableContext` usa `noScaleRectSortingStrategy`, cópia do rectSortingStrategy que força `scaleX/scaleY = 1` — sem isso cards de alturas diferentes esticavam para caber no slot alvo.
3. O layout é o componente `Masonry` local (round-robin em N colunas flex), NÃO CSS columns, para o transform do dnd-kit não disparar recálculo de layout.
4. O card de origem fica `visibility: hidden` (mantém o espaço) e o `<DragOverlay>` mostra `DragPreviewCard`, que usa `useDndMonitor` + `useMotionValue`/`useSpring` do framer-motion para inclinar até ±6° conforme a velocidade horizontal.
5. `onDragEnd` chama `reorderNotes(section, activeId, overId)`: atualização otimista e PATCH de `order` em paralelo, revertendo o snapshot em caso de erro.

#### Um evento chega pelo WebSocket global

1. `NotificationProvider` monta `useWebSocket({onNotification, onPermissionsChanged, onAccountDeactivated, onSolicitacoesChanged, enabled: isAuthenticated})`.
2. `notification` -> insere no topo da lista (ou substitui se o id já existir), incrementa o contador quando não lida e re-emite `window.dispatchEvent(new CustomEvent('notificationReceived', {detail}))` para outras páginas.
3. `permissions_changed` -> `refreshUser()` do AuthContext; como Sidebar, guardas de rota e todo `hasPermission(user, ...)` derivam do mesmo `user`, a UI inteira reage por re-render.
4. `account_deactivated` -> `logout()` imediato (o token já foi revogado no servidor).
5. `solicitacoes_changed` -> re-emite `CustomEvent('solicitacoesChanged')` em `window`; o painel de Prioridades escuta.
6. Em toda RE-conexão (não na primeira), o `onopen` dispara `onPermissionsChanged` + `onSolicitacoesChanged` para cobrir o buraco: o servidor não reenvia o que empurrou enquanto o socket esteve fora.

#### Um card se move na tela de outra pessoa (tempo real do quadro)

1. SprintDetails e ProjectDetails assinam `useSprintKanbanWebSocket({sprintId, enabled, onCardMoved})`.
2. Chega `card_moved`; o handler descarta o evento se `actor_user_id === user.id` (anti-eco: quem moveu já atualizou pelo PATCH).
3. Caso contrário faz `setCards(prev => prev.map(...))` trocando só o `status` do card — não recarrega a página inteira.
4. Em SprintDetails o handler ainda invalida os caches SWR (`sprint-bundle:<id>` e `METRICS_BUNDLE_CACHE_KEY`) via `invalidateCardCaches`.
5. No Dashboard o mesmo hook assina só `onKanbanChanged`, que roda um refetch com debounce de 250ms da lista de desenvolvedores sem card.

#### Alternar claro/escuro

1. `ThemeProvider` envolve `<App/>` em main.tsx (fora do Router).
2. Estado inicial: lê `bwa-theme` do localStorage; sem valor, cai em `matchMedia('(prefers-color-scheme: dark)')`.
3. Efeito adiciona/remove a classe `dark` em `document.documentElement` e persiste a escolha.
4. Um segundo efeito escuta mudanças do sistema, mas SÓ aplica se não houver escolha explícita gravada.
5. O botão fica no header de `layout/Layout.tsx` — um `role="switch"` com sol/lua e um pino que translada; o logo da marca troca de arquivo conforme `theme`.
6. Todo CSS pinta com `var(--color-*)`; o bloco `.dark` do index.css redefine os mesmos nomes, então nenhum componente precisa de `dark:`.

#### Abrir um modal (padrão de diálogo)

1. `<Dialog open onOpenChange>` monta dois portais em document.body: o backdrop (`fixed z-50 bg-black/50 backdrop-blur-sm`, fecha ao clicar) e o wrapper do conteúdo (`z-[60]`, centralizado com left-1/2/top-1/2 e translate).
2. `<DialogContent onClose>` desenha o cartão (`rounded-lg border bg-[var(--color-card)] p-6 shadow-lg max-h-[90vh] overflow-y-auto`) e o X no canto superior direito quando recebe `onClose`.
3. Dentro: DialogHeader > DialogTitle + DialogDescription; o conteúdo; DialogFooter (`flex-col-reverse` no mobile, `sm:flex-row sm:justify-end` no desktop — cancelar à esquerda, ação à direita).
4. Largura é escolhida pelo chamador via `containerClassName` (ex.: `max-w-md`, `max-w-5xl`) ou por `className` no DialogContent (ex.: `max-w-[600px]`).
5. Quando o painel de timeline (`CardLogsModal`, 480px fixos à direita) está aberto, o chamador passa `reserveRightPx={CARD_TIMELINE_LAYOUT_RESERVE_PX}` (488) para o backdrop parar antes do painel — o conteúdo do modal continua centralizado na viewport inteira.
6. `ConfirmDialog` (ui/confirm-dialog.tsx) é o atalho para toda ação sensível: título, descrição, `details` opcional, variante destrutiva com ícone de alerta e botão que vira spinner + "Aplicando..." quando `loading`.

#### Animação da tela de login

1. `LoginDemo` renderiza `DemoBrowserFrame` (moldura estilo Chrome com URL falsa) e alterna cenas via `AnimatePresence mode="wait"` do framer-motion — cada cena entra com opacity 0 -> 1 e y 8 -> 0 em 0.4s.
2. `useLoginDemoSequence` percorre a TIMELINE com setTimeout em ciclo; a cena `drag` anima um card fantasma de left 20% -> 46% em 2.2s com scale 1.04 e rotate 2.
3. `BrandFadeOverlay` cobre a tela nas cenas `fade` e `reset` — o `reset` existe só para esconder a troca project-detail -> dashboard por baixo do overlay.
4. `DemoCursor` posiciona um cursor animado por porcentagens fixas para cada cena.
5. Tudo tem `aria-hidden="true"` e o hook desliga a sequência sob `prefers-reduced-motion`.

---
