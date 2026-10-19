# Plano — "Meus Afazeres" vira "Minhas Anotações"

> Dez mudanças pedidas em 19/10/2026. **Nenhuma implementada ainda** — o trabalho
> foi pausado para corrigir o SLA do Suporte primeiro.
>
> Cada item tem um prompt pronto para ser usado sozinho. Eles foram escritos
> depois de ler o código, então citam arquivo e função — não são repetição do
> pedido.

## Onde isto vive

| | |
| --- | --- |
| Tela | `frontend/src/pages/MyTasks.tsx` — **2.306 linhas, tudo num arquivo só** |
| Serviço | `frontend/src/services/userNoteService.ts` |
| Rota | `ROUTES.meusAfazeres = '/meus-afazeres'`, com redirecionamento legado de `/mytasks` |
| Modelos | `UserNote` e `UserNoteItem`, em `backend/apps/projects/models.py` |

**`UserNote`**: `title`, `color` (com `choices`), `pinned`, `archived`, `order`.
**`UserNoteItem`**: `note` (FK), `kind` (`text` \| `todo`), `text`, `done` (**booleano**), `order`, `parent` (FK — é daqui que sai a hierarquia).

## Ordem recomendada

Os itens **4, 3 e 7 são perda e corrupção de dados** — fazem o usuário perder
trabalho. Vêm primeiro, antes de qualquer melhoria visual.

Os itens **6 e 10 exigem migração de banco.** Com outra branch viva em paralelo,
alinhe antes de rodar `makemigrations`: duas branches gerando migração pegam
números na mesma sequência e colidem, e o container roda `migrate` a cada start.

| Ordem | Item | Natureza | Migração |
| ---: | --- | --- | --- |
| 1 | 4 — salvar automaticamente | perda de dados | não |
| 2 | 3 — indentação some ao concluir | corrupção | não |
| 3 | 7 — itens duplicam ao concluir | corrupção | não |
| 4 | 2 — alvo de clique do fixar | usabilidade | não |
| 5 | 5 — menu de cores cortado | usabilidade | não |
| 6 | 1 — renomear a tela | rótulo | não |
| 7 | 6 — 25 cores | visual | **sim** (`choices`) |
| 8 | 9 — alternar tipo do item | interação | não |
| 9 | 8 — preview ao indentar | interação | não |
| 10 | 10 — quatro estados do item | funcionalidade | **sim** (campo novo + conversão) |

---

## 1. Renomear a tela para "Minhas Anotações"

> Renomeie a tela "Meus Afazeres" para "Minhas Anotações".
>
> O rótulo aparece em cinco arquivos, e um deles é fácil de esquecer:
> `components/layout/Sidebar.tsx`, `components/layout/Layout.tsx`,
> `pages/MyTasks.tsx` (o `<h1>`), e **`components/login-demo/DemoSidebar.tsx`** —
> a barra lateral falsa da animação da tela de login, que também mostra o nome.
> Há ainda menções em comentários de `ProjectDetails.tsx` e `SprintDetails.tsx`
> ("Meus Afazeres → Cards Fixados"), que devem acompanhar.
>
> **Decida e me diga antes de mexer na URL:** a rota hoje é `/meus-afazeres`, com
> um redirecionamento legado de `/mytasks` em `App.tsx`. Se a URL também mudar
> para `/minhas-anotacoes`, precisamos de um segundo redirecionamento, senão todo
> link salvo ou favoritado quebra. Se não mudar, a URL passa a discordar do nome
> da tela.

## 2. O alvo de clique do fixar/desafixar

> No card de anotação **minimizado** (fechado), o ícone de fixar/desafixar é
> difícil de acertar — o clique em cima dele falha com frequência.
>
> Em `pages/MyTasks.tsx`, investigue a área clicável real do botão no estado
> minimizado. Suspeitas prováveis, nesta ordem: a área de toque é apenas o ícone
> (~16 px) sem preenchimento ao redor; algum elemento sobreposto intercepta o
> clique; ou o `onClick` está no ícone e não no botão.
>
> O alvo deve ter no mínimo 32×32 px e o clique precisa funcionar em toda essa
> área, não só sobre o desenho. Confira também que o clique no botão **não**
> propaga para o card e acaba abrindo a anotação.

## 3. A indentação some ao marcar como concluído

