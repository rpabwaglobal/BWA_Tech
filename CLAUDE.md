# BWA Tech

Plataforma interna de gestão do trabalho: sprints, projetos, cards, prioridades,
suporte, feedback pós-entrega, score e relatórios. Monorepo com Django 5.2 + DRF
em `backend/` e React 19 + TypeScript + Vite em `frontend/`.

Idioma: **português do Brasil**, em código, comentário, commit e documentação.

---

## Regras deste repositório

### 1. Documentação entra no mesmo commit

A documentação oficial vive em `C:\Users\Italo.Martins\Desktop\Docs\bwa-tech\`.
**Mudou comportamento, tela, regra, endpoint, permissão, dependência, variável
de ambiente ou procedimento de operação: a documentação é atualizada no MESMO
commit.**

Use a skill `documentar-mudanca` — ela diz qual dos seis documentos mexer e como
escrever no padrão da casa.

Nem toda mudança tem reflexo: refatoração invisível, ajuste de teste e conserto
de comentário não pedem linha nova. O critério é **mudou o que alguém precisa
saber?**

### 2. Uma versão por commit

`VERSION` e a entrada no `CHANGELOG.md` entram **dentro** do commit que faz o
trabalho, nunca num commit de "fechar versão". Só sobe versão o commit que
**chega ao app** — o critério é a lista de caminhos que dispara o build em
`.github/workflows/docker-publish.yml`. Cada versão vira uma **tag**.

As regras completas estão no topo do `CHANGELOG.md`.

### 3. Autorização é por permissão, nunca por nome de cargo

Cargos são criados pela interface e podem se chamar qualquer coisa. Use sempre
`has_perm('accounts.<codename>')`. `role__in=['desenvolvedor', ...]` quebra no
primeiro cargo novo.

Duas exceções existem e estão documentadas no código: a trava do visitante e o
backend que concede tudo a `role='admin'`.

### 4. Testes

Rode **só o alvo da mudança**, com banco de teste próprio:

```bash
cd backend && DOTENV_OVERRIDE=false DB_NAME=test_alvo python manage.py test apps.projects.tests_replicacao_sprint --keepdb
```

Sem `DB_NAME` próprio, execuções paralelas se derrubam. Cuidado com `--keepdb`
depois de uma suíte que use `TransactionTestCase`: ela limpa o seed das
migrações, e o erro aparece numa suíte diferente da que o causou.

Suíte inteira só num passe final, antes de empurrar.

**O frontend não tem teste nem infraestrutura de teste.** Verificação de
interface é manual — não afirme que testou o que não dá para testar.

### 5. Um teste que pega a PRÓXIMA regressão vale mais que dez que pegam a anterior

Exemplo no repositório: `test_nenhum_campo_novo_escapa_da_replicacao` compara o
modelo inteiro, por introspecção, contra o que a replicação de sprint copia — e
falha quando alguém acrescenta um campo ao card sem decidir se ele atravessa a
virada. Foi exatamente assim que os links se perderam.

Depois de escrever um teste, **quebre o código de propósito** e confirme que ele
cai.

### 6. Comentários explicam o porquê, e ficam perto do código

Este projeto documenta decisão em comentário, e boa parte do conhecimento
operacional está lá. Ao mudar o código, **mude o comentário junto**: comentário
que defende o que o código não faz mais é pior que nenhum.

---

## Armadilhas conhecidas

Cada uma destas já custou um bug aqui:

- **Animação CSS vence estilo inline.** Nunca aplique classe que anime
  `transform` no nó que uma biblioteca posiciona por transform. E `fill-mode:
  both` mantém o estado final valendo **depois** da animação — declarar
  `opacity` num nó animado não funciona.
- **Elemento `fixed` dentro de um nó com `transform` não é `fixed`.** A animação
  de entrada de página cria um containing block. A saída é `createPortal`.
- **Cache do navegador ≠ cache da aplicação.** Limpar o segundo não impede o
  primeiro de servir resposta antiga. Depois de uma mutação, mande
  `Cache-Control: no-cache` no pedido.
- **`permission_classes` numa `@action` substitui a lista da classe**, não soma.
- **`2>&1` em comando nativo no PowerShell 5.1**, com `ErrorActionPreference =
  'Stop'`, lança exceção — justamente quando o comando falha.
- **`.bat` é lido como ANSI.** Só ASCII nesses arquivos; texto com acento vive
  no `.ps1`.
- **O worker do Celery não recarrega.** Reinicie antes de testar mudança em
  task.

---

## O que não fazer

- Não commite nem empurre sem pedido explícito.
- Não use `role == 'nome'` para decidir acesso.
- Não coloque segredo em arquivo versionado. (O `.env` já está no histórico —
  isso é dívida conhecida, não permissão.)
- Não renomeie projetos de sistema: há regras ainda acopladas ao nome literal, e
  renomear cala notificações em silêncio.
