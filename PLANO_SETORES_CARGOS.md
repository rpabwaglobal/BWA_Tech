# PLANO DE IMPLEMENTAÇÃO FINAL — Cargos de Sistema, Visitante, Migração de Cargos Legados e Segmentação por Setor
### BWA Tech · Consolidação dos requisitos (A)–(G)

> Este documento é o plano de engenharia único e executável. Ele consolida os três designs (Setor, Migração de Cargos, UX/Bulk/Tab) e a crítica de completude, **resolvendo cada contradição pela opção de menor risco para produção**. As decisões já tomadas estão marcadas como **DECISÃO FIXADA**; o que permanece a critério do produto está na seção 8.
>
> Premissa mestra que governa todas as escolhas: **hoje as permissões já estão 100% desacopladas do cargo (`user_permissions` por usuário — Fase 3 concluída) e nada tem setor (tudo é global).** Logo, mudar cargo não muda o que ninguém pode fazer; e a segmentação por setor só pode ser ligada depois que 100% dos dados estiverem backfillados, atrás de uma flag.

Caminhos absolutos de referência:
- Backend: `C:/Users/Italo.Martins/Documents/Github/BWA_Tech/backend/apps/accounts/{models,serializers,views,permissions,permission_catalog,signals}.py`
- Projetos: `C:/Users/Italo.Martins/Documents/Github/BWA_Tech/backend/apps/projects/{models,views,serializers,services}.py`
- Formulários: `C:/Users/Italo.Martins/Documents/Github/BWA_Tech/backend/apps/formularios/{models,views,consumers}.py`
- Frontend: `C:/Users/Italo.Martins/Documents/Github/BWA_Tech/frontend/src/`

---

## 1. Contexto e Objetivo

### 1.1 Situação atual (o que já existe)
- `User.role` (CharField, choices dinâmicas via `get_cargo_choices` lendo `Cargo`) e `User.setor` (CharField via `SetorCatalogo`).
- Catálogos `Cargo(codename, nome, is_system)` e `SetorCatalogo(codename, nome, is_system)`. Migration 0011 semeou **6 cargos** (admin, supervisor, gerente, desenvolvedor, dados, processos) e 8 setores, todos `is_system=True`.
- 19 permissões granulares (`permission_catalog.py`, modelo fantasma `PermissaoPlataforma`) atribuídas por usuário via `user_permissions` (auth.Permission).
- Toda autorização de escrita do backend já usa `request.user.has_perm('accounts.<codename>')`.
- Frontend com `lib/permissions.ts`, `Settings.tsx` (tabs Perfil + Gerenciamento de Usuários), `UserPermissionsDialog`, e organograma `People.tsx` (ReactFlow + dnd-kit) com colunas fixas por role.
- Hierarquia de dados: `Sprint → Project (FK sprint, CASCADE) → Card (FK projeto, CASCADE)`. **Nenhum tem FK de setor.** Métricas derivadas no frontend a partir de `/cards/metrics/`.

### 1.2 Objetivo
Entregar (A)–(G) sem quebrar produção:
- **(A)** Reduzir a **3 cargos de sistema**: Administrador BWA Tech, Supervisor, Visitante.
- **(B)** Visitante = zero permissões **e** sem acesso a métricas/dados sensíveis; todo cadastro novo nasce Visitante.
- **(C)** Migrar usuários de cargos legados (gerente/desenvolvedor/dados/processos) para um cargo **Desenvolvedor** (`is_system=False`) **sem alterar nenhuma permissão individual**.
- **(D)** Refazer o organograma e criar a tab **"Gerenciamento de Setores e Cargos"**.
- **(E)** Cores e rótulos definidos na criação/edição de cargo/setor (remover hard-code de ~9 arquivos).
- **(F)** Atribuição em massa (cargo/setor/permissões) com modal de confirmação personalizado.
- **(G)** Segmentação por setor dos dados (sprints/projetos/cards/métricas), com o primeiro setor "Tecnologia" absorvendo **tudo** sem deixar órfãos, e compartilhamento seletivo entre setores.

### 1.3 Regra de ouro do faseamento
As entregas de **cargos (A, C)**, **restrição do Visitante (B)** e **catálogo/UI/bulk (D-parcial, E, F)** **não dependem de nenhum campo `setor`** e vão a produção primeiro, com risco comprovadamente baixo. A **segmentação por setor (G)** é a única parte perigosa: fica isolada atrás da flag `SETOR_SCOPING_ENABLED`, entra por último e **nunca no mesmo deploy** da migração de cargos.

---

## 2. Modelo de Dados Novo

### 2.1 Cargos de sistema (requisito A) — **DECISÃO FIXADA**

Estado alvo: **exatamente 3 cargos `is_system=True`** (protegidos, imutáveis, não excluíveis):

| codename (imutável) | nome | is_system | template de permissões-padrão |
|---|---|---|---|
| `admin` | **Administrador BWA Tech** | True | todas as 19 |
| `supervisor` | Supervisor | True | todas as 19 |
| `visitante` | Visitante | True | **[]** (zero) |

Os 4 legados (`gerente`, `desenvolvedor`, `dados`, `processos`) passam a `is_system=False` (viram cargos comuns, editáveis e, quando esvaziados, excluíveis). **Nenhum é apagado na migração** (evita `role` órfão em `User`).

O `codename='admin'` **nunca muda** (é referenciado por string em `save()`, permissions, serializers, `UserViewSet`). Apenas o `nome` é renomeado para "Administrador BWA Tech".

### 2.2 Cargo template de permissões — **DECISÃO FIXADA (reconcilia MIGRACAO × UX)**

Adicionar ao model `Cargo` um campo de **template opcional**, que é **apenas conveniência na atribuição** e **nunca re-propaga automaticamente** (a autoridade permanece 100% em `user_permissions`):

```python
# apps/accounts/models.py — Cargo
permissoes_padrao = models.JSONField(default=list, blank=True)  # lista de codenames
```

Regras invioláveis do template:
- Editar o template **não** altera as permissões de nenhum usuário já existente.
- Aplicar o template só acontece quando o operador marca explicitamente "aplicar permissões-padrão" (individual ou bulk).
- Isso preserva a **invariância de permissões** exigida por (C) e ao mesmo tempo dá ao Supervisor recém-atribuído (não superuser) um caminho para receber as 19 permissões: atribuir o cargo Supervisor **com** "aplicar template".

