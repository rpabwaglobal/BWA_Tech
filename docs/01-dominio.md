# Domínio e vocabulário

> Parte da [Documentação de Arquitetura do BWA Tech](README.md).
> Levantada por leitura direta do código; o que não foi confirmado está
> em [Riscos e lacunas](12-riscos-e-lacunas.md).


## O produto em uma página

BWA Tech é o sistema interno de gestão de trabalho da BWA. Ele organiza o que a
equipe faz em **sprints**, agrupa esse trabalho em **projetos** e executa em
**cards**, num quadro Kanban. Em volta desse núcleo cresceram: chamados de
suporte, relatórios sob demanda, métricas, um sorteio de apresentações (Geek
Day), e o sistema de feedback pós-entrega.

### O vocabulário, e onde ele engana

Três palavras carregam significado específico aqui, e entendê-las errado leva a
decisões erradas:

**Sprint** é o ciclo de trabalho e a **autoridade de setor**. Ela tem janela
(`data_inicio`, `fechamento_em`), supervisor e setor. Quando fecha, replica seus
projetos e cards não concluídos para a sprint seguinte.

**Projeto é uma pasta.** Ele agrupa cards por um denominador comum e nada mais.
Tem um campo `status`, mas o produto nunca o move: numa medição no banco de
desenvolvimento, **106 de 106 projetos estavam em `criado`**, nenhum com data de
entrega. Quem tenta pendurar comportamento em `Project.status` escreve código
morto — foi exatamente o que aconteceu na primeira versão do sistema de
feedbacks, e a correção está documentada na seção de feedbacks.

**Card é a unidade real.** Ele é quem tem status, prazo, responsável,
homologação, métricas e ciclo de vida. Toda regra de negócio interessante do
sistema é sobre cards.

A hierarquia, então, é `Sprint → Project → Card`, e o peso está nas pontas: a
sprint manda no escopo, o card manda no trabalho, e o projeto no meio é só
organização.

### O quadro Kanban, em duas camadas

`KanbanStage` é um catálogo **global** de colunas. A `key` de uma etapa é
literalmente o valor gravado em `Card.status` — por isso ela é globalmente
única. `ProjectKanbanStageConfig` diz quais dessas etapas cada projeto desenha e
em que ordem. Um projeto comum usa as seis etapas padrão; o fluxo de feedback
usa quatro etapas próprias, ocultas do resto do sistema.

---


## Organização do código

```
BWA_Tech/
├── backend/
│   ├── apps/
│   │   ├── accounts/     identidade, permissões, setores, compartilhamento
│   │   ├── projects/     domínio central — 27 models, 61 migrações
│   │   ├── feedbacks/    feedback pós-entrega, formulário público
│   │   ├── formularios/  chamados de suporte (proxy do portal externo)
│   │   ├── reports/      relatórios sob demanda (jobs assíncronos)
│   │   ├── geekday/      sorteio de apresentações
│   │   ├── suggestions/  CRUD de sugestões
│   │   ├── teams/        DEPRECADO — sem rota
│   │   └── timeline/     código morto — sem rota
│   └── config/           settings, urls, asgi, celery
├── frontend/src/
│   ├── pages/            20 páginas
│   ├── components/       75 componentes (ui/, settings/, reports/, layout/, login-demo/)
│   ├── services/         27 clientes de API
│   ├── context/          4 contextos (Auth, Notification, Sidebar, Theme)
│   ├── hooks/            3 hooks (WebSocket)
│   └── lib/              20 utilitários
├── docs/                 este documento
├── scripts/              backup e dump/restore prod↔dev
└── .github/workflows/    build da imagem + deploy
```

**Dois apps estão mortos e continuam de pé.** `teams/` (substituído pelo mural
por setor em `People.tsx`) e `timeline/` seguem em `INSTALLED_APPS`, com tabelas
no banco, mas suas `urls.py` **não** são incluídas em `config/urls.py` — não há
endpoint algum para eles.

---
