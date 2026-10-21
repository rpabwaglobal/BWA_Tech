"""Cadastra o feriado municipal de Natal: Nossa Senhora da Apresentação, 21/11.

DE ONDE VEIO. A migration 0066 cadastrou o feriado ESTADUAL do RN e a lista
parou ali. Ao reavaliar o projeto aberto feriados.dev — desta vez olhando as
`database/migrations/`, e não só as `seeds/`, que foi o erro da primeira
avaliação — apareceu este, que faltava: 21 de novembro, Dia de Nossa Senhora da
Apresentação, padroeira de Natal e da Arquidiocese.

CONFERIDO FORA DAQUELE REPOSITÓRIO antes de entrar aqui, porque a base dele é
inconsistente: o 21/11 aparece no arquivo de 2027 e NÃO aparece no de 2026, e
não há arquivo de 2028. Fontes locais confirmam o feriado municipal; o número da
lei que o institui não foi localizado, então ele fica registrado pelo fato, não
pela norma. Se alguém achar a lei, o lugar de anotá-la é o campo `observacao`.

RECORRENTE: data fixa, vale todo ano. A linha abaixo é a PRIMEIRA ocorrência.

ANO-BASE 2026, o mesmo da 0066 e da 0066 em diante: é quando os dados deste
sistema começam (o card mais antigo tem `data_inicio` em 10/02/2026), e
recorrente não vale para trás de propósito.

EFEITO IMEDIATO: NENHUM, e pelo mesmo motivo do 03/10. 21/11/2026 cai num
SÁBADO e 21/11/2027 num domingo. O primeiro ano em que esta linha muda algum
número é 2028, numa terça — e é exatamente por isso que ela entra marcada como
recorrente: sem isso, a falta só apareceria daqui a dois anos.

O "ANIVERSÁRIO DE NATAL" NÃO ENTRA. A fundação da cidade é 25 de dezembro, que
já é o Natal nacional e é calculado. Cadastrá-lo criaria uma segunda resposta
para o mesmo dia sem tirar dia útil nenhum — e o serializer recusaria, pela
mesma regra.
"""
from datetime import date

from django.db import migrations

NOME = 'Nossa Senhora da Apresentação'
DATA_BASE = date(2026, 11, 21)


def cadastrar(apps, schema_editor):
    Feriado = apps.get_model('projects', 'Feriado')
    Feriado.objects.update_or_create(
        data=DATA_BASE,
        defaults={
            'nome': NOME,
            'abrangencia': 'municipal',
            'recorrente': True,
            'observacao': 'Padroeira de Natal/RN. Feriado municipal.',
        },
    )


def remover(apps, schema_editor):
    Feriado = apps.get_model('projects', 'Feriado')
    Feriado.objects.filter(data=DATA_BASE, nome=NOME).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('projects', '0066_feriado_martires_de_cunhau_e_uruacu'),
    ]

    operations = [
        migrations.RunPython(cadastrar, remover),
    ]
