# Testes

> Parte da [Documentação de Arquitetura do BWA Tech](README.md).
> Levantada por leitura direta do código; o que não foi confirmado está
> em [Riscos e lacunas](12-riscos-e-lacunas.md).


## Testes

A suíte tem **~11.400 linhas em 24 arquivos**, e a distribuição é muito desigual:

| App | Linhas | Arquivos |
|---|---|---|
| feedbacks | 7.940 | 12 |
| projects | 1.781 | 4 |
| accounts | 801 | 2 |
| geekday | 645 | 1 |
| reports, formularios, suggestions, timeline, teams | 0 | — |

Os arquivos de `feedbacks` são adversariais: documentam vulnerabilidades
específicas em docstrings longas, e é lá que está descrito o vazamento dormente
do balde `sem_setor`.

**Não há execução de testes no CI.** Os dois workflows do GitHub Actions só
buildam a imagem e fazem o deploy. Também não existe `pytest.ini`,
`pyproject.toml`, `tox.ini`, `conftest.py` nem `Makefile`.

### Como rodar a suíte

Isto não estava documentado em lugar nenhum do repositório, e a forma correta
não é óbvia:

```bash
DOTENV_OVERRIDE=false DB_NAME=bwaproj_meu python manage.py test apps --noinput --keepdb
```

- **`DOTENV_OVERRIDE=false` é obrigatório.** `config/settings.py` faz
  `load_dotenv(override=True)`, então exportar `DB_NAME` no ambiente não tem
  efeito nenhum — o `.env` sobrescreve em silêncio e você acha que isolou o banco
  quando não isolou.
- **`DB_NAME` próprio** evita que duas execuções simultâneas derrubem uma à
  outra no meio, produzindo erros fantasma que parecem defeito de código.
- **`--keepdb`** economiza a recriação do banco, que é a parte cara.

**Armadilha do `--keepdb`.** Há `TransactionTestCase` em
`apps/accounts/tests_realtime.py` e `apps/projects/tests_realtime.py`. Eles não
usam transação: dão `TRUNCATE` em todas as tabelas ao terminar, apagando o que as
migrações semearam (o formulário de feedback ativo, o catálogo de etapas). As
classes têm `serialized_rollback = True`, o que protege de uma classe para outra
**dentro da mesma execução** — mas não entre execuções com `--keepdb`: o último
flush fica gravado no banco reaproveitado. Um banco que rodou a suíte inteira
está queimado. O sintoma aparece na execução *seguinte*, em outra suíte, como
`DoesNotExist` de um dado que a migração deveria ter criado.

Na prática, mantenha dois bancos: um só para módulos sem `TransactionTestCase`
(iteração rápida com `--keepdb`) e outro descartável para o passe final.

---
