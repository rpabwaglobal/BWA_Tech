"""Cadastra o feriado estadual do RN: Mártires de Cunhaú e Uruaçu, 3 de outubro.

DE ONDE VEIO. Ao avaliar o projeto aberto feriados.dev como possível fonte de
dados, a conclusão foi NÃO integrá-lo: ele é self-hosted (subir Node e um
PostgreSQL próprio), os dados param em 2025, e o único feriado municipal de
Natal que ele traz é o "Aniversário de Natal" em 25/12 — que já é o Natal
nacional e não tira dia útil nenhum. Mas a pesquisa produziu UM fato útil, e é
este: o 3 de outubro é feriado estadual do Rio Grande do Norte, e a lista
cadastrada estava vazia.

POR QUE ENTRA POR MIGRATION, E NÃO À MÃO NA TELA. A lista nasceu vazia no
commit anterior. Deixar para alguém cadastrar depois significa que, até alguém
fazer, o 3 de outubro segue contando como dia útil nos prazos — e ninguém tem
motivo para desconfiar disso. Quem discordar apaga pela tela de Configurações,
que é uma ação de um clique.

RECORRENTE, E ESSE É O PONTO. O feriado é de data fixa e vale todo ano; a linha
abaixo é a PRIMEIRA ocorrência, não a única.

O ANO-BASE É 2026 porque é quando os dados deste sistema começam: o card mais
antigo tem `data_inicio` em 10/02/2026. Um ano-base anterior não alcançaria
registro nenhum, e recorrente não vale para trás de propósito — aplicar para
trás mudaria em silêncio o tempo de desenvolvimento de cards já fechados.

EFEITO IMEDIATO: NENHUM, e vale dizer por quê. 03/10/2026 cai num SÁBADO e
03/10/2027 num domingo, então o dia já não era útil. O primeiro ano em que esta
linha muda algum número é 2028, numa terça. É justamente por isso que ela entra
marcada como recorrente: sem isso, a falta só apareceria daqui a dois anos, e
ninguém ligaria a causa ao efeito.
"""
from datetime import date

from django.db import migrations

NOME = 'Mártires de Cunhaú e Uruaçu'
DATA_BASE = date(2026, 10, 3)


def cadastrar(apps, schema_editor):
    Feriado = apps.get_model('projects', 'Feriado')
    Feriado.objects.update_or_create(
        data=DATA_BASE,
        defaults={
            'nome': NOME,
            'abrangencia': 'estadual',
            'recorrente': True,
            'observacao': 'Feriado estadual do Rio Grande do Norte.',
        },
    )


def remover(apps, schema_editor):
    Feriado = apps.get_model('projects', 'Feriado')
    Feriado.objects.filter(data=DATA_BASE, nome=NOME).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('projects', '0065_feriado_recorrente'),
    ]

    operations = [
        migrations.RunPython(cadastrar, remover),
    ]
