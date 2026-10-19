# Registro de versões — BWA Tech

O número da versão vive em [`VERSION`](VERSION), na raiz. É de lá que o backend
o lê e a tela de perfil o mostra — não há segunda cópia em código.

## Como versionamos

Três números, `MAIOR.MENOR.CORREÇÃO`, e cada um responde a uma pergunta
diferente sobre o que mudou:

| Sobe | Quando | A pergunta que responde |
|---|---|---|
| **MAIOR** | grande mudança no sistema | *alguém precisa mudar o jeito de trabalhar?* Um fluxo sai, uma regra passa a recusar o que antes aceitava, uma integração muda de contrato |
| **MENOR** | funcionalidade nova | *dá para fazer algo que antes não dava?* |
| **CORREÇÃO** | conserto de defeito | *o que já existia passou a funcionar como se esperava?* |

O teste é sempre do lado de **quem usa**, não do código. Uma refatoração grande
que ninguém percebe não sobe nada; um botão de uma linha que habilita uma ação
nova sobe o MENOR.

**Numa leva com mais de um tipo, vence o mais alto.** Uma versão com quatro
correções e uma funcionalidade nova é MENOR — o número diz o TETO do que mudou, e
é o detalhe que a seção abaixo dele cobre.

**Sobe um, zera os de baixo:** depois da 2.2.4, uma funcionalidade nova vira
2.3.0 (e não 2.3.4); uma grande mudança vira 3.0.0.

### Uma versão por commit

**Todo commit que muda o app sobe a versão.** Dez commits são dez versões. O
número não espera por um "fechamento": ele viaja DENTRO do commit, junto com a
entrada aqui no registro.

Isso tem uma consequência que é o ponto todo: **a versão identifica um commit,
sem ambiguidade**. `git show v2.3.4` mostra exatamente o que entrou naquele
número, e a versão no rodapé do perfil aponta para uma linha única do histórico —
não para "algum lugar entre a 2.2.0 e a próxima".

Cada commit sobe o dígito do SEU tipo, e zera os de baixo:

| O commit | 2.3.4 vira |
|---|---|
| conserta um defeito | 2.3.5 |
| traz funcionalidade nova | 2.4.0 |
| é uma grande mudança | 3.0.0 |

**Não há mais commit de "fechar versão".** `VERSION` e a seção do registro fazem
parte do commit que faz o trabalho — separá-los é o que criou o problema que
levou a esta regra: a 2.2.0 foi fechada e doze commits entraram em produção
depois dela, sob o mesmo número.

