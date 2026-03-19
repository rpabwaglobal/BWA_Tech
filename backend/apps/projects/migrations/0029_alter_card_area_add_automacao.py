from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('projects', '0028_seed_kanban_stages'),
    ]

    operations = [
        migrations.AlterField(
            model_name='card',
            name='area',
            field=models.CharField(
                choices=[
                    ('rpa', 'RPA'),
                    ('frontend', 'Frontend'),
                    ('backend', 'Backend'),
                    ('script', 'Script'),
                    ('sistema', 'Sistema'),
                    ('automacao', 'Automação'),
                ],
                default='backend',
                max_length=20,
                verbose_name='Área',
            ),
        ),
    ]