Templates semeados: `admin`→19, `supervisor`→19, `visitante`→[], `desenvolvedor`→as 4 do ex-gerente? **Não** — ver 2.3: o template de "Desenvolvedor" é decisão de produto (pergunta #4 na seção 8); por padrão fica `[]` para não sugerir promoção indevida.

### 2.3 Cargo "Desenvolvedor" legado (requisito C) — **DECISÃO FIXADA: reutilizar o codename `desenvolvedor`**

- Reaproveitar a linha `Cargo(codename='desenvolvedor')` já existente: `nome='Desenvolvedor'`, `is_system=False`.
- **Motivo de menor risco:** `Project.desenvolvedor` tem `limit_choices_to={'role':'desenvolvedor'}` e `userService.getDevelopers()` faz `GET /users/?role=desenvolvedor`. Reutilizar o codename mantém esses pontos válidos sem refação de schema.
- "Mesmas permissões que existem hoje" = **não tocar `user_permissions` de ninguém**. Ex-gerentes preservam suas 4 permissões individuais; ex-dados/processos preservam suas 0. Usuários no mesmo cargo "Desenvolvedor" podem ter conjuntos de permissão diferentes — isso é **coerente e correto** no modelo per-usuário.

### 2.4 Setor como dimensão de segmentação (requisito G) — **DECISÃO FIXADA: Sprint é a autoridade, denormalizado até o Card**

Resolvendo a contradição central (Sprint tem setor? SIM):

O requisito diz literalmente "Processos não vê **sprints** de Tecnologia" → a Sprint precisa ser filtrável por setor. Modelo adotado (híbrido denormalizado, DESIGN SETOR):

```
Sprint.setor                    FK → SetorCatalogo (null=True na migração, db_index)  = AUTORIDADE
Sprint.setores_compartilhados   M2M → SetorCatalogo                                    = sharing nível sprint

Project.setor                   FK → SetorCatalogo (null=True, db_index)  default = sprint.setor no create
Project.setores_compartilhados  M2M → SetorCatalogo                        = sharing nível projeto

Card.setor                      FK → SetorCatalogo (null=True, db_index)  = ESPELHO de projeto.setor
                                (NÃO editável direto; mantido em Card.save() e na reatribuição de projeto)
```

**Por que denormalizar o Card:** `CardViewSet.metrics` (`views.py:867-900`) lê a base inteira de cards com `.only()` e alimenta on-time/cycle time/throughput/heatmap no frontend. Escopar esse endpoint com `WHERE card.setor_id IN (...)` indexado é o filtro mais barato e à prova de vazamento; o join `projeto__sprint__setor` no volume de cards seria o gargalo. Leituras de setor são constantes, escritas raras → denormalizar favorece o caso comum.

**Por que `Card.setor` é espelho puro (não campo livre):** resolve "card que muda de projeto" sem ambiguidade — o setor do card sempre reflete o projeto atual. Compartilhamento nunca é card-a-card (ingovernável com 200+ usuários), sempre em Sprint/Project — a granularidade que o requisito pede ("escolher **quais dados** compartilhar").

### 2.5 Compartilhamento entre setores (requisito G) — **DECISÃO FIXADA: M2M por objeto, fail-closed**

Resolvendo a contradição M2M-por-objeto (SETOR) × matriz N×N (UX): **adotar o M2M por objeto** (`setores_compartilhados` em Sprint e Project). Justificativa de menor risco e melhor aderência:
- **Cobre os dois lados do requisito com um só mecanismo:** por padrão cada setor vê **apenas** os próprios dados (fail-closed) → "Processos não vê sprints de Tecnologia" é o comportamento default, sem configurar nada. E "escolher **quais dados** compartilhar" é exatamente marcar `setores_compartilhados` numa sprint/projeto específico — granularidade por objeto, que é o que o texto pede.
- **A matriz N×N (`SetorAcesso`) é rejeitada como modelo primário:** é mais grossa ("Processos vê TODAS as sprints de Tecnologia"), introduz um segundo modelo consultado nos 15 pontos quentes sem cache, e não atende "quais dados". Pode ser reavaliada no futuro como camada opcional de "compartilhamento em massa por setor", mas **não entra agora**.

Regra canônica de visibilidade de um **Card** para um usuário cujos setores são `U` (conjunto de codenames):
```python
visivel(card, U) =
      card.setor_id in U
   or (card.projeto.setores_compartilhados & U)
   or (card.projeto.sprint.setores_compartilhados & U)
```
Sprint/Project usam a forma reduzida `setor ∈ U  ou  setores_compartilhados ∩ U`. Todo filtro M2M leva `.distinct()` embutido no helper (nunca no call-site).

### 2.6 Usuário × Setor (requisito F, G) — **DECISÃO FIXADA: M2M faseado, mantendo CharField como setor primário**

Resolvendo a contradição M2M (SETOR) × CharField (UX): **M2M com through, introduzido em paralelo ao CharField** (menor risco, não reescreve `validate_setor` num golpe):

```python
# apps/accounts/models.py
class UserSetor(models.Model):
    user = FK(AUTH_USER_MODEL, on_delete=CASCADE, related_name='setor_links')
    setor = FK('SetorCatalogo', on_delete=CASCADE, related_name='user_links')
    is_primary = BooleanField(default=False)
    added_by = FK(AUTH_USER_MODEL, on_delete=SET_NULL, null=True, related_name='+')
    added_at = DateTimeField(auto_now_add=True)
    class Meta:
        unique_together = [('user', 'setor')]

# no User:
setores = ManyToManyField('SetorCatalogo', through='UserSetor', related_name='usuarios', blank=True)
```

Faseamento: (1) manter `User.setor` CharField; (2) backfill cria `UserSetor(is_primary=True)` para cada usuário com setor; (3) `scoping.setores_do_usuario` lê do **M2M**; o CharField vira "setor primário" para exibição/compatibilidade com `validate_setor`; (4) deprecar o CharField só depois de estável, mantido sincronizado com o primary via signal enquanto houver código legado. O bulk de setor aceita **lista** de codenames.

### 2.7 Cor e rótulo (requisito E) — **DECISÃO FIXADA**

Adicionar a **ambos** `Cargo` e `SetorCatalogo`:
```python
cor          = CharField(max_length=7, default='#94a3b8')   # hex; slate-400 = "cinza default" atual
label_curto  = CharField(max_length=16, blank=True)          # badges compactos (Kanban/Metrics); front trunca nome se vazio
descricao    = CharField(max_length=255, blank=True)         # opcional
```
O rótulo longo já é o `nome`. Campos read-only calculados no serializer: `user_count` (e `project_count`/`sprint_count` para setor).

### 2.8 Suporte (requisito G, fase 2) — **DECISÃO FIXADA: nullable + derivação, best-effort**

`ChamadoSuporte` (`formularios/models.py:56-92`): adicionar FK **nullable** `setor` (→ `SetorCatalogo`), preenchido no create derivando de `usuario_email → User.setor` (setor primário). **Manter integralmente** o escopo por e-mail existente (`views.py:79-92`, `consumers.py:69-100`); setor é uma lente **adicional**. Como as métricas de suporte vêm do portal externo (`portal_proxy_views.py`) e a tabela local fica vazia em modo proxy, a **segmentação de métricas de suporte é Fase 2/best-effort**.

### 2.9 Permissões novas no catálogo — **DECISÃO FIXADA**

Em `permission_catalog.py`, +migration que cria os `auth.Permission` e semeia a admin/supervisor:
- `view_metrics` — gate de métricas/dados sensíveis (requisito B do Visitante).
- `view_cross_setor` — bypass do escopo de setor (vê todos os setores). Semeado a admin/supervisor.
- `manage_setor_sharing` — pode editar `setor`/`setores_compartilhados` dos dados.

O catálogo passa de 19 para **22 codenames**.

---

## 3. Migrações e Scripts de Produção (passo a passo)

> Numeração **unificada e coordenada** entre `accounts`, `projects` e `formularios` (resolve a colisão apontada na crítica). Cada migração é idempotente e reversível. **Backup completo do banco antes de qualquer coisa.**

### 3.1 Bloco CARGOS (accounts) — risco baixíssimo, vai primeiro

**`accounts/0012_reconcile_system_cargos.py`** (data migration, idempotente/reversível):
```python
SYSTEM_KEEP = {"admin":"Administrador BWA Tech", "supervisor":"Supervisor", "visitante":"Visitante"}
DEMOTE = ["gerente", "desenvolvedor", "dados", "processos"]

def forwards(apps, schema_editor):
    Cargo = apps.get_model("accounts", "Cargo")
    for codename, nome in SYSTEM_KEEP.items():
        Cargo.objects.update_or_create(codename=codename, defaults={"nome":nome, "is_system":True})
    Cargo.objects.filter(codename__in=DEMOTE).update(is_system=False)
    Cargo.objects.filter(codename="admin").update(nome="Administrador BWA Tech")

def backwards(apps, schema_editor):
    Cargo = apps.get_model("accounts", "Cargo")
    Cargo.objects.filter(codename__in=DEMOTE).update(is_system=True)
    # visitante permanece; não removemos usuários dele no rollback
```
Notas: **não deletar** os cargos rebaixados; `visitante` criado via `update_or_create` **antes** de qualquer cadastro novo usar o default.

**`accounts/0013_alter_user_role_default.py`** (schema): `User.role` default `desenvolvedor → visitante`. Também adicionar `VISITANTE = 'visitante', 'Visitante'` ao enum `Role` (models.py:9-19) mantendo as constantes legadas (usadas pelo command de migração).

**`accounts/0014_relax_role_limit_choices.py`** (schema, `AlterField`, baixíssimo risco — `limit_choices_to` é advisory, DRF ignora):
- `Project.gerente_atribuido`: remover `limit_choices_to={'role':'gerente'}` (após consolidação não há mais gerentes; senão o seletor do admin fica vazio; valores já gravados por FK-id permanecem).
- `WeeklyPriority.usuario`: `{'role__in':['gerente','desenvolvedor','dados']}` → `{'role__in':['desenvolvedor']}`.
- Manter `Project.desenvolvedor={'role':'desenvolvedor'}`, `WeeklyPriority.definido_por`, `Team/Hierarchy/Suggestion.supervisor` intactos.

**`accounts/0015_cargo_setor_cor_template.py`** (schema): adiciona `cor`, `label_curto`, `descricao` a `Cargo`/`SetorCatalogo`; `Cargo.permissoes_padrao` (JSON); semeia templates (`admin`/`supervisor`=19, `visitante`=[]).

**`accounts/0016_permissions_view_metrics_cross_setor.py`** (data): cria `auth.Permission` para `view_metrics`, `view_cross_setor`, `manage_setor_sharing` e semeia a admin/supervisor.

### 3.2 Command de migração dos legados (requisito C) — **NÃO toca `user_permissions`**

`apps/accounts/management/commands/migrate_legacy_cargos.py`:
```python
SOURCE_ROLES = ["gerente", "dados", "processos"]
TARGET_ROLE  = "desenvolvedor"
# --dry-run, --delete-empty-cargos, --bulk(opcional)

# guarda: cargo alvo existe?
# relatório ANTES por role
# transação: para cada usuário em SOURCE_ROLES (select_for_update):
#   if u.is_superuser: continue          # save() força admin
#   u.role = TARGET_ROLE
#   u.save(update_fields=["role"])        # dispara signal user_role_changed (histórico/notificação)
# NUNCA chama user_permissions.set()/.clear()  ← garante "mesmas permissões"
# --delete-empty-cargos: só apaga Cargo is_system=False SEM usuários
# cache.delete(CARGO_CHOICES_CACHE_KEY)
```
Pontos críticos: usa `save(update_fields=["role"])` de propósito (dispara `user_role_changed`, signals.py:785-798); pula superusers; `--dry-run` obrigatório antes do run real; `--delete-empty-cargos` só num segundo momento, após dias de operação estável.

**Rollback dos roles individuais:** o command consolida (perde "quem era gerente"). Por isso o **snapshot pré-migração** (dump `{user_id: role_original}`) é obrigatório e é o único rollback fiel dos roles. Ver 3.6.

### 3.3 Proteção contra exclusão de cargos/setores (requisito D/F)

`CargoViewSet`/`SetorViewSet` hoje são só `['get','post','head','options']`. Adicionar `patch`/`delete` com validações rígidas em `destroy`, na ordem:
1. `is_system=True` → **403** (os 3 de sistema nunca excluíveis).
2. Cargo com `User.objects.filter(role=cargo.codename).exists()` → **409** (retorna `usuarios_vinculados` para o modal).
3. Setor com usuários vinculados (`User.setores` / `setor` CharField) → **409**.
4. Setor com dados vinculados (`Sprint/Project.objects.filter(setor=...)`, quando o campo existir) → **409**.
5. Ator: `IsAdminOrSupervisor`. Após delete: invalidar `CARGO_CHOICES_CACHE_KEY`/`SETOR_CHOICES_CACHE_KEY`.

Defesa em profundidade: sobrescrever `Cargo.delete()`/`SetorCatalogo.delete()` para `raise ValidationError` se `is_system` (protege shell/admin).

### 3.4 Bloco SETOR — campos anuláveis (projects/formularios) — flag OFF

**`projects/00XX_add_setor_fields.py`** (schema, tudo `null=True`, comportamento idêntico ao atual):
- `Sprint.setor` (FK, db_index), `Sprint.setores_compartilhados` (M2M)
- `Project.setor` (FK, db_index), `Project.setores_compartilhados` (M2M)
- `Card.setor` (FK, db_index)

**`accounts/0017_user_setor_m2m.py`**: cria `UserSetor` + M2M `User.setores`.

**`formularios/00ZZ_chamado_setor.py`**: `ChamadoSuporte.setor` (FK, null=True).

Em `settings.py`: `SETOR_SCOPING_ENABLED = False`. **Nada é filtrado.** Sistema idêntico ao de hoje.

### 3.5 Seed "Tecnologia" + backfill "tudo para Tecnologia" (requisito G) — **DECISÃO FIXADA: command no deploy + endpoint UI para setores futuros**

Resolvendo #8/#9: o **primeiro** setor e o backfill vão por **data migration + management command** (operável no deploy, atômico, idempotente, verificável). O endpoint UI `absorver-tudo` existe para setores subsequentes.

**`accounts/0018_seed_setor_tecnologia.py`**:
```python
SetorCatalogo.objects.get_or_create(
    codename='tecnologia',
    defaults={'nome':'Tecnologia', 'is_system':False, 'cor':'#3b82f6'})
```
`is_system=False` (setor criado, não de sistema).

**`apps/projects/management/commands/migrar_tudo_para_tecnologia.py`** (envolto em `transaction.atomic()`):
```python
tec = SetorCatalogo.objects.get(codename='tecnologia')
Sprint.objects.filter(setor__isnull=True).update(setor=tec)     # só órfãos
Project.objects.filter(setor__isnull=True).update(setor=tec)
Card.objects.filter(setor__isnull=True).update(setor=tec)
for u in User.objects.all():
    UserSetor.objects.get_or_create(user=u, setor=tec, defaults={'is_primary': True})
    # sincroniza CharField primário se vazio
assert Card.objects.filter(setor__isnull=True).count() == 0   # idem Sprint/Project → aborta se órfão
# imprime contagens antes/depois; flag --undo guardada
```
**Idempotência por construção:** `filter(isnull=True).update()` só toca órfãos; `get_or_create` no M2M é no-op se já existe. Rodar N× → mesmo estado. **Não deve restar NADA de fora** (requisito G).

### 3.6 Herança em runtime (para registros criados entre deploys)
- `Project.save()`: se `setor_id is None` → `self.setor = self.sprint.setor`.
- `Card.save()`: se `setor_id is None` → `self.setor = self.projeto.setor`.
- `Sprint`: default no serializer = setor primário do supervisor logado (ou Tecnologia se ausente).
- `services.finalizar_sprint_replicacao` (services.py:265-272): copiar `setor` **e** `setores_compartilhados` ao replicar projetos/cards para a próxima sprint (com teste de regressão em `test_finalizar_sprint`).

### 3.7 Tornar obrigatório + ligar enforcement (deploy final da segmentação)

**`projects/00XX+2_setor_non_null.py`** (schema): `AlterField Sprint/Project/Card.setor` → `null=False`. Opcional `db_default` = id de Tecnologia como rede contra inserts concorrentes (**requer Django 5.0+ — verificar versão; se < 5.0, confiar apenas na herança em save()**). Só depois: `SETOR_SCOPING_ENABLED = True`.

### 3.8 Sequência, verificação e rollback

**Snapshot pré-migração (obrigatório):**
```
python manage.py shell -c "from apps.accounts.models import User, Cargo; from collections import Counter; \
print('roles:', Counter(User.objects.values_list('role', flat=True))); \
print('cargos:', list(Cargo.objects.values('codename','is_system','nome'))); \
print('perms:', {u.id: sorted(u.user_permissions.values_list('codename', flat=True)) for u in User.objects.all()})"
```
Este dump de `user_permissions` por usuário é a **prova de invariância** de (C) e o **rollback fiel dos roles**.

**Ordem estrita:**
1. Backup do banco + snapshot acima.
2. Deploy do código (migrations 0012–0016 + setor anuláveis, mas **sem** rodar o command de reatribuição ainda; `SETOR_SCOPING_ENABLED=False`).
3. `migrate accounts` → aplica 0012–0018.
4. `migrate_legacy_cargos --dry-run` → conferir contagens contra o snapshot.
5. `migrate_legacy_cargos` (run real).
6. **NÃO** rodar `--delete-empty-cargos` ainda (deixar legados vazios como rede de segurança por dias).
7. Reiniciar workers/web (limpar cache de choices em memória).
8. **Verificação pós-cargos:** re-rodar snapshot e **diffar** — `perms` idêntico antes/depois; nenhum usuário com role em (gerente/dados/processos); `desenvolvedor` = soma dos antigos; exatamente 3 cargos `is_system=True`; `admin.nome=='Administrador BWA Tech'`. Smoke tests: ex-gerente mantém 4 perms; ex-dados 0; cadastro novo nasce visitante; Projetos/Sprints/Kanban abrem.
9. (Janela separada) `migrar_tudo_para_tecnologia` → **verificar manualmente zero nulos** em Sprint/Project/Card.
10. `AlterField null=False` + `SETOR_SCOPING_ENABLED=True` só após o zero-nulos confirmado.

**Rollback por camadas:** reatribuição de roles via snapshot (`update(role=<original>)`); schema via `migrate accounts 0011`; segmentação via reverter `null=False`→`null=True` e flag OFF (instantâneo, sem perda de dados); último recurso: restaurar dump.

---

## 4. Backend — Endpoints Novos/Alterados

### 4.1 Helper de escopo por setor — `apps/accounts/scoping.py` (novo)
```python
BYPASS_PERM = 'accounts.view_cross_setor'

def setores_do_usuario(user) -> set[str]:
    return set(user.setores.values_list('codename', flat=True))

def usuario_ve_tudo(user) -> bool:
    return bool(user.is_superuser or user.has_perm(BYPASS_PERM))

def scope_sprints(qs, user):
    if not settings.SETOR_SCOPING_ENABLED: return qs      # fail-open durante migração
    if usuario_ve_tudo(user): return qs
    U = setores_do_usuario(user)
    if not U: return qs.none()                             # Visitante/sem setor → nada
    return qs.filter(Q(setor__in=U) | Q(setores_compartilhados__in=U)).distinct()

def scope_projects(qs, user): ...   # setor | setores_compartilhados | sprint__setores_compartilhados
def scope_cards(qs, user): ...      # setor | projeto__setores_compartilhados | projeto__sprint__setores_compartilhados
def scope_users(qs, user): ...      # setores__codename__in=U  ou  pk=user.pk
```
Padrão de aplicação: **chamada explícita** dentro de cada `get_queryset` (não mixin mágico — os viewsets têm `get_queryset` customizados). `.distinct()` embutido no helper. **Flag `SETOR_SCOPING_ENABLED` gata tudo** — fail-open até o deploy final.

### 4.2 Os 15 pontos de query a instrumentar (todos em `apps/projects/views.py` salvo nota)

| # | Local | Ação |
|---|---|---|
| 1 | `SprintViewSet.get_queryset` 134-192 | `scope_sprints` **e** compor `Q(projects__setor__in=U)` no `not_excluded` (linha 139) — senão contagens agregadas vazam volume de outros setores |
| 2 | `SprintViewSet.bundle` 194-264 | `scope_projects` (211) + `scope_cards` (229) |
| 3 | `ProjectViewSet.get_queryset` 329-361 | `scope_projects`; detalhe herda → out-of-scope vira **404** |
| 4 | `ProjectViewSet` bulk + `_safe_ids` 651-665 | validar ids ∈ `scope_projects` (mesmo padrão do bloqueio `is_system`) |
| 5 | `CardViewSet.get_queryset` 843-861 | `scope_cards` |
| 6 | `CardViewSet.metrics` 867-900 | `scope_cards` — escopa todas as métricas de uma vez |
| 7 | `CardViewSet.priorities_view` 983-1097 | escopar `usuarios_ativos` por setor + cards |
| 8 | `WeeklyPriorityViewSet.get_queryset` 1388-1409 | `.filter(usuario__setores__codename__in=U)` |
| 9 | `WeeklyPriorityViewSet.define_priority_options` 1484-1538 | validar `usuario_id` alvo no mesmo escopo |
| 10 | `WeeklyPriorityViewSet.priorities_view` 1540-1635 | escopar usuários/priorities/cards_fechados |
| 11 | `CardDueDateChangeRequestViewSet.get_queryset` 1653-1661 | escopar por `card__setor` |
| 12 | `CardScoreViewSet.get_queryset` 1814-1825 | escopar por `card__setor` |
| 13 | `CardScoreViewSet.pickable_cards` 1827-1845 | `scope_cards` |
| 14 | `EventViewSet` / `CardLogViewSet` | escopar via `card__setor` (não vazar timeline/logs) |
| 15 | `UserViewSet.get_queryset` (accounts/views.py:135-150) | `scope_users` |

Além disso: seletores de FK por role (`Project.gerente_atribuido`, `Project.desenvolvedor`, `WeeklyPriority.usuario`) recebem escopo por setor **no serializer/view** (dinâmico), pois `limit_choices_to` é estático.

### 4.3 Guardas de Visitante / métricas (requisito B) — **por permissão E por setor (AND)**

Resolvendo #7: Visitante é barrado nos **dois eixos** (belt-and-suspenders). Adicionar `HasPerm('view_metrics')` nas actions sensíveis: `CardViewSet.metrics`, `priorities_view` (983 e 1540), `SprintViewSet.bundle`, `ChamadoSuporteViewSet.por_usuario`. Sem a permissão → **403** mesmo chamando o endpoint direto. Somado ao escopo de setor (`scope_*` retorna `qs.none()` para quem não tem setor), o Visitante recém-criado (0 permissões, 0 setor) não vê nada sensível. **`/api/users/`** recebe `scope_users` (não vaza o organograma inteiro).

**Definição fechada de "dado sensível" (proposta — confirmar #7 na seção 8):** bloqueado por `view_metrics` → Métricas, Score, sprint bundle, priorities, métricas de suporte; escopado por setor (visível-mas-filtrado) → Dashboard/Sprints/Projetos/Kanban listagens, `/users/`. GeekDay e Relatórios: ver seção 8.

### 4.4 Endpoints de catálogo (requisito D/E)
- `PATCH /cargos/{id}/` e `PATCH /setores/{id}/` — editar `nome`, `cor`, `label_curto`, `descricao`, `permissoes_padrao`. Bloquear `codename` e `is_system`. **Permitir** trocar cor/label de cargos de sistema (nunca o codename). Guard `IsAdminOrSupervisor`. Ampliar `http_method_names` (hoje sem patch/delete).
- `DELETE /cargos/{id}/` e `DELETE /setores/{id}/` — validações da seção 3.3.
- `GET /cargos/` e `GET /setores/` — anotar `user_count` / `project_count` / `sprint_count` via `Count`. Serializers ganham `cor`, `label_curto`, `descricao`, contagens read-only. Manter invalidação de cache no update.

### 4.5 Atribuição de dados a setor + compartilhamento (requisito G)
- `POST /setores/{id}/atribuir-dados/` — body `{ sprint_ids?, project_ids?, card_ids?, todos?:bool }`. Transacional, retorna contagens. Guard `IsAdminOrSupervisor`. (Para setores subsequentes; o primeiro usa o command.)
- `PATCH /sprints/{id}/` e `PATCH /projects/{id}/` — expor `setor` e `setores_compartilhados` no serializer, escrita só por quem tem `manage_setor_sharing` (padrão de `UserSerializer.validate_setor`). É assim que o supervisor **escolhe o que compartilhar**.

### 4.6 Atribuição em massa (requisito F) — **nomes padronizados**
Resolvendo a divergência de nomes: **padronizar em `bulk-assign-*`**. Todos guardados por `CanManageUserPermissions`/`IsAdminOrSupervisor`, transacionais, respeitando travas existentes (não alterar a si mesmo — filtrar `request.user.pk`; pular `role='admin'` se solicitante não é admin; validar codenames contra `ALL_PERMISSION_CODENAMES`):
```
POST /users/bulk-assign-cargo       {user_ids[], cargo_codename, apply_template:bool}
POST /users/bulk-assign-setor       {user_ids[], setor_codenames:[...]}   # M2M, aceita múltiplos
POST /users/bulk-set-permissions    {user_ids[], codenames[], mode:'set'|'add'|'remove'}
```
Resposta `{updated:N, skipped:[{id,motivo}]}`. **Auditoria/undo (requisito de segurança):** cada bulk grava um registro com os valores anteriores dos usuários afetados (para permitir reversão), atendendo à lacuna "sem undo para 200 usuários". Cenário dos 200 usuários: seleciona todos → 1 POST. Validar `cargo_codename`/`setor_codenames` existem (regra de `validate_role`/`validate_setor`).

### 4.7 Websockets
Aplicar o mesmo predicado de setor no push por-conexão em `formularios/consumers.py` (ao lado do filtro de e-mail existente) e no Kanban `projects/consumers.py` (grupo `sprint_{id}_kanban`) — não empurrar eventos cross-setor.

---

## 5. Frontend

### 5.1 Nova tab "Gerenciamento de Setores e Cargos" (requisito D)
Em `Settings.tsx` (hoje 2 tabs), adicionar a 3ª (`perfil | usuarios | setores-cargos`), gated por `canManageUsers = isSupervisorOrAdmin(user)`. Novo componente `components/settings/GerenciamentoSetoresCargos.tsx`, layout `lg:grid-cols-2`:
- **Seção A — Cargos:** tabela (padrão `<table>` de `GerenciamentoUsuarios.tsx:157-217`) com colunas Tag (chip colorido com `nome`), Codename (mono, read-only), Nº usuários, Nº permissões-padrão, Sistema? (badge), Ações (Editar / Excluir desabilitada se `is_system` ou `user_count>0`). Botão "+ Novo cargo".
- **Seção B — Setores:** análoga, + Nº projetos/sprints vinculados. Botão "+ Novo setor".
- **Compartilhamento:** como o modelo é M2M por objeto (não matriz), o compartilhamento entre setores é editado **na sprint/projeto** (PATCH `setores_compartilhados`), não numa matriz N×N. A tab mostra, por setor, quais sprints/projetos estão compartilhados com ele (visão de leitura + atalho para editar no objeto). Estado vazio (nenhum setor): card explicativo com CTA para o fluxo "criar setor e absorver tudo".

### 5.2 Criação/edição de cargo/setor com cor e rótulo (requisito E)
Novo dialog `components/settings/CargoSetorFormDialog.tsx` (sobre `components/ui/dialog.tsx`): Nome; **color picker** (grid de ~10 swatches predefinidos = paleta atual roxo/azul/verde/laranja/vermelho/cinza + extras, + input hex); Label curto (`maxLength=16`); Descrição; (cargo) botão "Ver/editar permissões-padrão" reusando o agrupamento por área de `UserPermissionsDialog.tsx:367-419`; preview ao vivo do chip. Serviços em `userService.ts`: `updateCargo`/`deleteCargo`/`updateSetor`/`deleteSetor`; `createCargo`/`createSetor` passam a aceitar `{nome, cor, label_curto}`; tipo `CatalogItem` ganha `cor`, `label_curto`, `descricao?`, `user_count?`.

### 5.3 Refactor das cores/labels hard-coded (requisito E) — **DECISÃO FIXADA: um único mecanismo**
Resolvendo #14 (dois caches propostos): **unificar em `frontend/src/lib/catalog-style.ts`** (descartar o `useCatalog()` hook duplicado; um hook fino pode envolvê-lo se necessário). Cache de cargos+setores populado no `AuthContext`/bootstrap após login (`getCargos()`+`getSetores()`), rebuscado quando um cargo/setor é criado/editado.
```ts
export function getCargoColor(codename?): string  // cargoMap[cn]?.cor ?? LEGACY[cn] ?? '#94a3b8'
export function getCargoLabel(codename?): string  // label_curto || nome || LEGACY || codename
// idem getSetorColor/getSetorLabel
```
Como as cores viram **hex dinâmico**, os badges passam a usar `style={{backgroundColor: cor+'20', color: cor, borderColor: cor}}` em vez de classe Tailwind fixa. **Estratégia de baixo risco:** manter `getRoleColor`/`getRoleLabel` em `components/ui/user-select.tsx:15-70` como **shims** que delegam ao novo util — os arquivos que importam de lá não mudam imports, só passam a receber cor do catálogo. Arquivos com **cópias locais** trocam a cópia pelo import do shim.

Arquivos afetados (os ~9): `user-select.tsx`, `ProjectDetails.tsx` (160-196), `SprintDetails.tsx` (1427-1464), `Metrics.tsx` (84-140, inclui `getRoleBarColor` hex de gráfico → vem direto do `cor`), `GeekDay.tsx` (176-193 hex da roleta), `MetricasSuporte.tsx` (26-43), `KanbanCardPreview.tsx` (13,50-51), `filter-select.tsx` (5,68,142,213), e `People.tsx` (some na reescrita).

### 5.4 Multi-seleção + atribuição em massa (requisito F)
Em `GerenciamentoUsuarios.tsx`, reaproveitar o padrão de `Projects.tsx` (`selectedProjectIds` + barra flutuante 2383-2475): coluna de checkbox por linha; "selecionar todos os **filtrados**" no `<thead>` (client-side sobre `getAllManagement` → 200 filtrados marcados de uma vez); estado `selectedUserIds:Set<number>`; barra flutuante com "N selecionados" + botões **Atribuir cargo**, **Atribuir setor**, **Definir permissões**, **Limpar**. Dialogs de bulk: cargo (com checkbox "aplicar permissões-padrão"), setor (multi-seleção), permissões (modos Substituir/Adicionar/Remover — "Substituir" é destructive). Serviços `bulkAssignCargo`/`bulkAssignSetor`/`bulkSetPermissions` em `userService.ts`.

### 5.5 Modal de confirmação personalizado (requisito F) — **DECISÃO FIXADA: componente único**
Criar `components/ui/confirm-dialog.tsx` (sobre `Dialog`), props: `open, title, description, confirmLabel, variant('default'|'destructive'), details(ReactNode), onConfirm, onCancel, loading`. **Todas** estas ações passam por ele:
1. Atribuir cargo em massa (mostra nº, cargo, se aplica template/quantas perms, quantos ignorados).
2. Atribuir setor em massa.
3. Definir permissões em massa (mostra modo; "Substituir" = destructive).
4. Excluir cargo (destructive).
5. Excluir setor (destructive).
6. Editar cor/label de cargo/setor de **sistema** (confirmação leve — afeta aparência global).
7. Editar `setores_compartilhados` de uma sprint/projeto (mostra o diff: "Processos deixará de ver / passará a ver a sprint X").
8. "Absorver tudo"/`atribuir-dados` ao criar setor (destructive; mostra contagens "312 projetos, 1.204 cards, 47 usuários").
9. Trocar cargo individual (`UserPermissionsDialog.tsx:265-272`), sobretudo com `apply_template`.
10. Ativar/desativar usuário (`setActive` 252-263 — desativar apaga tokens).
11. Regenerar código de recuperação (`PerfilTab.tsx:397-448`) — migrar para o componente unificado.

### 5.6 Reescrita do organograma People (requisito D) — **DECISÃO FIXADA: mural read-only por setor**
Resolvendo #12: `People.tsx` (69KB, ReactFlow + dnd-kit + 5 colunas fixas por role gravando `role` via drag) é **descartado**. O drag-and-drop de cargo e a hierarquia `teams/` saem. Nova `People.tsx` = **mural somente-leitura agrupado por `User.setor`**: cabeçalho com `FilterSelect` de setor; colunas dinâmicas = setores; cada card de usuário com chip do cargo (cor do catálogo) e chip do setor; sem dnd, sem ReactFlow (remove deps pesadas do bundle). Clicar num usuário (se `canManageUsers`) abre o `UserPermissionsDialog` existente — toda escrita continua centralizada. Alternativa (redirect `/pessoas`→`/configuracoes?tab=setores-cargos`) fica como opção secundária.

**App `teams/`** (Hierarchy/Team/TeamMember/NodePosition) e `teamService.ts`: **deprecar rotas/telas agora, dropar tabelas depois** em migration separada fora do caminho crítico (não apagar em produção às pressas). Não há dado de negócio crítico a preservar (é layout de canvas + trios); exportar `Hierarchy` para JSON antes é opcional.

### 5.7 Restrição do Visitante no frontend (requisito B)
Backend é a autoridade; o front só esconde UI. `App.tsx`: envolver `/metricas` (174) em `<PermissionRoute codename="view_metrics">` (padrão já usado em `/score` 96-111); idem `/relatorios` se sensível (ver #11). `Sidebar.tsx`: mover "Métricas" (39) para lista condicional renderizada só se `hasPermission(user,'view_metrics')` (mecanismo do item "Score" 187-208). Configurações→Perfil permanece; tabs de gestão já gated por `isSupervisorOrAdmin`. Páginas de leitura (Dashboard/Sprints/Projetos/Kanban) continuam acessíveis mas **escopadas por setor no backend** — Visitante sem setor vê pouco/nada. Botões de escrita já gated por `has_perm` (Fase 3). Opcional: `isVisitante(user)` em `lib/permissions.ts` para banner "acesso somente leitura; peça ao supervisor para liberar áreas".

---

## 6. Faseamento de Execução (marcos verificáveis)

Cada fase é independente, verificável e reversível. **Fases 1–3 não dependem de nenhum campo `setor`** e vão a produção primeiro com risco baixíssimo.

**FASE 0 — Decisões e preparação (bloqueante)**
Responder as perguntas da seção 8 (especialmente as que já não estão fixadas). Backup do banco + snapshot de `user_permissions`. Definir baseline de testes de regressão. Marco: snapshot arquivado, plano de migrations numerado aprovado.

**FASE 1 — Cargos (A + C)**
Migrations 0012–0016; `migrate_legacy_cargos --dry-run` → run; proteção de exclusão. **NÃO** rodar `--delete-empty-cargos`. Reiniciar workers.
Marco: `perms` idêntico antes/depois; 3 cargos de sistema; ex-gerente mantém 4 perms; cadastro novo nasce visitante; Projetos/Sprints/Kanban abrem.

**FASE 2 — Visitante restrito a leitura sensível (B)**
Permissões `view_metrics`/`view_cross_setor`/`manage_setor_sharing` (0016) semeadas a admin/supervisor; `HasPerm('view_metrics')` nas actions sensíveis; `PermissionRoute` + Sidebar condicional; `/users/` reduzido para não-privilegiados. Depende só da Fase 1.
Marco: Visitante recebe 403 em `/cards/metrics/`; item Métricas some da Sidebar do Visitante.

**FASE 3 — Catálogo cor/label + tab + bulk (D-parcial, E, F)** — sem risco de dado
Campos cor/label_curto/descricao + contagens; `PATCH`/`DELETE`; `catalog-style.ts` + refactor dos ~9 arquivos via shim; 3ª tab (Cargos + Setores); multi-seleção + barra bulk + `confirm-dialog.tsx` + endpoints bulk.
Marco: criar/editar cargo com cor reflete em todos os badges; atribuir cargo a 200 usuários selecionados num POST com confirmação.

**FASE 4 — Modelo de setor + backfill "tudo para Tecnologia" (G parte 1)** — flag OFF
Migrations de setor anuláveis + `UserSetor` + `ChamadoSuporte.setor`; `SETOR_SCOPING_ENABLED=False`; seed Tecnologia + `migrar_tudo_para_tecnologia` (atômico/idempotente); herança em `save()`; replicação copia setor.
Marco: **zero nulos** em Sprint/Project/Card verificado em produção; sistema idêntico ao atual (nada filtrado).

**FASE 5 — Ligar enforcement + compartilhamento (G parte 2, D final)** — flag ON
Instrumentar os 15 querysets (`.distinct()` embutido, contagens agregadas corrigidas, bulk valida ids ∈ escopo); websockets aplicam predicado de setor; `AlterField null=False` (+`db_default` se Django≥5.0); `SETOR_SCOPING_ENABLED=True`. UI de edição de `setores_compartilhados`. Monitorar plano do `metrics`.
Marco: usuário de Processos não vê sprints de Tecnologia; usuário com `view_cross_setor` vê tudo; métricas escopadas.

**FASE 6 — People + limpeza (D final)**
People → mural read-only por setor; deprecar rotas `teams/`; dropar tabelas em migration separada; remover dead code (`@property is_*` do User, permission classes ociosas); `migrate_legacy_cargos --delete-empty-cargos` só após dias estáveis.

---

## 7. Riscos Principais e Mitigações

1. **Enforcement ligado com dados meio-migrados → tela vazia em produção.** → Flag `SETOR_SCOPING_ENABLED` OFF até verificação manual de zero-nulos; helper fail-open enquanto desligada.
2. **Migração de cargos altera o que alguém pode fazer.** → Command **nunca** toca `user_permissions`; snapshot antes/depois prova invariância; superusers pulados.
3. **Apagar cargo legado deixa `User.role` órfão.** → Não deletar na 0012; `--delete-empty-cargos` só depois, e só cargos sem usuários e `is_system=False`.
4. **Contagens agregadas da sprint vazam volume de outros setores** mesmo com cards não listados. → Compor `Q(projects__setor__in=U)` dentro de `not_excluded` (views.py:139).
5. **Vazamento de existência via 403.** → Escopo no `get_queryset` → out-of-scope vira **404** naturalmente no DRF, nunca 403.
6. **Drift de `Card.setor` (espelho).** → Nunca editável direto; mantido em `Card.save()` e na reatribuição de projeto; command `resync_card_setor` idempotente para reconciliação.
7. **`.distinct()` esquecido em filtros M2M → linhas duplicadas em métricas.** → `.distinct()` embutido no helper `scope_*`.
8. **Replicação de sprint perde setor** (services.py:265-272). → Copiar `setor`+`setores_compartilhados`; teste de regressão.
9. **Bulk de ids arbitrários burlando escopo** (ProjectViewSet). → Validar ids ∈ `scope_projects` em `_safe_ids`.
10. **Bulk de 200 usuários sem undo.** → Cada bulk grava valores anteriores (registro de auditoria) para reversão.
11. **`AlterField null=False` falha por insert concorrente órfão.** → Herança em `save()` antes do deploy + `db_default` (se Django≥5.0).
12. **Cache de choices/catálogo stale.** → Invalidar `CARGO/SETOR_CHOICES_CACHE_KEY` em create/update/delete; reiniciar workers no deploy de cargos; catálogo do front rebuscado ao editar.
13. **Cache de métricas `private, max-age=60`** serve escopo antigo por até 60s após mudança de setor. → Manter `private` (não vaza entre usuários); aceitar janela de 60s ou reduzir max-age nas rotas escopadas.
14. **Websocket cross-setor** (suporte + Kanban). → Predicado de setor no push por-conexão.
15. **`limit_choices_to` legado quebra formulário** ao sumir gerente. → `0014` relaxa (`gerente_atribuido` sem constraint, `WeeklyPriority.usuario`→`['desenvolvedor']`); FKs por id nunca quebram.
16. **Testes de regressão insuficientes** para 15 querysets + websockets. → Baseline na Fase 0; suíte por setor/visibilidade/visitante antes de ligar a flag (não só `test_finalizar_sprint`).
17. **Edge cases de herança** (card sem projeto, projeto sem sprint, FK nulo intermediário). → `save()` trata `setor_id is None` derivando da cadeia; backfill garante zero-nulos; command de reconciliação para incidentes.
18. **Front filtrando sozinho não satisfaz "não ver dado sensível"** (payload já chegou). → Escopo **sempre no backend**; front só esconde UI.

---

## 8. Perguntas de Decisão em Aberto (para o usuário)

As decisões arquiteturais críticas já foram **fixadas** neste plano pela opção de menor risco (marcadas "DECISÃO FIXADA"): Sprint como autoridade de setor com denormalização até o Card (2.4); compartilhamento M2M por objeto, sem matriz N×N (2.5); User multi-setor via M2M faseado (2.6); cargo template só como conveniência (2.2); reutilizar codename `desenvolvedor` (2.3); Visitante barrado por permissão **E** setor (4.3); Tecnologia via command no deploy + endpoint UI para setores futuros (3.5); People como mural read-only (5.6); único cache de catálogo em `catalog-style.ts` (5.3). **Confirme se concorda com essas escolhas.** Restam em aberto, dependendo do produto:

1. **Template do cargo "Desenvolvedor":** por padrão deixei `[]` (nenhuma permissão sugerida ao promover). Você quer que "Desenvolvedor" sugira as 4 permissões que o ex-gerente tinha, ou nenhuma? (A invariância dos usuários já migrados é preservada em qualquer caso — isto afeta só futuras atribuições.)
2. **Definição fechada de "dado sensível" do Visitante (#7):** confirma a lista da seção 4.3 (bloqueado por `view_metrics`: Métricas/Score/bundle/priorities/métricas de suporte; escopado por setor: Dashboard/Sprints/Projetos/Kanban/`/users/`)? Falta decidir explicitamente **Relatórios** (`/relatorios`) e **GeekDay**.
3. **GeekDay e Relatórios entram na segmentação por setor / gate de métricas?** Hoje só aparecem no refactor de cores; não há análise de escopo. Se sim, precisam de análise de query dedicada (roleta/participantes do GeekDay; conteúdo de Relatórios).
4. **Score / `SetorSolicitante`:** o `CardScore` tem um eixo "setor solicitante" (quem *pede* a demanda), diferente do "setor dono do dado". Confirmo que a segmentação usa o **setor dono** (`card__setor`) e o `SetorSolicitante` permanece um campo informativo separado, sem efeito de visibilidade?
5. **Suporte na Fase 1 ou 2?** Mantive **Fase 2 best-effort** (métricas vêm do portal externo; tabela local vazia em modo proxy). Confirma? Se quiser Fase 1, precisamos de plano de backfill do histórico e enriquecimento do payload do portal.
6. **Bulk deve respeitar o escopo de setor do solicitante?** Ex.: um Supervisor de um setor pode atribuir cargo/setor a usuários de **outro** setor via bulk, ou só aos do seu escopo? (Admin sempre vê tudo.) Hoje só travamos "não alterar a si mesmo" e "pular admins".
7. **App `teams/`:** confirmo deprecar rotas agora e dropar tabelas depois (migration separada), **sem** exportar `Hierarchy` para JSON? Ou você quer preservar o histórico de hierarquia antes?
8. **Versão do Django:** o `db_default` = id de Tecnologia (rede contra inserts concorrentes no deploy final) exige Django ≥ 5.0. Qual a versão do projeto? Se < 5.0, confiaremos apenas na herança em `save()` (mais que suficiente, mas quero registrar).
9. **`--delete-empty-cargos`:** após quantos dias de operação estável você quer efetivamente remover as linhas de cargo legadas (gerente/dados/processos) vazias?

---

**Resumo dos artefatos a criar/alterar:** migrations `accounts/0012`–`0018`, `projects/00XX`(setor anulável)/`00XX+2`(non-null), `formularios/00ZZ`; commands `migrate_legacy_cargos.py` e `migrar_tudo_para_tecnologia.py`; novo `apps/accounts/scoping.py`; alterações em `accounts/{models,serializers,views,permissions,permission_catalog,signals}.py`, `projects/{models,views,serializers,services,consumers}.py`, `formularios/{models,views,consumers}.py`; frontend novos `components/settings/GerenciamentoSetoresCargos.tsx`, `components/settings/CargoSetorFormDialog.tsx`, `components/ui/confirm-dialog.tsx`, `lib/catalog-style.ts`; 3ª tab em `Settings.tsx`; multi-seleção/bulk em `GerenciamentoUsuarios.tsx`; guards em `App.tsx`/`Sidebar.tsx`; reescrita de `People.tsx`; refactor de cor/label nos ~9 arquivos via shim em `user-select.tsx`. **A descartar:** app `teams/` + `teamService.ts`; dnd/reactflow de People; dead code (`@property is_*`, permission classes ociosas).