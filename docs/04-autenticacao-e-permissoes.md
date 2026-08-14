# Autenticação e autorização

> Parte da [Documentação de Arquitetura do BWA Tech](README.md).
> Levantada por leitura direta do código; o que não foi confirmado está
> em [Riscos e lacunas](12-riscos-e-lacunas.md).


## Autenticação e autorização

**Token DRF com validade de 24 horas.** `ExpiringTokenAuthentication`
(`backend/apps/accounts/authentication.py`) apaga o token vencido e devolve 401.
No cliente ele vive em `localStorage['auth_token']` e é injetado pelo interceptor
de request de `src/services/api.ts`.

**A autorização é sempre por permissão, nunca por cargo.** O catálogo
`PERMISSION_CATALOG` (`backend/apps/accounts/permission_catalog.py`) declara 29
permissões granulares e é a única base de decisão. A regra está escrita no
próprio código: *autorização é decidida por `has_perm`, nunca por comparação de
cargo*. Não existem propriedades `is_supervisor` ou `is_gerente` — apagá-las foi
proposital, para que ninguém volte a ramificar por papel.

**Como a permissão chega ao usuário.** `Cargo.permissoes_padrao` (JSON) deixou de
ser template e virou fonte de autoridade: o `CargoPermissionBackend` a resolve a
cada `has_perm`. Mudar as permissões de um cargo muda o acesso de todo mundo que
o tem, na hora, sem migração de dados. Superusuários e o cargo `admin` recebem o
catálogo inteiro pelo `AdminRolePermissionBackend`.

**Contas não são apagadas.** `User.delete()` é sobrescrito: desativa
(`is_active=False`), revoga todos os tokens e solta os cards abertos da pessoa
(`desatribuir_cards_de_usuario_desativado`). O histórico sobrevive.

### Fluxos de identidade

**Autenticação por token (login → uso → expiração)**

1. POST /api/users/login/ com {email, password}. `LoginSerializer` busca por email__iexact, valida check_password e recusa conta inativa; mensagens de erro genéricas ('Credenciais inválidas.').
2. `_issue_fresh_token(user)` DELETA todos os tokens existentes do usuário e cria um novo — o cliente sempre recebe 24h cheias em vez de um token velho prestes a expirar. É uma rotação, não um reaproveitamento.
3. A view faz `request.user = user` ANTES de serializar. Sem isso `UserSerializer.get_permissions` veria um anônimo pedindo permissões de outra pessoa e devolveria [], e o frontend montaria Sidebar e rotas com lista vazia.
4. Resposta: {user, token, expires_at (ISO = token.created + 24h), message}.
5. Nas requests seguintes, `ExpiringTokenAuthentication` (DEFAULT_AUTHENTICATION_CLASSES) lê o header `Authorization: Token <key>`, recusa usuário inativo e, se `now > token.created + 24h`, APAGA o token e levanta 401 'Token expirado. Faça login novamente.'.
6. Não há refresh: o único caminho de renovação é novo login (que rotaciona).

**Resolução de uma permissão (has_perm) — a soma de quatro caminhos**

1. Todo gate chama `request.user.has_perm('accounts.<codename>')`. O Django percorre AUTHENTICATION_BACKENDS e devolve True se QUALQUER backend disser True — a ordem é irrelevante.
2. ModelBackend: permissões personalizadas (`user_permissions`) e grupos.
3. CargoPermissionBackend: lê `Cargo.permissoes_padrao` do cargo apontado por `user.role`, prefixa com 'accounts.' e INTERSECTA com o catálogo (codename inválido gravado no JSON não vira permissão fantasma). Cacheado no `__dict__` da INSTÂNCIA de User, com a chave incluindo o role — nunca em módulo, senão trocar cargo só valeria no próximo restart.
4. AdminRolePermissionBackend: role == 'admin' e is_active → catálogo inteiro. Existe para a plataforma nunca ficar sem administrador.
5. `PermissionsMixin.has_perm` já devolve True para is_superuser, sem consultar catálogo nenhum.
6. Todos checam `is_active` antes de conceder: conta desativada tem has_perm False para tudo.
7. Nenhum backend concede quando `obj is not None` — não há permissão de objeto por este caminho.

**A pergunta invertida: quem pode? (usuarios_com_perm_qs)**

1. `permissions.usuarios_com_perm_qs(codename)` devolve o queryset dos usuários ATIVOS para quem `has_perm` seria True — usado para escolher destinatário de notificação e para filtrar listagens sem N+1.
2. Reproduz os cinco caminhos: user_permissions, grupos, is_superuser, role em cargo cujo permissoes_padrao contém o codename (via `cargos_que_concedem`), e role='admin'.
3. Os dois últimos valem SÓ para codename do catálogo (`CODENAMES_DO_CATALOGO`), porque os backends intersectam com o catálogo antes de conceder — é essa assimetria que faz um codename digitado errado devolver o mesmo conjunto que `has_perm` devolveria, em vez de 'todos os admins'.
4. `cargos_que_concedem` resolve em Python (uma consulta lendo o catálogo inteiro) porque busca dentro de JSONField não é portável entre backends e a tabela Cargo tem dezenas de linhas.
5. `ids_que_participam_do_trabalho()` = set de ids com `view_content` — o piso de leitura, usado no filtro ?participa_do_trabalho e no campo `participa_do_trabalho` do serializer.

