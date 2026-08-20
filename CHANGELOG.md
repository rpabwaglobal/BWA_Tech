# Registro de versões — BWA Tech

O número da versão vive em [`VERSION`](VERSION), na raiz. É de lá que o backend
o lê e a tela de perfil o mostra — não há segunda cópia em código.

## Como versionamos

Três números, `MAIOR.MENOR.CORREÇÃO`, e o que muda cada um:

| Sobe | Quando |
|---|---|
| **MAIOR** | muda algo que quebra uso existente: um fluxo sai, uma regra passa a recusar o que antes aceitava, uma integração muda de contrato |
| **MENOR** | entra funcionalidade nova sem quebrar o que já existia |
| **CORREÇÃO** | conserto de defeito, sem funcionalidade nova |

**Toda versão vira uma tag no git.** É isso que torna a versão verificável e
reversível: com a tag, `git show v2.1.0:VERSION` responde qual era a versão, e
`git diff v2.0.0..v2.1.0` mostra exatamente o que entrou entre uma e outra.

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
