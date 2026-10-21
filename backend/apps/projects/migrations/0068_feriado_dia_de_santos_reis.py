"""Cadastra o feriado municipal de Natal: Dia de Santos Reis, 6 de janeiro.

FONTE PRIMÁRIA, desta vez. As migrations 0066 e 0067 nasceram de pistas de um
projeto aberto de terceiros, conferidas depois. Esta sai do **Decreto municipal
nº 13.643, de 30/12/2025**, publicado no Diário Oficial do Município de Natal —
o Anexo Único traz o calendário de 2026 classificando cada data, e o 6 de
janeiro está lá como "Dia de Santos Reis — Feriado Municipal".

O MESMO DECRETO FECHOU A LISTA. Comparado com o que o sistema já conhecia, só
esta data faltava. As outras do anexo ou já são calculadas (Paixão de Cristo e
Corpus Christi aparecem no decreto como municipais, mas são derivadas da Páscoa
e o sistema as produz sozinho) ou já estavam cadastradas (3 de outubro,
estadual; 21 de novembro, Nossa Senhora da Apresentação).

ESTE PESA MAIS QUE OS OUTROS DOIS. O 03/10 e o 21/11 caem em fim de semana em
2026 e 2027, e só tiram dia útil a partir de 2028. O 6 de janeiro cai em dia de
semana em 2026 (terça), 2027 (quarta) e 2028 (quinta) — ele muda número já no
próximo ano.

SEM EFEITO RETROATIVO, verificado: nenhum card do sistema tem janela de
desenvolvimento que atravesse 06/01/2026 (o card mais antigo começa em
10/02/2026). O ano-base continua sendo 2026 por coerência com as outras duas.

O QUE O DECRETO CHAMA DE PONTO FACULTATIVO NÃO ENTRA AQUI, e a diferença
importa: Carnaval, Quarta-feira de Cinzas, São Pedro (29/06), Dia do Servidor
Público (28/10) e as vésperas de Natal e Ano Novo são ponto facultativo para a
prefeitura, não feriado. Se a BWA não trabalha em algum deles, é decisão da
empresa e o lugar de registrar é a tela de Configurações, com abrangência
"empresa" — não aqui.
"""
from datetime import date

from django.db import migrations

NOME = 'Dia de Santos Reis'
DATA_BASE = date(2026, 1, 6)


#: As duas linhas que as migrations 0066 e 0067 cadastraram entraram sem a
#: norma, porque na época ela não tinha sido localizada. Agora foi, e anotá-la
#: poupa a próxima pessoa de refazer a busca. As migrations anteriores NÃO são
#: reescritas: já rodaram em produção, e mexer no passado de uma migration
#: aplicada é como mexer num commit publicado.
FONTES = {
    date(2026, 10, 3): (
        'Feriado estadual do Rio Grande do Norte. Lei Estadual 8.913, '
        'de 06/12/2006.'
    ),
    date(2026, 11, 21): (
        'Padroeira de Natal/RN. Feriado municipal; Decreto municipal 13.643, '
        'de 30/12/2025, Anexo Único.'
    ),
}


def cadastrar(apps, schema_editor):
    Feriado = apps.get_model('projects', 'Feriado')
    Feriado.objects.update_or_create(
        data=DATA_BASE,
        defaults={
            'nome': NOME,
            'abrangencia': 'municipal',
            'recorrente': True,
            'observacao': (
                'Feriado municipal de Natal/RN. Decreto municipal 13.643, '
                'de 30/12/2025, Anexo Único.'
            ),
        },
    )

    # Só a observação: nome, data e abrangência ficam como estão.
    for dia, texto in FONTES.items():
        Feriado.objects.filter(data=dia).update(observacao=texto)


def remover(apps, schema_editor):
    Feriado = apps.get_model('projects', 'Feriado')
    Feriado.objects.filter(data=DATA_BASE, nome=NOME).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('projects', '0067_feriado_nossa_senhora_da_apresentacao'),
    ]

    operations = [
        migrations.RunPython(cadastrar, remover),
    ]
