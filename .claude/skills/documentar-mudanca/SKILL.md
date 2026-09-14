---
name: documentar-mudanca
description: Atualiza a documentação oficial do BWA Tech em Desktop/Docs/bwa-tech junto com a mudança. Use SEMPRE antes de commitar qualquer alteração no BWA Tech — mudou comportamento, tela, regra, endpoint, permissão, dependência, variável de ambiente ou procedimento de operação, a documentação entra no MESMO commit. Também use quando pedirem para revisar, conferir ou corrigir a documentação do projeto.
---

# Documentar a mudança, no mesmo commit

A documentação oficial do BWA Tech vive **fora do repositório**, em:

```
C:\Users\Italo.Martins\Desktop\Docs\bwa-tech\
```

Ela não é gerada — é escrita. E envelhece rápido: a documentação interna do
repositório (`docs/`) defasou justamente por ser atualizada "depois", e hoje
afirma coisas que não são mais verdade. Esta skill existe para isso não se
repetir com a oficial.

## A regra

**A atualização da documentação entra no MESMO commit da mudança.** Não num
commit seguinte, não numa faxina no fim da semana. O mesmo motivo pelo qual
`VERSION` e o `CHANGELOG` entram junto: separá-los foi o que criou o problema
que a regra de versionamento existe para resolver.

Se a mudança não altera nada do que está documentado, **não force**: nem toda
mudança tem reflexo na documentação. Refatoração que ninguém percebe, ajuste de
teste, correção de comentário — nada disso precisa de linha nova. O critério é o
mesmo do versionamento: **mudou o que alguém precisa saber?**

## Qual documento mexer

| A mudança foi em... | Atualize |
| --- | --- |
| Tela nova, tela removida, funcionalidade visível | `README.md` (resumo) + `03. Entrega e Operacao/Documento de Entrega.md` (tabela de telas, caminho do trabalho) |
| Regra de negócio (sprint, card, prioridade, feedback, suporte) | `01. Planejamento/PRD.md` §7 + `01. Planejamento/Criterios de Aceite.md` |
| Endpoint, modelo, permissão, decisão técnica | `02. Desenvolvimento/Arquitetura e Decisoes Tecnicas.md` |
| Integração externa nova ou alterada | `README.md` (tabela "se cair") + `02. Desenvolvimento/…` + `03. Entrega e Operacao/Runbook.md` |
| Variável de ambiente, serviço no compose, deploy | `03. Entrega e Operacao/Runbook.md` |
| Procedimento de operação, comando novo | `03. Entrega e Operacao/Runbook.md` §6 |
| Incidente em produção e o que o causou | `03. Entrega e Operacao/Runbook.md` §10 (tabela de incidentes) |
| Dívida técnica descoberta ou quitada | `README.md` (Pontos de atenção) + `02. Desenvolvimento/…` §12 |
| Limitação que o usuário vai sentir | `03. Entrega e Operacao/Documento de Entrega.md` §7 |

Quando quitar uma dívida, **remova o item** das listas — dívida resolvida que
continua documentada faz a próxima pessoa procurar um problema que não existe.

## Como escrever (o padrão da casa)

Estes documentos seguem o padrão do `Desktop\Docs\sistema-licencas`. O que
caracteriza:

- **Diga o porquê, não só o quê.** "Atraso é derivado, nunca gravado — guardado,
  estaria errado no dia seguinte" vale mais que "o campo atraso é calculado".
- **Seja concreto.** Nome de arquivo, número, medição. "17 de 1311 cards tinham
  links" é melhor que "alguns cards".
- **Escopo negativo é seção de primeira classe.** O que o sistema NÃO faz evita
  mais confusão do que o que ele faz.
- **Registre o que está errado.** As seções de pontos de atenção e critérios "em
  aberto" existem para isso. Documentação que só elogia não serve para operar.
- **Não afirme o que não verificou.** Se não conferiu, escreva que não conferiu.
- **Português do Brasil**, texto corrido, sem jargão desnecessário.

## Antes de commitar, confira

1. A tabela de metadados do `README.md` traz a **versão de referência** e a
   **data** — atualize as duas.
2. O que você escreveu é verdade **hoje**, não a intenção original.
3. Você não deixou uma afirmação antiga contradizendo a nova em outro documento.
4. Nenhum segredo entrou: senha, token, chave. Nome de variável de ambiente
   pode; valor, nunca.

## O que NÃO fazer

- Não copie código para dentro da documentação. Ela envelhece; o código é a
  fonte.
- Não descreva arquivo por arquivo. Descreva **comportamento e decisão**.
- Não escreva "melhorias diversas". Diga o que mudou para quem usa.
