# Banco de dados

> Parte da [Documentação de Arquitetura do BWA Tech](README.md).
> Levantada por leitura direta do código; o que não foi confirmado está
> em [Riscos e lacunas](12-riscos-e-lacunas.md).


## Banco de dados

A camada de banco do BWA Tech é Django ORM puro sobre PostgreSQL 16 em produção e SQLite em desenvolvimento (`config/settings.py:147` — a escolha depende da env `USE_POSTGRES`, default False). São 9 apps locais com migrações (`apps/accounts`, `projects`, `teams`, `timeline`, `suggestions`, `geekday`, `formularios`, `reports`, `feedbacks`) e 130 arquivos de migração reais (excluindo os 10 `__init__.py`), dos quais 35 usam `migrations.RunPython` — 33 efetivas e 2 no-op mantidos só para não quebrar o grafo de dependências. O sistema NÃO nasce vazio: uma cadeia de seeds em migração cria o catálogo de cargos (Admin/Visitante), o setor padrão "Sem Setor", as 6 etapas de Kanban, os 5 critérios de Score, o catálogo de suporte, o formulário de feedback ativo e toda a estrutura sistêmica de "Monitoramento de Feedbacks" (setor técnico + sprint + projeto + 4 etapas ocultas). A integridade declarada no banco é enxuta e deliberada: 7 `UniqueConstraint` (uma delas PARCIAL), 8 `unique_together`, zero `CheckConstraint`, e o eixo de segurança real é a política de `on_delete` — PROTECT nos pontos onde apagar uma linha derrubaria acervo em cascata (supervisor de sprint, setor de sprint/projeto/card, definição de formulário, grupo de Geek Day), SET_NULL na autoria (o histórico sobrevive anônimo) e CASCADE apenas em conteúdo que não existe sem o pai. `User.delete()` é sobrescrito para NÃO apagar: desativa, revoga tokens e solta os cards abertos.

### Bootstrap de um banco zerado — ordem em que os seeds nascem

1. 1. Django cria as tabelas de auth/contenttypes e as 29 linhas de auth_permission via Meta.permissions de PermissaoPlataforma (accounts/0008 registra; o post_migrate cria as linhas).
2. 2. accounts/0013 força create_permissions ANTES da hora (senão a consulta viria vazia), cria os Cargos 'admin' (com o catálogo inteiro em permissoes_padrao) e 'visitante' (vazio), joga superusers para admin e todo o resto para visitante, e só DEPOIS apaga cargos fora do catálogo.
3. 3. accounts/0016 cria SetorCatalogo 'sem_setor' (is_system=True), vincula TODOS os usuários existentes via UserSetor + CharField, e apaga os setores do seed antigo.
4. 4. accounts/0019 divide manage_catalog em manage_cargos + manage_setores, dando as duas novas a quem tinha a antiga; 0022 dá view_content a todo cargo != visitante/admin; 0024 dá view_geekday a quem tem view_metrics ou manage_geekday; 0026 dá approve_card_reopen a quem tem approve_due_date_requests.
5. 5. formularios/0002 cria o catálogo de suporte (2 tipos, 3 itens, 3 motivos) — SÓ se SuporteTipo estiver vazio; 0006 acrescenta Easy e Dashboards com update_or_create (reativa se estiverem inativos).
6. 6. projects/0028 cria as 6 KanbanStage globais e um ProjectKanbanStageConfig para cada projeto já existente.
7. 7. projects/0049 cria os 5 ScoreCriterion (Redução de esforço 0.30, Risco fiscal 0.25, Escalabilidade 0.20, Complexidade 0.15 negativo, Dependência 0.10 negativo) com suas opções — opções só em critério recém-criado, para não sobrescrever edições do supervisor.
8. 8. projects/0053 faz o backfill de setor em Sprint/Project/Card para 'sem_setor' e FECHA as três colunas como NOT NULL com PROTECT; aborta com RuntimeError se sobrar órfão.
9. 9. feedbacks/0002 cria o FeedbackFormulario slug='padrao' v1; 0005 desativa v1 e cria v2 (11 perguntas, 6 seções); 0007 desativa v2 e cria v3 (+ campo 'Seu setor:').
10. 10. feedbacks/0003 cria o setor técnico 'monitoramento_feedbacks' (is_system=True), a Sprint is_system (fechamento_em ~100 anos no futuro), o Project is_system e as 3 etapas ocultas — MAS PULA silenciosamente se não houver nenhum usuário no banco.
11. 11. feedbacks/0006 renomeia o fluxo para 'Monitoramento de Feedbacks' (casando por is_system, nunca por nome); 0009 acrescenta a 4ª etapa 'feedback_encerrado'.
12. 12. geekday/0006 cria/renomeia o grupo 'Geek Day', vincula o setor padrão e adota os sorteios órfãos; 0008 ressincroniza a sequência de ids de GeekDayGrupo no Postgres.