O que **não** sobe versão: commit que não chega ao app — documentação, scripts
locais, testes. O critério já está escrito em
[`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml):
se o caminho está na lista que dispara o build, gerou imagem nova e é versão.

### Tags, e o que de fato foi para produção

**Toda versão vira uma tag**, então a tag também é por commit. É ela que torna a
versão verificável: `git show v2.3.4:VERSION` responde qual era o número, e
`git diff v2.3.4..v2.4.0` mostra o que entrou entre uma e outra.

Vale saber a diferença entre versão e implantação: um push com cinco commits
deploya UMA vez, então as quatro versões do meio existem como marco no histórico,
não como estado que rodou no servidor. Quem responde "o que está no ar agora" é o
rodapé do perfil, que lê o `VERSION` da imagem em execução — e ele aponta a
versão do ÚLTIMO commit da leva.

### A cada commit

Três coisas entram no MESMO commit do trabalho — não depois:

1. `VERSION`, subindo o dígito do tipo do commit.
2. A seção aqui no registro, dizendo o que mudou para **quem usa** — não os
   arquivos tocados, que o git já guarda.
3. O código.

Depois de comitar, a tag:

```bash
git tag -a v2.4.0 -m "Timeline do ticket recolhe para o canto"
```

E, quando a leva estiver pronta para ir ao ar:

```bash
git push origin main --tags
```

O deploy é automático no push para `main`; a tag não dispara nada, ela serve para
achar e reverter depois. Se a leva tem cinco commits, são cinco tags indo juntas
num push só — e é isso que faz cada número apontar para uma linha exata do
histórico.

### Para reverter

`git revert` do intervalo da versão, ou voltar a imagem anterior no servidor.
**Migração de banco não volta sozinha** — confira aqui se a versão teve migração
antes de reverter, e reverta a migração antes do código.

---

## 2.7.1

Data: 19/10/2026 · migração de banco: **não**

Correções nas métricas de chamados do Suporte.

- **O SLA deixou de contar sábado e domingo.** Um chamado aberto na sexta às 16h
  e resolvido na segunda às 10h contava 66 horas e saía como atrasado; agora
  conta 18 horas úteis e está no prazo. A tela de Suporte já descontava o fim de
  semana — eram duas contas diferentes no mesmo sistema, e o mesmo chamado podia
  sair "no prazo" numa tela e "atrasado" na outra.
- **As métricas passam a contar o chamado no mês em que foi RESOLVIDO.** Escolher
  "setembro" mostrava os chamados *abertos* em setembro, inclusive os resolvidos
  em outubro. Os gráficos de abertura continuam contando por abertura, e cada
  card agora diz no título qual data usa.
- Enquanto as datas de conclusão carregam, os cards que dependem delas avisam que
  estão carregando em vez de mostrarem "nenhum ticket no período"; se a busca
  falhar, dizem que falhou.

### Para quem acompanha os números

**Os números de meses anteriores mudam** — é a correção, não um erro novo. Um
relatório tirado depois desta versão não vai bater com um tirado antes.

### Em aberto

O campo "chamados resolvidos" dos relatórios Executivo e Métricas Globais
**mostra zero, e sempre mostrou**: os chamados vivem no portal externo e a tabela
local está vazia. A consulta foi corrigida, mas falta a fonte. Decidir entre
contar pela linha do tempo, buscar no portal ou remover o campo.

---

## 2.7.0

Data: 28/09/2026 · migração de banco: **não**

Sobe o MENOR porque dá para fazer coisas que antes não dava: pontuar um card já
entregue, filtrar o seletor por sprint e abrir o card em leitura de dentro do
Score.

### Score

- **O score acompanha o card na virada da sprint.** Ele ficava no card da sprint
  encerrada, e como a tela lê o status ao vivo do card apontado, mostrava o
  status congelado no fechamento: quatro scores apareciam como "Em
  Desenvolvimento", "Em Homologação" ou "A Desenvolver" para trabalho já
  entregue. Cinco dos oito scores da base estavam presos em cards da Sprint 8.26.
  **Há comando para corrigir o que já está gravado** — ver o fim desta entrada.
- **Todo card pode receber nota.** Antes o seletor recusava card finalizado, com
  o argumento de que não faz sentido pontuar algo concluído — e o efeito era o
  oposto do que a tela promete: pontuar virava algo que alguém tinha de *lembrar*
  de fazer antes de concluir. Eram 132 cards entregues fora do alcance na sprint
  vigente, contra 59 dentro. Sprint encerrada e projeto arquivado também entram.
- **Card de projeto de sistema não entra** (Sugestões, Suporte, Descartados,
  Monitoramento de Feedbacks): não é trabalho entregue.
- **O seletor carrega aos poucos**, conforme se rola, e a busca procura em
  **todos** os cards e não só nos carregados. Sem isso a lista abria com 1515
  previews de uma vez.
- **Seletor de sprint** no "Atribuir Score", com as sprints em ordem cronológica.
- **Clicar no card** abre-o em leitura, e o botão do rodapé abre **aquele card**
  no quadro do projeto — antes navegava só para a página do projeto e deixava a
  pessoa procurando.
- **O modal de editar desenha o card igual ao de atribuir.** Ele dependia de
  achar o card na lista do seletor, que excluía finalizado — justamente o card
  que se costuma editar. Mostrava só o nome.
- A tela **cabe na altura da janela**: a rolagem é da tabela, não da página.
- Etiquetas de setor do mesmo tamanho, centradas e com inicial maiúscula; filtros
  com a largura do próprio conteúdo e a busca ocupando a sobra; cabeçalhos de
  Projeto, Setor, Status e Score centrados; contador "Mostrando x de x" removido.

### Em todo o sistema

- **Os modais abrem e fecham animados.** O componente desmontava no mesmo quadro
  em que a animação de saída começaria, então ela nunca rodava. Vale para todos
  os modais, porque o componente é um só. Quem pede menos movimento continua sem
  animação.
- **A flag de projeto de sistema atravessa a virada de sprint.** A replicação não
  a copiava, então cada virada criava uma cópia de "Sugestões", "Suporte" e
  "Descartados" como projeto de trabalho comum — 11 projetos estavam assim na
  base, e **toda regra que depende dessa flag falhava em silêncio a partir da
  Sprint 7.26**. **Há comando para corrigir o que já está gravado.**
- O relatório de Gargalos contava os dias de atraso dos cards em aberto por
  subtração crua, divergindo do relatório de Backlog para o mesmo card.

### Depois do deploy, rodar na VPS

```
python manage.py corrigir_score_preso_em_card_replicado --aplicar
python manage.py remarcar_projetos_de_sistema --aplicar
```

Os dois **simulam por padrão**: sem `--aplicar` apenas mostram o que fariam. O
primeiro move 5 scores para o card vivo; o segundo remarca 11 projetos.

---

## 2.6.12

Data: 17/09/2026 · migração de banco: **não**

- **O selo "Fora do prazo" deixou de acender antes da hora.** A versão anterior
  deu um minuto de tolerância à *entrega*, mas o card ainda em aberto continuava
  sendo marcado como atrasado a partir de 18:30:00 — não de 18:31:00. Dava uma
  contradição de 59 segundos: às 18:30:30 a tela dizia "fora do prazo" e, se o
  card fosse concluído às 18:30:40, ficava gravado como entregue no prazo. O
  mesmo card, no mesmo minuto, com dois veredictos. Agora o prazo "18:30" vale
  até 18:30:59 dos dois lados — na tela, na notificação de atraso e nos três
  relatórios que contam cards em aberto.
- **O selo "Atrasado" do quadro da sprint estava respondendo outra pergunta, e
  acertava o rótulo ao contrário.** Para card já entregue, ele comparava o
  *prazo* com o fechamento da sprint em vez de olhar *quando a entrega saiu*.
  Medido na base: dos 902 cards entregues com prazo, ele marcava 28 que **não**
  atrasaram e deixava sem selo os 100 que atrasaram — nenhum acerto em comum
  com o número das Métricas. Agora usa a mesma regra do resto do sistema, então
  **128 cards mudam de selo** nessa tela.
- **A coluna "Atraso (dias)" do relatório de Gargalos** contava os dias por
  subtração crua, enquanto a coluna equivalente do relatório de Backlog já
  usava a regra. Os dois davam números diferentes para o mesmo card na janela
  de um minuto depois de cada virada de dia.
- **Auditoria dos 1.455 cards da base**, do primeiro ao último: 902 têm prazo e
  conclusão e passam pela regra (802 no prazo, 100 atrasados); 165 estão em
  aberto com prazo (153 vencidos); os demais não têm prazo gravado e ficam fora
  da pergunta. Banco e código concordam card por card nos dois lados, sem uma
  única divergência.

---

## 2.6.11

Data: 17/09/2026 · migração de banco: **não**

- **Quem entrega dentro do minuto do prazo deixou de contar como atrasado.** O
  prazo é escolhido em minutos, mas a entrega é registrada em segundos: um card
  com prazo às 18:30 e conclusão às 18:30:26 aparecia como "Fora do prazo"
  mostrando, na tela, exatamente o mesmo horário do prazo. Quatro cards estavam
  nessa situação; os outros 100 atrasos, de horas ou dias, seguem como atrasos.

---

## 2.6.10

Data: 14/09/2026 · migração de banco: **não**

- **A página da sprint deixou de recarregar tudo por mudanças que ela mesma
  acabou de aplicar.** Concluir ou editar um card disparava uma recarga completa
  do quadro logo em seguida, sem nada a corrigir.

---

## 2.6.9

Data: 14/09/2026 · migração de banco: **não**

- **Na página da sprint, o card finalizado aparece como finalizado na hora.**
  Ele voltava a se mostrar "em desenvolvimento" por até meio minuto depois de
  concluído — o navegador estava servindo uma cópia guardada da tela, de antes
  da mudança, e ela sobrescrevia o que já estava certo.

---

## 2.6.8

Data: 14/09/2026 · migração de banco: **não**

- **O card que passa para a próxima sprint leva os links junto.** Eles ficavam
  para trás no card da sprint encerrada, onde ninguém procura. Os **anexos** e o
  **compartilhamento entre setores** tinham o mesmo problema e foram junto.

---

## 2.6.7

Data: 14/09/2026 · migração de banco: **não**

- **Os chamados de Suporte voltaram a funcionar.** O portal saiu da porta 3334 e
  passou a atender na porta padrão; o BWA Tech continuava procurando no endereço
  antigo, que não responde mais.

---

## 2.6.6

Data: 03/09/2026 · migração de banco: **não**

- **O círculo da troca de tema passa a nascer sempre no botão do sol, e a
  cobrir a tela inteira**, em qualquer resolução. Havia caminhos em que ele
  nascia no meio da tela ou parava antes da borda.

---

## 2.6.5

Data: 31/08/2026 · migração de banco: **não**

- **Quem supervisiona deixou de aparecer em "Usuários sem card", no Dashboard.**
  O admin estava listado ali. Cobrar card de quem distribui card não quer dizer
  nada — e a tela de Prioridades já não os mostrava, então as duas telas davam
  respostas diferentes para a mesma pergunta.

  A regra é por **permissão**, não por nome de cargo: um cargo novo, com o nome
  que for, some da lista se tiver a permissão de gerenciar prioridades, e
  aparece se não tiver.

---

## 2.6.4

Data: 31/08/2026 · migração de banco: **não**

- **O filete entre os itens do Dashboard ficou simétrico**: roxo no meio, ciano
  nas pontas, sumindo dos dois lados.

---

## 2.6.3

Data: 31/08/2026 · migração de banco: **não**

- **As listas do Dashboard viraram linhas separadas por um filete**, em vez de
  um cartão em volta de cada item. O painel já é a moldura; repetir uma em cada
  linha empilhava molduras e comia altura. O filete usa as cores do separador do
  cabeçalho, com 1px, e vai sumindo até o fim da linha.

---

## 2.6.2

Data: 31/08/2026 · migração de banco: **não**

- **O Dashboard cabe numa tela.** As listas de "Cards em Desenvolvimento" e
  "Usuários sem card" agora rolam por dentro dos próprios cartões, em vez de
  esticarem a página. Num monitor comum elas ficaram até maiores do que eram.

---

## 2.6.1

Data: 31/08/2026 · migração de banco: **não**

- **Saiu a seção "Projetos Recentes" do Dashboard**, que não era usada.

---

## 2.6.0

Data: 31/08/2026 · migração de banco: **não**

- **Trocar entre o modo claro e o escuro virou um círculo que abre a partir do
  botão**, varrendo a tela até o canto mais distante. Antes a troca era seca, no
  meio de um piscar.

- **E o botão virou um sol que se transforma em lua.** Não são dois ícones se
  revezando: é o mesmo disco, com os raios recuando e uma sombra crescendo até
  deixá-lo em crescente.

- De quebra, as barras de rolagem e os campos nativos passam a acompanhar o
  tema — no escuro eles continuavam claros.

---

## 2.5.6

Data: 31/08/2026 · migração de banco: **não**

- **O Daily Mode agora existe só na aba "Prioridades do Dia".** Trocar para a
  aba da semana desliga o modo, e o seletor some — a reunião fala do que está
  acontecendo agora; a aba da semana é planejamento, e o formato de uma pessoa
  por vez não responde a essa pergunta.

- **Sair da tela também desliga.** O modo deixou de ser lembrado entre visitas:
  ele é o estado de uma reunião em andamento, não uma preferência.

---

## 2.5.5

Data: 31/08/2026 · migração de banco: **não**

- **Sumiram as barras de rolagem que piscavam ao avançar para a próxima pessoa
  no Daily Mode.** Apareciam só no "próximo", nunca no "voltar".

---

## 2.5.4

Data: 31/08/2026 · migração de banco: **não**

- **A troca de pessoa no Daily Mode ficou mais suave.** A transição era rápida
  demais para o olho acompanhar — lia como um corte, não como uma troca. Agora
  as três colunas entram em ordem de leitura, e os cards aparecem escalonados
  dentro delas.

- **O avatar de quem está falando voltou a ter um halo**, agora fino o bastante
  para caber na barra sem ser cortado.

---

## 2.5.3

Data: 31/08/2026 · migração de banco: **não**

- **A coluna "Em desenvolvimento" do Daily Mode agora separa os cards por
  projeto**, do mesmo jeito que a coluna da direita separa as entregas por dia.
  Quem tem trabalho espalhado em três frentes vê as três, em vez de uma pilha
  única. A ordem dos projetos segue a urgência dos cards, não o alfabeto.

---

## 2.5.2

Data: 31/08/2026 · migração de banco: **não**

- **No Daily Mode, o espaço de "nenhum card em desenvolvimento" agora tem o
  tamanho de um card.** Era uma tira fina, e a coluna mudava de altura conforme
  a pessoa pegava ou largava trabalho.

- **A coluna "Última semana" não tem mais barra de rolagem horizontal.**

---

## 2.5.1

Data: 31/08/2026 · migração de banco: **não**

- **No Daily Mode, quem rola agora é a coluna, e não a página.** Com mais de um
  card, ou com cards grandes, a página inteira crescia e a barra de rolagem
  aparecia na janela — o rodapé com a fila da equipe saía da vista justamente
  durante a reunião, que é quando ele mais serve.

---

## 2.5.0

Data: 31/08/2026 · migração de banco: **não**

- **A página de Prioridades ganhou o Daily Mode.** A visualização em grade
  responde "como está a equipe?" de relance; a reunião diária faz outra
  pergunta, e uma pessoa de cada vez. Com a equipe inteira na tela, quem vai
  falar precisa procurar o próprio cartão antes de começar, e quem ouve não sabe
  para onde olhar.

  O novo modo mostra **uma pessoa por vez**, em três colunas: o que ela está
  tocando agora, o que concluiu hoje e o que entregou nos últimos dias. Embaixo,
  a fila da equipe — quem já passou fica marcado, e dá para andar pelas setas do
  teclado sem tirar a mão do lugar.

  É um **seletor**, e não uma terceira aba: "Dia" e "Semana" escolhem quais
  cards; o Daily Mode escolhe como eles aparecem, e vale para os dois. A escolha
  fica guardada, então quem conduz a reunião abre a página já no modo certo.

- **Os cards são os mesmos do kanban.** Cor de prioridade, etiquetas de área e
  tipo, aviso de atraso e link de script — tudo idêntico ao quadro, porque é o
  mesmo componente. Clicar abre o card, como em qualquer outra tela.

- **O motivo de cada card parado agora aparece escrito no card.** Antes essa
  informação existia no histórico e não chegava a lugar nenhum: a tela dizia
  "parado por pendências" sem dizer parado por quê, que é justamente o que a
  reunião precisa saber.

- **O card abre na hora.** Ao clicar em um card na página de Prioridades, o modal
  esperava a resposta do servidor antes de sequer aparecer — um a dois segundos
  de tela parada, sem sinal de que algo estava acontecendo. Agora ele abre
  imediatamente, já com o conteúdo que a página tinha em mãos.

---

## 2.4.2

Data: 24/08/2026 · migração de banco: **não**

- **A proteção passou a valer para todas as ações do Suporte**, e não só para
  carregar a lista. Mover um chamado entre colunas com o portal fora ainda
  consumia capacidade do servidor antes de desistir — pouco, mas era a tela de
  Suporte cobrando das outras, que é o que a versão anterior existe para acabar.

---

## 2.4.1

Data: 24/08/2026 · migração de banco: **não**

- **O sistema não cai mais junto com o portal de chamados.** Hoje, às 08:02, o
  portal externo onde os chamados de suporte moram ficou inalcançável — e levou o
  BWA Tech inteiro com ele: home, kanban e login pararam de responder, e o site
  passou a devolver 404. A causa era o tempo de espera: cada pedido à tela de
  Suporte segurava o servidor por até 90 segundos aguardando uma resposta que não
  vinha, até não sobrar capacidade para servir nenhuma outra tela.

  Agora a espera é curta e, se o portal falhar algumas vezes seguidas, o sistema
  para de tentar por meio minuto e responde na hora — **só a tela de Suporte fica
  indisponível, e o resto segue funcionando**.

- **E volta sozinho.** Passada essa pausa, o sistema testa o portal de novo por
  conta própria. Assim que ele responder, o Suporte volta ao normal sem ninguém
  precisar reiniciar nada.

- **A mensagem de erro do Suporte passou a ser legível.** Ela exibia
  "Não foi possível carregar os chamados: [object Object]"; agora diz que o
  portal está fora e que o sistema tentará de novo.

---

## 2.4.0

Data: 21/08/2026 · migração de banco: **não**

- **A timeline do ticket de suporte recolhe.** Fechar não a descarta mais: ela
  vira uma pastilha "Timeline do ticket" no canto superior direito e volta com um
  clique. Fazia mais falta aqui que no card, porque este painel abre junto com o
  ticket — quem quisesse ver o formulário sem ele ao lado só tinha a opção de
  fechar de vez e perder o caminho de volta.

---

## 2.3.0

Data: 21/08/2026 · migração de banco: **não**

### Arrastar cards no kanban

- **O card agora tem peso ao ser arrastado.** Ele se inclina na direção do
  movimento — quanto mais rápido o gesto, mais inclinado —, o lugar de origem
  fica reservado com um contorno tracejado, a coluna de destino se acende, e ao
  soltar o card assenta no lugar em vez de aparecer pronto.
- **O card deixou de fugir do cursor.** Ao ser pego, ele saltava para longe do
  mouse — em telas com a barra lateral aberta, quase 300px à direita. Também
  ficava mais largo do que a coluna e transbordava.
- **Arrastar passou a funcionar em tela de toque** no quadro do projeto. Antes o
  gesto era tratado como rolagem e o card não saía do lugar.
- **A coluna reconhece a entrega sem exagero.** Não é mais preciso levar o card
  além da borda visível para ela aceitar.
- No **Geek Day**, as listas paravam de piscar e a rolagem deixou de saltar para
  o topo no meio do arrasto — o que também fazia o card cair na posição errada.

### Timeline do card

- **Fechar agora recolhe.** A timeline vira uma pastilha "Timeline do card" no
  canto superior direito, e volta com um clique. Entra e sai deslizando.
- **O painel voltou para o canto da tela.** Ele aparecia deslocado para baixo e
  para a direita, com o fim da lista cortado fora da janela e sem como alcançá-lo.
- **O fundo atrás dele passou a ser desfocado.** Sobravam faixas mostrando a
  página crua em volta de um painel flutuante.

### Avisos e telas

- **O aviso de "faltam dados" não aparece mais por cima do card.** Ele sobe
  sozinho; o formulário abre quando ele fecha. E foi refeito: cada campo que
  falta é uma linha destacada, com a mesma marca que o formulário usa, e com o
  nome que o campo tem lá dentro.
- **As barras de seleção em massa** (Projetos, Meus Afazeres, kanban, Suporte)
  voltaram para o rodapé da janela. Ficavam ancoradas no fim da lista, então em
  listas longas a pessoa selecionava itens e não via botão nenhum.
- **O tooltip do heatmap de entregas** (Métricas) voltou a aparecer. Ele nascia
  fora da tela — na prática, parecia que o heatmap não tinha tooltip.

---

## 2.2.0

Data: 20/08/2026 · migração de banco: **não**

### Relatórios

- **O relatório de cards deixou de esconder entregas.** Filtrar por período e
  por projeto voltava vazio: o mesmo projeto existe uma vez por sprint, e o
  filtro pegava só a instância da sprint atual. Selecionar um projeto agora
  alcança todas as instâncias dele; para recortar uma sprint, o filtro de sprint
  continua ali. Num caso real, 0 cards viraram 19.
- **O último dia do período passou a entrar.** Quem pedia "até segunda" perdia
  tudo que foi entregue na segunda. O mesmo defeito vivia no Executivo, nas
  Métricas Globais, em Atrasos & Gargalos e no Por Usuário: numa janela de um
  mês, 6 entregas e 2 aprovações de mudança de data reapareceram nos KPIs, e
  cinco pessoas voltaram a ter uma entrega no relatório individual.
- **Os campos de data usam o calendário do sistema.** Antes abriam o seletor do
  navegador, que aparecia no canto superior esquerdo da janela.

### Calendário (data de entrega, prazos, filtros)

- **Dá para escolher mês e ano.** Antes era uma seta por mês — doze cliques para
  voltar um ano.
- **Abrir cai no mês da data já escolhida**, e não no mês corrente. Um card com
  entrega em dezembro abria o calendário em agosto, sem nada marcado.
- **A navegação parou de pular meses.** Com uma data de fim de mês na tela,
  fevereiro era inalcançável pela seta.

### Demandas

- **Aceitar e recusar, lado a lado.** A avaliação só tinha "Avaliar", que abre o
  formulário de sprint e projeto — ou seja, só dava para aceitar. Recusar arquiva
  a demanda em "Projetos Descartados" e a encerra, sem apagar nada: autor,
  descrição e histórico ficam, e ela volta mudando de projeto.
- **A confirmação parou de mentir.** Ela prometia arquivamento ao autor da
  demanda, para quem a ação apagava o card.
- **O modal de "Criar Demanda" explica cada caminho.** Eram três botões grandes
  só com o nome, e nada dizia que ajuste de data e reabertura são pedidos que vão
  para uma fila de aprovação.

### Desempenho e carregamento

- **O dashboard abre em uma requisição.** Eram cerca de quarenta, em sequência.
  Medido: 6,53 s até o conteúdo principal, contra ~360 ms agora.
- **A página do projeto abre mais rápido**, e a lista de usuários deixou de
  custar sete vezes mais para quem é administrador.
- **Carregamento com a tela desfocada em dez páginas**, com o conteúdo entrando
  em cascata e os números subindo até o valor final, em vez de uma bolinha
  girando sobre a tela vazia. Transição suave ao trocar de página.
- **Card criado aparece no quadro sem recarregar a página.**

### Geek Day

- A roleta deixou de ser cortada, expande sobre a página antes de girar, e o
  histórico de sorteios seguiu o padrão visual do resto do sistema.

---

## 2.1.0

Data: 19/08/2026 · migração de banco: **não**

- **A versão do sistema aparece no rodapé do perfil.** Quem for reportar um
  problema consegue dizer em que versão viu. O número vem do servidor, não do
  navegador — um bundle antigo em cache mostraria a versão errada com toda a
  confiança.
- **Configurações sumiu do menu para quem não administra nada.** O item era
  exibido para todos e levava a uma página que só dizia "você não tem
  permissão". Agora só aparece para quem alcança ao menos uma das abas
  (usuários, cargos ou setores).

## 2.0.0

Data: 19/08/2026 · a partir daqui o histórico passa a ser versionado

Estado da plataforma quando o versionamento começou. O que havia de mais recente
no momento em que este registro nasceu:

- **Colunas do kanban por projeto.** Uma coluna criada pertence ao projeto:
  dois projetos podem ter, cada um, o seu "Backlog" com cards próprios, e a
  coluna acompanha o projeto na virada da sprint (antes ela ficava para trás e
  os cards dela sumiam da tela até alguém recriá-la à mão). Nome de coluna
  passou a ter limite, e nomes de etapas do sistema ficaram reservados.
- **Feedbacks pós-entrega.** Card marcado gera formulário 30 dias após ser
  finalizado; o link é público e enviado à mão. As respostas ficam no fluxo de
  monitoramento, dentro de Relatórios, com exportação em Excel e CSV.
- **Visitantes e inativos** fora do dashboard, das prioridades e do campo de
  responsável; cards abertos de quem foi desativado ficam sem responsável.
- Sprints, projetos, cards e quadro kanban; chamados de suporte; relatórios e
  métricas; Geek Day; segmentação por setor com cargos e permissões.