**Escopo por setor (SETOR_SCOPING_ENABLED)**

1. Com a flag OFF (padrão), todo `scope_*` devolve o queryset inteiro — fail-open, sistema idêntico ao de antes da segmentação.
2. Com a flag ON: quem é superuser ou tem `accounts.view_cross_setor` (`usuario_ve_tudo`) continua vendo tudo.
3. Para os demais, `setores_ids_do_usuario(user)` lê os ids do M2M `UserSetor` (memoizados na instância). Se o conjunto for VAZIO, a resposta é `qs.none()` — fail-closed.
4. Cada `scope_*` resolve primeiro os ids compartilhados (consultas pequenas nas tabelas de vínculo) e depois filtra a tabela grande por `pk__in`, evitando os LEFT JOINs de M2M e o `.distinct()` que inflava `Count()` anotado antes do escopo.
5. A cascata é feita na query, não copiada para os filhos: compartilhar uma sprint alcança projetos e cards dela; descompartilhar remove o acesso da árvore inteira de uma vez.
6. Funções existentes: scope_sprints, scope_projects, scope_cards, scope_card_scores, scope_weekly_priorities, scope_card_logs, scope_events, scope_card_anexos, scope_card_pins, scope_card_date_change_requests, scope_card_reopen_requests, scope_chamados, scope_users.
7. `scope_chamados` é a única com exceção: chamado sem setor (`setor__isnull=True`) continua visível — o vínculo é best-effort (derivado por e-mail) e esconder um chamado órfão faria alguém perder um pedido de ajuda.
8. `scope_users` devolve quem compartilha algum setor com o operador + ele mesmo; sem setor, só a si mesmo.

**Escrita sob escopo (SETOR_WRITE_ENFORCEMENT_ENABLED)**

1. Flag SEPARADA da de visibilidade, de propósito: liga-se a visibilidade primeiro, observa-se que ninguém perdeu tela, e só então se passa a recusar escrita. Ligar as duas juntas transformaria qualquer erro de classificação de setor em 'não consigo mais trabalhar', no meio do expediente.
2. `nivel_de_acesso(user, obj)` devolve 'dono' (o item pertence a um setor do usuário — aí compartilhamento nem entra na conta), 'edicao', 'leitura' ou None. Entre empréstimos o mais permissivo vence.
3. `pode_editar` = nível em ('dono','edicao'). O gate DRF é `SetorPermiteEscrita.has_object_permission`, acoplado a TODA rota de detalhe pelo `check_object_permissions` do `CompartilhamentoSetorMixin` (e não por permission_classes, que cada viewset poderia esquecer de incluir).
4. POST não passa por gate de objeto: a criação é coberta por `checar_escrita_no_pai(user, pai)`, que levanta PermissionDenied se o pai foi emprestado só para leitura.
5. `sprints_editaveis` / `projetos_editaveis` / `cards_editaveis` alimentam `queryset=` de PrimaryKeyRelatedField (só nível 'edicao' + setor dono). Elas leem a flag DE ESCRITA inline, e não `_sem_escopo`, porque restringir queryset de campo gravável RECUSA UMA ESCRITA — se obedecessem à flag de visibilidade, ligar só a visibilidade já começaria a barrar PATCH/POST.

**Atribuição de setor e a regra do balde de não classificados**

1. Todas as portas de atribuição (PATCH do usuário, criação pela gestão, bulk-assign-setor, cadastro público) passam por `sincronizar_setor_primario(user, setor_obj, operador)` em accounts/serializers.py.
2. `setor_obj=None` REMOVE todos os vínculos (antes só zerava a marca de primário, e o resultado era um estado ilegível: a tela dizia 'sem setor' enquanto o M2M — a autoridade do escopo — dizia que a pessoa era de Tecnologia).
3. Com setor: `get_or_create`, marca is_primary e desmarca os demais.
4. Sempre termina em `aplicar_regra_do_setor_padrao(user)`, que mantém dois invariantes: (1) quem ganha QUALQUER setor real SAI de 'sem_setor' — o vínculo residual entregaria à pessoa todo o conteúdo não classificado da empresa, já que os setores do usuário são SOMADOS, nunca interseccionados; (2) ninguém fica com ZERO setores — o escopo é fail-closed, e plataforma em branco é lida como defeito por quem opera.
5. A quarta porta é `UserViewSet.remover_setor`, que chama a regra depois de apagar o vínculo.
6. `_setor_padrao_estrito()` resolve 'sem_setor' SÓ pelo codename, sem o fallback 'primeiro setor do catálogo' de `setor_padrao_do_sistema()` — porque aqui se APAGA e se CRIA vínculo de usuário, e o fallback expulsaria gente do primeiro setor da lista ou entregaria o conteúdo dele de brinde.

