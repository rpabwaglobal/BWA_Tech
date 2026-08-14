# Decisões arquiteturais

> Parte da [Documentação de Arquitetura do BWA Tech](README.md).
> Levantada por leitura direta do código; o que não foi confirmado está
> em [Riscos e lacunas](12-riscos-e-lacunas.md).


## Decisões arquiteturais

366 decisões foram recuperadas do código — a maioria de comentários que
explicam o *porquê*. Estão agrupadas por subsistema. Esta é a parte do documento
que não se reconstrói lendo o código depois.

### Contas, autenticação, permissões e setores

**Autorização é 100% por `has_perm`, nunca por comparação de cargo. O enum `Role` tem apenas ADMIN e VISITANTE.**

Para que o admin possa criar qualquer cargo (CEO, Supervisor, Gerente...) na tela de Setores e Cargos e dar a ele as capacidades que quiser, sem tocar em código. ADMIN existe porque `User.save()` força esse role em superusers e o backend lhe concede o catálogo inteiro; VISITANTE porque é o cargo de entrada e `NaoVisitanteEscreve` o usa como rede de segurança. O código proíbe explicitamente properties tipo is_supervisor/is_gerente.

*Alternativa descartada:* Comparar `user.role == 'supervisor'` nos viewsets — cravaria o organograma da empresa no código.

`backend/apps/accounts/models.py (Role, comentário após `is_admin`) e backend/apps/accounts/permissions.py (docstring do módulo)`

**`Cargo.permissoes_padrao` é resolvido em tempo de `has_perm` por um backend de autenticação, em vez de copiado para `user_permissions` quando o cargo é atribuído.**

O requisito é que a permissão do cargo e a personalizada 'se somem e se mantenham, independente da ordem'. Copiar faz a ordem importar e erra dos dois lados: aplicar o template depois sobrescreve a personalizada (`user_permissions.set` substitui o conjunto), conceder a personalizada antes e trocar o cargo depois a perde, e editar `permissoes_padrao` não alcançaria quem já tem o cargo. Resolvendo no `has_perm`, a união é ESTRUTURAL — o `_user_has_perm` do Django devolve True se qualquer backend disser True — e editar o cargo passa a valer imediatamente para todos os portadores.

*Alternativa descartada:* Copiar o template para user_permissions no momento da atribuição (o 'apply_template', que sobrevive só como atalho de materialização).

`backend/apps/accounts/auth_backends.py (CargoPermissionBackend) e backend/config/settings.py (AUTHENTICATION_BACKENDS)`

**Trava anti-escalonamento: ninguém concede permissão que não possui — nem a um usuário (`set-permissions`, `bulk-set-permissions`) nem a um cargo (`permissoes_padrao`).**

Desde que o cargo virou fonte de autoridade, editar `permissoes_padrao` é conceder acesso de verdade, inclusive a si mesmo se quem edita tiver o cargo. Sem a trava, `manage_cargos` e `manage_user_permissions` seriam caminhos diretos para virar administrador. No cargo, só o DELTA que ENTRA é verificado: remover nunca é escalonamento, e exigir posse do conjunto inteiro impediria alguém de apenas renomear um cargo mais poderoso que ele.

`backend/apps/accounts/views.py (CargoViewSet._barrar_escalonamento) e backend/apps/accounts/permissions.py (permissoes_concediveis_por)`

**Ninguém troca o PRÓPRIO cargo — nem quem tem `manage_users`.**

Antes era só higiene: o cargo não concedia permissão nenhuma. Agora concede (CargoPermissionBackend), e sem esta trava bastaria ter `manage_users` para se autoatribuir o cargo mais poderoso do catálogo e herdar tudo o que ele dá. É a mesma regra que `_TravasDeAlvo` aplica nas demais ações de gestão; esta rota era a exceção porque também serve para editar o próprio perfil.

`backend/apps/accounts/views.py (UserViewSet.update, checagem de `role` em request.data)`

**`_TravasDeAlvo`: ninguém mexe na própria conta pelas rotas de gestão, e um admin só é gerenciável por outro admin.**

A primeira evita autobloqueio e autoescalonamento; a segunda evita que quem tivesse a permissão desativasse todos os admins e deixasse a plataforma sem administração. As mesmas duas regras são replicadas em `_bulk_targets` para as ações em massa, que não passam por `has_object_permission`.

`backend/apps/accounts/permissions.py (_TravasDeAlvo) e backend/apps/accounts/views.py (_bulk_targets)`

**`apply_template` no bulk usa `user_permissions.add(...)`, nunca `set(...)`.**

`set` substitui o conjunto inteiro e APAGAVA as permissões personalizadas do usuário. Bastava um gestor rodar a atribuição em massa com a caixinha marcada para alguém perder, em silêncio, permissão concedida individualmente antes — contradizendo frontalmente o requisito de que as permissões se somem.

`backend/apps/accounts/views.py (bulk_assign_cargo)`

**Conta de usuário nunca é excluída — é desativada. E a regra mora no `delete()` do model, não só na API.**

Toda a plataforma pendura histórico no usuário (sprints, projetos, cards, logs, anexos, score); apagar a linha levaria isso junto, e o trabalho de uma pessoa que saiu continua sendo o acervo da empresa. O `delete()` também é alcançável pelo /admin e pelo shell — o offboarding tem que ser o mesmo caminho independentemente de por onde se chega.

`backend/apps/accounts/models.py (User.delete) e backend/apps/accounts/views.py (UserViewSet.destroy → 405)`

**Duas flags separadas: `SETOR_SCOPING_ENABLED` (visibilidade) e `SETOR_WRITE_ENFORCEMENT_ENABLED` (escrita). Ambas default false.**

Permite ligar a visibilidade, observar que ninguém perdeu tela, e só depois começar a recusar escrita. Ligar as duas de uma vez transformaria qualquer erro de classificação de setor em 'não consigo mais trabalhar', e no meio do expediente. A flag de visibilidade também existe para permitir migrar/backfillar sem quebrar produção — deve ser ligada só depois de verificar que 100% dos dados têm setor.

`backend/config/settings.py (linhas ~238-249) e backend/apps/accounts/permissions.py (SetorPermiteEscrita)`

**As funções de escopo resolvem ids ANTES de filtrar (`pk__in=<lista>`) em vez de usar `Q` sobre M2M.**

A forma direta traduzia cada Q de M2M num LEFT JOIN — NOVE joins em `scope_cards` — e obrigava um `.distinct()` sobre o produto cartesiano. Pior: `Count()` anotado ANTES do escopo contava as linhas duplicadas, e as contagens de card por sprint/projeto vinham infladas em silêncio assim que houvesse qualquer compartilhamento. Com ids resolvidos, o custo passa a depender do número de itens compartilhados, não do número de cards.

*Alternativa descartada:* `qs.filter(Q(setor__in=U) | Q(setores_compartilhados__in=U)).distinct()`. A troca futura documentada é `pk__in=<subquery>`, local, quando `projects_card` passar de 30 mil linhas ou o p95 de /api/cards/ passar de 500 ms com a flag ligada.

`backend/apps/accounts/scoping.py (docstring do módulo)`

**`view_content` é um piso de leitura separado de `view_metrics`.**

`NaoVisitanteEscreve` sempre cobriu só a ESCRITA, então quem entrava sem cargo lia o acervo inteiro. `view_content` é a metade que faltava do requisito 'entra como visitante sem acesso a nada até que alguém atribua setor e cargo'. Separada de `view_metrics` porque uma coisa é enxergar a sprint em que se trabalha, outra é ver métricas consolidadas da empresa.

`backend/apps/accounts/permission_catalog.py (comentário sobre view_content) e permissions.py (PodeVerConteudo)`

**`approve_card_reopen` é separada de `approve_due_date_requests`, e `view_geekday` é separada de `manage_geekday`.**

Mudar prazo reorganiza trabalho em andamento; reabrir card desfaz uma ENTREGA, devolve ao quadro algo que a sprint já contou como concluído e mexe nas métricas. Quem delega uma não necessariamente delega a outra. No Geek Day, o time inteiro acompanha o sorteio e só quem organiza sorteia — antes, ver exigia `view_metrics`, permissão larga demais para uma brincadeira interna.

`backend/apps/accounts/permission_catalog.py (comentários das duas entradas); migrations 0024 e 0026 fazem o backfill nos cargos`

**`_group_send_many` envia em lotes de 100 com uma única travessia sync→async por lote.**

`async_to_sync` monta e desmonta um event loop por chamada; num cargo com 300 pessoas seriam 300 idas e voltas em série. O lote também segura o número de operações simultâneas no Redis. Falha de um usuário não cancela a dos outros — quem ficou sem o aviso descobre no próximo F5.

`backend/apps/accounts/realtime.py`

**`get_channel_layer()` fica DENTRO do try no realtime.**

Ele não só devolve None quando não há camada — ele LEVANTA quando a camada está configurada e não pode ser construída (BACKEND inexistente, CONFIG inválida, Redis fora do ar). A exceção subia e derrubava a request: com o Redis mal configurado, salvar um usuário respondia 500. Tempo real é melhoria de UX — a escrita já aconteceu e não se desfaz porque o WebSocket caiu.

`backend/apps/accounts/realtime.py (_group_send_many)`

**O evento de tempo real NÃO carrega payload: o cliente refaz GET /users/me/.**

Mantém o consumer burro e evita duplicar no backend a lógica de serialização/visibilidade que já vive no DRF — /users/me/ é a fonte de verdade e já filtra o que cada um pode ver.

`backend/apps/accounts/realtime.py (docstring do módulo)`

**Catálogo inicial mínimo: só os cargos 'admin' e 'visitante', e só o setor 'sem_setor'.**

O sistema nasce com catálogo mínimo e todo o resto (Supervisor, Gerente, CEO, Tecnologia, Fiscal...) é criado manualmente pelo admin — é para isso que a tela de Setores e Cargos existe. As migrations 0009 e 0011, que semeavam 6 cargos e 8 setores e distribuíam permissão por role legado, foram convertidas em no-op (mantidas pelo nome porque outras migrations dependem delas no grafo).

`backend/apps/accounts/migrations/0013_reconcile_system_cargos_and_seed.py, 0016_seed_setor_padrao.py, 0009_*.py, 0011_*.py`

**Os codenames 'admin' e 'visitante' são LITERAIS e não podem mudar.**

`User.save()` força role='admin' para superuser e `NaoVisitanteEscreve` compara com a string 'visitante'. Um cargo criado pela UI tem codename derivado do nome (slugify), por isso estes dois precisam nascer no seed.

`backend/apps/accounts/migrations/0013_reconcile_system_cargos_and_seed.py (docstring)`

**Migrations de backfill reimplementam a regra em vez de importar a função do app.**

Migration histórica não pode depender do código atual: se a função for renomeada ou mudar de módulo numa release futura, `migrate` num banco novo quebra no meio. O preço é a duplicação, aceitável porque o arquivo está congelado — ele descreve o estado do banco em 2026-08, não a regra viva.

`backend/apps/accounts/migrations/0020_backfill_regra_setor_padrao.py (docstring)`

**O campo `participa_do_trabalho` é público no `UserSerializer`, enquanto `permissions` é restrito.**

As telas de Dashboard e Métricas baixam a lista inteira e cruzam com os cards no cliente para montar 'quem está sem card'; `permissions` vem [] para quem não gerencia usuários, então o frontend não teria como decidir sozinho — a única saída seria voltar a comparar nome de cargo no cliente, exatamente o que a plataforma abandonou. O campo revela 'esta pessoa participa do trabalho', não O QUE ela pode fazer — a mesma informação que qualquer um deduz ao ver a pessoa com cards no kanban.

`backend/apps/accounts/serializers.py (get_participa_do_trabalho)`

**`SetorPermiteEscrita` é acoplado via `check_object_permissions`, não via `permission_classes`.**

Os quatro viewsets montam as próprias listas em `get_permissions()`, então uma entrada declarada no mixin seria descartada por quem não chamasse `super()`. Um gate de segurança que depende de cada viewset lembrar de incluí-lo é um gate que uma hora vai faltar em algum lugar. `check_object_permissions` é chamado pelo `get_object()` do próprio DRF, para todos.

`backend/apps/accounts/sharing.py (CompartilhamentoSetorMixin.check_object_permissions)`

**O fluxo sistêmico (sprint com `is_system=True`) fica FORA de qualquer movimentação em `atribuir-dados`.**

A sprint sistêmica (âncora do Monitoramento de Feedbacks) e o que está dentro dela moram num setor TÉCNICO justamente para que ninguém seja dono deles — é isso que impede `scope_cards` de entregar o feedback, e a `url_publica` (credencial da rota anônima), a um setor inteiro de uma vez. Dar-lhes um setor real desfaria essa decisão em um clique, sem aviso e sem log; e como a sprint não aparece na listagem, o operador nem saberia que a moveu.

`backend/apps/accounts/views.py (SetorViewSet.atribuir_dados)`

**As choices de `User.role` e `User.setor` são callables cacheados por 60 segundos.**

Django 5+ aceita `choices` como callable e o REAVALIA a cada `get_role_display()` — sem cache, cada chamada vira uma query. TTL curto é seguro porque cargos/setores mudam raramente (ação manual de admin) e o cache é invalidado explicitamente ao criar/editar um (nos serializers e viewsets).

`backend/apps/accounts/models.py (get_cargo_choices, get_setor_choices)`

**Foto de perfil é redimensionada para 512px, re-encodada como JPEG e renomeada com uuid.**

Fotos grandes (upload aceita até 5 MB) servidas cruas faziam páginas com muitos avatares dispararem dezenas de downloads pesados simultâneos, saturando o servidor de mídia — o sintoma era o avatar que 'não carrega até dar F5'. O nome único faz a URL mudar sempre que a foto muda, o que torna seguro o cache imutável no browser (`serve_media` em config/views.py).

`backend/apps/accounts/image_processing.py`

**`get_permissions` do UserSerializer resolve por `has_perm`, não pela tabela `user_permissions`.**

Um usuário com cargo Admin recebe o catálogo inteiro pelo backend de autenticação sem ter linha nenhuma em user_permissions. Ler direto da tabela devolveria [] e esconderia a interface toda de um administrador legítimo.

`backend/apps/accounts/serializers.py (UserSerializer.get_permissions)`

### Domínio central: projetos, sprints, cards, kanban

**`Sprint.supervisor` usa on_delete=PROTECT, e não SET_NULL como quase todas as outras FKs de usuário do app.**

A sprint é acervo: continua no histórico depois que quem a criou sai da empresa. Como `Project.sprint` e `Card.projeto` são CASCADE, apagar o supervisor levaria a sprint junto e, atrás dela, projetos e cards.

*Alternativa descartada:* SET_NULL (o padrão do resto do app para autoria) — aqui não serve porque a FK não é autoria, é a âncora de uma árvore em cascata.

`backend/apps/projects/models.py:20`

**Criar o campo `Sprint.is_system` em vez de identificar a sprint de monitoramento por nome ou pelos discriminadores existentes.**

O comentário diz que o campo era INEVITÁVEL: os dois discriminadores que já existiam (`finalizada` e a janela data_inicio/fechamento_em) puxam para lados opostos. Com `fechamento_em` no PASSADO, `_sprint_efetivamente_fechada` trancaria todo card de feedback e `finalizar_sprints_por_data` fecharia a sprint sozinha; com ele no FUTURO — que é o valor usado — a sprint apareceria como 'em andamento' no menu, no Dashboard e como destino de replicação. Nenhum valor resolve os dois lados; a flag resolve.

*Alternativa descartada:* Hardcoding por nome da sprint (o padrão que `Project.is_system` já existia para substituir).

`backend/apps/projects/models.py:30`

**'Card aberto' é sempre definido pela NEGATIVA, com `.exclude(status__in=CARD_STATUS_FECHADOS)`.**

É a forma que o projeto já usa nos ~9 lugares onde a pergunta aparece, e é o lado seguro: um status que não esteja na dupla (finalizado, inviabilizado) cai em 'aberto', ou seja, continua sendo tratado como trabalho vivo.

`backend/apps/projects/models.py:235`

**`KanbanStage.is_terminal` NÃO governa a regra de negócio de 'card fechado'.**

Aquele flag hoje é só decoração de UI, e `KanbanStageViewSet` só exige `manage_global_kanban_stages` no `perform_create` — qualquer um com `view_content` consegue virá-lo. Amarrar regra de negócio nele deixaria um não-privilegiado escolher, por exemplo, de quais cards o responsável some. As duas definições coincidem hoje por causa do seed da 0028; uma etapa terminal customizada é tratada como aberta.

*Alternativa descartada:* Usar `is_terminal` como fonte da verdade de 'card encerrado'.

`backend/apps/projects/models.py:240`

**`oculta_no_catalogo` é um CAMPO no KanbanStage, e não um `if key in (...)` no código.**

O board de um projeto já é recortado por `ProjectKanbanStageConfig`, então criar uma etapa nova não adiciona coluna a ninguém. O furo que sobra é o SELETOR: sem o campo, um supervisor com `manage_kanban_config` poderia adicionar 'Aguardando 30 dias' a um projeto comum. Uma lista de keys cravada em projects/models.py colocaria conhecimento do app de feedbacks dentro de projects — é justamente o que a flag evita.

`backend/apps/projects/models.py:266`

**`Card.setor` é ESPELHO do projeto (reescrito em todo `save()`), e o empréstimo pontual de um card exige a tabela `CardCompartilhamento`.**

Espelhar resolve o caso 'card que muda de projeto' sem intervenção manual. E, como o campo não é editável, `CardCompartilhamento` passa a ser o ÚNICO jeito de dar acesso a um card específico sem mover o projeto inteiro.

`backend/apps/projects/models.py:493`

**O checkbox `gerar_formulario_feedback` fica no CARD, não no projeto.**

A regra é UM formulário e UM link POR CARD MARCADO — cinco cards marcados no mesmo projeto viram cinco links distintos. O nome do card é copiado (congelado) para `PedidoFeedback.referencia_publica`, que é o que a pessoa de fora vê: renomear o card depois não muda o link já enviado.

`backend/apps/projects/models.py:474`

**O gatilho do pedido de feedback é o CARD virando 'finalizado', e não o projeto virando 'entregue'.**

Os dados diziam isso: dos 106 projetos do banco, os 106 estavam em 'criado' e NENHUM tinha `data_entrega` preenchida. `Project.status` existe no model mas nada no produto o move. Neste sistema o projeto é uma PASTA; quem tem ciclo de vida, data de entrega e homologação é o CARD. Com o gatilho antigo nenhum pedido nasceria em produção — falha por AUSÊNCIA, que ninguém percebe.

*Alternativa descartada:* Observar `Project.status == 'entregue'` (foi a primeira versão e estava errada).

`backend/apps/feedbacks/signals.py:4`

**Anexos de card são gravados no disco com nome aleatório (uuid4), preservando só a extensão.**

O arquivo é servido por `/media/` sem exigir header (o SPA aponta um `<a download>` direto), então o nome é a única barreira: gravado com o nome original, `/media/card_anexos/contrato-cliente.pdf` seria adivinhável de fora. O nome amigável fica em `nome_original`.

`backend/apps/projects/models.py:524`

**`CardLogEventType.REABERTO` é um evento próprio, não um `atualizado`/`movimentado`.**

Ressuscitar trabalho já encerrado é a exceção que alguém vai querer achar no histórico meses depois ('por que este card entregue voltou ao quadro?'). Enterrado dentro de 'atualizado' viraria mais uma linha de diff, indistinguível de uma troca de prioridade.

`backend/apps/projects/models.py:653`

**`CardReopenRequest.nova_data_entrega` é OBRIGATÓRIO (ao contrário de `reason`).**

Reabrir sem prazo devolveria ao quadro um card sem previsão de entrega — o estado que o resto da plataforma combate (alerta de atraso, vencimento em 24h/1h/10min, métricas de entrega no prazo, tudo depende de `data_fim`). Um card reaberto sem data seria invisível para todos esses mecanismos. Como o pedido é feito justamente porque a data anterior não valeu, é quem pede que precisa dizer a nova.

`backend/apps/projects/models.py:842`

**`CardReopenRequest` reaproveita o enum `CardDateChangeRequestStatus` em vez de ter o seu.**

São os mesmos três estados (pendente/aprovado/recusado), com o mesmo significado e os mesmos valores gravados. Um enum próprio seria cópia idêntica e obrigaria o frontend a aprender dois vocabulários para a mesma coluna de status.

`backend/apps/projects/models.py:849`

**`WeeklyPriority.usuario` usa PROTECT, enquanto `definido_por` usa SET_NULL.**

Aqui o usuário é o ALVO da prioridade, não o autor: sem ele o registro não quer dizer nada e a unicidade (usuario, card, semana_inicio) deixaria de valer, porque NULLs não colidem entre si. A conta só sai depois que as prioridades dela saírem.

`backend/apps/projects/models.py:912`

**`CardScoreValue` guarda o valor inteiro BRUTO, não uma FK para `ScoreCriterionOption`.**

Para que o histórico do card permaneça íntegro mesmo se o supervisor editar ou remover opções depois.

`backend/apps/projects/models.py:1345`

**`CardScore.setor_solicitante` foi definido SEM `choices` (migration 0055).**

O comentário no model diz: o setor solicitante vem do catálogo (`SetorCatalogo`), que o admin monta como quiser; uma lista fixa rejeitaria qualquer setor criado depois — inclusive o setor padrão do sistema.

*Alternativa descartada:* Manter `choices=SetorSolicitante.choices` — porém a whitelist antiga sobreviveu na view (ver armadilhas).

`backend/apps/projects/models.py:1284`

**Compartilhamento entre setores tem TABELA PRÓPRIA por tipo de conteúdo, em vez de M2M automático ou uma tabela genérica com id solto.**

Duas razões, ambas comentadas: (1) o `nivel` — emprestar para consulta e emprestar para trabalho são coisas diferentes, e sem ele o dono não teria como escolher; (2) FK de verdade (indexada, com CASCADE) vale mais que uma tabela genérica. O nível governa apenas o que o COMPARTILHAMENTO concede: não amplia as permissões do cargo.

`backend/apps/accounts/models.py:283`

**A regra 'uma sprint em andamento por setor' é verificada comparando JANELAS, não 'está em andamento agora'.**

O setor pode deixar quantas sprints planejadas quiser na fila, desde que cada uma comece depois que a anterior fechar. Uma sprint cadastrada para começar dia 5, enquanto a atual só fecha dia 20, não conflita hoje — mas no dia 5 o setor amanheceria com duas sprints abertas sem que ninguém tivesse feito nada. Comparar janelas recusa isso no cadastro, que é o único instante em que dá para corrigir.

`backend/apps/projects/services.py:201`

**Toda consulta de sprint em `services.py` e `tasks.py` filtra `is_system=False` explicitamente.**

A sprint sistêmica tem janela de ~100 anos e satisfaz por construção o predicado 'em andamento'. Sem o recorte: nenhuma sprint nova poderia ser criada no setor onde ela mora (cruzaria qualquer janela); ela seria eleita destino de replicação de toda sprint real e a finalização despejaria projetos e cards pendentes dentro do fluxo de monitoramento; e ela seria devolvida como 'a sprint em andamento do setor' para sempre.

