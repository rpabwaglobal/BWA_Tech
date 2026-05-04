from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('projects', '0034_card_links'),
    ]

    operations = [
        migrations.AlterField(
            model_name='cardduedatechangerequest',
            name='requested_date',
            field=models.DateTimeField(verbose_name='Nova data e hora solicitada'),
        ),
    ]
