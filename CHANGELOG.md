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

### Quando cortar uma versão

**Todo push para `main` que muda o app é uma versão.** Não é rigor de processo —
é a única forma de o número significar alguma coisa: o deploy é automático no
push, então o que vai para `main` está em produção em minutos. Uma mudança que
chega lá sem subir o número fica invisível, e a partir daí `VERSION` deixa de
responder "o que está no ar".

Já aconteceu: a 2.2.0 foi cortada e **doze commits** entraram em produção depois
dela, sob o mesmo número — incluindo o redesenho do arrastar de cards. Quem
olhasse a tela veria uma coisa e o rodapé do perfil diria outra.

O que **não** precisa de versão: mudança que não chega ao app — documentação,
scripts locais, testes. O critério já está escrito em
[`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml):
se o caminho está na lista que dispara o build, gerou imagem nova e é versão.

**Toda versão vira uma tag no git.** É isso que torna a versão verificável e
reversível: com a tag, `git show v2.1.0:VERSION` responde qual era a versão,
`git diff v2.2.0..v2.3.0` mostra o que entrou entre uma e outra, e
`git log v2.2.0..HEAD` responde a pergunta que mais importa no dia a dia —
*o que já está no ar e ainda não tem versão?*

### Ao lançar

1. Atualize `VERSION`.
2. Acrescente a seção aqui, dizendo o que mudou para **quem usa** — não os
   arquivos tocados, que o git já guarda.
3. Comite, marque a tag e envie as duas coisas:

```bash
git tag -a v2.1.0 -m "Versao na tela e correcao do menu" && git push origin main --tags
```

O deploy é automático no push para `main`; a tag não dispara nada, ela serve
para achar e reverter depois.

### Para reverter

`git revert` do intervalo da versão, ou voltar a imagem anterior no servidor.
**Migração de banco não volta sozinha** — confira aqui se a versão teve migração
antes de reverter, e reverta a migração antes do código.

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
