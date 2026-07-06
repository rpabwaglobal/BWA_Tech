from django.db import migrations
from decimal import Decimal


# (nome, peso, negativo, ordem, [(valor, descricao), ...])
CRITERIOS = [
    ('Redução de esforço', Decimal('0.30'), False, 1, [
        (0, 'Não ajuda'),
        (2, 'Ajuda pontual'),
        (4, 'Reduz parte'),
        (6, 'Elimina tarefa'),
        (8, 'Elimina processo'),
        (10, 'Elimina atividade'),
    ]),
    ('Risco fiscal mitigado', Decimal('0.25'), False, 2, [
        (0, 'Sem risco'),
        (2, 'Erro interno'),
        (4, 'Retrabalho'),
        (6, 'Inconsistência'),
        (8, 'Problema fiscal'),
        (10, 'Multa/autuação'),
    ]),
    ('Escalabilidade', Decimal('0.20'), False, 3, [
        (0, 'até 100'),
        (2, 'até 900'),
        (4, 'até 1800'),
        (6, 'até 2800'),
        (8, 'até 3500'),
        (10, 'padrão empresa'),
    ]),
    ('Complexidade', Decimal('0.15'), True, 4, [
        (0, 'Sem integração'),
        (2, 'Script simples'),
        (4, 'Integração básica'),
        (6, 'Regra média'),
        (8, 'Integração complexa'),
        (10, 'Alto risco'),
    ]),
    ('Dependência', Decimal('0.10'), True, 5, [
        (2, 'Nenhuma'),
        (4, 'Pequena'),
        (6, 'Outro time'),
        (8, 'Sistema externo'),
        (10, 'Fora controle'),
    ]),
]


def seed(apps, schema_editor):
    ScoreCriterion = apps.get_model('projects', 'ScoreCriterion')
    ScoreCriterionOption = apps.get_model('projects', 'ScoreCriterionOption')

    for nome, peso, negativo, ordem, opcoes in CRITERIOS:
        criterion, created = ScoreCriterion.objects.get_or_create(
            nome=nome,
            defaults={'peso': peso, 'negativo': negativo, 'ordem': ordem, 'ativo': True},
        )
        # Só popula opções em critérios recém-criados (não sobrescreve edições do supervisor).
        if created:
            for idx, (valor, descricao) in enumerate(opcoes):
                ScoreCriterionOption.objects.create(
                    criterion=criterion,
                    valor=valor,
                    descricao=descricao,
                    ordem=idx,
                )


def unseed(apps, schema_editor):
    ScoreCriterion = apps.get_model('projects', 'ScoreCriterion')
    nomes = [c[0] for c in CRITERIOS]
    ScoreCriterion.objects.filter(nome__in=nomes).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('projects', '0048_score_models'),
    ]

    operations = [
        migrations.RunPython(seed, unseed),
    ]