**Offboarding: desativação em vez de exclusão**

1. DELETE /api/users/{id}/ responde 405 com a instrução de usar set-active.
2. POST /api/users/{id}/set-active/ {is_active:false}, dentro de uma transação: is_active=False → `Token.objects.filter(user=instance).delete()` → `desatribuir_cards_de_usuario_desativado(instance, operador=request.user)`.
3. `transaction.on_commit` emite `account_deactivated` — o broadcast fica FORA da transação porque o contrato do realtime é 'cliente recebe o evento e refaz o GET', e evento emitido dentro da transação faria o cliente ler estado velho.
4. `User.delete()` (models.py) faz o mesmo caminho, com operador=None, para que shell e /admin do Django não tenham um offboarding diferente do da API.
5. Os dois pontos estão marcados no código como PAREADOS: qualquer PORTA NOVA de desativação precisa chamar `desatribuir_cards_de_usuario_desativado`.

**Recuperação de conta e reset de senha**

1. Todo usuário nasce com um `recovery_code` XXXX-XXXX-XXXX gerado por `_generate_recovery_code` (alfabeto A-Z0-9, unicidade garantida no DB, até 20 tentativas). Ele NÃO expira por tempo — a coluna `recovery_code_expires_at` foi adicionada na migration 0006 e REMOVIDA na 0007.
2. POST /api/users/recover-account/ {recovery_code, new_password, confirm_password}: valida força da senha, rotaciona o código (o antigo deixa de valer no ato) e apaga todos os tokens — defesa contra atacante que já tinha token.
3. Mensagem de erro unificada ('Código de recuperação inválido.') tanto para código inexistente quanto para conta inativa, para evitar enumeration.
4. Caminho alternativo, para quem não guardou o código: POST /api/users/{id}/reset-password/ por quem tem manage_users. Sem esta rota, uma conta perdida só voltaria com acesso ao shell do servidor.
5. Regra de senha (`_validate_password_strength`): mínimo 8 caracteres, ao menos uma maiúscula, uma minúscula e um caractere especial de `!@#$%^&*()_+-=[]{}|;:,.<>?`. Note: dígito NÃO é exigido, embora `_generate_strong_password` sempre inclua um.

**Compartilhamento de um item entre setores**

1. `CompartilhamentoSetorMixin` (accounts/sharing.py) é plugado nos viewsets de Sprint/Project/Card/Chamado e adiciona GET/POST <recurso>/{id}/compartilhar/, protegido por `HasPerm('manage_setor_sharing')`.
2. POST recebe `setores`: aceita a forma curta `["comercial"]` (nível leitura, o caso comum) e a longa `[{"setor":"comercial","nivel":"edicao"}]`.
3. O setor DONO é removido da lista desejada — compartilhar com o próprio dono é ruído e faria a lista crescer sozinha a cada reatribuição.
4. `_sincronizar` ATUALIZA vínculos existentes em vez de recriar, para que quem já tinha acesso preserve a data e o autor originais do empréstimo.
5. O payload devolve `meu_acesso` (`nivel_de_acesso` de quem perguntou), para a tela decidir entre formulário e aviso de somente leitura sem uma segunda requisição e sem refazer a regra no frontend.

### Segmentação por setor — hoje desligada

O recorte por setor (`backend/apps/accounts/scoping.py`) existe inteiro:
`scope_*` por tipo de conteúdo, `nivel_de_acesso`, `pode_editar`,
`checar_escrita_no_pai` e os querysets de campo gravável. Ele está atrás de duas
feature flags:

| Flag | Default | O que liga |
|---|---|---|
| `SETOR_SCOPING_ENABLED` | `False` | o recorte de **leitura** por setor |
| `SETOR_WRITE_ENFORCEMENT_ENABLED` | `False` | o bloqueio de **escrita** fora do setor |

**Com as duas desligadas, esses gates são fail-open** — deixam passar. Isso
importa para quem for ligá-las: há um vazamento **dormente** documentado nos
testes (`backend/apps/feedbacks/tests_escopo_fase2.py`, 30 linhas de docstring).
O setor `sem_setor` não é "o setor de ninguém": é o balde de todo usuário ainda
não classificado — 14 de 15 vínculos no banco de desenvolvimento. Qualquer
conteúdo ancorado nele fica visível para todos eles no instante em que o recorte
for ligado. Foi por isso que o fluxo de feedbacks ganhou um setor técnico próprio.

---
