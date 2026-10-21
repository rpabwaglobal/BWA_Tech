"""Feriados — a única resposta para "este dia é útil?", em todo o sistema.

HAVIA TRÊS RESPOSTAS DIFERENTES, E NENHUMA ESTAVA CERTA:

  1. `frontend/src/lib/dateUtils.ts` calculava fixos + móveis, mas sem o 20/11 e
     sem nada estadual ou municipal. Era a melhor das três, e ninguém além dos
     cards a usava.
  2. `business_time.py` lia a tabela `CachedHoliday` e, quando ela vinha vazia,
     caía num fallback de oito datas fixas — sem Carnaval, sem Sexta-feira
     Santa, sem Corpus Christi.
  3. `holiday_sync.py` buscava numa API externa. MEDIDO EM 19/10/2026: a tabela
     tinha ZERO linhas em produção, `FERIADOS_API_KEY` não estava definida, e o
     sync só rodava por comando manual que ninguém chamava. O fallback do item 2
     escondia isso — o cálculo nunca quebrou, só passou a dar outro número.

E o SLA dos chamados de suporte não usava nenhuma das três: contava feriado como
dia normal.

ESTE MÓDULO É A ÚNICA FONTE. Mesmo motivo de `apps/reports/periodo.py`,
`apps/projects/prazo.py` e `apps/reports/suporte.py` existirem: regra duplicada
vira regra divergente, e dois números que discordam destroem a confiança nos
dois.

DUAS METADES, E A DIVISÃO NÃO É ARBITRÁRIA:

  CALCULADO — os nacionais. São lei ou prática universal, valem para qualquer
  ano, e um algoritmo os produz exatamente. Guardar isso numa tabela seria
  convidar o problema que acabamos de ter: dado que envelhece e ninguém percebe.

  CADASTRADO — estaduais do RN, municipais de Natal e recessos da empresa. Não
  há como calcular: são decisão de alguém. Ficam no modelo `Feriado`, mantido
  pela equipe na tela de Configurações.

  Um cadastrado pode ser RECORRENTE, e isso importa: feriado estadual e
  municipal costuma ser data fixa anual. Sem a marcação, alguém teria de
  recadastrar todo ano e um dia esqueceria — o mesmo envelhecimento silencioso
  que a tabela de cache produziu, só que movido para a mão da equipe. O
  recorrente vale do ano da `data` EM DIANTE, nunca para trás: aplicar para trás
  mudaria o tempo de desenvolvimento de cards já fechados.

SOBRE CARNAVAL: juridicamente é PONTO FACULTATIVO, não feriado. Os decretos de
2026 — o municipal 13.643 e o estadual 35.209 — classificam a segunda e a terça
assim, e não como feriado. Ele conta aqui como dia NÃO ÚTIL por **decisão da
empresa, confirmada em 21/10/2026**: a BWA não trabalha no Carnaval.

Isso era uma herança não decidida — o código antigo dos cards já contava assim e
ninguém tinha perguntado. Agora é decisão registrada, e há teste fixando-a
(`CarnavalContaComoNaoUtilTests`). Se um dia a empresa passar a trabalhar no
Carnaval, o lugar de mudar é aqui, num lugar só, e o teste cai junto para avisar.

CORPUS CHRISTI É OUTRO CASO, e vale não confundir: o decreto MUNICIPAL de Natal
o classifica como feriado municipal, embora o estadual o chame de ponto
facultativo. Como a empresa fica em Natal, vale o municipal — ele é feriado de
fato, não decisão interna.

QUARTA-FEIRA DE CINZAS NÃO ENTRA. O decreto a trata como ponto facultativo até
as 14h, e o sistema não modela meio expediente: ou o dia conta inteiro, ou não
conta. Contá-la inteira tiraria um dia útil que a empresa só perde pela metade.

LIMITAÇÃO CONHECIDA: a lista cadastrada só ACRESCENTA dias não úteis. Não há
como marcar um feriado nacional como dia de expediente. Nunca foi preciso; se
for, o campo novo entra no modelo `Feriado`, não num `if` espalhado.
"""
from __future__ import annotations

from datetime import date, timedelta

