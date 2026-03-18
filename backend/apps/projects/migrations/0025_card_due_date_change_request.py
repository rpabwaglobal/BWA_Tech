from django.db import migrations, models
import django.db.models.deletion
from django.conf import settings


class Migration(migrations.Migration):

    dependencies = [
        ('projects', '0024_alter_card_tipo'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='CardDueDateChangeRequest',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('requested_date', models.DateField(verbose_name='Nova Data Solicitada')),
                ('reason', models.TextField(blank=True, null=True, verbose_name='Motivo')),
                ('status', models.CharField(choices=[('pending', 'Pendente'), ('approved', 'Aprovado'), ('rejected', 'Recusado')], default='pending', max_length=20, verbose_name='Status')),
                ('reviewed_at', models.DateTimeField(blank=True, null=True, verbose_name='Data de Avaliação')),
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='Data de Criação')),
                ('updated_at', models.DateTimeField(auto_now=True, verbose_name='Data de Atualização')),
                ('card', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='due_date_change_requests', to='projects.card', verbose_name='Card')),
                ('requested_by', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='due_date_change_requests_created', to=settings.AUTH_USER_MODEL, verbose_name='Solicitado Por')),
                ('reviewed_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='due_date_change_requests_reviewed', to=settings.AUTH_USER_MODEL, verbose_name='Avaliado Por')),
            ],
            options={
                'verbose_name': 'Solicitação de Mudança de Data de Entrega',
                'verbose_name_plural': 'Solicitações de Mudança de Data de Entrega',
                'ordering': ['-created_at'],
            },
        ),
        migrations.AddIndex(
            model_name='cardduedatechangerequest',
            index=models.Index(fields=['status', '-created_at'], name='projects_ca_status_9626e9_idx'),
        ),
        migrations.AddIndex(
            model_name='cardduedatechangerequest',
            index=models.Index(fields=['card', 'status'], name='projects_ca_card_i_480b21_idx'),
        ),
        migrations.AddIndex(
            model_name='cardduedatechangerequest',
            index=models.Index(fields=['requested_by', '-created_at'], name='projects_ca_request_a7301e_idx'),
        ),
    ]