`backend/apps/projects/services.py:221, 249, 270, 292; backend/apps/projects/tasks.py:255`

**A replicação de card na virada da sprint copia `gerar_formulario_feedback` explicitamente.**

SEM ISSO O CHECKBOX SE PERDE EM SILÊNCIO: um card marcado que ainda não foi finalizado é replicado para a sprint seguinte, a cópia nascia com o padrão False, e quando ela finalmente fosse para 'Finalizado' o signal não dispararia. Ninguém perceberia — não há erro, não há log — só um feedback que nunca é colhido, justamente nos cards de vida mais longa.

`backend/apps/projects/services.py:60`

**`desatribuir_cards_de_usuario_desativado` usa `.update()` em massa em vez de `card.save()` em laço.**

O `post_save` do Card escreveria SOZINHO um segundo log dizendo o mesmo fato ('Responsável: Fulano → Ninguém') e dispararia uma notificação por card para o gerente de cada projeto. Pular o `Card.save()` é seguro ali porque ele só zera `data_inicio` quando o status é 'a_desenvolver' e espelha o `setor_id` — e nem status nem projeto são tocados.

`backend/apps/projects/services.py:546`

**`CardTodo` (subtarefas por card) foi removido e substituído por `UserNote`/`UserNoteItem` (notas pessoais).**

CardTodo gerava muito ruído no banco e não era usado efetivamente; as notificações de subtarefa (Supervisores + Gerentes + Admins + Responsável) eram ruidosas demais. O tipo `card_todo_updated` saiu do enum, mas registros antigos continuam no banco para histórico.

*Alternativa descartada:* Manter subtarefas presas ao card.

`backend/apps/projects/models.py:595 e signals.py:971`

**Os broadcasts de WebSocket chamam `get_channel_layer()` DENTRO do try/except.**

Ele não só devolve None quando não há camada — ele LEVANTA quando a camada está configurada e não pode ser construída (BACKEND inexistente, config inválida, Redis fora do ar). Como a função é chamada do `post_save` do Card, a exceção subia pelo signal e derrubava a request: com o Redis mal configurado, mover um card no quadro respondia 500. Tempo real é melhoria de UX — a escrita já aconteceu.

`backend/apps/projects/realtime.py:44`

**`broadcast_solicitacoes_changed` emite um evento LITERALMENTE sem payload.**

Quem decide o que cada pessoa enxerga da fila é o GET da API, que já passa pelos `scope_*`. Mandar a linha serializada obrigaria o emissor a repetir aquela decisão de visibilidade fora de qualquer queryset — o erro que `formularios/realtime.py` teve de desfazer. O pior caso de errar o destinatário aqui é um GET desperdiçado, não vazamento.

`backend/apps/projects/realtime.py:115`

### API de projetos e regras de negócio

**O fluxo 'Monitoramento de Feedbacks' é somente leitura pela API, mas o ARRASTE entre as etapas do próprio fluxo é permitido.**

Nasceu de uma contradição real entre dois pedidos do usuário: 'o fluxo não deve ter opção de criar, editar ou excluir card' (que virou 403 no `update` inteiro, e `update` é por onde passa o arraste) e 'se um card de feedback encerrado voltar para aguardando feedback ou feedback colhido o link deve voltar a funcionar' (que EXIGE arrastar). A resolução foi recortar o VERBO em vez de escolher um dos pedidos: mover passa, criar/editar/excluir continuam bloqueados.

*Alternativa descartada:* Bloqueio total do update (o comportamento anterior), que existia porque um PATCH cru de `status` mexia SÓ no card e a reconciliação diária desfazia a mudança em silêncio. O caminho novo remove a causa (escreve no PedidoFeedback primeiro) em vez de tratar o sintoma.

`backend/apps/projects/views.py (FEEDBACK_ETAPA_FORA_DO_FLUXO, ~linha 146)`

**O recorte do arraste de feedback é pelo CONJUNTO DE CHAVES do corpo: só passa quem manda exatamente {"status": ...}.**

Assim um PUT — que o DRF monta com o objeto completo — continua barrado sem precisar de uma segunda regra, e não existe a brecha de 'arrastar e, de carona, renomear o card'.

`backend/apps/projects/views.py (`_mover_card_do_fluxo_de_feedback`)`

**O fluxo de feedback é identificado pelo par de flags `is_system` (no projeto E na sprint), nunca pelo nome.**

Casar por NOME seria frágil e é exatamente o que `Project.is_system` existe para substituir: renomear o projeto na tela não pode reabrir a escrita. É a mesma identificação usada no frontend (`isProjetoMonitoramento`) e no `bundle`. A função recebe o PROJETO e não o card porque na criação o card ainda não existe.

`backend/apps/projects/views.py (`_projeto_do_fluxo_de_feedback`)`

**'Uma sprint em andamento por setor' é verificada por SOBREPOSIÇÃO DE JANELAS, não por 'está em andamento agora'.**

O setor pode enfileirar quantas sprints planejadas quiser, desde que cada uma comece depois que a anterior fechar. Uma sprint cadastrada para começar dia 5 enquanto a atual só fecha dia 20 não conflita hoje — mas no dia 5 o setor amanheceria com duas sprints abertas sem ninguém ter feito nada. Comparar janelas recusa isso no CADASTRO, que é o único instante em que dá para corrigir.

`backend/apps/projects/services.py (`sprint_conflitante_na_janela`), aplicado em SprintSerializer.validate`

**Todas as consultas de sprint em services.py filtram `is_system=False`.**

A sprint sistêmica tem janela de ~100 anos e satisfaz por construção o predicado 'em andamento' (não finalizada, fechamento no futuro). Sem esse recorte: (a) ela cruzaria QUALQUER janela e nenhuma sprint nova poderia ser criada no setor dela; (b) seria eleita destino de replicação de toda sprint real e `finalizar_sprint_replicacao` despejaria projetos e cards pendentes dentro do fluxo de monitoramento.

`backend/apps/projects/services.py (`sprint_conflitante_na_janela`, `conflitos_ao_mover_sprints`, `outra_sprint_em_andamento`, `get_proxima_sprint`, `get_sprint_ids_atribuiveis`)`

**`gerar_formulario_feedback` é copiado explicitamente na replicação do card.**

Comentário em caixa alta no código: 'SEM ISTO O CHECKBOX SE PERDE NA VIRADA DA SPRINT, EM SILÊNCIO.' A cópia nascia com o padrão False e, quando finalmente fosse para Finalizado, o signal não dispararia. Não há erro nem log — só um feedback que nunca é colhido, justamente nos cards de vida mais longa.

`backend/apps/projects/services.py (`_replicar_card_para_sprint`)`

**Na reabertura o card é MOVIDO para a sprint em andamento, não copiado.**

Decisão do dono do produto: a métrica deve contar na sprint em que o card foi reaberto. A sprint de origem perde a entrega, o que está correto — se o trabalho voltou, ele não estava concluído. Exigir sprint ativa não é burocracia: sem ela o card voltaria para um quadro encerrado, invisível para quem trabalha — 'reaberto no papel e perdido na prática'. O código registra que 678 dos 705 cards fechados do acervo estão em sprint encerrada, então recusar inutilizaria a funcionalidade.

*Alternativa descartada:* Recusar a aprovação quando a sprint de origem já fechou.

`backend/apps/projects/services.py (`reancorar_card_na_sprint`) + views.py (CardReopenRequestViewSet.approve)`

**`reancorar_card_na_sprint` usa a MESMA regra de casamento de projeto (`_norm_nome_projeto`) que a replicação de sprint.**

Card não aponta para sprint — ele pertence a um Project, e o Project é que pertence à Sprint. Duas implementações do mesmo pareamento acabariam divergindo, e aí o mesmo projeto viraria dois.

`backend/apps/projects/services.py`

**Quem pode PEDIR reabertura é o responsável OU quem tem `manage_others_cards` OU quem tem `approve_card_reopen` — mais amplo que na fila de prazo.**

A regra 'só o responsável' veio do fluxo de mudança de PRAZO, onde ela cabe (o prazo é um acordo de quem executa). Reabertura é outra coisa: quem percebe que o trabalho não estava pronto costuma ser o gestor ou quem recebeu a entrega. E era incoerente que alguém com `approve_card_reopen` pudesse aprovar o pedido mas não abri-lo, tendo que pedir ao responsável para registrar algo que ele mesmo decidiria.

`backend/apps/projects/views.py (CardReopenRequestViewSet.perform_create)`

**Nova data de entrega da reabertura tem de estar no FUTURO.**

Reabrir com prazo no passado devolveria ao quadro um card já nascido atrasado — o alerta de atraso dispararia no mesmo instante. Se o prazo real é curto, que seja curto e futuro.

`backend/apps/projects/views.py`

**Só uma solicitação de reabertura pendente por card.**

Dois pedidos pendentes para o mesmo card viram duas aprovações possíveis do MESMO fato, e a segunda reescreveria o `data_fim` que a primeira acabou de definir.

`backend/apps/projects/views.py`

**Na aprovação de reabertura, a SOLICITAÇÃO é travada antes do card.**

É ela que decide se a reabertura acontece. Dois cliques simultâneos em 'aprovar' fazem o segundo esperar no lock e reler status já 'approved'; sem isso os dois passariam pela checagem inicial e o card seria reaberto (e logado) duas vezes.

`backend/apps/projects/views.py`

**Os broadcasts do painel de solicitações usam `transaction.on_commit` SEMPRE, mesmo onde hoje não há bloco atômico aberto.**

O evento manda o cliente REFAZER o GET, então um aviso pré-commit faria ele ler o estado antigo — em `approve`, a fila voltaria com a linha que acabou de ser aprovada. Hoje os pontos de chamada estão fora dos blocos atômicos, mas isso é frágil: basta alguém definir ATOMIC_REQUESTS ou embrulhar uma action num atomic. Fora de bloco atômico o `on_commit` executa imediatamente — custo zero.

`backend/apps/projects/views.py (`_avisar_painel_de_solicitacoes`)`

**`_validar_status_no_board` valida o status contra as etapas configuradas NO PROJETO, não contra o catálogo global de KanbanStage.**

`ProjectKanbanStageConfig` é quem decide as colunas de um projeto. A validação antiga aprovava qualquer key que existisse globalmente, o que deixava um card comum parar numa coluna que o board dele não desenha. Uma regra só fecha os dois lados: card comum não entra em coluna de feedback E card de feedback não vai parar em 'finalizado'.

*Alternativa descartada:* Validar em `validate_status` (que continua existindo mas não valida nada) — ali não existe o PROJETO do card.

`backend/apps/projects/serializers.py (CardSerializer)`

**Etapas com `oculta_no_catalogo` não podem ser adicionadas a um projeto, e um quadro cujas colunas são TODAS ocultas não aceita coluna nova.**

'Quadro de fluxo automático não se mistura com quadro de trabalho, e o recorte tem de valer nos DOIS sentidos.' Tirá-las do KanbanStageViewSet só as escondeu do SELETOR — um POST direto ainda pendurava 'Aguardando 30 dias' num projeto comum, e a coluna configurada passaria a ACEITAR um card comum (porque a lista de status legítimos sai das configs do projeto), que ficaria lá para sempre: a reconciliação diária só toca em card que tem pedido de feedback.

`backend/apps/projects/views.py (`kanban_config_add`)`

**`_move_project_cards_status` salva card a card quando a operação envolve 'finalizado', e usa `.update()` em massa caso contrário.**

Só o `save()` dispara os signals que carimbam `finalizado_em` e calculam as métricas de tempo de desenvolvimento. Fora desse caso, N saves seriam N signals e N notificações desnecessárias.

`backend/apps/projects/views.py`

**O `bundle` da sprint reaplica `scope_projects` em vez de herdar o escopo do `get_object()`.**

O `get_object()` escopou a SPRINT, e o conteúdo dela nem sempre vem por cascata: um projeto pode ter sido movido isoladamente por `POST /api/setores/<X>/atribuir-dados/`, que troca o setor do projeto sem tocar na sprint. Sem o escopo, esse projeto some da listagem e continua visível no bundle com todos os cards — e bundle é o endpoint que a tela de sprint carrega, então a divergência apareceria para todo mundo.

`backend/apps/projects/views.py`

**As contagens agregadas que o SprintSerializer devolve no `bundle` NÃO são escopadas por setor.**

É exatamente o número que `/api/sprints/` devolve na listagem; mudar só no bundle recriaria a divergência que a action acabou de fechar.

`backend/apps/projects/views.py`

**O projeto sistêmico de Monitoramento de Feedbacks vem dentro do bundle da sprint, e não em request separada.**

A página desenha o fluxo FIXADO como primeira coluna, no mesmo formato de um projeto comum, e ele reaparece na sprint seguinte sozinho justamente por não pertencer a sprint nenhuma. Trazê-lo aqui faz os cards e a kanban_config das 3 etapas virem de carona (`project_ids` alimenta os dois). Não contamina métricas: no frontend `getProjectsForSprint` filtra por `p.sprint === sprintId` e a sprint dele é a sistêmica.

`backend/apps/projects/views.py`

**Em ações de detalhe do ProjectViewSet o filtro de `arquivado` NÃO é aplicado.**

Caso contrário, acessar a URL direta de um projeto arquivado retornaria 404 — impedindo até de desarquivá-lo.

`backend/apps/projects/views.py (`get_queryset`)`

**`arquivado` fica fora de `filterset_fields` e é tratado à mão no get_queryset.**

O BooleanFilter do django-filter rejeitaria com 400 o valor não-booleano `all`, que a tela usa.

`backend/apps/projects/views.py`

**`cards_entregues_count` conta apenas status='finalizado' com `finalizado_em` não nulo — inviabilizado nunca conta.**

Regra de negócio explícita: inviabilizado é cancelamento, não entrega. A mesma regra vale nas anotações do SprintViewSet.

`backend/apps/projects/views.py`

**O critério de atraso das métricas de sprint é `data_fim` do CARD, nunca `sprint.fechamento_em`.**

A fonte de verdade é o prazo do card. Aberto atrasado = data_fim < hoje e status não terminal; entregue atrasado = finalizado_em > data_fim. Alinhado com Metrics.tsx no frontend.

`backend/apps/projects/views.py (SprintViewSet.get_queryset)`

**As ações em massa de projeto aplicam o escopo dentro de `_safe_ids`, e não em cada action.**

Nenhuma delas chama `get_object()`, então nem o `get_queryset()` escopado nem o gate de objeto do CompartilhamentoSetorMixin (que só engata em rota de detalhe) entram em jogo. Sem isto, um {ids:[1..200]} alcança projeto de qualquer setor — e `bulk_project_actions` é permissão de CARGO, não implica `view_cross_setor`. Id fora do escopo simplesmente some do conjunto e `requested` continua devolvendo o total pedido, para a resposta não virar oráculo de 'existe mas não é seu'.

`backend/apps/projects/views.py`

**O `bulk-delete-preview` roda com `escrita=True` mesmo sendo um GET disfarçado de POST, mas os CARDS do prefetch vão crus (sem escopo).**

Listar um projeto que o bulk_delete recusaria prometeria uma exclusão que não acontece e entregaria o backlog dele de brinde. Já os cards vão crus porque o delete é no PROJETO e o banco cascateia: um preview escopado anunciaria MENOS do que o delete destrói, e perder trabalho sem aviso é pior do que ver o nome de um card que já se ia perder. Comentário deixa a condição: se o delete um dia poupar card fora do escopo, este prefetch tem de ser escopado no mesmo commit.

`backend/apps/projects/views.py`

**Nas quatro rotas de kanban do projeto os cards são buscados CRUS (`Card.objects.filter(projeto=...)`), sem `scope_cards`.**

É operação do BOARD DO PROJETO, e o projeto já veio escopado do `get_object()` — todo card dele é visível para `scope_cards`. E se um dia divergisse, seria para pior: os cards de fora ficariam parados num status cuja coluna acabou de ser apagada, órfãos invisíveis no kanban. 'Quem senta na coluna tem de sair dela.'

`backend/apps/projects/views.py (`kanban_config_remove`, `kanban_config_move_cards`)`

**O gate de escrita dos satélites (Event, CardLog, CardAnexo, CardScore) é sempre expresso sobre o CARD pai, jamais sobre o próprio satélite.**

`nivel_de_acesso` não conhece Event/CardAnexo/CardScore (não têm `setor` nem `compartilhamentos`), então perguntar pelo próprio objeto devolveria None e NEGARIA TUDO assim que a flag de escrita subisse.

`backend/apps/projects/views.py (EventViewSet.perform_update/destroy, CardAnexoViewSet.destroy, CardScoreViewSet.update/destroy)`

**O CardPin NÃO tem gate de escrita — só de visibilidade (`editaveis_fn=None`).**

Fixar não escreve nada DENTRO do card: o CardPin é uma linha pessoal (user + card) que só aparece para quem fixou. Um card emprestado ao setor apenas para leitura continua fixável por quem já o enxerga. Repetir um `checar_escrita_no_pai` no viewset contradiria essa decisão e recusaria 403 no botão 'Fixar' assim que SETOR_WRITE_ENFORCEMENT_ENABLED subisse.

`backend/apps/projects/views.py (CardPinViewSet.perform_create) + serializers.py (CardPinSerializer.validate_card)`

**`DELETE /api/card-pins/by-card/<card_id>/` não aplica escopo de setor.**

Apaga só o pin de quem pede (`user=request.user`), e desfixar precisa continuar possível mesmo depois de o card sair do escopo do usuário — senão o pin residual ficaria preso para sempre.

`backend/apps/projects/views.py`

**CardLog é append-only: PATCH e DELETE ficam fora de `http_method_names`.**

O log é a prova do que aconteceu com o card — um histórico que pode ser reescrito não serve para auditar nada. Criar continua liberado porque é assim que a tela registra comentários e mudanças de etapa.

`backend/apps/projects/views.py (CardLogViewSet)`

**`CardScoreViewSet.create` resolve o card com `scope_cards` e devolve 404 'Card não encontrado.' para card fora do escopo, exatamente como para card inexistente.**

`create` não tem `get_object()`, então nada passa pelo get_queryset escopado — e esta rota também EDITA (get_or_create), então sem isso ela sobrescreveria o score de um card de outro setor, com a transação commitando antes de a resposta estourar. A resposta não deve distinguir 'não existe' de 'não é seu'.

`backend/apps/projects/views.py`

**`pickable-cards` reaplica `scope_cards` à mão.**

Action `detail=False` não passa pelo `get_queryset()` da classe (onde vive `scope_card_scores`) e monta um queryset de Card próprio. Sem o escopo, quem tem `manage_score` (permissão de cargo, que não implica `view_cross_setor`) recebia numa única requisição, sem paginação, o backlog vivo da empresa inteira — o CardPickerSerializer devolve nome, descrição, script_url e responsável.

`backend/apps/projects/views.py`

**`_ids_supervisao_prioridades` delega a `usuarios_com_perm_qs('manage_weekly_priorities')` em vez de montar a consulta à mão.**

A versão artesanal reproduzia só três dos caminhos de concessão e ignorava `Cargo.permissoes_padrao`: desde que o cargo virou fonte de autoridade, quem tinha a permissão SÓ pelo cargo não era reconhecido como supervisor e voltava a aparecer como linha da própria lista que coordena. Resolvedor em massa e `has_perm` têm que concordar.

`backend/apps/projects/views.py`

**As telas de 'quem está sem card' excluem quem supervisiona prioridades E quem não tem `view_content`.**

São perguntas diferentes: quem supervisiona é leitor da tela, não item dela; e quem não tem `view_content` não enxerga sprint/projeto/card, então listá-lo como 'sem card' é ruído — ele não está sem card, está sem acesso. Resolvido por PERMISSÃO para que um cargo novo sem a permissão também suma sem tocar em código.

`backend/apps/projects/views.py (`_usuarios_que_executam`)`

**O thread-local `signals._thread_locals.user` é APAGADO logo depois do `create()` do CardSerializer.**

`threading.local` vive na THREAD, não na requisição, e o servidor reaproveita threads: um valor deixado ali é lido pela PRÓXIMA criação de card que não passe por este serializer (replicação de sprint, aprovação de sugestão, shell, task), e o CardLog sai assinado por quem não fez nada — pior, o usuário pode nem existir mais quando o log for gravado. O `_request_user` na instância continua sendo o portador para o resto da requisição.

`backend/apps/projects/serializers.py (CardSerializer.create)`

**Os campos graváveis que apontam para uma PESSOA (`supervisor`, `gerente_atribuido`, `desenvolvedor`, `responsavel`, `usuario`, `definido_por`) recebem gate SÓ de visibilidade, nunca de escrita.**

Não existe 'usuário editável'. Apontar um card para alguém não escreve nada DENTRO dessa pessoa — o que está sendo escrito é o CARD, e o direito ali já é gate do próprio card. Também NÃO se checa se a pessoa é do mesmo setor do card: o modelo prevê o contrário (alguém emprestado a um card compartilhado). A pergunta certa é se o OPERADOR enxerga aquela pessoa. O furo fechado: como o campo é gravável sobre `User.objects.all()` e a resposta traz nome/cargo/foto, um PATCH repetido com ids em sequência enumerava o quadro inteiro da empresa sem passar por listagem nenhuma.

`backend/apps/projects/serializers.py (`_checar_pessoa_do_setor`)`

**O gate de setor mora no `validate_<campo>` e não no `queryset=` do PrimaryKeyRelatedField.**

O queryset de um PrimaryKeyRelatedField é avaliado UMA vez, quando a classe é definida — ali não existe request nenhum para escopar. Validar no `validate_<campo>` faz a pergunta quando o usuário já é conhecido e ainda devolve mensagem legível em vez do genérico 'objeto inválido' do DRF.

`backend/apps/projects/serializers.py (`_checar_destino_do_setor`)`

**Toda sprint precisa de setor: sem `setor` no payload e sem setor primário no criador, a criação é RECUSADA em vez de cair no setor padrão.**

Uma sprint que nasce em 'Sem Setor' some do time que deveria enxergá-la e contamina o depósito de conteúdo não classificado.

`backend/apps/projects/serializers.py (SprintSerializer.create)`

**`is_system` (Sprint e Project) é read-only na API, mas exposto na leitura.**

É gerenciado pelo backend (data migration + seed do fluxo de monitoramento). Marcar uma sprint/projeto arbitrário a tiraria das métricas e do fechamento automático. Exposto porque o frontend precisa dele para achar a sprint do atalho e para cortá-la das listas de 'sprint em andamento'.

`backend/apps/projects/serializers.py`

**Nome de projeto duplicado é permitido, desde que em sprints diferentes; nome de card duplicado é sempre permitido.**

O identificador único do card é o id — nome é apenas exibição. Para projeto, a unicidade só faz sentido dentro da sprint, e a replicação depende justamente de recriar o mesmo nome na sprint seguinte.

`backend/apps/projects/serializers.py (`ProjectSerializer.validate_nome`, `CardSerializer.validate_nome`)`

**`CardMetricsSerializer` inclui cards de projeto arquivado.**

A regra é que arquivados ficam fora das métricas, mas excluir no backend economiza pouco e introduziria divergência com o ProjectViewSet, que pode listar arquivados em outros contextos. O frontend filtra por `projeto_arquivado`.