#: Feriados nacionais de data fixa (mês, dia).
#:
#: O 20 DE NOVEMBRO FALTAVA NAS DUAS IMPLEMENTAÇÕES ANTIGAS. A Lei 14.759/2023
#: tornou o Dia da Consciência Negra feriado nacional a partir de 2024, e nem o
#: frontend nem o fallback do backend tinham sido atualizados — todo 20/11 desde
#: 2024 foi contado como dia útil.
NACIONAIS_FIXOS: tuple[tuple[int, int], ...] = (
    (1, 1),    # Confraternização Universal
    (4, 21),   # Tiradentes
    (5, 1),    # Dia do Trabalhador
    (9, 7),    # Independência do Brasil
    (10, 12),  # Nossa Senhora Aparecida
    (11, 2),   # Finados
    (11, 15),  # Proclamação da República
    (11, 20),  # Consciência Negra (Lei 14.759/2023, desde 2024)
    (12, 25),  # Natal
)

#: Ano a partir do qual o 20/11 vale. Antes disso ele era feriado só em alguns
#: municípios, e contá-lo mudaria o histórico de cards fechados em 2023.
ANO_CONSCIENCIA_NEGRA = 2024


def pascoa(ano: int) -> date:
    """Domingo de Páscoa pelo algoritmo de Meeus/Jones/Butcher.

    O mesmo que o frontend já usava. Fica aqui porque dele saem Carnaval,
    Sexta-feira Santa e Corpus Christi, e calcular é melhor que cadastrar: são
    quatro datas por ano que mudam todo ano, e esquecer de cadastrar é silencioso.
    """
    a = ano % 19
    b, c = divmod(ano, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    mes = (h + l - 7 * m + 114) // 31
    dia = ((h + l - 7 * m + 114) % 31) + 1
    return date(ano, mes, dia)


def nacionais_do_ano(ano: int) -> set[date]:
    """Feriados nacionais de um ano: os fixos mais os derivados da Páscoa."""
    dias = {
        date(ano, mes, dia)
        for mes, dia in NACIONAIS_FIXOS
        if not (mes == 11 and dia == 20 and ano < ANO_CONSCIENCIA_NEGRA)
    }

    domingo = pascoa(ano)
    dias.update({
        domingo - timedelta(days=48),  # Carnaval, segunda
        domingo - timedelta(days=47),  # Carnaval, terça
        domingo - timedelta(days=2),   # Sexta-feira Santa
        domingo + timedelta(days=60),  # Corpus Christi
    })
    return dias


def feriados_entre(inicio: date, fim: date) -> set[date]:
    """Todos os dias não úteis por feriado no intervalo, inclusive nas pontas.

    União das duas metades: os nacionais calculados e a lista que a equipe
    cadastra. Fins de semana NÃO entram — quem pergunta por dia útil combina as
    duas coisas, e misturá-las aqui esconderia qual das duas tirou o dia.
    """
    if inicio > fim:
        inicio, fim = fim, inicio

    dias: set[date] = set()
    for ano in range(inicio.year, fim.year + 1):
        dias.update(nacionais_do_ano(ano))

    # Import adiado: `models` importa este módulo em tempo de carga do app, e
    # importar de volta no topo fecharia o ciclo.
    from .models import Feriado

    # NÃO DÁ PARA FILTRAR OS RECORRENTES PELO INTERVALO. Um feriado cadastrado
    # com data de 2026 vale em 2030, e um `filter(data__lte=fim)` o perderia. A
    # tabela é de dezenas de linhas — lê-se inteira e expande-se em memória.
    for data_base, recorrente in Feriado.objects.values_list('data', 'recorrente'):
        if not recorrente:
            dias.add(data_base)
            continue
        for ano in range(max(inicio.year, data_base.year), fim.year + 1):
            try:
                dias.add(data_base.replace(year=ano))
            except ValueError:
                # 29 de fevereiro em ano não bissexto: aquele ano não tem o dia.
                # Pular é a única resposta honesta — empurrar para 28 ou 1º
                # inventaria um feriado em data que ninguém cadastrou.
                continue

    return {d for d in dias if inicio <= d <= fim}


def e_dia_util(dia: date, feriados: set[date] | None = None) -> bool:
    """Dia útil = não é sábado, não é domingo, não é feriado.

    `feriados` é opcional para quem já carregou o conjunto de um intervalo e não
    quer uma consulta por dia. Sem ele, consulta só aquele dia.
    """
    if dia.weekday() >= 5:
        return False
    if feriados is None:
        feriados = feriados_entre(dia, dia)
    return dia not in feriados