> **Corrupção de dados — prioridade alta.**
>
> Ao clicar na caixinha de um item com o card de anotação **minimizado**, o item
> é marcado como concluído, mas **todos os itens perdem a hierarquia**: os que
> estavam indentados sob outro voltam para a margem esquerda.
>
> A hierarquia é persistida em `UserNoteItem.parent` (FK). Então o `parent` está
> sendo apagado ou não está sendo enviado. Investigue em `pages/MyTasks.tsx` e
> `services/userNoteService.ts` o caminho que marca um item como concluído a
> partir do card minimizado — provavelmente ele reenvia a lista inteira de itens
> montada sem o campo `parent`, e o backend grava `null`.
>
> Compare com o caminho equivalente no card **aberto**, que aparentemente
> preserva a hierarquia: a diferença entre os dois é a pista.
>
> Escreva um teste que marque um item concluído numa nota com itens indentados e
> verifique que todos os `parent` continuam intactos depois.

## 4. Salvar automaticamente, sem depender do botão

> **Perda de dados — prioridade máxima.**
>
> Hoje uma anotação só é gravada ao clicar em "Salvar". Quem fecha o card, troca
> de tela ou fecha o navegador perde o que digitou.
>
> Toda anotação, nova ou existente, deve salvar sozinha: ao **parar de digitar**
> (com espera de 600 a 1000 ms, para não gerar uma requisição por tecla) e ao
> **fechar o card**.
>
> Pontos que costumam morder, e que o teste precisa cobrir:
>
> - **Anotação nova ainda não tem id.** O primeiro salvamento cria e devolve o
>   id; os seguintes atualizam. Duas digitações rápidas não podem criar duas
>   anotações — segure a criação numa promessa única.
> - **Fechar o card não pode perder o que está na espera.** Ao fechar, descarregue
>   imediatamente o que estiver pendente, sem aguardar o tempo.
> - **Respostas fora de ordem.** Uma requisição lenta não pode sobrescrever uma
>   mais recente. Use um contador de pedido em voo, como o seletor de cards do
>   Score faz.
> - **O botão "Salvar" continua existindo?** Decida: ou some, ou vira apenas uma
>   confirmação visual. Deixá-lo sugerindo que é necessário salvar seria mentir.

## 5. O menu de cores aparece cortado

> Com o card de anotação minimizado, o menu de seleção de cores abre cortado
> pelas bordas do card.
>
> O menu precisa ser sobreposto, escapando do recorte do card. Em
> `pages/MyTasks.tsx`, veja se o contêiner do card tem `overflow: hidden` ou um
> empilhamento que confina o menu.
>
> **Armadilha conhecida deste projeto:** `position: fixed` **não** é fixo dentro
> de um ancestral com `transform` — e os cards aqui têm animação de entrada que
> cria exatamente esse contexto. A saída usada em outros pontos do sistema é
> `createPortal` para fora da árvore do card. Veja como o `Dialog`
> (`components/ui/dialog.tsx`) resolve isso.

## 6. Vinte e cinco cores, numa matriz 5×5

> **Exige migração.**
>
> Hoje existem **seis** cores em `UserNoteColor`
> (`backend/apps/projects/models.py`): `default`, `lilas`, `rosa`, `verde`,
> `azul`, `bege` — descritas como "paleta inspirada em papéis Color Plus / Sirio
> Color". Elas são escuras e sem vida.
>
> Monte **25 cores numa grade 5×5**, mais vivas que as atuais, **sem serem
> berrantes**. Sugestão de organização: cinco matizes (as atuais mais os que
> faltam) em cinco níveis de saturação/luminosidade cada, para a grade ter lógica
> visual em vez de ser um amontoado.
>
> Cuidados:
>
> - Cada cor precisa funcionar em **tema claro e escuro**, com o texto legível por
>   cima. O sistema tem os dois.
> - As seis cores existentes não podem sumir: anotações já gravadas apontam para
>   elas. Ou mantenha as chaves atuais dentro da paleta nova, ou escreva a
>   conversão na migração.
> - `choices` novo gera migração (`AlterField`). Alinhe com as outras branches.

## 7. Itens duplicam ao marcar como concluído