`backend/apps/projects/views.py (CardViewSet.metrics)`

**SVG e executáveis ficam FORA da allowlist de anexos.**

SVG é vetor de XSS quando servido inline, e `/media/` só exige estar autenticado.

`backend/apps/projects/serializers.py (CARD_ANEXO_ALLOWED_EXTENSIONS, limite de 25 MB)`

**`_notificar_solicitante` reusa o tipo CARD_UPDATED em vez de criar um tipo novo.**

É o tipo existente que já vem LIGADO por padrão; inventar um tipo novo exigiria também um campo novo em `UserNotificationPreference` para o usuário poder desligá-lo, e o pedido era só 'quem solicitou precisa saber'. Silencioso quando o solicitante saiu da empresa ou quando quem avaliou é o próprio solicitante.

`backend/apps/projects/views.py (CardReopenRequestViewSet)`

**Falha de WebSocket/notificação nunca derruba a escrita.**

'Tempo real é melhoria de UX: a reabertura já foi commitada e não pode ser desfeita porque o WebSocket caiu.' Os broadcasts capturam Exception e logam. Em `realtime.py` o próprio `get_channel_layer()` fica dentro do try, porque com Redis mal configurado ele LEVANTA (não devolve None) e mover um card no quadro respondia 500.

`backend/apps/projects/views.py + backend/apps/projects/realtime.py`

**O broadcast `solicitacoes_changed` vai SEM payload e é enviado a quem tem `view_content`, não a quem tem `approve_card_reopen`.**

Quem decide o que cada pessoa enxerga da fila é o GET da API, já escopado; mandar a linha serializada obrigaria o emissor a repetir a decisão de visibilidade fora de qualquer queryset. E as três abas e seus CONTADORES são renderizados para todo mundo (só Aprovar/Recusar é restrito), então avisar só quem aprova deixaria o contador velho para quase todas as sessões.

`backend/apps/projects/realtime.py`

**`desatribuir_cards_de_usuario_desativado` é um SERVIÇO chamado explicitamente, e não um `post_save` de User.**

(i) dentro do signal não há `request.user`, então todo CardLog sairia sem autor; (ii) `post_save` dispara com `raw=True` em `loaddata`, e um restore do dump de produção desatribuiria cards em massa; (iii) data migration usa modelo histórico e não dispara signal nenhum. Cards FINALIZADOS e INVIABILIZADOS mantêm o responsável: apagar ali reescreveria a métrica de entrega de sprints passadas.

`backend/apps/projects/services.py`

### Feedbacks pós-entrega

**O gatilho é a transição do CARD para 'finalizado', não o projeto virar 'entregue'**

Os dados desmentiram a primeira versão: dos 106 projetos do banco, os 106 estão em 'criado' e NENHUM tem `data_entrega` preenchida. `Project.status` existe no model, mas nada no produto o move. Neste sistema o projeto é uma PASTA que agrupa cards; quem tem ciclo de vida, data de entrega e homologação é o CARD. Com o gatilho antigo nenhum pedido nasceria em produção e a feature ficaria inerte sem ninguém perceber, porque a falha é a AUSÊNCIA de algo.

*Alternativa descartada:* Observar `Project.status` -> 'entregue' (a primeira versão implementada, e removida).

`backend/apps/feedbacks/signals.py:1-30, backend/apps/feedbacks/estrutura.py:286-291`

**A data de entrega é `card.finalizado_em` convertida com `timezone.localdate(dt)`, jamais `dt.date()`**

`finalizado_em` está preenchida em 688 de 688 cards finalizados do banco — é o instante observável da entrega, diferente de `Project.data_entrega` (que ninguém preenche) e de `data_fim` (o PRAZO combinado, que pode estar no passado ou no futuro). E `.date()` num DateTimeField gravado em UTC já causou bug neste projeto: das 21h à meia-noite as duas datas apontam para dias diferentes. `data_referencia` ser DateField torna o bug impossível por CONSTRUÇÃO, não por disciplina.

`backend/apps/feedbacks/estrutura.py:322-335`

**`PedidoFeedback.estado` é a fonte da verdade; a coluna do kanban é PROJEÇÃO**

Duas das transições não têm humano no laço — a promoção dos 30 dias é uma varredura do Celery e a resposta chega de um visitante anônimo, sem sessão e sem card. Nenhuma das duas é expressável como 'alguém arrastou o card'. Um arraste que escrevesse SÓ no card passaria no teste da tela e seria DESFEITO em silêncio pela reconciliação, e o usuário veria o card voltar sozinho de madrugada, sem mensagem nenhuma — o pior tipo de bug possível aqui.

`backend/apps/feedbacks/models.py:16-21, backend/apps/feedbacks/services.py:178-190`

**As KEYS das etapas do kanban são LITERALMENTE os valores de EstadoPedido**

Faz a sincronização card↔pedido ser uma linha (`Card.objects.filter(pk=...).update(status=pedido.estado)`) e não uma tabela de-para que possa divergir.

`backend/apps/feedbacks/models.py:43-47, backend/apps/feedbacks/estrutura.py:88-92`

**A 4ª etapa se chama 'feedback_encerrado', não 'encerrado' nem 'finalizado'**

'finalizado' está OCUPADA — é a etapa terminal dos projetos normais e o valor de CardStatus.FINALIZADO; `KanbanStage.key` é UNIQUE GLOBAL, então reusá-la faria os dois boards apontarem para a MESMA linha, e `_card_edicao_restrita` trata status='finalizado' como card travado, congelando justamente o arraste que este estado existe para permitir. 'encerrado' está livre mas é genérica demais para um catálogo GLOBAL — é o nome que um projeto comum vai querer amanhã. 'feedback_encerrado' tem 18 chars e cabe em Card.status (max_length=20) com folga.

*Alternativa descartada:* 'finalizado' (colisão fatal) e 'encerrado' (colisão futura provável).

`backend/apps/feedbacks/models.py:58-75`

**`is_terminal=True` na etapa de encerramento NÃO impede arrastar o card de volta**

O flag é rótulo de leitura do board, não trava de movimento — quem trava é `Card.status` em `_card_edicao_restrita`, e 'feedback_encerrado' não está lá de propósito. Poder arrastar de volta É literalmente o requisito.

`backend/apps/feedbacks/estrutura.py:102-106, backend/apps/feedbacks/migrations/0009_etapa_feedback_encerrado.py:44-49`

**O fluxo é ancorado num SETOR TÉCNICO próprio ('monitoramento_feedbacks'), não em `sem_setor`**

Correção de um vazamento dormente. O argumento original ('sem_setor não é setor de trabalho de ninguém, logo ninguém enxerga') é FALSO neste sistema, e apps.accounts diz isso em três lugares: a migration accounts/0016 vincula TODO usuário existente a `sem_setor`, `RegisterSerializer.create` põe toda conta NOVA lá, e `aplicar_regra_do_setor_padrao` documenta que o vínculo 'entregaria a essa pessoa todo o conteúdo NÃO CLASSIFICADO da empresa'. No banco de dev, 14 dos 15 vínculos são `sem_setor`. Com SETOR_SCOPING_ENABLED ligada, cada um deles receberia todo card de feedback da empresa — e junto a `url_publica`, que é a credencial INTEIRA da rota anônima.

*Alternativa descartada:* Ancorar sprint/projeto/cards no setor padrão `sem_setor`.

`backend/apps/feedbacks/estrutura.py:42-76`

**Quem enxerga o card de feedback entra por CardCompartilhamento (nivel=LEITURA), um a um, para o setor que ENTREGOU**

`Card.save()` sobrescreve `setor_id` com o do PROJETO em todo save, e o projeto de monitoramento é do setor técnico, que não é de ninguém. Sem mais nada, `scope_cards` esconderia o card de TODO MUNDO — inclusive do time que entregou e é justamente quem precisa copiar o link. Fail-closed, seguro, e inútil. O compartilhamento pontual é o mecanismo previsto pelo próprio modelo, e resolve sem tocar em Card.save(), sem tornar Project.setor nulável e sem exigir um projeto de monitoramento por setor.

*Alternativa descartada:* Um projeto de monitoramento por setor; tornar Project.setor nulável; mexer em Card.save().

`backend/apps/feedbacks/estrutura.py:459-495`

**`referencia_publica` é o nome do CARD, não o do projeto**

Decisão explícita do usuário, e a regra da cardinalidade é o que a torna coerente: um pedido POR CARD MARCADO. Cinco cards marcados do mesmo projeto geram cinco links, e é o nome do card que diz a QUAL das cinco entregas cada link se refere — com o nome do projeto os cinco exibiriam a mesma string e quem recebesse dois não saberia distinguir o que está avaliando. É CÓPIA congelada (vive nos `defaults` do get_or_create): renomear o card depois não altera nenhum link já gerado.

`backend/apps/feedbacks/estrutura.py:399-423`

**A ordem em `_gerar_pedido_do_card` é o INVERSO da intuitiva: motor primeiro, card depois**

A ordem ingênua ('crio o card e depois chamo o motor passando card_kanban_id') produz um card ÓRFÃO a cada nova entrega, porque `card_kanban_id` é `defaults` do get_or_create e é IGNORADO na segunda chamada — o pedido continuaria apontando para o card antigo e o novo ficaria parado no board sem dono.

*Alternativa descartada:* Criar o Card antes e passar card_kanban_id ao motor.

`backend/apps/feedbacks/estrutura.py:362-386`

**O 404 da rota pública é UNIFORME para todos os casos não-utilizáveis, mas o encerramento é 410 GONE**

O 404 único protege ENUMERAÇÃO: token inexistente, fora do alfabeto, grande demais e pedido apagado por CASCADE têm de ser indistinguíveis. Essa propriedade fica intacta — `_encerrado` só é alcançado DEPOIS de o token ter sido resolvido para uma linha real. A distinção encerrado×aberto não entrega nada: quem tem o token já sabia que o link existia (foi enviado a ele à mão), e esconder o encerramento atrás do 404 genérico só faria o cliente achar que o link quebrou e cobrar a equipe. 410 é o status que dá ao frontend um gancho estável sem depender de casar string de mensagem, e `encerrado: True` vai junto para o cliente não inferir nada do status.

`backend/apps/feedbacks/views.py:61-82, 204-223`

**O throttle por token chaveia pelo TEXTO da URL (SHA-256), nunca pelo objeto do banco**

Se o bucket só existisse para tokens válidos, um 429 já diria ao atacante que aquele token existe — o rate limit viraria o oráculo que o resto do desenho evita. E nenhuma consulta ao banco acontece antes do throttle: o custo de uma tentativa às cegas fica em cache, não em SQL. O SHA-256 porque chave de cache acaba em dump de memória e em log de erro, e a regra 'nunca registrar o token inteiro' vale também aí.

`backend/apps/feedbacks/throttling.py:29-52`

**Baldes SEPARADOS para GET (120/hour) e POST (10/hour) no mesmo token**

O balde único estava errado nos dois sentidos. Frouxo como teto de escrita (60 INSERTs por hora não é teto nenhum para um link sem login) e apertado como teto de leitura (20 pessoas abrindo o link, algumas recarregando, consumiam o balde e o cliente LEGÍTIMO via 'Muitas tentativas em pouco tempo'). O prefixo da chave é próprio, senão os dois escopos dividiriam o mesmo bucket e a separação seria só aparente.

`backend/apps/feedbacks/throttling.py:55-75, backend/apps/feedbacks/views.py:118-135, backend/config/settings.py:276-293`

**`parser_classes = [JSONParser]` apenas, e `metadata_class = None`**

Ambos MEDIDOS, não supostos. Sem só-JSON, um POST multipart/form-data de qualquer pessoa com o link é PARSEADO antes de a view olhar o conteúdo: DATA_UPLOAD_MAX_MEMORY_SIZE não vale para as partes de ARQUIVO, então acima de 2,5 MB vai para arquivo temporário em DISCO — um upload de 3 MB era aceito e gravado antes do 400. Com metadata default, `OPTIONS /api/feedback/<qualquer coisa>/` devolvia 200 com 989 bytes contendo a DOCSTRING inteira da classe, incluindo caminhos e linhas do código de autenticação.

`backend/apps/feedbacks/views.py:137-169`

**A unicidade de RespostaFeedback foi removida e substituída por MAX_RESPOSTAS_POR_PEDIDO = 100**

Pedido do usuário: 'mais de um usuário deve poder responder o feedback, o link do formulário não deve expirar'. Sem nenhum limite estrutural, um link público, perene e sem login vira storage grátis para quem o tiver — o rate limit sozinho não fecha o buraco, porque quem fica DENTRO da taxa cresce indefinidamente e o balde do cache zera a cada restart do Redis. 100 × ~12 KB (o teto medido de uma resposta cheia) = ~1,2 MB por pedido no pior caso, duas ordens de grandeza acima de qualquer entrega real e ainda assim FINITO — que é a propriedade perdida ao remover a unicidade.

`backend/apps/feedbacks/models.py:118-129, 332-343`

**RESPONDIDO fica FORA de ESTADOS_QUE_PROMOVEM e `respondido_em` usa Coalesce**

Essa tupla é o WHERE do UPDATE de promoção; incluir RESPONDIDO faria a 2ª resposta em diante re-disparar `notificar_transicao` e reescrever `respondido_em` a cada envio. O Coalesce fecha o caminho que 'Feedback Finalizado' abriu: encerrar e depois arrastar de volta devolve um pedido JÁ RESPONDIDO a 'aguardando_resposta', e sem ele a resposta seguinte reentraria no UPDATE e sobrescreveria a data da PRIMEIRA resposta. Mover `respondido_em` tornaria o prazo de retenção do dado pessoal reiniciável por um anônimo, indefinidamente.

`backend/apps/feedbacks/models.py:78-92, backend/apps/feedbacks/views.py:339-369`

**A retenção corta por `RespostaFeedback.enviado_em`, nunca pelo `respondido_em` do pedido**

Com várias respostas por pedido, `respondido_em` congela no instante da PRIMEIRA resposta — filtrar por ele casaria TODAS as linhas daquele pedido, inclusive uma resposta enviada HOJE, que seria apagada amanhã sem ter cumprido um dia sequer do prazo. Seria perda de dado do usuário disfarçada de LGPD.

`backend/apps/feedbacks/tasks.py:152-163`

**Sempre `.update()` de queryset nos cards do kanban, JAMAIS `card.save()`**

`save()` acorda `card_pre_save` (um SELECT extra + `apply_development_time_metrics`, que escreveria métricas de desenvolvimento inventadas num card que ninguém desenvolve) e `card_created_or_updated` (CardLog + notificação + broadcast realtime). Qualquer um deles pode levantar — e o hook roda com a exceção ENGOLIDA nos chamadores, logo o card ficaria na coluna errada CALADO.

`backend/apps/feedbacks/services.py:192-198, 244-267, backend/apps/feedbacks/tasks.py:106-108`

**Os campos são JSON e o formulário é versionado por linha nova, nunca por edição da linha antiga**

Modelar os campos como JSON (e não como colunas) faz trocar o formulário ser uma data migration sem mexer em schema e sem quebrar respostas antigas. E uma resposta gravada há seis meses precisa continuar legível contra a definição que a pessoa DE FATO viu na tela — se a v1 fosse editada, a resposta antiga apareceria sob os rótulos da v2.

*Alternativa descartada:* Uma coluna por pergunta (exigiria migration de schema a cada troca) e editar a definição no lugar.

`backend/apps/feedbacks/models.py:132-143, backend/apps/feedbacks/migrations/0005_seed_formulario_v2.py:1-40`

**Zero campo de digitação OBRIGATÓRIO no formulário: 6 obrigatórias, todas de um clique**

A regra que gerou a lista: obrigatório só o que, faltando, torna a resposta inútil como métrica; e TODO campo de texto livre é opcional. Seis cliques fecham o formulário, o que torna verdadeiro o próprio subtítulo ('leva menos de 2 minutos'). Texto livre obrigatório é o que faz a pessoa escrever '-' e abandonar, e um '-' gravado é pior que um campo vazio porque contamina a leitura. O nome do respondente é opcional também por ser dado pessoal — o feedback já é identificado pelo card via token.

*Alternativa descartada:* 'obrigatório quando 6.1 != Pronto para uso' — recusada porque exige dependência entre campos no schema, que é o primeiro passo do form builder que este desenho evita.

`backend/apps/feedbacks/migrations/0005_seed_formulario_v2.py:53-64, 172-184`

**A validação REJEITA, nunca trunca nem coage; e a neutralização de fórmula é na SAÍDA**

Truncar gravaria um texto que a pessoa não escreveu; ignorar chave desconhecida esconderia um formulário desatualizado no cliente. E a validação deve continuar recusando o inválido, nunca reescrevendo em silêncio o que a pessoa respondeu — o texto no banco continua exatamente o digitado; o que muda é como o arquivo exportado o declara.

`backend/apps/feedbacks/serializers.py:226-256, backend/apps/feedbacks/exportacao.py:112-131`

**As mensagens de erro do 400 nunca ecoam o valor recebido, e as chaves desconhecidas viram CONTAGEM**

A resposta 400 dessa rota é montada a partir de conteúdo arbitrário de um anônimo. MEDIDO: 200 chaves de 300 bytes viravam um 400 de 60 KB de conteúdo do atacante, com teto real em DATA_UPLOAD_MAX_MEMORY_SIZE (2,5 MB) — amplificação de graça. A contagem preserva o que a mensagem existe para dizer (o formulário do cliente está desatualizado); qual chave sobrou é diagnóstico de desenvolvimento, e o cliente legítimo tem a definição inteira no GET.

`backend/apps/feedbacks/serializers.py:265-278`

**Tetos numéricos explícitos na validação (MAX_DIGITOS_ESCALA=12, MAX_BITS_NUMERO=128) e lista de caracteres proibidos**

Todos MEDIDOS e todos fechando um 500 na rota anônima — e um 500 tem duas consequências que um 400 não tem: a exceção NÃO passa por `finalize_response` (então 'Internal Server Error: /api/feedback/<TOKEN>/' vai para o log com a credencial inteira) e é DISTINGUÍVEL do 404 único, devolvendo à rota o oráculo de enumeração. Os casos: `int('9'*4301)` levanta ValueError (CVE-2020-10735); `str(10**5000)` idem, do outro lado; `\x00` em jsonb levanta UntranslatableCharacter no Postgres, que vira DataError e NÃO é IntegrityError, passando direto pelo único except da view; surrogate solto sobrevive ao parse e explode em UnicodeEncodeError no driver. `re.ASCII` porque `\d` casa dígito UNICODE por padrão e '٧' (árabe-índico) passava e virava 7.

`backend/apps/feedbacks/serializers.py:60-111, 370-414`

**`finalize_response` marca `_has_been_logged = True` em toda resposta >= 400**

MEDIDO: `django/core/handlers/base.py:142-149` chama `log_response` para TODA resposta com status >= 400, não só quando um Http404 propaga. Com o token no path e o logger `django.request` em DEBUG, cada 404/400/429 gravaria a credencial completa no log da aplicação. Só trocar `raise Http404` por `return Response(404)` NÃO resolve — os testes mostraram o token no log mesmo assim.

`backend/apps/feedbacks/views.py:175-200`

**O endpoint autenticado sai VAZIO sem `?card=` e não tem rota de detalhe**

Ele entrega o TOKEN dentro de `url_publica`, e o token é a credencial INTEIRA da rota anônima — quem tem o link pode RESPONDER NO LUGAR DO CLIENTE. Antes, um GET em /api/feedbacks/pedidos/ devolvia TODOS os pedidos paginados com o link pronto: qualquer conta com view_content colhia os links de todos os clientes. A rota de detalhe deixava o mesmo inventário acessível iterando 1, 2, 3…

`backend/apps/feedbacks/views.py:403-417`

**Ler o TEXTO das respostas vive no mesmo payload e sob o mesmo gate que o link**

Esse endpoint JÁ entrega `url_publica`, que carrega o token. Ler o texto é estritamente MENOS poderoso do que o que já sai dali; um gate mais estreito só para o texto, mantendo o link no gate largo, seria uma proteção que não protege. O porto inegociável é outro: `respostas` e o contador NÃO entram em CardSerializer nem em nenhuma listagem de card, nem na rota anônima.

`backend/apps/feedbacks/serializers.py:633-643`

**A exportação fica sob `view_metrics`, não sob `view_content`**

A planilha reúne o texto de TODAS as respostas de TODA a empresa num arquivo só, que sai do sistema e passa a circular por e-mail e pendrive. Isso é dado consolidado — a mesma régua dos relatórios, não a de 'ver o card do meu setor'.

`backend/apps/feedbacks/views.py:515-531`

**A exportação não usa o app `reports` e faz streaming direto**

Aquele sistema é de JOB (enfileira, grava em disco, o cliente faz polling e baixa depois). Aqui o volume é pequeno e o botão fica ao lado da busca — a pessoa espera o arquivo cair na hora, e nada fica no disco para expurgar.

`backend/apps/feedbacks/exportacao.py:9-12, backend/apps/feedbacks/views.py:525-528`

**`dias_restantes` é calculado no SERVIDOR e devolve None (não 0) fora da espera**

A regra tem de ser a MESMA da varredura que promove o pedido: mesmo FEEDBACK_ESPERA_DIAS, mesma data_referencia, mesmo timezone.localdate(). Reimplementar no cliente faria a tela dizer 'faltam 2 dias' enquanto o servidor já teria promovido — e o pior é que divergiria só perto da meia-noite, quando ninguém está olhando. 0 significaria 'libera hoje', que é informação diferente de 'não se aplica'.

`backend/apps/feedbacks/serializers.py:715-734`

**A rota pública é registrada em config/urls.py ANTES dos include(), e o token vai no PATH**

O urlconf termina no catch-all `serve_spa`, que devolve index.html com HTTP 200 para qualquer caminho não casado — uma rota de API registrada tarde não daria 404, daria HTML onde o front espera JSON, e a falha seria silenciosa. E o token vai no path porque query string cai no access log e no header Referer enviado a terceiros.

`backend/config/urls.py:35-41, backend/apps/feedbacks/urls.py:1-9`

**`estrutura.py` e a migration 0003 são GÊMEOS escritos duas vezes, de propósito**

É a regra do Django: migration é retrato congelado do schema e NUNCA importa código de app. Se `garantir_estrutura_monitoramento` ganhar um campo amanhã, a migration antiga continuaria rodando com o código novo contra bancos antigos e quebraria. O mesmo vale para a 0009 e `etapas_monitoramento()`.

`backend/apps/feedbacks/estrutura.py:13-19, backend/apps/feedbacks/migrations/0003_seed_monitoramento.py:4-9`

**A migration 0008 usa AlterField (nunca RemoveField+AddField) para tirar a unicidade**

`AlterField` mantém a MESMA coluna `pedido_id`; no Postgres o SQL gerado é só DROP CONSTRAINT + CREATE INDEX comum, e nenhum dado é reescrito. Conferido com `sqlmigrate feedbacks 0008` ANTES de aplicar: não há DROP COLUMN nem ADD COLUMN. Em produção existem respostas reais, e um drop-and-create as apagaria em silêncio.

*Alternativa descartada:* RemoveField + AddField (perda silenciosa de todas as respostas em produção).