### Trocar o formulário de feedback — procedimento de 2 passos (obrigatório nesta ordem)

1. 1. UPDATE, em statement SEPARADO e ANTERIOR: FeedbackFormulario.objects.filter(slug='padrao', ativo=True).update(ativo=False).
2. 2. INSERT da versão seguinte: update_or_create(slug='padrao', versao=N+1, defaults={..., 'ativo': True}).
3. POR QUE A ORDEM: uniq_formulario_ativo_por_slug é UniqueConstraint PARCIAL (condition=Q(ativo=True)) e NÃO é DEFERRABLE — o Postgres avalia no próprio statement. Inverter é IntegrityError em produção, e passa calado num teste que semeie na ordem certa por acaso.
4. A LINHA ANTIGA NUNCA É EDITADA, só perde o flag ativo — é isso que mantém respostas de meses atrás legíveis contra a definição que a pessoa de fato viu.
5. CONSEQUÊNCIA: pedidos JÁ CRIADOS não mudam de versão. A FK do formulário é congelada nos defaults do get_or_create em services.py, e defaults só vale na criação. Para ver o campo novo é preciso um pedido NOVO.
6. A reversão tem TRÊS statements e também é ordenada: desativar a versão nova (libera a constraint), apagar só se não houver pedidos apontando (a FK é PROTECT), reativar a anterior (senão services.formulario_ativo levanta DoesNotExist, engolido pelo try/except do on_commit, e a feature fica INERTE em silêncio).

### Desativação de usuário — o caminho que substitui o DELETE

1. User.delete() (accounts/models.py:210) NÃO apaga a linha. Dentro de uma transaction.atomic: seta is_active=False, apaga os Tokens do DRF e chama desatribuir_cards_de_usuario_desativado(self, operador=None).
2. desatribuir_cards_de_usuario_desativado (projects/services.py:478) solta o responsável dos cards ABERTOS (definidos pela NEGATIVA de CARD_STATUS_FECHADOS) e grava um CardLog 'responsavel_alterado' por card.
3. Cards FINALIZADOS e INVIABILIZADOS mantêm o responsável — apagar ali reescreveria a métrica de entrega de sprints passadas.
4. O mesmo serviço é chamado por UserViewSet.set_active (accounts/views.py). Os dois caminhos estão pareados por comentário explícito nos dois arquivos; QUALQUER porta nova de desativação precisa chamá-lo.
5. O estado legado (cards já pendurados em contas desativadas antes desta regra existir) foi tratado por projects/0060, que é IRREVERSÍVEL: o responsável anterior não é guardado em campo nenhum, sobra só o nome dentro do texto do CardLog.

### Auto-cura da estrutura de monitoramento quando o seed pula

1. feedbacks/0003 desiste (só loga um warning) se não houver nenhum usuário para ser supervisor da sprint — Sprint.supervisor é NOT NULL com PROTECT. É o caso do banco de teste recém-migrado.
2. Na primeira entrega real, gerar_pedidos_do_projeto chama garantir_estrutura_monitoramento (feedbacks/estrutura.py:161) como PRIMEIRA coisa, e ela cria setor + sprint + projeto + as QUATRO etapas de uma vez.
3. As identidades usadas são estruturais, nunca o nome: setor pelo codename 'monitoramento_feedbacks', sprint por is_system=True, projeto por 'o único projeto da sprint sistêmica', etapas pela key.
4. Projeto e configs de etapa nascem na MESMA transação: _ensure_project_default_kanban_config (projects/views.py) injeta as 6 colunas normais em qualquer projeto com zero configs, e uma janela de um instante deixaria o board de monitoramento com as colunas erradas para sempre.

---