> **Corrupção de dados — prioridade alta.**
>
> Já aconteceu mais de uma vez: ao concluir um item com o card **minimizado**,
> **todos** os itens da anotação duplicam. Exemplo real: marcar "subir pr e fazer
> o merge" e, depois disso, a lista inteira aparecer em dobro.
>
> O sintoma (lista inteira duplicada, não só o item marcado) aponta para o
> salvamento reenviando a lista completa e o backend **criando** em vez de
> atualizar — provavelmente porque os itens vão sem `id`, ou porque a gravação
> apaga e recria e isso corre duas vezes.
>
> Investigue em `services/userNoteService.ts` e na view correspondente do backend
> como os itens são persistidos. Procure um `delete` seguido de `create`, ou
> itens enviados sem identificador.
>
> **Provavelmente é a mesma raiz do item 3** (a indentação que some): os dois
> acontecem no card minimizado, ao concluir, e os dois sugerem que aquele caminho
> remonta a lista. Investigue juntos — pode ser um conserto só.
>
> Teste obrigatório: concluir um item duas vezes seguidas, rápido, e verificar que
> a contagem de itens não muda.

## 8. Preview ao arrastar para indentar

> Hoje, ao arrastar um item lateralmente dentro do card para indentá-lo sob outro,
> não há retorno visual — só se descobre o resultado ao soltar.
>
> Mostre um preview durante o arraste: a linha-guia na posição em que o item vai
> ficar, com o deslocamento horizontal do nível de indentação alvo.
>
> O projeto já usa `@dnd-kit` e tem um componente de arraste com física própria
> (`components/kanban/ArrastoEstilingue.tsx`) — vale olhar antes de inventar outro
> jeito, para o movimento ficar coerente com o resto do sistema.
>
> Defina e respeite um **limite de profundidade**. Sem limite, dá para indentar
> indefinidamente e a leitura do card quebra.

## 9. Uma forma consistente de trocar o tipo do item

> Hoje transformar texto em item marcável (e o contrário) é clicar num tracinho ou
> num ícone à direita do item — dois gestos diferentes para a mesma ação,
> dependendo de qual é o tipo atual.
>
> `UserNoteItem.kind` só tem dois valores: `text` e `todo`.
>
> Proponha **um único gesto**, igual nos dois sentidos. Antes de implementar, me
> apresente duas ou três alternativas com o prós e contras de cada — por exemplo
> um menu no item, um atalho de teclado no início da linha (estilo Markdown
> `[] `), ou um botão de alternância sempre visível.
>
> Seja qual for a escolha, o estado atual do item precisa ficar evidente **sem
> passar o mouse**.

## 10. Quatro estados do item, não dois

> **Exige migração com conversão de dados. É o maior item da lista.**
>
> Hoje `UserNoteItem.done` é **booleano**: marcado ou desmarcado. Queremos quatro
> estados:
>
> | Estado | Ícone |
> | --- | --- |
> | Concluído | o atual |
> | Em andamento | um ícone que represente progresso |
> | Pendência | triângulo amarelo |
> | Descartado | x vermelho |
>
> Interação pedida: **clicar na caixa marca como concluído** (atalho para o caso
> comum); **passar o mouse** abre um menuzinho abaixo com os quatro estados para
> escolher.
>
> Backend: `done` (booleano) precisa virar um campo de estado. Migração em dois
> passos, para não perder nada: criar o campo novo, converter `done=True` para
> "concluído" e `done=False` para "desmarcado", e só então remover o booleano —
> em commits separados, para que um deploy intermediário não quebre.
>
> **Decida antes:** item "descartado" e item "concluído" contam igual em qualquer
> lugar que some itens? E um item em "pendência" ou "descartado" continua
> aparecendo na contagem do card minimizado?

---

## Em aberto, para decidir antes de começar

1. **A URL muda junto com o nome?** (item 1)
2. **O botão "Salvar" continua existindo** depois do salvamento automático? (item 4)
3. **As seis cores atuais sobrevivem** dentro da paleta de 25, ou são convertidas? (item 6)
4. **Qual gesto** para alternar o tipo do item? (item 9)
5. **Descartado e concluído contam igual?** (item 10)

## O que ninguém mediu ainda

O banco de desenvolvimento estava parado quando este plano foi escrito, então
**não há números de uso**: quantas anotações existem, quantos itens, quantos
estão indentados. Antes de mexer nos itens 3, 6, 7 e 10, suba o banco e meça — em
especial quantos itens têm `parent` preenchido, que é o que os itens 3 e 8
afetam, e quantas anotações usam cada cor, que é o que o item 6 afeta.