`backend/apps/feedbacks/migrations/0008_respostas_multiplas.py:1-16`

**A migration 0006 renomeia o fluxo por migration em vez de só trocar a constante**

O seed e o `get_or_create` guardam o nome nos `defaults`, que só se aplicam na CRIAÇÃO. Num banco onde a estrutura já existe, mudar a constante não renomeia nada e o nome antigo ficaria na tela para sempre. A identificação é pelo PAR de flags (`is_system` no projeto E na sprint), nunca pelo nome antigo — casar pelo nome falharia justamente no banco onde alguém já tivesse renomeado à mão.

`backend/apps/feedbacks/migrations/0006_renomear_monitoramento.py:1-20`

**As colunas de pergunta da exportação são a UNIÃO de todas as versões do formulário**

O formulário é versionado e respostas antigas foram dadas sob outra definição. Montar as colunas só da versão ativa jogaria fora, silenciosamente, o que foi respondido em perguntas que não existem mais. A ordem é semeada pela definição ATIVA para que um campo acrescentado numa versão nova ('Seu setor:') não caia no FIM da planilha, longe do 'Seu nome:' a que pertence.

`backend/apps/feedbacks/exportacao.py:14-18, 55-70`

**A prévia NÃO neutraliza prefixo de fórmula**

Ela é desenhada no navegador, onde '=' é só um caractere. Aplicar o apóstrofo do CSV mostraria à pessoa um texto que ela não escreveu — e a promessa da prévia é sobre QUAIS COLUNAS E LINHAS saem no arquivo, não sobre o artifício com que cada formato declara que a célula é texto.

`backend/apps/feedbacks/exportacao.py:226-231`

**Não há e-mail em lugar nenhum: sem destinatário, sem tentativa de envio, sem erro de envio**

Quem envia o link é uma PESSOA, pela ferramenta que quiser (WhatsApp, e-mail próprio, telefone). Sem envio, essas colunas seriam trabalho morto. Consequência de segunda ordem: os 30 dias VIRARAM o gatilho da etapa (antes seria 'e-mail enviado com sucesso -> muda de etapa'), e quem faz isso é a varredura.

`backend/apps/feedbacks/models.py:1-8, backend/apps/feedbacks/tasks.py:31-33`

**O link nasce JÁ VÁLIDO junto com o pedido, não aos 30 dias**

Sendo envio manual não há motivo para segurá-lo, e dá para antecipar quando fizer sentido. Por isso o POST aceita responder ainda em 'aguardando_prazo' — quem recebeu antes e respondeu pula direto para 'Feedback colhido'.

`backend/apps/feedbacks/services.py:110-115, backend/apps/feedbacks/views.py:344-346`

**`resposta_legivel` casa label↔valor NO SERVIDOR, contra a definição DAQUELE pedido**

Devolver o dict cru {key: valor} obrigaria a interface a casar as chaves contra ALGUMA definição — e a única que ela tem à mão é a ATIVA. Uma resposta gravada na versão 1 apareceria sob os rótulos da versão 2, que é exatamente o defeito que o versionamento de 2 passos existe para impedir.

`backend/apps/feedbacks/serializers.py:521-551`

### Geração de relatórios

**Um job de relatório por usuário por vez, com 409 devolvendo os dados do job existente**

Evita que o usuário duplique geração pesada clicando duas vezes ou recarregando. O 409 carrega `existing_id`/`existing_status`/`existing_type`/`existing_format` justamente para o frontend ADOTAR o job em andamento em vez de criar outro.

*Alternativa descartada:* Deixar criar N jobs e resolver a concorrência depois.

`backend/apps/reports/views.py (create) + frontend/src/components/reports/ReportConfigPanel.tsx (handleSubmit, ramo isAxiosError 409)`

**O arquivo é gravado dentro de um subdiretório aleatório de 16 hex, e o nome do arquivo permanece o nome 'bonito'**

`BaseReport.filename` é determinístico — um de oito títulos fixos + timestamp com granularidade de MINUTO — logo o caminho em MEDIA_ROOT seria enumerável por quem descobrisse outra porta para os arquivos de mídia. O segmento aleatório vai no DIRETÓRIO e nunca no nome porque o Content-Disposition do /download/ e o filename do /preview/ saem de `os.path.basename(job.file.name)`. E são 16 hex (64 bits) de propósito: FileField.max_length é 100 e o Django TRUNCA o nome do arquivo se o caminho estourar, o que estragaria justamente o nome exibido.

*Alternativa descartada:* Depender só do gate da rota /media/; ou colocar o hash no nome do arquivo.

`backend/apps/reports/tasks.py (linhas 57–74)`

**O prefixo `reports/` é NUNCA servido por /media/, nem para autenticado, e responde 404 (não 403), antes mesmo do teste de existência do arquivo**

O relatório é o agregado de tudo que o DONO do job enxerga, mas o arquivo em disco não carrega esse vínculo; estar autenticado bastaria para varrer o mês e baixar o consolidado de outro setor. E um 403 (ou um 404 tardio) já confirmaria que o relatório de tal título foi gerado em tal minuto. O download legítimo passa por /api/reports/<id>/download|preview/, que filtra por `user=request.user` — nem o SPA nem o serializer apontam para /media/reports/ em lugar nenhum.

*Alternativa descartada:* Servir com autenticação; responder 403.

`backend/config/views.py (_MEDIA_BLOQUEADA, linhas 34–46 e 79–83)`

**Todo gerador lê o banco por `cards_visiveis()` / `projetos_visiveis()` / `sprints_visiveis()` do BaseReport, nunca por `Card.objects` direto**

Relatório é exportação: os dados saem da plataforma em PDF/XLSX e circulam por e-mail. Um gerador que esquecesse o escopo entregaria o acervo de outro setor num arquivo, sem deixar rastro na tela. Concentrar as três fontes num lugar só torna esse esquecimento visível na revisão.

*Alternativa descartada:* Cada gerador aplicar `scope_cards`/`scope_projects`/`scope_sprints` por conta própria.

`backend/apps/reports/generators/base.py (linhas 66–92)`

**`is_system=False` fica dentro de `sprints_visiveis()`, e não em cada gerador**

Os SEIS call-sites (executive, metrics, cards, sprint) herdam o recorte de graça. Sprint sistêmica ancora fluxo interno — não é ciclo de trabalho e não pode virar 'sprint ativa' de relatório executivo nem linha de comparativo.

`backend/apps/reports/generators/base.py (linhas 85–92)`

**`/download/` usa StreamingHttpResponse com generator custom em vez de FileResponse**

Precisa de controle do ciclo de vida do handle e de um hook de 'fim de stream' para decidir se apaga. Conta os bytes enviados e só apaga se `sent >= file_size`; se o cliente desconecta, o GeneratorExit propaga e o arquivo FICA para futuras tentativas. Deleta a LINHA primeiro para não deixar job órfão apontando para arquivo inexistente.

*Alternativa descartada:* FileResponse (que já resolve Content-Length e ranges, e é o que o /preview/ usa).

`backend/apps/reports/views.py (_serve_file_and_delete_on_success, linhas 228–291)`

**Cancelar um job não faz revoke da task Celery**

O comentário no código diz explicitamente que 'revoke é frágil'. A intenção declarada era que o worker, ao terminar, visse o job já marcado e não sobrescrevesse.

*Alternativa descartada:* app.control.revoke(task_id) — exigiria persistir o task_id, que hoje não é guardado em lugar nenhum.

`backend/apps/reports/views.py (destroy, linhas 96–114)`

**O expurgo periódico apaga o ARQUIVO e preserva a LINHA do ReportJob; e `user` é SET_NULL, não CASCADE**

A linha registra quem gerou o quê e quando — isso é auditoria; o peso e o risco estão no arquivo, não no registro. Pelo mesmo motivo a FK virou SET_NULL na migração 0002: apagar a linha junto com o usuário deixaria o arquivo órfão e sumiria com o registro de que ele foi emitido.

`backend/apps/reports/tasks.py (docstring de limpar_relatorios_expirados) + backend/apps/reports/models.py (linhas 53–61) + backend/apps/reports/migrations/0002_alter_reportjob_user.py`

**O expurgo de órfãos ignora arquivos com mtime mais recente que o corte de retenção**

Um arquivo sendo gravado agora ainda não tem job apontando para ele; sem essa guarda a rotina o apagaria no meio da geração.

`backend/apps/reports/tasks.py (linhas 145–155)`

**O cabeçalho CONTEXTUAL (logo/título/data/usuário/filtros) é sempre gravado; `include_header` controla apenas a linha de rótulos das colunas**

São duas coisas diferentes: a procedência do documento (que precisa estar sempre lá) e a conveniência de colar as células direto numa planilha existente.

`backend/apps/reports/models.py (linhas 48–51) + backend/apps/reports/generators/base.py (_render_xlsx e _render_csv)`

**CSV com delimitador `;` e encoding utf-8-sig (BOM)**

Ambos são concessões ao Excel em português do Brasil — o `;` é o separador que ele espera na configuração pt-BR, e o BOM faz ele reconhecer o UTF-8 em vez de abrir com acentuação quebrada.

`backend/apps/reports/generators/base.py (_render_csv, linhas 379–416)`

**`paginate_with_progress` materializa querysets em chunks de 100 com LIMIT/OFFSET manual**

Cada chunk vira uma query a mais — overhead irrelevante para querysets pequenos — mas para querysets grandes (centenas+) o ganho de UX vale: a mensagem 'Exportando cards 245 / 1340' evolui a cada página e o polling de 1,5s do frontend mostra a barra andando.

`backend/apps/reports/generators/base.py (linhas 132–172)`

**O import do WeasyPrint tem catch específico de OSError com mensagem em português**

WeasyPrint depende de libs nativas (Pango, Cairo, GDK-Pixbuf, GObject). No Linux Docker vêm via apt-get; no Windows é preciso instalar o GTK runtime, e sem isso o import falha com um erro FFI genérico que confunde o usuário. O catch devolve uma mensagem prática: use DOCX/XLSX/CSV para testes locais.

`backend/apps/reports/generators/base.py (linhas 242–262) + Dockerfile (linhas 25–39)`

**O preview tabular não persiste ReportJob — usa uma instância efêmera e `set_progress` vira no-op**

Preview não é emissão: não deve consumir o lock, não deve gerar arquivo, não deve entrar no histórico. O no-op é implementado como `if not self.job.pk: return` dentro do próprio `set_progress`, de forma que nenhum gerador precisa saber que está em modo preview.

`backend/apps/reports/views.py (preview_table, linhas 137–225) + backend/apps/reports/generators/base.py (set_progress, linhas 118–130)`

**Cada chamada de preview-table re-roda `fetch_data()` inteiro, sem cache de página**

Comentário na view: 'barato porque as listas vivem em memória'. Assume-se que o custo de refazer a consulta é menor que o de manter estado de sessão entre páginas.

`backend/apps/reports/views.py (linhas 137–150)`

**O preview do PDF no frontend busca via axios e injeta como blob, em vez de apontar o iframe para a URL**

O `<iframe>` faz a request sem os headers do JS (Authorization); o backend responderia 401 com uma página de erro que traz `X-Frame-Options: deny`, e o resultado visível seria um quadrado vazio. Além disso o Blob é criado forçando `type: 'application/pdf'` e NÃO honrando o Content-Type do servidor — defesa: se o backend regredir e mandar text/html, um `blob:` HTML executaria JS na mesma origem do app, escapando do sandbox do iframe.

`frontend/src/components/reports/ReportPreviewDialog.tsx (linhas 14–24 e 46–51)`

**O filtro de usuário do relatório 'Por Usuário' lista apenas participantes (`userService.getParticipantes()`)**

Gerar o relatório de quem não enxerga sprint/projeto/card produz um PDF com zero entregas, 0% no prazo e distribuição por área vazia — documento que só serve para confundir. O gerador continua aceitando qualquer id, então relatório histórico de quem perdeu o acesso segue possível.

`frontend/src/components/reports/ReportConfigPanel.tsx (linhas 129–135)`

**'Feedbacks' aparece na lista de relatórios mas NÃO faz parte do tipo `ReportType`**

`ReportType` é o contrato do que o backend gera e entrega como arquivo; 'feedbacks' é um PAINEL que se olha na tela, sem download. Ampliar o tipo para incluí-lo faria o serviço de relatórios prometer um arquivo que não existe — daí a união `ItemDeRelatorioId = ReportType | 'feedbacks'` existir só naquele arquivo.

`frontend/src/pages/Reports.tsx (linhas 12–20 e 100–108)`

**O registry importa os geradores tolerando ImportError**

Permite desenvolvimento incremental — registra só os geradores cujos arquivos já existem. Para adicionar um relatório novo: criar `generators/<nome>.py` com uma subclasse de BaseReport exportada como `Report`, adicionar o nome em `_MODULES` e criar `templates/reports/<nome>.html`.

*Alternativa descartada:* Import estrito, que quebraria o app inteiro por um gerador com erro de import.

`backend/apps/reports/generators/__init__.py`

### Chamados, Geek Day, sugestões e apps mortos

**O recorte de visibilidade do Kanban de suporte é feito na PUBLICAÇÃO (vários grupos no channel layer), não no recebimento.**

Com um grupo global único, o payload completo do chamado — descrição, empresa, e-mail do solicitante, texto da resolução — trafegava pelo Redis até o processo de quem não podia vê-lo, e só era descartado na ponta, dentro do consumer. Filtrar quem recebe não é isolamento: o dado já viajou, já passou pelo Redis e já esteve na memória do outro processo.

*Alternativa descartada:* Grupo único + filtro no consumer (o desenho anterior), que trocava isolamento por descarte tardio.

`backend/apps/formularios/realtime.py (docstring do módulo)`

**O grupo de posse do WebSocket usa SHA-256 do e-mail normalizado, não o e-mail.**

O Channels só aceita [A-Za-z0-9._-] em nome de grupo, até 100 caracteres, e e-mail tem '@' e '+'. O hash não é medida de sigilo (o espaço de e-mails é adivinhável): é codificação — nome válido, tamanho fixo, estável entre processos, e de quebra evita gravar e-mail de usuário como chave no Redis.

*Alternativa descartada:* Usar o e-mail cru como nome de grupo

`backend/apps/formularios/realtime.py (grupo_do_dono)`

**`_user_can_access_chamado` libera o acesso quando o chamado NÃO existe na tabela local.**

Em produção os chamados vivem no portal externo e a tabela `ChamadoSuporte` local fica vazia; tratar 'não achei' como 'não pode' derrubaria a timeline, a resolução e o realtime inteiros. A gate real fica no portal.

*Alternativa descartada:* Fail-closed em chamado inexistente

`backend/apps/formularios/views.py (linhas 39-75)`

**O escopo de setor foi acrescentado ao `_user_can_access_chamado`, e não só à listagem.**

Este helper é a ÚNICA porta da timeline e da resolução. Sem ele, um atendente do setor A pedia por id (`?chamado_id=`) exatamente o chamado do setor B que a listagem escondia dele — a divergência entre as duas rotas é o furo.

`backend/apps/formularios/views.py (linhas 39-56)`

**O POST de resolução exige TRÊS gates independentes: manage_ticket_resolution, posse do chamado e checar_escrita_no_pai.**

manage_ticket_resolution e view_all_tickets são permissões INDEPENDENTES no catálogo: quem tinha a primeira sem a segunda anexava (e LIA, porque o 201 devolve o que já estava gravado) a resolução de QUALQUER chamado, bastando informar o chamado_id. O gate de setor não fechava isso — o furo aparecia também DENTRO do próprio setor, entre chamados de pessoas diferentes. E como o POST não passa por get_object(), o SetorPermiteEscrita do mixin nunca roda nessa rota.

*Alternativa descartada:* Reaproveitar `_user_can_access_chamado` como gate de setor — recusaria escrita a partir da flag de VISIBILIDADE, o acoplamento que as duas flags separadas existem para evitar.

`backend/apps/formularios/views.py (linhas 501-556)`

**`resolvido-em/` existe como endpoint próprio, lendo a timeline em vez de ChamadoSuporte.data_atualizacao.**

`data_atualizacao` é auto_now=True: é reescrito em QUALQUER save (mover entre tabs, o proxy re-tocando o registro), sem relação com a conclusão de fato. A timeline só ganha um evento `etapa_alterada` quando o usuário realmente move o card no quadro — por isso é a fonte confiável para medir SLA.

`backend/apps/formularios/views.py (linhas 381-404)`

**`chamado_ids` em `resolvido-em/` é OPCIONAL.**

A tela de métricas tem centenas de tickets e mandar todos os ids na query string estourava o limite prático de URL.

`backend/apps/formularios/views.py (linha 395-397)`

**`ChamadoSuporteResolucao` e `ChamadoSuporteTimeline` guardam `chamado_id` como inteiro solto, não como ForeignKey.**

Precisam funcionar quando o chamado vive no portal externo — não há linha local para referenciar.

`backend/apps/formularios/models.py (linhas 119-127, 157-160)`

**O anexo de resolução recebe nome uuid4 aleatório, preservando só a extensão.**

O arquivo é servido por /media/ sem header de proteção, então o nome é a única barreira contra alguém adivinhar a URL. SVG fica fora da whitelist de extensões por ser vetor de XSS quando servido inline.

`backend/apps/formularios/models.py (caminho_resolucao_suporte) e serializers.py (RESOLUCAO_ALLOWED_EXTENSIONS)`

**O Geek Day é POR SETOR (grupo), não da empresa inteira. `GeekDayConfig` (singleton pk=1) virou `GeekDayGrupo` por RenameModel.**

Resetar o sorteio de um setor não pode zerar a fila do setor vizinho, e o histórico de cada grupo tem de continuar de pé. RENAME de verdade, não CreateModel, porque a tabela existe em produção com o ciclo corrente — recriar o model perderia a noção de quem já foi sorteado no ciclo em curso.

*Alternativa descartada:* CreateModel de um model novo, descartando a tabela do singleton

`backend/apps/geekday/models.py (docstring de GeekDayGrupo) e migrations/0005_geekdaygrupo.py`

**A migração para grupo foi feita em TRÊS passos: FK nula (0005) → backfill (0006) → NOT NULL (0007).**

É o que permite migrar uma base com histórico sem perder linha nenhuma.

`backend/apps/geekday/migrations/0005_geekdaygrupo.py (docstring)`

**`GeekDayGrupoSetor.setor` é OneToOneField (UNIQUE no banco), com tabela `through` explícita.**

Um setor em dois grupos colocaria o mesmo usuário em dois sorteios, com dois `current_cycle` diferentes — não haveria resposta para 'esta pessoa já foi sorteada neste ciclo?'. A garantia tem de estar no BANCO, não só na API. A tabela explícita ainda deixa o vínculo auditável (added_at) e permite crescer sem outra migração de rename.

*Alternativa descartada:* UniqueConstraint sobre a tabela M2M automática — não é declarável em Meta.

`backend/apps/geekday/models.py (docstring de GeekDayGrupoSetor)`

**Assimetria deliberada entre `usuarios_do_grupo` (amplo) e `participantes_do_sorteio` (estreito).**

ESCOLHER quem entra na roleta recorta por participação; RESOLVER alguém já gravado, não. Quem foi sorteado ontem e hoje não participa mais precisa continuar encontrável, senão o gestor perde o único caminho de corrigir o próprio histórico (o gatilho de desmarcar na tela é arrastar o card de volta, e card só existe para quem vem na resposta).

`backend/apps/geekday/models.py (docstrings de usuarios_do_grupo e participantes_do_sorteio); views.py (users_status, marcar_como_sorteado, desmarcar_como_sorteado)`

**O corte de participação no sorteio é por PERMISSÃO (`view_content` via ids_que_participam_do_trabalho), nunca por nome de cargo.**

Quem não tem view_content não enxerga sprint, projeto nem card, então não tem o que apresentar. Assim, um cargo criado amanhã sem essa permissão some da roleta sozinho, sem ninguém tocar em código. `view_geekday` NÃO serve para isso: ela é sobre ASSISTIR ao ritual, não participar dele.

`backend/apps/geekday/models.py (participantes_do_sorteio)`

**`view_geekday` e `manage_geekday` foram criadas para tirar o Geek Day de `view_metrics`.**

Ver o Geek Day é separado de operá-lo: o time inteiro acompanha o sorteio e o histórico, e só quem organiza sorteia. Antes disso, ver o Geek Day exigia view_metrics — permissão de dados consolidados da empresa, larga demais para uma brincadeira interna.

`backend/apps/accounts/permission_catalog.py (linhas 33-38)`

**O gate de escrita do Geek Day é por MÉTODO HTTP, não por lista de actions.**

Qualquer rota que não seja segura (as @actions de POST e o CRUD herdado do ModelViewSet) cai na mesma exigência, e uma @action nova nasce protegida por padrão. Antes, POST/PUT/PATCH/DELETE em /geekday-draws/ passavam só com view_metrics e deixavam quem lê Métricas criar e apagar sorteio.

`backend/apps/geekday/views.py (get_permissions, linhas 161-168)`

**`GeekDayDrawSerializer.validate_usuario` repete o recorte de participação que a @action já faz.**

`marcar_como_sorteado` não é a única porta — o POST/PUT cru do ModelViewSet tem `usuario` gravável. Sem a validação, a regra valeria para a tela e não para a API: bastaria mandar o id do visitante no corpo. A exceção é quando o `usuario` não está MUDANDO (PUT que reenvia o mesmo id), para continuar sendo possível anotar observação/data de uma apresentação que já aconteceu.

`backend/apps/geekday/serializers.py (linhas 95-125)`

**`setores` foi declarado à mão como PrimaryKeyRelatedField no GeekDayGrupoSerializer.**

O DRF marca como READ-ONLY todo M2M com `through` explícito (has_through_model em utils/field_mapping.py), e o nosso through existe justamente para o UNIQUE de setor. Sem essa linha não haveria como montar/desmontar grupo pela API.

`backend/apps/geekday/serializers.py (linhas 29-30)`

**`marcar_como_sorteado` usa timezone.localdate() e não now().date().**

now().date() é UTC e, das 21h à meia-noite, já é o dia seguinte — o 'já foi sorteado hoje' erraria.

`backend/apps/geekday/views.py (linha 396)`

**As consultas de ciclo filtram `usuario__isnull=False`.**

A FK é SET_NULL. Um None na lista de excluídos vira `NOT (id IN (NULL, ...))` no SQL, que é avaliado como desconhecido para TODA linha e esvaziaria a roleta — o erro apareceria como 'todos já foram sorteados'.

`backend/apps/geekday/views.py (linhas 294-303)`

**`apps/geekday/__init__.py` existe e carrega um comentário de 14 linhas explicando por quê.**

Sem ele o diretório virava namespace package (PEP 420) e a descoberta de testes do unittest PULAVA a suíte de geekday em silêncio: `manage.py test apps` dava OK sem nunca executar um teste do app. Todos os outros apps já tinham o seu.

`backend/apps/geekday/__init__.py`

**geekday/0008 ressincroniza a sequência de ids de GeekDayGrupo.**

Enquanto o model era singleton, a única linha entrava por get_or_create(pk=1) — INSERT com id explícito, que no Postgres não avança a identity. Agora que grupos nascem sozinhos, o primeiro grupo novo tentaria nascer com id=1 e estouraria 'duplicate key' (reproduzido neste banco antes da migração).

`backend/apps/geekday/migrations/0008_sincroniza_sequencia_grupo.py`

**geekday/0006 reimplementa a regra do setor padrão em vez de chamar `setor_padrao_do_sistema()`.**

Chamar a função de runtime faria a migração fazer SELECT em todas as colunas que SetorCatalogo tiver NO FUTURO — numa base criada do zero isso quebraria com 'column does not exist'. Só o codename vem do módulo de escopo, para as duas definições não divergirem.

`backend/apps/geekday/migrations/0006_migra_sorteios_para_grupo.py`

**formularios/0012 REMOVE e RECRIA o M2M `setores_compartilhados` em vez de alterá-lo.**

AlterField não funciona para trocar uma M2M automática por uma com `through` — o Django recusa explicitamente. Como as tabelas de vínculo nunca receberam uma linha (a feature não chegou a produção), remover e recriar é equivalente, sem perda.

`backend/apps/formularios/migrations/0012_chamadocompartilhamento_and_more.py`

**formularios/0006 usa update_or_create em vez de get_or_create para os tipos Easy e Dashboards.**

Garante que, se o tipo já existir mas estiver inativo (alguém desativou via admin), a migração REATIVA. Com get_or_create o campo `ativo` seria ignorado e o tipo continuaria escondido do /catalogo/.

`backend/apps/formularios/migrations/0006_seed_easy_dashboards.py`

**O proxy do portal repassa apenas uma whitelist de headers da resposta upstream.**

Content-Length/Transfer-Encoding são recalculados pelo Django, e Set-Cookie do portal não deve vazar cookies de outro domínio para o nosso.

`backend/apps/formularios/portal_proxy_views.py (_FORWARDED_RESPONSE_HEADERS)`

**O proxy resolve o hostname para TODOS os IPs antes de aceitar PORTAL_BASE_URL, e bloqueia DNS quebrado.**

Defesa contra SSRF interno e DNS rebinding; a lista de bloqueio inclui explicitamente os endpoints de metadata de nuvem (169.254.169.254, metadata.google.internal, 100.100.100.200).

`backend/apps/formularios/portal_proxy_views.py (_is_internal_host)`

**`ChamadoSuporte.setor` e `ChamadoSuporte.usuario_setor` são coisas diferentes e o comentário no model avisa isso.**

`usuario_setor` é texto livre preenchido pelo solicitante e exibido na tela de Suporte; `setor` é o vínculo com o catálogo, usado pelo escopo.

`backend/apps/formularios/models.py (linhas 76-82)`

**O app `teams` foi deprecado na Fase 6 e ganhou um command de export antes do drop das tabelas.**

O organograma baseado em ReactFlow foi substituído pelo mural read-only por setor (People.tsx). As tabelas serão dropadas numa migração separada; o command preserva os dados para consulta histórica ou reimportação manual.

`backend/apps/teams/management/commands/export_hierarchy.py (docstring)`

**teams e timeline continuam em INSTALLED_APPS mas suas urls.py NÃO são incluídas.**

As tabelas guardam histórico — o comentário em config/urls.py diz exatamente isso: 'teams e timeline seguem instalados (as tabelas guardam histórico), mas sem API exposta.'

`backend/config/urls.py (linha do include de suggestions)`

### Configuração e roteamento

**SECRET_KEY sem fallback: o processo morre no import se ela faltar**

O fallback 'django-insecure-*' foi REMOVIDO de propósito — produção exige a chave no ambiente. Se a chave presente ainda tiver o prefixo django-insecure-, emite warning em vez de falhar, porque em dev pode ser válido.

*Alternativa descartada:* Manter um default gerado, que silenciosamente iria para produção

`backend/config/settings.py:36-47`

**Detectar produção resolvendo o hostname 'redis' por DNS em vez de confiar só na env var**

Dev local roda Django nativo no host, sem proxy reverso. O .env da raiz é compartilhado com produção e traz BEHIND_HTTPS_PROXY=true; sem a checagem, SECURE_SSL_REDIRECT redirecionaria HTTP→HTTPS localmente, quebrando o preflight CORS e derrubando o login vindo de http://localhost:5173.

*Alternativa descartada:* Exigir que cada dev sobrescreva BEHIND_HTTPS_PROXY=false no backend/.env

`backend/config/settings.py:59-69`

**Dois load_dotenv, o segundo com override=False**

Em dev, o runserver precisa ler também o .env da RAIZ (REDIS_PASSWORD, CELERY_BROKER_URL e demais valores compartilhados entre serviços do compose), mas sem sobrescrever o backend/.env do dev. Em produção o Compose injeta tudo por env_file e o segundo load é no-op.

`backend/config/settings.py:25-30`

**DOTENV_OVERRIDE=false fixado dentro da imagem Docker**

Em dev (default true) o .env prevalece sobre o ambiente da IDE. Na imagem é o contrário: o env_file do Compose na VPS precisa sobrepor o .env que possa ter ficado baked no build.

`backend/config/settings.py:20-21 e Dockerfile:53-54`

**'daphne' é o PRIMEIRO item de INSTALLED_APPS**

Precisa vir antes de django.contrib.staticfiles para que o `runserver` use o handler ASGI (que suporta WebSocket via Channels) em vez do WSGI puro.

`backend/config/settings.py:79-81`

**Não usar CsrfExemptMiddleware nem desligar CSRF globalmente**

CSRF protege os endpoints baseados em sessão. Endpoints DRF que usam ExpiringTokenAuthentication (header Authorization) ficam isentos naturalmente; as views públicas (register/login/recover) usam @csrf_exempt pontualmente.

`backend/config/settings.py:112-115`

**Três backends de autenticação somados em vez de copiar permissões do cargo para user_permissions**

Os gates da plataforma são todos por has_perm, para que qualquer cargo criado pelo admin possa receber capacidades administrativas. has_perm devolve True se QUALQUER backend disser True, e a ordem é irrelevante: ModelBackend cobre permissões personalizadas, CargoPermissionBackend resolve as do cargo em tempo real, e AdminRolePermissionBackend dá o catálogo inteiro a role='admin' para a plataforma nunca ficar sem administrador.

*Alternativa descartada:* Copiar Cargo.permissoes_padrao para user_permissions (ver apps/accounts/auth_backends.py para o porquê)

`backend/config/settings.py:221-236`

**Duas flags de setor separadas (SETOR_SCOPING_ENABLED e SETOR_WRITE_ENFORCEMENT_ENABLED), ligadas uma de cada vez**

Primeiro se liga a visibilidade e se observa que ninguém perdeu tela; só depois se passa a recusar escrita. Ligar as duas juntas transformaria qualquer erro de classificação de setor em 'não consigo mais trabalhar', e no meio do expediente.

`backend/config/settings.py:238-249`

**Baldes de throttle SEPARADOS para leitura e escrita do feedback público**

Com um balde só, os GETs de 20 pessoas abrindo o mesmo link perene estouravam o limite e o cliente legítimo via 'Muitas tentativas em pouco tempo'. feedback_ip fica por IP (20 pessoas são 20 IPs); feedback_token 120/hour cobre ~3 aberturas por pessoa com o dobro de folga; feedback_envio 10/hour derruba o teto de vazão de ~720 KB/h para ~120 KB/h.

*Alternativa descartada:* Um escopo único para GET e POST

`backend/config/settings.py:276-293`

**Todo escopo de throttle usado precisa estar em DEFAULT_THROTTLE_RATES**

Escopo ausente faz o DRF levantar ImproperlyConfigured NA REQUISIÇÃO, não no boot — a falha aparece em produção, para o usuário, não no deploy.

`backend/config/settings.py:280-282`

**CORS_PREFLIGHT_MAX_AGE de 60s em dev e 86400s em prod**

O browser cacheia decisões negativas também: uma vez que o backend respondeu sem header CORS (ex.: um redirect 301 antes de algum fix), o navegador bloqueia requests por 24h sem refazer preflight. Em prod a origem é estável, então 24h é OK.

`backend/config/settings.py:329-334`

**CORS_ALLOWED_ORIGINS é obrigatório e levanta ImproperlyConfigured quando não é dev-runtime**

Em produção real (atrás de Traefik) não existe fallback aceitável — o silêncio viraria um app que simplesmente não conecta.

`backend/config/settings.py:319-325`

**django.setup() antes de instanciar o Celery, e reescrita explícita dos env vars CELERY_***

O settings.py é quem faz load_dotenv e reescreve '@redis:' para '@127.0.0.1:' em dev local. Como o Celery prioriza env vars sobre config_from_object, sem reescrever os.environ o worker usaria a URL original e não conectaria.

`backend/config/celery.py:7-19`

**CELERY_BROKER_CONNECTION_RETRY_ON_STARTUP=False e timeouts de 3s**

Evita erros quando o Redis não está rodando e faz falhar rápido — sem isso, um pedido HTTP que cria sprint com apply_async fica preso esperando o broker.

`backend/config/settings.py:440-447`

**CELERY_TASK_ALWAYS_EAGER como flag de dev**

Em dev local no Windows subir o worker é mais trabalhoso; com a flag, .delay() roda inline na request sem fila nem broker. NUNCA usar em produção — bloqueia a request.

`backend/config/settings.py:449-453`

**FEEDBACK_ESPERA_DIAS vive em um lugar só, sem coluna com a data derivada**

Como não há envio de e-mail, é esse prazo que dispara a mudança de etapa. Sem coluna derivada, mudar o número move também os pedidos já criados — comportamento desejado: uma regra só.

`backend/config/settings.py:463-469`

**FEEDBACK_RETENCAO_DIAS default 0 (limpeza DESLIGADA)**

O prazo de retenção é decisão de negócio, não default técnico. Quando ligado, apaga a RespostaFeedback inteira e preserva estado='respondido' + respondido_em no pedido: o fato e a data ficam (métrica), o dado pessoal some (LGPD).

`backend/config/settings.py:470-475`

**Guardar só o token do feedback no banco e montar a URL a partir de FEEDBACK_PUBLIC_BASE_URL**

A criação do pedido vem de um sinal, onde não há `request`. Guardando só o token, trocar de domínio não invalida nada já gravado. O https é explícito porque SECURE_SSL_REDIRECT=True em produção e um POST redirecionado por 301 perde o corpo em alguns clientes — e este link vai ser colado à mão no WhatsApp.

`backend/config/settings.py:476-485`

**Rota /api/feedback/<token>/ registrada no urls.py raiz, antes dos include()**

O urlconf termina no catch-all serve_spa: uma rota de API registrada depois não daria 404, daria index.html com HTTP 200 onde o front espera JSON — e a falha seria silenciosa. A PÁGINA (/feedback/<token>) não precisa de registro, o catch-all entrega a SPA e o React Router resolve.

`backend/config/urls.py:35-41 e backend/apps/feedbacks/urls.py:1-9`

**Token do feedback no PATH, não em query string**

Query string cai no access log e no header Referer enviado a terceiros.

`backend/config/urls.py:35-36`

**register/ e login/ registradas no urls.py raiz ANTES dos include()**

O router do accounts registra users/<pk>/ e capturaria users/register/ e users/login/ como se fossem detail de recurso.

`backend/config/urls.py:30-32`

**serve_media própria em vez de django.conf.urls.static.static()**

A view trata /media/ em dev E prod, com cache imutável e 304 — então dispensa o helper que só funciona em DEBUG.

`backend/config/urls.py:50-52`

**Cache imutável de 1 ano para /media/**

As fotos de perfil são salvas com nome único (uuid), então a URL muda sempre que a foto muda. Isso permite o browser cachear o avatar para sempre e não refazer o download a cada navegação — evitando a saturação que fazia alguns avatares não carregarem até dar F5. Para conteúdo não-público o cache vira 'private': um cache compartilhado (proxy/CDN) entregaria a cópia sem passar pela checagem de acesso.

`backend/config/views.py:10-19`

**media/reports/ devolve 404 sempre, e ANTES do teste de existência**

O nome do arquivo vem de BaseReport.filename, determinístico: título de um conjunto fixo de oito strings + timestamp com granularidade de MINUTO. Estar autenticado bastaria para varrer o mês e baixar o consolidado de outro setor. Um 403 (ou um 404 tardio) já confirmaria que o relatório de tal título foi gerado em tal minuto. O download legítimo passa por /api/reports/<id>/download|preview/, que filtra por user=request.user.

`backend/config/views.py:34-46, 79-83`

**serve_spa confere is_relative_to(frontend_dir) antes de abrir o arquivo**

O catch-all (?P<path>.*) entrega strings que o pathlib considera raiz ABSOLUTA ('C:/Windows/…' no Windows), e nesse caso o operador `/` DESCARTA o frontend_dir em vez de concatenar. Como serve_spa não exige autenticação, isso serviria qualquer arquivo do disco para quem nem está logado — e os guardas de '..' e barra inicial não pegam, porque a string não tem nenhum dos dois.

`backend/config/views.py:149-162`

**LoggingOriginValidator em vez do OriginValidator puro do Channels**

Espelha o comportamento mas registra warning quando rejeita (com origin, path e lista permitida) — facilita o diagnóstico em produção quando uma origem é negada.

`backend/config/asgi.py:64-85`

**Manter AuthMiddlewareStack mesmo sem nenhum consumer usar scope['user']**

Todos os consumers leem o token manualmente. O stack fica por compatibilidade com middlewares de terceiros que possam ler scope['user'].

`backend/config/asgi.py:88-90`

**Import do celery_app dentro de try/except ImportError**

Celery não instalado é OK para desenvolvimento — celery_app vira None em vez de derrubar o boot do Django.

`backend/config/__init__.py`

**beat com --schedule=/tmp/celerybeat-schedule no container**

É writável pelo USER appuser; em /app/backend o usuário não tinha permissão consistente para apagar/rotacionar o .bak.

`docker-compose.yml:135-137`

**Volume backend_media montado TAMBÉM no celery-worker**

CRÍTICO: o worker escreve os arquivos de relatório (apps.reports.tasks → BaseReport.render → job.file.save). Sem o volume, o backend não consegue ler os arquivos gerados pelo worker — FileNotFoundError em /api/reports/<id>/download/ e /preview/.

`docker-compose.yml:111-116`

**traefik.docker.network declarado explicitamente no serviço backend**

Diferente de um stack só-nginx, o backend está também na rede compose 'default'; sem a label o Traefik pode tentar o IP errado.

`docker-compose.yml:83-85`

### Filas, agendamentos e tempo real

**django.setup() e leitura do settings ANTES de instanciar a app Celery, com sobrescrita explícita de os.environ['CELERY_BROKER_URL'] e ['CELERY_RESULT_BACKEND']**

settings.py faz load_dotenv e reescreve '@redis:' para '@127.0.0.1:' quando o hostname do compose não resolve (dev local nativo). Como o Celery prioriza env vars sobre config_from_object, sem essa sobrescrita o worker usaria o hostname não resolvível e ignoraria a reescrita.

`backend/config/celery.py:7-19`

**broker_connection_retry_on_startup=False e CELERY_BROKER_CONNECTION_TIMEOUT=3 com socket_connect_timeout/socket_timeout=3**

Não tentar conectar ao broker na inicialização evita erros quando o Redis não está rodando; os timeouts curtos fazem falhar rápido para não deixar requisições HTTP presas ao publicar tasks (o comentário cita explicitamente o apply_async na criação de sprint).

`backend/config/settings.py:440-447`

**CELERY_TASK_ALWAYS_EAGER controlado por env var, default False**

Permite rodar tasks inline na request em dev local Windows, onde subir o worker dá mais trabalho. O comentário é explícito: NUNCA usar em produção, porque bloqueia a request.

`backend/config/settings.py:449-453`

**feedbacks-liberar-pedidos mudou de uma vez por dia às 06:10 para crontab(minute=1), de hora em hora**

A regra continua sendo por DIA (compara data_referencia com timezone.localdate()), mas rodar 1x/dia criava uma janela ruim: o dia virava à meia-noite, o pedido já estava vencido pela regra e o card só mudava de coluna seis horas depois — o contador dizia 'liberado hoje' enquanto o card seguia em 'Aguardando 30 dias'. De hora em hora promove logo após a virada (00:01) e se cura sozinho se uma execução falhar ou o worker cair, o que uma execução diária levaria 24h para fazer. A varredura é barata: SELECT por índice e no-op quando não há nada.

*Alternativa descartada:* manter crontab(hour=6, minute=10)

`backend/config/settings.py:509-526`

**limpar-relatorios-expirados às 03:30 e feedbacks-limpar-respostas às 03:45 (madrugada, escalonadas)**

Arquivo de relatório não sumia sozinho: a remoção só acontecia ao fim de um /download/ bem-sucedido, então quem usava /preview/ ou cancelava deixava o arquivo no disco para sempre (o autor achou 30 arquivos assim, o mais antigo de maio). A limpeza de feedbacks foi posta 'junto das demais limpezas'.

`backend/config/settings.py:496-502 e 527-532`

**finalizar-sprints-por-data no beat a cada 5 min mesmo existindo o agendamento por ETA**

É fallback de segurança para os casos em que o agendamento por ETA ao salvar a sprint falhe (Redis fora do ar na hora do apply_async, ETA perdido em restart do broker). O comentário deixa claro que o fechamento no instante correto usa Sprint.fechamento_em, não WeeklyPriorityConfig.

`backend/config/settings.py:503-508`

**O evento em tempo real de mudança de acesso não carrega o payload novo — o cliente refaz GET /users/me/**

Mantém o consumer burro e evita duplicar no backend a lógica de serialização e de visibilidade que já vive no DRF. Mesma razão para reaproveitar o grupo user_<id> das notificações em vez de abrir uma segunda conexão WebSocket.

`backend/apps/accounts/realtime.py:1-10`

**solicitacoes_changed é literalmente {'type': 'solicitacoes_changed'}, sem nenhum dado**

Quem decide o que cada pessoa enxerga da fila é o GET da API, que já passa por scope_card_reopen_requests / scope_card_date_change_requests. Mandar a linha serializada obrigaria o emissor a repetir aquela decisão de visibilidade fora de qualquer queryset — exatamente o erro que formularios/realtime.py teve de desfazer. Aqui o pior caso de errar o destinatário é um GET desperdiçado, não vazamento de conteúdo.

*Alternativa descartada:* enviar a solicitação serializada no evento

`backend/apps/projects/realtime.py:115-143`

**Destinatário do solicitacoes_changed é quem tem 'view_content', NÃO quem tem 'approve_card_reopen'**

As três abas e seus CONTADORES são renderizados para todo mundo; só Aprovar/Recusar é restrito. Avisar só quem aprova deixaria o contador velho para quase todas as sessões — o bug de volta para a maioria. O recorte por setor ali não protege conteúdo (não há conteúdo), protege CADÊNCIA: sem ele alguém do setor A mediria a frequência de reaberturas do setor B.

`backend/apps/projects/realtime.py:126-140`

**No kanban de suporte, o escopo passou a ser decidido na INSCRIÇÃO (vários grupos), não no push**

Com um grupo único global, o payload completo do chamado — descrição, empresa, e-mail do solicitante, texto da resolução — atravessava o channel layer (Redis em produção) e chegava ao processo do socket de quem não podia ver aquele chamado, sendo descartado só na ponta. Filtro de quem RECEBE não é isolamento: o dado já viajou, já passou pelo Redis e já esteve na memória do outro processo.

*Alternativa descartada:* grupo único + descarte no consumer (era o desenho anterior)

`backend/apps/formularios/realtime.py:1-36 e backend/apps/formularios/consumers.py:19-54`

**O grupo de posse usa SHA-256 do e-mail normalizado, e existe um grupo dedicado 'suporte_kanban_todos' em vez de inscrever o privilegiado em todos os setores**

O Channels só aceita [A-Za-z0-9._-] em nome de grupo (até 100 chars) e e-mail tem '@' e '+' — o hash é codificação, não sigilo (o espaço de e-mails é adivinhável), e de quebra evita gravar e-mail de usuário como chave no Redis. O grupo TODOS existe porque a lista de setores é resolvida no connect e ficaria congelada: um setor criado depois nunca chegaria a quem deveria ver tudo.

`backend/apps/formularios/realtime.py:29-53 e 70-85`

**get_channel_layer() é chamado DENTRO do try em projects/realtime.py e accounts/realtime.py**

Ele não só devolve None quando não há camada — ele LEVANTA quando a camada está configurada e não pode ser construída (BACKEND inexistente, CONFIG inválida, Redis fora do ar na instanciação). Como essas funções são chamadas do post_save do Card e de signals de User/UserSetor, a exceção subia pelo signal e derrubava a request: com o Redis mal configurado, mover um card no quadro respondia 500. Tempo real é melhoria de UX — a escrita já aconteceu e não se desfaz porque o WebSocket caiu.

`backend/apps/projects/realtime.py:42-51 e backend/apps/accounts/realtime.py:37-54`

**Envio em lotes de 100 com asyncio.gather em vez de um async_to_sync por usuário**

async_to_sync monta e desmonta um event loop por chamada; num cargo com 300 pessoas seriam 300 idas e voltas em série. Assim é UMA travessia sync→async por lote, com os envios do lote em paralelo. O return_exceptions=True garante que a falha de um usuário não cancela a dos outros — quem ficou sem o aviso descobre no próximo F5.

`backend/apps/accounts/realtime.py:19-73`

**Broadcast de kanban é no-op fora da sprint em andamento (_sprint_is_active)**

Alinha com o pedido do produto: só a sprint atual gera realtime.

`backend/apps/projects/realtime.py:19-30`

**Um broadcast por SPRINT afetada, não por card, na desatribuição em massa de conta desativada**

O payload é só o id do card + o ator e o cliente responde recarregando o widget; N eventos na mesma sprint seriam N recargas da mesma coisa. O envio vai em transaction.on_commit porque o contrato do realtime é 'cliente recebe o evento e refaz o GET' — emitir dentro da transação faria o cliente ler o estado anterior ao commit.

`backend/apps/projects/services.py:580-598`

**_avisar_painel_de_solicitacoes usa transaction.on_commit SEMPRE, mesmo onde hoje não há bloco atômico aberto**

O evento manda o cliente REFAZER o GET, então um aviso pré-commit faria ele ler o estado antigo (em approve, a fila voltaria com a linha que acabou de ser aprovada). Hoje os pontos de chamada já estão fora de blocos atômicos, mas isso é frágil: basta alguém definir ATOMIC_REQUESTS ou embrulhar uma action num atomic para o aviso virar evento fantasma. Fora de bloco atômico o on_commit executa imediatamente — o custo de usá-lo em todos os pontos é zero.

`backend/apps/projects/views.py:2104-2127`

**O gatilho do feedback observa o CARD virando 'finalizado', não o Project virando 'entregue'**

Os dados diziam que a primeira versão estava errada: dos 106 projetos do banco, os 106 estão em 'criado' e NENHUM tem data_entrega preenchida. Neste sistema o projeto é uma PASTA que agrupa cards; quem tem ciclo de vida, data de entrega e homologação é o CARD. Com o gatilho antigo nenhum pedido nasceria em produção e a feature ficaria inerte sem ninguém perceber, porque a falha é a AUSÊNCIA de algo.

*Alternativa descartada:* post_save em Project.status == 'entregue'

`backend/apps/feedbacks/signals.py:1-30 e backend/apps/feedbacks/estrutura.py:283-299`

**sender declarado como STRING 'projects.Card' nos receivers de feedbacks**

ModelSignal.connect aceita 'app_label.Model' e resolve preguiçosamente, então o módulo NÃO importa apps.projects no carregamento — a mesma regra que a fase 1 se impôs (a FK do motor também é declarada por string). Evita ciclo com projects/apps.py:ready.

`backend/apps/feedbacks/signals.py:18-21`

**gerar_pedido_do_card_finalizado é chamado por transaction.on_commit e engole TODAS as próprias exceções**

Um pedido criado numa transação que dê rollback deixaria um token vivo apontando para nada — e o link já é válido no instante em que nasce. E um callback de on_commit que levanta propaga para quem chamou o commit, ou seja, o PATCH do card responderia 500 COM O DADO JÁ GRAVADO. É falha silenciosa POR DESENHO, e o log é o único aviso.

`backend/apps/feedbacks/signals.py:101-109 e backend/apps/feedbacks/estrutura.py:293-299`

**notificar_transicao usa Card.objects.filter(...).update(), JAMAIS card.save()**

save() acordaria card_pre_save (um SELECT extra + apply_development_time_metrics) e card_created_or_updated (CardLog + notificações + broadcast realtime). Qualquer um deles pode levantar — e este hook roda com a exceção ENGOLIDA nos dois chamadores, logo o card ficaria na coluna errada CALADO. Mesmo motivo em _reconciliar_colunas_do_kanban.

`backend/apps/feedbacks/services.py:255-259 e backend/apps/feedbacks/tasks.py:105-108`

**A reconciliação do kanban roda no FIM da varredura que já existe, sem task nova nem entrada nova no beat**

Fecha o único buraco estrutural do hook: notificar_transicao roda DEPOIS do UPDATE de estado já commitado e sua exceção vira só log. Como o estado já saiu do valor que a varredura procura, a próxima execução não tenta de novo — sem a reconciliação, um pedido em 'aguardando_resposta' com o card parado em 'Aguardando 30 dias' ficaria assim PARA SEMPRE. É o que torna 'projeção' uma garantia, e não uma esperança.

`backend/apps/feedbacks/tasks.py:91-121`

**Idempotência do liberar_pedidos_no_prazo é o estado no WHERE do UPDATE, com o rowcount decidindo — sem lock externo**

O banco serializa duas execuções concorrentes e o hook de sincronização só dispara com rowcount == 1, nunca duas vezes para a mesma transição. Mesmo padrão de finalizar_sprints_por_data.

`backend/apps/feedbacks/tasks.py:39-44`

**O arquivo de relatório é gravado num subdiretório aleatório (uuid4().hex[:16]) e não com nome aleatório**

O nome devolvido por BaseReport.filename é determinístico (um de oito títulos fixos + timestamp com granularidade de MINUTO), então o caminho em MEDIA_ROOT seria enumerável por quem descobrisse outra porta para os arquivos de mídia — defesa em profundidade sobre o bloqueio de 'reports/' em config/views.py. O segmento aleatório vai no DIRETÓRIO porque o Content-Disposition sai de os.path.basename(job.file.name): o nome bonito que o usuário recebe continua o mesmo. 16 hex = 64 bits, curto de propósito porque FileField.max_length é 100 e o Django trunca o nome se o caminho estourar.

*Alternativa descartada:* sufixo aleatório no nome do arquivo

`backend/apps/reports/tasks.py:56-74`

**A limpeza de relatórios apaga o ARQUIVO mas preserva a LINHA do ReportJob; a de feedbacks apaga a RespostaFeedback inteira mas preserva estado e respondido_em no pedido**

Em ambos: o registro é auditoria (quem gerou o quê, o fato e a data), o peso e o risco estão no conteúdo. Em feedbacks isso também elimina a necessidade de uma coluna 'anonimizado_em'.

`backend/config/settings.py:458-461 e backend/apps/feedbacks/tasks.py:126-138`

**FEEDBACK_RETENCAO_DIAS=0 (desligado) é o default**

O prazo de retenção é decisão de negócio, não default técnico. Enquanto o usuário não definir o número, nada é apagado.

`backend/config/settings.py:470-475`

**A limpeza de respostas corta por RespostaFeedback.enviado_em, nunca pelo respondido_em do PEDIDO**

Com várias respostas por pedido, respondido_em congela no instante da PRIMEIRA resposta — filtrar por ele casaria TODAS as linhas daquele pedido, inclusive uma enviada HOJE, que seria apagada amanhã sem ter cumprido um dia sequer do prazo. Seria perda de dado do usuário disfarçada de LGPD.

`backend/apps/feedbacks/tasks.py:152-158`

**A limpeza de órfãos pula arquivos com mtime mais recente que o corte**

Um arquivo sendo gravado agora ainda não tem job apontando para ele; sem essa guarda a rotina o apagaria no meio da geração.

`backend/apps/reports/tasks.py:113-115 e 152-154`

**Sprint sistêmica (is_system) é excluída do agendamento por ETA em três lugares independentes: Sprint.save(), o management command e a própria task**

O fechamento_em dela é NOT NULL e fica ~100 anos no futuro. Agendar deixaria uma mensagem parada no broker e na memória do worker (que segura tarefas com ETA até a hora) por um século, para uma task que só responderia 'systemic'. A guarda dentro da task é cinto para ETAs publicados ANTES do deploy — ou por sprints que só depois viraram sistêmicas.

`backend/apps/projects/models.py:79-85, tasks.py:216-220, management/commands/agendar_fechamento_sprints_abertas.py:13-19`

**fechar_sprint_em_hora recusa fechar quando expected vs. stored divergem em mais de 120 segundos**

Se o fechamento_em foi alterado após o agendamento, o ETA antigo continua na fila; a tolerância de 120s separa 'a data mudou' de ruído de serialização/fuso.

`backend/apps/projects/tasks.py:232-234`

**O publish do ETA vai numa threading.Thread daemon dentro do transaction.on_commit**

Depois do commit a sprint já existe na BD; publicar no broker numa thread evita bloquear a resposta HTTP se o Redis estiver lento ou indisponível.

`backend/apps/projects/models.py:103-121`

**AuthMiddlewareStack é mantido no asgi.py mesmo sem nenhum consumer usar scope['user']**

Comentário explícito: todos os consumers leem o token manualmente; o middleware fica por compatibilidade com middlewares de terceiros que possam ler scope['user'].

`backend/config/asgi.py:88-90`

**LoggingOriginValidator em vez do OriginValidator puro do Channels**

Registra em log a origem rejeitada, o path e a lista permitida — facilita o diagnóstico em produção quando uma origem é negada (o OriginValidator padrão fecha o socket em silêncio).

`backend/config/asgi.py:64-85`

**Sprint inexistente e sprint inacessível fecham o WebSocket com o MESMO código 4003**

Separar os casos diria ao cliente quais ids de sprint existem. Entrar no grupo é receber toda movimentação de card daquela sprint em tempo real, e isso não aparece em tela nenhuma — sem escopo, saber o id bastaria para acompanhar a operação de outro setor sem deixar rastro.

`backend/apps/projects/consumers.py:156-167`

**SuporteKanbanConsumer aceita a conexão mesmo quando a lista de grupos sai vazia**

O usuário comum sem e-mail cadastrado não tem chamado que lhe pertença, mas a conexão em si é legítima e o ping/pong continua funcionando. Recusar ali só trocaria 'não recebe evento' por um ciclo de reconexão infinito no frontend.

`backend/apps/formularios/consumers.py:87-91`

**Evento duplicado no kanban de suporte (mesmo socket em dois grupos alvo) é tolerado de propósito**

O cliente faz upsert por id (upsertChamadoLista em frontend/src/pages/Support.tsx), então reaplicar o mesmo evento dá o mesmo estado. Deduplicar exigiria carregar id de mensagem e memória por socket para evitar um efeito que não existe.

`backend/apps/formularios/realtime.py:106-112`

**broadcast_chamado é fail-CLOSED (erro no roteamento = ninguém recebe), e por isso o id do payload é convertido com try/except**

Cair no grupo global 'para não perder o evento' reabriria justamente o vazamento que o módulo fecha — realtime é melhoria de UX, a tela recarrega pelo REST. Mas como em produção o payload nasce da resposta JSON do portal externo, o tipo do id é contrato de terceiro: um '"id": "42"' faria filter(pk=...) estourar ValueError e derrubaria o realtime de TODO mundo, silenciosamente.

`backend/apps/formularios/realtime.py:129-139 e 203-208`

**Destinatários de notificação passam por usuarios_que_alcancam (recorte por setor) — fail-open em três situações**

Notificação é o único caminho que ENTREGA o nome de uma sprint/card na tela de alguém sem passar por queryset escopado: quando o usuário abre /api/notifications/, a Notification já foi gravada com a mensagem dentro e o filtro é só usuario=request.user. O fail-open (flag desligada, objeto sem setor resolvível, erro inesperado) é deliberado: notificação que não chega é bug silencioso — ninguém abre chamado por não ter recebido um aviso que não sabia que existia.

`backend/apps/projects/signals.py:114-159`

**usuarios_com_permissao delega a resolução de quem tem a permissão para usuarios_com_perm_qs (app accounts)**

Antes a consulta era escrita à mão em signals.py e reproduzia apenas dois dos três caminhos de concessão — faltava o CARGO. Como Cargo.permissoes_padrao virou fonte de autoridade (CargoPermissionBackend), quem tinha a permissão só pelo cargo passava no has_perm e mesmo assim NÃO era notificado.

`backend/apps/projects/signals.py:37-64`

**As notificações de CardTodo e de CardLog foram REMOVIDAS**

Notificações sobre subtarefas eram muito ruidosas (Supervisores + Gerentes + Admins + Responsável). As de log foram removidas porque as notificações de atualização de card já mostram os dados alterados. Registros antigos permanecem no banco para histórico.

`backend/apps/projects/signals.py:966-972 e models.py:698-699`

**celery-beat roda com --schedule=/tmp/celerybeat-schedule**

É writable pelo USER appuser; em /app/backend o usuário não tinha permissão consistente para apagar/rotacionar o arquivo .bak do schedule.

`docker-compose.yml:135-137`

**celery-worker monta o volume backend_media**

Marcado como CRÍTICO no compose: o worker escreve os arquivos de relatório (generate_report → job.file.save). Sem o volume, o backend não consegue ler os arquivos gerados pelo worker (FileNotFoundError em /api/reports/<id>/download/ e /preview/).

`docker-compose.yml:111-116`

### Banco de dados

**Conta de usuário nunca é apagada — User.delete() desativa em vez de excluir**

"Toda a plataforma pendura histórico no usuário: sprints, projetos, cards, logs, anexos, score. Apagar a linha levaria isso junto, e o trabalho de uma pessoa que saiu continua sendo o acervo da empresa." Sobrescrito no MODEL e não só na API porque delete() também é alcançável pelo admin do Django e pelo shell — o offboarding tem que ser o mesmo caminho independentemente de por onde se chega.

*Alternativa descartada:* Bloquear só na API (deixaria shell/admin apagando de verdade)

`backend/apps/accounts/models.py:210-245`

**Sprint.supervisor é PROTECT, não CASCADE**

Comentário literal: "A sprint é acervo: continua no histórico depois que quem a criou sai da empresa. PROTECT porque Project.sprint e Card.projeto são CASCADE — apagar o supervisor levaria a sprint junto e, atrás dela, projetos e cards." Era CASCADE originalmente (projects/0001 e 0002); virou PROTECT em projects/0056.

`backend/apps/projects/models.py:20-28`

**WeeklyPriority.usuario é PROTECT, não SET_NULL**

"Aqui o usuário é o ALVO da prioridade (o autor é definido_por): sem ele o registro não quer dizer nada e a unicidade (usuario, card, semana_inicio) deixaria de valer, porque NULLs não colidem entre si. Daí PROTECT: a conta só sai depois que as prioridades dela saírem." Percorreu CASCADE (0051/0055) → PROTECT (0056).

`backend/apps/projects/models.py:913-923`

**Sprint/Project/Card.setor são PROTECT e o setor 'sem_setor' é is_system=True**

"Sendo de sistema, o setor padrão não pode ser excluído pela UI — o que é desejável, já que ele segura todo o conteúdo ainda não classificado e as FKs são PROTECT." A API força is_system=False em tudo que cria, então só o seed consegue marcar.

*Alternativa descartada:* SET_NULL nos setores (deixaria conteúdo órfão e invisível para o escopo, que é fail-closed)

`backend/apps/accounts/migrations/0016_seed_setor_padrao.py:7-13`

**PedidoFeedback.formulario é PROTECT e a definição do formulário NUNCA é editada — troca cria linha nova**

"apagar a definição tornaria as respostas gravadas ilegíveis" e "uma resposta gravada há seis meses continua legível contra a definição que a pessoa de fato viu na tela". A definição vive como JSON, o que faz trocar o formulário ser data migration e não schema migration.

`backend/apps/feedbacks/models.py:132-254`

**uniq_formulario_ativo_por_slug é UniqueConstraint PARCIAL (condition=Q(ativo=True))**

"Qual versão nasce nos pedidos novos. A constraint parcial abaixo garante que exista no máximo UMA ativa por slug — sem isso, a criação do pedido teria de escolher entre duas e a escolha seria arbitrária." É a única constraint parcial do repositório.

`backend/apps/feedbacks/models.py:181-200`

**RespostaFeedback.pedido deixou de ser OneToOne e virou FK — a unicidade foi REMOVIDA de propósito**

Pedido do usuário: "mais de um usuário deve poder responder o feedback". A migração usa AlterField e não RemoveField/AddField para não perder linha nenhuma: "No Postgres o SQL gerado é só DROP CONSTRAINT ...key + CREATE INDEX comum", conferido com sqlmigrate ANTES de aplicar. O freio que substitui o índice único é MAX_RESPOSTAS_POR_PEDIDO=100, política de aplicação, não de banco: "na 100ª resposta dois POSTs simultâneos podem gravar 101 linhas, e isso é irrelevante nessa escala".

`backend/apps/feedbacks/migrations/0008_respostas_multiplas.py e backend/apps/feedbacks/models.py:118-129`

**PedidoFeedback.card é OneToOne CASCADE; card_kanban é OneToOne SET_NULL**

"OneToOne porque a regra é UM formulário POR CARD: o índice único É a idempotência da criação. CASCADE porque, sem o card, a resposta não tem sujeito — e guardar dado pessoal órfão contraria a minimização da LGPD." Para o card de exibição: "SET_NULL e não CASCADE: apagar o card de EXIBIÇÃO não pode destruir a resposta."

`backend/apps/feedbacks/models.py:226-247`

**GeekDayGrupoSetor.setor é OneToOneField, e a tabela through é explícita em vez de M2M automático**

"um setor em dois grupos colocaria o mesmo usuário em dois sorteios, com dois current_cycle diferentes — não haveria resposta para 'esta pessoa já foi sorteada neste ciclo?'. Preferi o OneToOneField a um UniqueConstraint sobre a tabela automática porque a tabela automática não é declarável em Meta, e a tabela explícita ainda deixa o vínculo auditável (added_at)."

`backend/apps/geekday/models.py:40-74`

**GeekDayConfig → GeekDayGrupo por RenameModel (tabela preservada), não CreateModel**

"a tabela geekday_geekdayconfig existe em produção com o ciclo corrente, e recriar o model perderia esse estado (e com ele a noção de quem já foi sorteado no ciclo em curso)". A FK grupo do sorteio nasce nula (0005), é preenchida (0006) e só depois vira NOT NULL (0007) — três passos para migrar base com histórico sem perder linha.

`backend/apps/geekday/migrations/0005_geekdaygrupo.py`

**As tabelas de compartilhamento têm FK de verdade em vez de uma tabela genérica com id solto**

"Abstrata porque cada tipo de conteúdo tem a sua tabela: FK de verdade (indexada, com CASCADE) vale mais que uma tabela genérica com id solto." E o compartilhamento tem tabela própria em vez de M2M automático porque "emprestar para consulta e emprestar para trabalho são coisas diferentes, e sem o nível o dono não teria como escolher".

`backend/apps/accounts/models.py:272-308`

**O índice das tabelas de compartilhamento é (setor, nivel), nessa ordem**

"O escopo pergunta sempre 'quais itens o setor S enxerga?' — o índice segue essa ordem, e o nivel junto evita voltar à tabela no gate de escrita."

`backend/apps/projects/models.py:1436-1438`

**CardScoreValue guarda o valor INT bruto, não uma FK para ScoreCriterionOption**

"para que o histórico do card permaneça íntegro mesmo se o supervisor editar/remover opções depois".

`backend/apps/projects/models.py:1344-1349`

**Reabertura de card é um tipo de CardLog PRÓPRIO ('reaberto'), não um 'atualizado'**

"ressuscitar trabalho já encerrado é a exceção que alguém vai querer achar no histórico meses depois ('por que este card entregue voltou ao quadro?'). Enterrado dentro de 'atualizado' ele viraria mais uma linha de diff de campos, indistinguível de uma troca de prioridade."

`backend/apps/projects/models.py:653-658`

**CARD_STATUS_FECHADOS é definido pela NEGATIVA e NÃO usa KanbanStage.is_terminal**

"aquele flag hoje é só decoração de UI e KanbanStageViewSet só exige manage_global_kanban_stages no perform_create — qualquer um com view_content consegue virá-lo. Amarrar regra de negócio nele deixaria um não-privilegiado escolher, por exemplo, de quais cards o responsável some. Hoje as duas definições coincidem por causa do seed da migration 0028; se alguém criar uma etapa terminal customizada, ela é tratada como aberta."

`backend/apps/projects/models.py:235-247`

**Sprint.is_system foi INEVITÁVEL — nenhum valor de data resolveria os dois lados**

"os dois discriminadores que já existiam (finalizada e a janela data_inicio/fechamento_em) puxam para lados opostos. Com fechamento_em no PASSADO, _sprint_efetivamente_fechada trancaria todo card de feedback e finalizar_sprints_por_data fecharia a sprint sozinha; com ele no FUTURO — que é o valor que usamos — a sprint apareceria como 'em andamento' no menu, no Dashboard e como destino de replicação. Nenhum valor resolve os dois lados; a flag resolve."

`backend/apps/projects/models.py:30-49`

**PedidoFeedback.data_referencia é DateField, não DateTimeField**

"a granularidade é DIA e o motor não faz nenhuma conta de fuso. Com isso o bug UTC-vs-local das 21h à meia-noite que este projeto já teve fica impossível por CONSTRUÇÃO, não por disciplina."

`backend/apps/feedbacks/models.py:256-260`

**As migrações de dados reimplementam a regra em vez de importar a função do app**

"migration histórica não pode depender do código atual do app — se a função for renomeada ou mudar de módulo numa release futura, migrate num banco novo quebra no meio. O preço é esta duplicação, que é aceitável porque este arquivo está congelado: ele descreve o estado do banco em 2026-08, não a regra viva." Mesma razão em feedbacks/0003 ("ESTE ARQUIVO É GÊMEO DE apps/feedbacks/estrutura.py") e em projects/0060 (STATUS_FECHADOS inline).

`backend/apps/accounts/migrations/0020_backfill_regra_setor_padrao.py:19-23`

**Migrações antigas de seed viraram no-op em vez de serem apagadas**

"Mantida como no-op (em vez de removida) porque outras migrations dependem dela pelo nome — apagá-la quebraria o grafo em qualquer banco já migrado." Vale para accounts/0009 e accounts/0011.

`backend/apps/accounts/migrations/0011_seed_cargo_setor_catalog.py:1-13`

**Backfill de invariante é migração, não management command**

"a regra é 'conta desativada não segura card aberto', um invariante de produto que precisa valer no instante do deploy. Dependendo de alguém lembrar de rodar um comando, a entrega chega em produção com o problema visível no dia 1. Precedente da casa para backfill que faz parte da entrega: 0042_project_is_system_and_backfill."

`backend/apps/projects/migrations/0060_desatribuir_cards_de_inativos.py:1-10`

**A key da 4ª etapa de feedback é 'feedback_encerrado', não 'encerrado' nem 'finalizado'**

"'finalizado' está OCUPADA. É a etapa terminal dos projetos NORMAIS e o valor de CardStatus.FINALIZADO. KanbanStage.key é UNIQUE GLOBAL, então reusá-la faria o board de monitoramento e o board comum apontarem para a MESMA linha de etapa — e, pior, _card_edicao_restrita trata status='finalizado' como card travado, o que congelaria o arraste que este estado existe para permitir. 'encerrado' está livre, mas é genérica demais para um catálogo GLOBAL. 'feedback_encerrado' tem 18 caracteres e cabe em Card.status (max_length=20) COM folga."

`backend/apps/feedbacks/models.py:58-75`

**O setor do fluxo de monitoramento é 'monitoramento_feedbacks' e deliberadamente NÃO é 'sem_setor'**

"O balde de não classificados é o setor de todo usuário ainda não classificado, então ancorar o fluxo lá entregaria todo feedback da empresa — e a url_publica, que é a credencial da rota anônima — a qualquer conta não classificada assim que SETOR_SCOPING_ENABLED for ligada." Correção de um vazamento dormente de visibilidade.

`backend/apps/feedbacks/migrations/0003_seed_monitoramento.py:36-47`

**Anexos são gravados com nome UUID aleatório, preservando só a extensão**

"O arquivo é servido por /media/ sem exigir header (o SPA aponta um <a download> direto para ele), então o nome é a única barreira: gravado com o nome original, /media/card_anexos/contrato-cliente.pdf seria adivinhável de fora." O nome amigável fica em nome_original.

`backend/apps/projects/models.py:524-536 e backend/apps/formularios/models.py:107-116`

**geekday/0008 ressincroniza a sequência de ids do Postgres**

"Enquanto o model era singleton, a única linha entrava por get_or_create(pk=1) — um INSERT com id EXPLÍCITO, que no Postgres não avança a identity da coluna. A sequência ficou em 1 e ninguém notou... Sem este ajuste, o PRIMEIRO grupo novo tentaria nascer com id=1 e estouraria 'duplicate key value violates unique constraint' — reproduzido neste banco antes de existir esta migração."

`backend/apps/geekday/migrations/0008_sincroniza_sequencia_grupo.py`

**Cargo.permissoes_padrao é fonte de autoridade resolvida em has_perm, não permissões copiadas para user_permissions**

"o acesso efetivo de um usuário é a UNIÃO desta lista com as permissões personalizadas dele. Uma nunca sobrescreve a outra... editar esta lista muda o acesso de TODO MUNDO que tem o cargo, na hora." Consequência de banco: não há tabela de junção cargo↔permissão; o vínculo User↔Cargo é pela STRING User.role == Cargo.codename, sem FK.

`backend/apps/accounts/models.py:61-84`

### Frontend: rotas, estado, comunicação

**Autorização no frontend é SÓ por permissão granular (`hasPermission(user, codename)`), nunca por nome de cargo**

Gates por `user.role === 'supervisor'` impediam que um cargo criado pelo admin — CEO, Gerente, o que for — recebesse a mesma capacidade. O comentário afirma que não há checagem por cargo em lugar nenhum.

*Alternativa descartada:* Comparar `user.role` com nomes de cargo

`frontend/src/lib/permissions.ts`

**Quem não tem `view_content` vê a tela SemAcesso em vez de ser redirecionado para /painel**

O painel também exige view_content — redirecionar para lá seria laço infinito. A tela explica o que falta, que é a informação de que a pessoa precisa: ela não errou o caminho, ainda não foi liberada.

`frontend/src/App.tsx (PermissionRoute)`

**A rota /feedback/:token fica fora de PublicRoute E fora do bloco `path="/"`**

PublicRoute mandaria um funcionário logado para o painel (e quem abre o link pode estar logado no mesmo navegador), e o bloco `/` carregaria sidebar, notificações e WebSocket para um estranho. Também usa caminho literal em vez de ROUTES, porque routes.ts é da navegação interna e este link nunca é navegado de dentro do sistema.

`frontend/src/App.tsx (linhas 126-133)`

**feedbackService cria uma instância própria de axios, sem interceptors**

Dois defeitos concretos do cliente padrão na única rota anônima: o interceptor de request emprestaria a sessão do funcionário logado à chamada anônima, e o de response apagaria o localStorage e deslogaria da plataforma quem só abriu o link para responder.

*Alternativa descartada:* Reusar services/api.ts

`frontend/src/services/feedbackService.ts (linhas 3-19)`

**pedidoFeedbackService (autenticado) vive em arquivo separado de feedbackService (anônimo)**

Misturar os dois no mesmo arquivo faria alguém importar o axios errado um dia — e o erro seria mudo.

`frontend/src/services/pedidoFeedbackService.ts (linhas 5-13)`

**`refreshUser` tem identidade estável (useCallback sem dependências) e o value do AuthContext é memoizado**

O NotificationContext usa refreshUser como dependência do handler de permissions_changed e, por tabela, das callbacks do WebSocket. Se mudasse a cada render, cada refresh derrubaria e reabriria o socket — e os eventos empurrados durante a reconexão se perdem, que é justamente o que não pode acontecer com permissão.

`frontend/src/context/AuthContext.tsx (linhas 91-97, 158-173)`

**Falha de rede no refreshUser NÃO derruba a sessão**

Quando o servidor de fato recusa o token (401), o interceptor do axios já limpa o storage e redireciona. Zerar o `user` ali deslogava a pessoa por um blip — e o método roda a cada evento de permissão, então blip é questão de tempo.

`frontend/src/context/AuthContext.tsx (linhas 107-112)`

**authService.logout usa catch, não finally**

O finally limpava a sessão mas RE-LANÇAVA o erro, e como quem chama faz `void performLogout()` a rejeição virava 'Uncaught (in promise)' a cada saída com token já inválido. Sair não pode falhar: um 401 aqui significa que o token que se queria revogar já não valia.

`frontend/src/services/authService.ts (linhas 92-105)`

**O WebSocket global não tem número máximo de tentativas de reconexão (só teto de 30s no backoff)**

Por este socket chegam as mudanças de permissão; desistir dele em definitivo devolveria a plataforma ao 'recarregue a página para valer'. Um servidor fora do ar custa uma tentativa a cada 30s, e a aba volta sozinha quando ele levanta.

`frontend/src/hooks/useWebSocket.ts (linhas 32-37)`

**disconnect() zera o ref antes de mexer no socket e, se estiver em CONNECTING, descarta os handlers em vez de chamar close()**

Chamar close() em CONNECTING faz o navegador registrar 'WebSocket is closed before the connection is established' e disparar onerror + onclose 1006. Não é falha de nada (acontece a cada queda de sessão e a cada monta/desmonta do StrictMode), e ruído de erro que não corresponde a erro treina quem olha o console a ignorá-lo.

`frontend/src/hooks/useWebSocket.ts (linhas 164-198)`

**Toda RE-conexão do socket dispara onPermissionsChanged e onSolicitacoesChanged**

O servidor não reenvia o que empurrou enquanto o socket esteve fora. Quem estava com a aba ABERTA durante a queda ficaria com a permissão velha até um F5, porque o visibilitychange do AuthContext só cobre quem saiu e voltou da aba. Custa um GET /users/me/ por reconexão.

`frontend/src/hooks/useWebSocket.ts (linhas 78-92)`

**Eventos de solicitações são reemitidos como CustomEvent de window em vez de virarem API do contexto**

O provider não conhece o painel; a ponte já existia para 'notificationReceived' e Priorities.tsx já a consome. Uma API nova de contexto para um consumidor só seria superfície a mais sem ganho.

`frontend/src/context/NotificationContext.tsx (linhas 124-131)`

**O projeto 'Monitoramento de Feedbacks' é reconhecido pelo par de flags `is_system` do projeto + `sprint_detail.is_system`, nunca por nome**

Renomear o projeto pela interface não pode quebrar a tela. E não basta `sprint_detail.is_system` sozinho: um projeto criado à mão dentro da sprint sistêmica não é o de monitoramento. Perguntar à lista de sprints também não funciona — GET /sprints/ não devolve a sprint sistêmica.

*Alternativa descartada:* Casar pelo nome do projeto; ou olhar só a flag da sprint

`frontend/src/lib/monitoramentoFeedback.ts`

**`ehFluxoAutomatico` existe como função separada, e não como alias de `isProjetoMonitoramento`**

Para que o dia em que as duas divergirem seja uma edição óbvia ali, e não uma renomeação silenciosa espalhada pelas telas.

`frontend/src/lib/monitoramentoFeedback.ts`

**A sprint sistêmica é marcada por flag `is_system` em vez de casamento por nome**

Ela nunca fecha (finalizada=false, fechamento_em daqui a ~100 anos), então passaria por 'sprint em andamento' em todo lugar que decide isso por data — Sidebar, Dashboard, redirect de entrada e a própria lista de Sprints.

`frontend/src/services/sprintService.ts, frontend/src/lib/sprintFechamento.ts`

**O agrupamento por seção do feedback usa 'run consecutivo', não Set de seções**

`[...new Set(itens.map(i => i.secao))].map(s => itens.filter(...))` REORDENA e FUNDE runs não-adjacentes. Na versão 2 do formulário os 11 campos já vêm em runs perfeitos, então o resultado visual seria idêntico hoje — que é exatamente o que faria o defeito passar despercebido até a versão seguinte.

*Alternativa descartada:* Agrupar via Set + filter

`frontend/src/lib/feedbackSecoes.ts`

**METRICS_BUNDLE_CACHE_KEY mora em lib/cachedFetch.ts, não na página, e é versionada (`:v2`)**

Tem DOIS donos: Metrics.tsx grava e SprintDetails.tsx invalida a cada card mexido. Enquanto a string era repetida nos dois arquivos, mudar a versão num só quebrava a invalidação em silêncio. O sufixo :vN deve subir sempre que o FORMATO do bundle mudar, para descartar os payloads antigos do localStorage de todo mundo.

`frontend/src/lib/cachedFetch.ts (linhas 15-32)`

**A escrita do cache no localStorage é adiada por requestIdleCallback**

JSON.stringify + setItem de bundles grandes é síncrono e pode travar a main thread por >100ms. Se isso resolve no instante em que o usuário já navegou, a PÁGINA SEGUINTE trava ao montar.

`frontend/src/lib/cachedFetch.ts (linhas 65-78)`

**Sem source maps em produção**

Comentário no vite.config: evita expor lógica/path de código original. `sourcemap: mode !== 'production'`.

`frontend/vite.config.ts`

**O proxy /__formularios do Vite tem `ws: false`**

WebSocket ao portal costuma gerar ECONNABORTED no terminal (rede/firewall/fecho do cliente). O REST continua funcionando; novidades em Suporte em dev chegam por polling.

`frontend/vite.config.ts`

**getFormulariosApiBase LANÇA erro em produção sem configuração, em vez de usar fallback hardcoded**

Em produção a env var é exigida explicitamente. No build, a ausência de VITE_FORMULARIOS_PROXY_TARGET gera só um warning não fatal (o proxy de dev é desativado).

`frontend/src/services/formulariosApi.ts (linhas 76-80), frontend/vite.config.ts`

**reportService.downloadFile baixa via axios/blob em vez de window.open na downloadUrl**

O browser não envia o header Authorization num window.open. O mesmo vale para previewUrl e iframe.

`frontend/src/services/reportService.ts (linhas 80-122)`

**Colunas de feedback: `feedbacks` não entra em ReportType, fica numa união separada `ItemDeRelatorioId`**

ReportType é o contrato do que o BACKEND gera e entrega como arquivo; 'feedbacks' é um painel que se olha na tela, sem download. Ampliar ReportType faria o serviço prometer um arquivo que não existe.

`frontend/src/pages/Reports.tsx (linhas 12-19)`

**`getDevelopers()` (/users/?role=desenvolvedor) foi REMOVIDO, não consertado**

Recortava por NOME DE CARGO: um cargo novo com view_content (ex. 'Analista') ficava de fora e a lista morria em silêncio se o cargo fosse renomeado. O substituto é getParticipantes(), que recorta por permissão.

*Alternativa descartada:* Manter a variante por cargo

`frontend/src/services/userService.ts (linhas 136-149)`

**Não decidir 'esta pessoa trabalha?' olhando `User.permissions`**

Vem [] para quem NÃO gerencia usuários (o backend só revela o mapa para admin/gestor e para o próprio usuário). Use `participa_do_trabalho` via o helper `participaDoTrabalho`, que falha em aberto.

`frontend/src/services/userService.ts (linhas 37-56)`

**CSV exportado leva BOM UTF-8**

O Excel no Windows abre CSV como ANSI se não houver BOM, e os acentos ficam corrompidos.

`frontend/src/lib/exportCards.ts`

**xlsx é importado dinamicamente**

Reduz o impacto no build para quem não usa export XLSX.

`frontend/src/lib/exportCards.ts`

**A preferência de cores do Kanban usa a MESMA chave de localStorage na página da sprint e na do projeto**

A escolha é do usuário, não da tela. Mesmo raciocínio para a preferência de fluxos automáticos. Já a preferência do Suporte tem chave separada, para não acoplar.

`frontend/src/lib/kanbanCardDisplayPreference.ts, fluxosAutomaticosPreference.ts, suporteCardDisplayPreference.ts`

**Fluxos automáticos nascem VISÍVEIS (padrão ligado)**

O fluxo é trabalho de verdade — alguém precisa copiar o link e enviar. Nascer escondido faria a feature parecer quebrada para quem não sabe que a opção existe; quem se incomodar desliga.

`frontend/src/lib/fluxosAutomaticosPreference.ts`

**O token do feedback público vai por encodeURIComponent no caminho**

secrets.token_urlsafe só produz [A-Za-z0-9_-], mas um token digitado ou colado errado pode trazer `/` ou `?` e reescrever a rota chamada. Codificado, um token inválido bate no MESMO 404 de qualquer outro — a propriedade que o backend se esforça para manter.

`frontend/src/services/feedbackService.ts (linhas 147-157)`

**410 GONE é o gancho do feedback encerrado, não a string da mensagem**

Casar a string quebraria na primeira revisão do texto. O corpo traz `encerrado: true` pelo mesmo motivo, mas o status já basta e não depende de o corpo ter sido parseado.

`frontend/src/services/feedbackService.ts (linhas 118-128)`

**SLA de suporte: 24h corridas empurradas para fora do fim de semana, sem feriados**

Escolha pragmática, para não depender de lib externa. Não modela horário comercial (9h-18h) — qualquer hora do dia conta. O comentário diz que, se um dia for preciso, vale revisitar com date-fns/dayjs e arquivo de feriados.

*Alternativa descartada:* Modelar horário comercial e feriados

`frontend/src/lib/businessHours.ts`

**'Parado por pendências' é um marcador de texto (`__PENDENCIA_BWA__`) no início de descricao_resolucao**

A API de chamados só tem 4 status ('Aberto', 'Em andamento', 'Resolvido', 'Cancelado') e não há 'Em andamento parado'. O marcador é a forma canônica gravada na API.

`frontend/src/services/suporteService.ts (linhas 3-7)`

**A página de Perfil saiu das abas de Configurações**

As abas de Configurações são de gestão da plataforma; o perfil é da própria conta e todo usuário tem acesso, inclusive visitante. Fica na engrenagem do canto superior direito.

`frontend/src/pages/Perfil.tsx, frontend/src/pages/Settings.tsx`

**O interceptor de request remove Content-Type quando o body é FormData**

É preciso deixar o axios definir o Content-Type com o boundary do multipart; forçar application/json corromperia o upload. O mesmo é feito no formulariosApi.

`frontend/src/services/api.ts (linhas 31-34), frontend/src/services/formulariosApi.ts (linhas 137-139)`

**`Project.sprint_detail` é tipado como um recorte, não como o Sprint inteiro**

Tipar o objeto todo duplicaria o type Sprint e sairia do ar na primeira mudança do serializer, embora a API devolva o SprintSerializer completo.

`frontend/src/services/projectService.ts`

### Frontend: componentes e design system

**O socket de notificações não desiste nunca de reconectar; só limita o backoff a 30s**

Comentário no código: por este socket chegam as mudanças de permissão, e desistir devolveria a plataforma ao "recarregue a página para valer" — exatamente o que o tempo real existe para evitar. Um servidor fora do ar custa uma tentativa a cada 30s e a aba volta sozinha.

*Alternativa descartada:* Número máximo de tentativas, como fazem os dois hooks de Kanban (8)

`frontend/src/hooks/useWebSocket.ts (linhas 32-37)`

**Toda RE-conexão do socket global refaz /users/me/ e recarrega as solicitações**

O servidor não reenvia o que empurrou enquanto o socket esteve fora, e `permissions_changed` é o evento que não pode se perder: quem estava com a aba ABERTA durante a queda ficaria com a permissão velha até um F5 (a outra rede de segurança, o `visibilitychange` do AuthContext, só dispara para quem saiu e voltou da aba). O flag `jaConectouRef` distingue o primeiro `onopen` de uma reconexão.

`frontend/src/hooks/useWebSocket.ts (linhas 38-93)`

**Ao desconectar um socket ainda em CONNECTING, os handlers são anulados e o close só acontece no onopen**

Chamar `close()` durante o handshake faz o navegador registrar "WebSocket is closed before the connection is established" e disparar onerror + onclose 1006. Não é falha de nada (acontece a cada queda de sessão e no StrictMode em dev), e ruído de erro que não corresponde a erro treina quem olha o console a ignorá-lo.

`frontend/src/hooks/useWebSocket.ts (linhas 172-190)`

**O ref do socket é zerado ANTES de fechar, e onclose/onerror checam `wsRef.current !== ws`**

Sem isso, o fechamento do socket antigo agendaria uma reconexão que duplicaria o socket recém-aberto — e dois sockets no mesmo grupo entregariam cada notificação duas vezes.

`frontend/src/hooks/useWebSocket.ts (linhas 46-52, 127-148)`

**O autor da movimentação também recebe o evento card_moved; o filtro anti-eco fica no consumidor**

Quem moveu já atualizou o estado pelo PATCH otimista; reaplicar o evento causaria dupla atualização. O JSDoc do hook instrui explicitamente a comparar `actor_user_id === currentUser.id`.

`frontend/src/hooks/useSprintKanbanWebSocket.ts (linhas 25-34); uso em ProjectDetails.tsx (~859) e SprintDetails.tsx (~183)`

**O Kanban de Suporte reconecta ao voltar para a aba**

Comentário: se as 8 tentativas se esgotaram enquanto a aba dormia em background, o WS ficaria morto para sempre depois de ~24s de tela apagada.

`frontend/src/hooks/useSuporteKanbanWebSocket.ts (linhas 114-131)`

**As colunas do Kanban vêm inteiras do backend (kanban-config), o frontend nunca as monta**

Comentário no loadData: é aí que o recorte acontece — o board de monitoramento recebe só as 3 etapas de feedback, um projeto comum só as normais. Como o frontend não compõe a lista, as colunas não têm como vazar de um lado para o outro.

`frontend/src/pages/ProjectDetails.tsx (linhas 1105-1123)`

**Arrastar no fluxo de feedback envia PATCH com o corpo EXATAMENTE {status} e sem criar log**

Comentário extenso: o backend responde 403 a qualquer chave a mais — é assim que ele impede "arrastar e, de quebra, renomear". O board era projeção do pedido e ninguém movia nada à mão; isso mudou por pedido do usuário porque "Feedback Finalizado" só uma pessoa aciona e voltar de lá reabre o link. O backend escreve no PEDIDO antes de projetar no card — sem isso, a varredura noturna desfaria o arraste calada.

*Alternativa descartada:* Bloquear o arraste com um `return` seco, como era antes

`frontend/src/pages/ProjectDetails.tsx (linhas 1488-1531)`

**O estado local do card é atualizado ANTES do await do PATCH**

Comentário repetido três vezes no handleDragEnd: "Atualizar o estado local IMEDIATAMENTE para evitar animação de retorno" — sem isso o card volta visualmente à coluna de origem até a resposta chegar. Em caso de erro chama `loadData()` (no fluxo de feedback, reverte a coluna na hora antes de recarregar, porque o recarregamento é assíncrono e a peça ficaria no lugar errado).

`frontend/src/pages/ProjectDetails.tsx (linhas 1634-1699)`

**Estratégia de ordenação customizada no masonry de notas (noScaleRectSortingStrategy)**

O rectSortingStrategy padrão escala o card para caber no slot alvo; com cards de alturas heterogêneas (masonry estilo Keep) o vizinho estica/encolhe e fica visualmente péssimo. A cópia força scaleX/scaleY = 1 e mantém o reorder lógico idêntico.

`frontend/src/pages/MyTasks.tsx (linhas 614-638)`

**framer-motion foi REMOVIDO do item arrastável em Meus Afazeres**

Comentário: `layout`/`layoutId` brigavam com o transform do dnd-kit e distorciam o card (esticava para ocupar o slot anterior). Hoje é dnd-kit puro; a animação shared-element de pin↔unpin foi removida pelo mesmo motivo, e o código sugere reintroduzi-la num motion.div ao redor do container das seções, não no item. O prop `layoutId` continua na assinatura, descartado com `void layoutId`.

`frontend/src/pages/MyTasks.tsx (linhas 560-597)`

**O masonry usa colunas flex em round-robin, não CSS columns**

Comentário: assim o transform do dnd-kit pode mover itens dentro de cada coluna sem o browser recalcular layout e distorcer cards adjacentes.

`frontend/src/pages/MyTasks.tsx (linhas 666-694)`

**O max-height do dropdown é MEDIDO e entra como classe via custom property, não como style inline**

Dois motivos comentados: (a) um `70vh` cravado ou sobra espaço à toa ou continua passando da tela conforme a posição do gatilho, porque o menu é absolute logo abaixo dele; (b) style inline venceria SEMPRE, inclusive o `max-h-[280px]` que alguns menus já definem — como a classe vem antes de `className`, o twMerge deixa o chamador ganhar. A rolagem vive no elemento que tem a altura, senão um max-h do chamador só cortava os últimos itens sem barra.

`frontend/src/components/ui/dropdown-menu.tsx (linhas 134-197)`

**O click-outside do dropdown considera o wrapper inteiro (trigger + content), não só o content**

Sem isso, clicar no trigger gera mousedown→fecha seguido de click→reabre: flicker e toggle quebrado.

`frontend/src/components/ui/dropdown-menu.tsx (linhas 6-11, 110-123)`

**DropdownMenuItem ganhou `closeOnSelect`**

Itens de ALTERNÂNCIA (marcar/desmarcar, modo de visualização) transformam o menu num painel de ajustes; fechar a cada clique esconde justamente o efeito que a pessoa quer conferir e obriga a reabrir. Itens de AÇÃO continuam fechando, porque a tela muda de assunto.

`frontend/src/components/ui/dropdown-menu.tsx (linhas 218-231)`

**Checkbox e Switch não usam input nativo nem Radix**

Comentário no checkbox: o input nativo não é estilizável de forma consistente entre navegadores — o quadrado herdava a cor do sistema operacional. Ambos são `<button>` com `role` adequado e CSS vars do tema.

`frontend/src/components/ui/checkbox.tsx (linhas 18-24), frontend/src/components/ui/switch.tsx`

**O Dialog aceita `reserveRightPx`**

Quando a timeline do card (painel fixo de 480px à direita) está aberta, o backdrop precisa parar antes dela para o painel não ficar escurecido; o conteúdo do modal continua centralizado na viewport inteira. A constante `CARD_TIMELINE_LAYOUT_RESERVE_PX = 488` (right-[8px] + 480px) mora no próprio CardLogsModal.

`frontend/src/components/ui/dialog.tsx (linhas 12-19) e frontend/src/components/CardLogsModal.tsx (linha 17)`

**UserSelect resolve o valor gravado na lista COMPLETA, mas oferece só quem participa do trabalho**

Atribuir um card a quem não enxerga sprint/projeto/card cria trabalho que o destinatário nem abre — e grava isso na FK. Mas um card antigo cujo responsável virou Visitante (ou admin) precisa continuar mostrando o nome: resolver pelas opções deixaria o campo em branco e faria o usuário achar que o card perdeu o dono. A exclusão de admin é comportamento antigo mantido de propósito (admin é conta de administração, não de execução).

`frontend/src/components/ui/user-select.tsx (linhas 93-108)`

**FeedbackCardBloco, CardFeedbackSection e RespostaFeedbackItens são arquivos próprios**

Cada um é desenhado por DUAS telas diferentes (ProjectDetails/SprintDetails, ou quadro do projeto/aba Feedbacks de Relatórios). Com o trecho copiado, bastaria ajustar uma para o mesmo card/resposta aparecer diferente dependendo de onde a pessoa entrou — e ninguém notaria, porque as duas telas quase nunca são abertas lado a lado.

`frontend/src/components/FeedbackCardBloco.tsx, frontend/src/components/CardFeedbackSection.tsx, frontend/src/components/RespostaFeedbackItens.tsx`

**As tags do card de feedback são `flex w-full`, não `inline-flex`**

Como inline-flex elas encolhiam até o texto, e textos de comprimentos diferentes davam ao board uma borda serrilhada tag a tag. `flex w-full` faz a pílula virar uma FAIXA de largura e altura iguais em todos os cards. `min-w-0` + `truncate` no filho porque um item flex se recusa a encolher abaixo do próprio conteúdo e a linha longa vazaria a coluna.

`frontend/src/components/FeedbackCardBloco.tsx (linhas 29-46)`

**O FeedbackConsolidadoDialog copia o layout do UserPermissionsDialog**

Pedido explícito: mesma largura `max-w-5xl`, mesma grade `[minmax(0,340px)_minmax(0,1fr)]`, mesma borda entre colunas e cada coluna rolando por si com `min-h-0` nas duas — sem o min-h-0 a coluna mais alta empurra a grade além do max-h e o rodapé some. Clicar num card do fluxo abre ISTO e não o formulário de edição, porque o backend recusa qualquer campo que não seja `status`: abrir um formulário editável ali era oferecer o que não existe.

`frontend/src/components/FeedbackConsolidadoDialog.tsx (linhas 24-45)`

**O card do projeto sistêmico pinta o degradê da marca POR CIMA da cor de superfície do tema**

Comentário no CSS: a superfície fica por baixo e o degradê translúcido por cima — é o que mantém o texto legível e o card coerente em claro e escuro. O card precisa ficar LEVEMENTE diferente dos projetos de trabalho, não virar um banner. No escuro o mesmo alfa desaparece contra o fundo, então sobe de 0.12 para 0.28/0.20.

`frontend/src/index.css (linhas 163-185)`

**A animação de saída dos fluxos automáticos usa `forwards` e anima max-width junto com opacidade**

Sem animar max-width o vizinho salta na hora e a transição de opacidade sozinha pareceria um piscar; sem `forwards` o elemento pisca de volta ao estado inicial no último quadro, antes de o React desmontá-lo.

`frontend/src/index.css (linhas 187-209)`

**A troca de tela do formulário público anima só a entrada**

As duas telas ocupam o mesmo espaço no cartão; animar as duas exigiria posicionamento absoluto e um salto de altura. A entrada sozinha já dá a leitura de "avançou um passo".

`frontend/src/index.css (linhas 239-249)`

**O painel de vidro tem fallback @supports para navegador sem backdrop-filter**

Sem o desfoque do que está atrás, o cartão semitransparente vira um retângulo ilegível por cima das manchas do fundo; o fallback cai num cartão sólido. O `saturate(1.3)` evita que o desfoque lave as cores das manchas.

`frontend/src/index.css (linhas 269-295)`

**O anel de campo obrigatório anima só a OPACIDADE do box-shadow, com spread fixo de 1px**

Assim ele aparece/desaparece sem crescer, o que evitaria empurrar o layout. Sob prefers-reduced-motion vira um anel estático.

`frontend/src/index.css (linhas 313-328) e ProjectDetails.tsx (linhas 839-843)`

**A rota do formulário público fica FORA de PublicRoute e fora do bloco com Layout**

PublicRoute mandaria um funcionário logado para o painel (e quem abre o link pode estar logado no mesmo navegador), e o bloco privado carregaria sidebar, notificações e WebSocket para um estranho. O caminho é literal e não vem de routes.ts porque o link nunca é navegado de dentro do sistema — é copiado e enviado à mão.

`frontend/src/App.tsx (linhas 126-133)`

**Quem não tem view_content vê a tela SemAcesso em vez de ser redirecionado**

O painel também exige view_content, então redirecionar para lá seria um laço infinito. A tela explica o que falta, que é a informação de que essa pessoa precisa: ela não errou o caminho, ainda não foi liberada.

`frontend/src/App.tsx (linhas 92-121)`

**O ReportPreviewDialog busca o PDF por axios e o injeta no iframe como blob:**

Um `src` apontando direto para /preview/ faz o iframe requisitar sem os headers do JS (Authorization); o backend responde 401 + página de erro com X-Frame-Options: deny, e o resultado é um quadrado vazio.

`frontend/src/components/reports/ReportPreviewDialog.tsx (linhas 14-24)`

**O botão de sair fica FORA do link de perfil na sidebar**

Comentário: senão sair navegaria para o perfil no mesmo clique.

`frontend/src/components/layout/Sidebar.tsx (linhas 218-219)`

**A navegação da sidebar filtra por `requires: 'view_content'`, mas Suporte e o perfil ficam fora da lista**

view_content é o piso de leitura do trabalho — sem ela a API devolve 403 em sprint/projeto/card e mostrar o item levaria a uma tela de erro. Suporte fica fora porque alguém sem acesso precisa conseguir PEDIR acesso.

`frontend/src/components/layout/Sidebar.tsx (linhas 14-30)`

**Cores e rótulos de cargo/setor vêm de um cache client-side alimentado pelo backend**

Substitui mapas hard-coded, com fallback para a paleta legada e para cinza para funcionar antes de o cache carregar. `listarSetoresDoUsuario` prefere o array `setores` (já ordenado e com cor embutida) justamente para um setor criado há dez segundos sair com a cor certa sem esperar o catálogo recarregar.

`frontend/src/lib/catalog-style.ts`

**Sem source maps no build de produção**

Comentário no vite.config: evita expor lógica/caminho do código original.

`frontend/vite.config.ts (linhas 18-21)`

### Infraestrutura, Docker e CI/CD

**Build multi-stage: o frontend é buildado dentro da imagem e só o `dist/` vai para o estágio final Python.**

Uma imagem só serve tudo — a SPA é entregue pelo próprio Django (serve_spa lê FRONTEND_BUILD_DIR). Não existe container nginx nem serviço `frontend` no compose.

*Alternativa descartada:* Serviço de frontend separado (nginx). O README e as mensagens do deploy.sh ainda falam em 'frontend' como se fosse um serviço — resíduo dessa alternativa.

`Dockerfile:1-18, docker-compose.yml`

**O estágio de build do frontend roda como root, ao contrário do estágio final.**

Comentário no Dockerfile: 'Build stage é descartado (só dist/ vai pra imagem final). USER não-root aqui só introduzia bug de permissão de diretório sem ganho de segurança real.'

`Dockerfile:8-9`

**Instalar libpango, libpangoft2, libcairo, libgdk-pixbuf, libffi8, shared-mime-info e fonts-liberation na imagem final.**

WeasyPrint exige essas libs, e 'PDF não embed fontes do sistema sem isso e os relatórios saem com a fonte default feia'. fonts-noto-color-emoji é opcional, para emojis no PDF.

`Dockerfile:25-27`

**ENV DOTENV_OVERRIDE=false dentro da imagem.**

Faz o `env_file` do Compose sobrepor qualquer .env que estivesse dentro da imagem. Em dev (variável ausente) o padrão é `true`, e o backend/.env prevalece sobre o ambiente da IDE.

`Dockerfile:53-54, backend/config/settings.py:18-30`

**Redis com senha obrigatória, sem persistência (--save "" --appendonly no) e protected-mode.**

É broker/channel layer apenas — não guarda estado que precise sobreviver a restart. Comentário: 'Sem persistência em disco (broker apenas)'.

*Alternativa descartada:* Persistência RDB/AOF. Nota: o volume `redis_data:/data` continua declarado mesmo sem persistência.

`docker-compose.yml:34-35`

**Porta do Postgres publicada SEMPRE em 127.0.0.1 (`127.0.0.1:${POSTGRES_PORT:-5433}:5432`).**

Comentário: 'Bind LOCALHOST sempre. Exposição externa só via Traefik (não pelo Postgres).'

`docker-compose.yml:20-21`

**Label `traefik.docker.network=${TRAEFIK_NETWORK:-web}` é obrigatória neste stack.**

Comentário: 'Obrigatório aqui (diferente do stack só-nginx): o backend está também na rede compose "default"; sem isto o Traefik pode tentar IP errado. O outro projeto só usa "web".'

`docker-compose.yml:83-84`

**O volume `backend_media` é montado também no celery-worker.**

Marcado como CRÍTICO no compose: o worker é quem escreve os arquivos de relatório (apps.reports.tasks → BaseReport.render → job.file.save). Sem o volume compartilhado, o backend não lê os arquivos gerados e /api/reports/<id>/download/ e /preview/ estouram FileNotFoundError.

`docker-compose.yml:111-116`

**celery-beat grava o schedule em /tmp/celerybeat-schedule.**

Comentário: 'writable como USER appuser (em /app/backend o user ainda não tinha permissão consistente para apagar/rotacionar o .bak)'.

`docker-compose.yml:135-137`

**A flag DEPLOY_LAN_EXPOSE=1 foi REMOVIDA do deploy.sh e agora aborta com erro se alguém tentar usá-la.**

Comentário: 'por publicar :8000 em 0.0.0.0 sem TLS (vetor de takeover)'. A recomendação é configurar HOST_BIND no .env com o IP específico da LAN ou usar Traefik+TLS.

*Alternativa descartada:* Publicar a porta 8000 em 0.0.0.0 para acesso em rede local.

`deploy.sh:106-117`

**`!frontend/.env.production` é exceção explícita no .dockerignore.**

Comentário: 'o Vite lê automaticamente durante `npx vite build`. Sem ele, VITE_FORMULARIOS_API_BASE fica indefinido e a página de Suporte quebra em runtime ("defina VITE_FORMULARIOS_PROXY_THROUGH_DJANGO...")'.

`.dockerignore:13-16`

**docker-publish.yml filtra por paths (Dockerfile, backend/**, frontend/**, .env, .dockerignore, o próprio workflow).**

Comentário: 'Só rebuilda quando algo relevante muda. Mudanças em docs/scripts não disparam build (economiza tempo + minutos do Actions).'

`.github/workflows/docker-publish.yml:12-13`

**Deploy por SSH (appleboy/ssh-action) em vez do 'Compose by URL' do Docker Manager da Hostinger.**

Comentário no cabeçalho do workflow: o Compose by URL 'estava perdendo o YAML'.

*Alternativa descartada:* Docker Manager da Hostinger com Compose by URL.

`.github/workflows/hostinger-deploy.yml:3-4`

**backup-diario.sh é invocado no cron por `bash /opt/bwa_tech/scripts/backup-diario.sh`, não pelo caminho direto.**

Comentário: 'o repositório é clonado a partir de uma máquina Windows (core.fileMode=false), então o bit de execução não sobrevive ao `git pull` e o cron falharia em silêncio com Permission denied'.

`scripts/backup-diario.sh:11-12`

**O backup escreve em `.parcial` e só renomeia depois de validar tamanho; a retenção só roda depois do dump aprovado.**

Comentário: 'Backup vazio/truncado é pior que backup nenhum: passa despercebido até a hora do rollback' e 'se o backup do dia falhou, os antigos ficam intactos'. Arquivo reprovado vira `.suspeito`, fora do padrão de nome que serve de referência de tamanho, para que um dump ruim não vire a base do dia seguinte.

`scripts/backup-diario.sh:117-118, 176-184, 204-206`

**A retenção usa um glob restrito ao prefixo `bwa_tech_diario_`.**

Comentário: 'a retenção só apaga arquivos que casem com ele, nunca toca nos dumps manuais (bwaproj_prod_*) que alguém deixou na mesma pasta'.

`scripts/backup-diario.sh:54-58`

**`find -mtime +N` na retenção guarda um dia a mais do que o pedido.**

Comentário explícito: 'na dúvida entre apagar cedo e guardar demais, guarda-se demais'.

`scripts/backup-diario.sh:205-206`

**docker-compose.override.yml expõe só a porta 6379 do Redis e é gitignored.**

Comentário: permite ao worker Celery rodado NATIVAMENTE (fora do compose, em dev) conectar em redis://...@127.0.0.1:6379/0. 'Em produção (Hostinger), este arquivo NÃO existe — o Redis fica exclusivamente na network interna do compose'.

`docker-compose.override.yml:1-18, .gitignore:69-70`

**settings.py usa `socket.gethostbyname('redis')` como detector de 'estou dentro do compose ou não'.**

Duplamente: (1) se não resolve, força BEHIND_HTTPS_PROXY=False — 'Sem isso, SECURE_SSL_REDIRECT redireciona HTTP→HTTPS local quebrando preflight CORS (logins via http://localhost:5173 falham)'; (2) reescreve `@redis:` → `@127.0.0.1:` nas URLs do Celery e do channel layer.

`backend/config/settings.py:59-69, 393-401, 424-435`

**config/celery.py chama django.setup() e reescreve os.environ['CELERY_BROKER_URL'] ANTES de instanciar o Celery.**

Comentário: 'o Celery prioriza env vars sobre config_from_object' — sem reescrever a env var, a reescrita `@redis:`→`@127.0.0.1:` feita no settings.py seria ignorada em dev.

`backend/config/celery.py:7-19`

**Existe um scripts/compose-project-name.sh só para resolver o nome do projeto Compose.**

Produção usa COMPOSE_PROJECT_NAME=bwa_tech (definido no hostinger-deploy.yml) e o deploy local usa `bwaproj` (deploy.sh/deploy.bat). Como o nome do projeto define o namespace dos volumes e containers, os scripts de dump/restore precisam adivinhar corretamente qual stack está rodando.

`scripts/compose-project-name.sh:1-34`

### Varredura de completude

**O backup diário é invocado no cron como `bash /opt/bwa_tech/scripts/backup-diario.sh`, não pelo caminho direto**

O repositório é clonado a partir de uma máquina Windows (core.fileMode=false), então o bit de execução não sobrevive ao `git pull` e o cron falharia em silêncio com 'Permission denied'.

`scripts/backup-diario.sh (linhas 10-12)`

**O dump é escrito em `.parcial` e só renomeado no fim; se reprovar na validação vira `.suspeito`, fora do glob de referência**

Um dump interrompido nunca pode virar um arquivo com cara de backup bom e, pior, a referência de tamanho do dia seguinte. Backup vazio ou truncado é pior que backup nenhum: passa despercebido até a hora do rollback.

*Alternativa descartada:* Escrever direto no arquivo final e confiar no exit code do pg_dump

`scripts/backup-diario.sh (linhas 117-119, 176-184)`

**A retenção só roda depois do dump do dia ser aprovado, e o `-mtime +N` guarda um dia a mais que o pedido**

Se o backup do dia falhou, os antigos ficam intactos. Na dúvida entre apagar cedo e guardar demais, guarda-se demais.

`scripts/backup-diario.sh (linhas 204-212)`

**O prefixo dos backups automáticos é `bwa_tech_diario` e a retenção só apaga arquivos que casem com ele**

Nunca tocar nos dumps manuais (`bwaproj_prod_*`) que alguém deixou na mesma pasta.

`scripts/backup-diario.sh (linhas 54-58)`

**O agendamento de fechamento por ETA filtra `is_system=False`**

A sprint sistêmica (âncora do 'Monitoramento de feedbacks') NUNCA fecha, e o `fechamento_em` dela fica ~100 anos no futuro só porque a coluna é NOT NULL. Agendar um ETA para ela deixaria uma mensagem parada no broker — e na memória do worker, que segura tarefas com ETA até a hora — por um século, para uma task que só responde 'systemic'.

`backend/apps/projects/management/commands/agendar_fechamento_sprints_abertas.py (linhas 12-19)`

**A busca da 'sprint em andamento' no consolidador também exclui `is_system=False`**

A sprint sistêmica satisfaz 'em andamento' por construção (nunca finaliza, fechamento ~100 anos à frente) e seria eleita alvo quando não houvesse sprint real aberta. Ela não é ciclo de trabalho e não tem projeto duplicado para consolidar.

`backend/apps/projects/management/commands/consolidar_projetos_sprint_atual.py (linhas 51-58)`

**O `--dry-run` do limpar_relatorios reimplementa a regra da task em vez de reutilizá-la com um parâmetro**

Um dry-run que chamasse a task com um parâmetro extra correria o risco de divergir do caminho real por um `if` mal posicionado — e um dry-run que mente é pior que não ter dry-run.

*Alternativa descartada:* Passar um flag `dry_run=True` para dentro de limpar_relatorios_expirados

`backend/apps/reports/management/commands/limpar_relatorios.py (método _relatar)`

**O migrate_legacy_cargos usa `save(update_fields=['role','updated_at'])` por usuário em vez de um `.update()` em lote, e NUNCA chama user_permissions.set()/clear()**

O save() dispara o signal `user_role_changed` (histórico/notificação), que um update em lote pularia. E não tocar em user_permissions é o que garante literalmente 'mesmas permissões' exigido pelo requisito (C) — usuários no mesmo cargo Desenvolvedor podem ter conjuntos diferentes, o que é coerente no modelo por usuário.

*Alternativa descartada:* queryset.update(role=...) em lote

`backend/apps/accounts/management/commands/migrate_legacy_cargos.py`

**Os cargos legados não são apagados na migração; `--delete-empty-cargos` é um segundo passo separado**

Apagar deixaria `User.role` órfão. É rede de segurança — o command imprime 'Cargos legados NÃO apagados (rede de segurança). Use --delete-empty-cargos após dias estáveis.'

`backend/apps/accounts/management/commands/migrate_legacy_cargos.py`

**Os commands de seed NÃO removem usuários legados (dev, gerente, supervisor)**

Sprint.supervisor é on_delete=CASCADE, então apagar um usuário que supervisiona sprints leva junto as sprints dele e, por Project.sprint, os cards. Para tirar alguém de circulação usa-se is_active=False pela tela de usuários.

*Alternativa descartada:* Limpar usuários legados no seed

`backend/apps/accounts/management/commands/seed_dados_users.py (linhas 8-13)`

**Usuários criados pelos seeds nascem com Role.VISITANTE**

Visitante é o cargo padrão do sistema; o cargo real e o setor são atribuídos manualmente pelo admin.

`backend/apps/accounts/management/commands/seed_new_users.py, seed_dados_users.py`

**`Sprint` é a autoridade de setor e o valor é denormalizado até o `Card`**

CardViewSet.metrics lê a base inteira de cards com .only() e alimenta on-time/cycle time/throughput/heatmap. Escopar com `WHERE card.setor_id IN (...)` indexado é o filtro mais barato e à prova de vazamento; o join `projeto__sprint__setor` no volume de cards seria o gargalo. Leituras de setor são constantes, escritas raras.

*Alternativa descartada:* Resolver o setor por join a partir da sprint em cada consulta

`PLANO_SETORES_CARGOS.md (seção 2.4)`

**`Card.setor` é espelho puro de `projeto.setor`, nunca editável direto**

Resolve 'card que muda de projeto' sem ambiguidade. Compartilhamento nunca é card-a-card (ingovernável com 200+ usuários), sempre em Sprint/Project — a granularidade que o requisito pede.

`PLANO_SETORES_CARGOS.md (seção 2.4)`

**Compartilhamento entre setores é M2M por objeto (`setores_compartilhados`), não matriz N×N**

Um só mecanismo cobre os dois lados: por padrão cada setor vê apenas os próprios dados (fail-closed), e 'escolher quais dados compartilhar' é marcar o M2M numa sprint/projeto específico. A matriz N×N é mais grossa, introduz um segundo modelo consultado nos 15 pontos quentes sem cache e não atende 'quais dados'.

*Alternativa descartada:* Modelo SetorAcesso com matriz N×N entre setores

`PLANO_SETORES_CARGOS.md (seção 2.5)`

**O cargo `desenvolvedor` reutiliza o codename existente em vez de criar um novo**

Project.desenvolvedor tem limit_choices_to={'role':'desenvolvedor'} e userService.getDevelopers() faz GET /users/?role=desenvolvedor. Reutilizar o codename mantém esses pontos válidos sem refação de schema.

`PLANO_SETORES_CARGOS.md (seção 2.3)`

**O template de permissões do cargo (`permissoes_padrao`) nunca re-propaga automaticamente**

A autoridade permanece 100% em user_permissions. Editar o template não altera permissões de ninguém já existente; aplicar só acontece quando o operador marca explicitamente. Isso preserva a invariância exigida por (C) e ainda dá ao Supervisor recém-atribuído um caminho para receber as 19 permissões.

`PLANO_SETORES_CARGOS.md (seção 2.2)`

**Fora de escopo vira 404, nunca 403**

Vazamento de existência: escopo aplicado no get_queryset faz o objeto simplesmente não existir para o DRF, então o 404 sai naturalmente.

`PLANO_SETORES_CARGOS.md (seção 7, risco 5)`

**O escopo por setor é sempre aplicado no backend; o front só esconde UI**

Front filtrando sozinho não satisfaz 'não ver dado sensível' — o payload já chegou ao browser.

`PLANO_SETORES_CARGOS.md (seção 7, risco 18)`

**O app `teams` é exportado para JSON antes do drop das tabelas**

Fase 6 substituiu o organograma ReactFlow pelo mural read-only por setor (People.tsx). O command preserva os dados antes do drop, para consulta histórica ou reimportação manual. (No PLANO, seção 8 pergunta 7, essa preservação era uma decisão em aberto — o command resolve pelo lado de preservar.)

`backend/apps/teams/management/commands/export_hierarchy.py (docstring)`

**O helper de testes dos feedbacks chama-se `_apoio_testes.py` e não `test_*`**

O runner do Django descobre por `test*.py`; assim o módulo é importado como apoio e nunca coletado. E o payload é DERIVADO da definição ativa: quando a versão 2 do formulário entrou, trinta testes de motor quebraram de uma vez por chave desconhecida — com o helper, uma versão 3 não quebra os testes que não são sobre conteúdo.

`backend/apps/feedbacks/_apoio_testes.py (docstring)`

**O `.dockerignore` abre exceção explícita para `frontend/.env.production`**

O Vite lê o arquivo automaticamente durante `npx vite build`. Sem ele, VITE_FORMULARIOS_API_BASE fica indefinido e a página de Suporte quebra em runtime com 'defina VITE_FORMULARIOS_PROXY_THROUGH_DJANGO...'.

`.dockerignore`

**O estágio de build do frontend no Dockerfile roda como root**

O estágio é descartado (só dist/ vai para a imagem final). USER não-root ali só introduziria bug de permissão de diretório sem ganho de segurança real. A imagem final roda como appuser UID/GID 10001.

`Dockerfile`

**O Dockerfile instala libpango, libcairo, libgdk-pixbuf, libffi e fonts-liberation**

WeasyPrint exige essas libs, e sem fonts-liberation o PDF não embute fontes do sistema — os relatórios saem com a fonte default feia.

`Dockerfile`

**`daphne` vem antes de `django.contrib.staticfiles` no INSTALLED_APPS**

Para que `runserver` use o ASGI handler (com WebSocket via Channels) em vez do WSGI puro.

`backend/config/settings.py (linhas 79-81)`

**O settings carrega dois .env: `backend/.env` com override e a raiz `BWA_Tech/.env` sem override**

Em dev o runserver precisa ler o .env da raiz, onde ficam REDIS_PASSWORD, CELERY_BROKER_URL e demais valores compartilhados entre serviços do compose — mas sem sobrescrever o backend/.env. Em produção esse .env é injetado pelo Compose via env_file e o segundo load é no-op. DOTENV_OVERRIDE=false na imagem Docker deixa o env_file do Compose prevalecer.

`backend/config/settings.py (linhas 18-30), Dockerfile (ENV DOTENV_OVERRIDE=false)`

**Sem source maps no build de produção do Vite**

Evita expor lógica e caminho de código original.

`frontend/vite.config.ts (linhas 18-21)`

**`docker-compose.override.yml` é gitignored e existe só em dev**

Em produção (Hostinger) o Redis fica exclusivamente na network interna do compose, sem porta exposta, e o worker roda dentro do compose usando o hostname `redis`. Em dev o override publica 127.0.0.1:6379 para o worker nativo (fora do compose) conseguir conectar.

`docker-compose.override.yml (cabeçalho), .gitignore`

**O workflow de build filtra paths**

Só rebuilda quando algo relevante muda; mudanças em docs e scripts não disparam build, economizando tempo e minutos do Actions.

`.github/workflows/docker-publish.yml`

**`deploy.bat`/`deploy.sh` exigem ADMIN_USERNAME/ADMIN_PASSWORD/ADMIN_EMAIL por variável de ambiente e abortam sem elas**

Tira as credenciais do superadmin de dentro do script versionado. A sugestão embutida é `ADMIN_PASSWORD=$(openssl rand -base64 24)`.

`deploy.sh (linhas 27-38), deploy.bat`

---
