"""Roda a limpeza de arquivos de relatório na mão.

O agendamento diário (Celery Beat, `reports.limpar_relatorios_expirados`) cobre
a operação normal. Este comando existe para os casos em que esperar até as 3h30
não serve: antes de um deploy, ao investigar uso de disco, ou num ambiente onde
o Beat não está de pé.
"""
from django.core.management.base import BaseCommand

from apps.reports.tasks import limpar_relatorios_expirados


class Command(BaseCommand):
    help = 'Apaga arquivos de relatório vencidos e órfãos (mantém as linhas de ReportJob).'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run', action='store_true',
            help='Só relata o que seria apagado, sem apagar nada.')

    def handle(self, *args, **options):
        if options['dry_run']:
            self._relatar()
            return
        r = limpar_relatorios_expirados()
        self.stdout.write(self.style.SUCCESS(
            f'{r["vencidos"]} arquivo(s) vencido(s) e {r["orfaos"]} órfão(s) removidos. '
            'As linhas de ReportJob foram preservadas.'))

    def _relatar(self):
        """Conta sem apagar. Repete a regra da task de propósito: um dry-run que
        chamasse a task com um parâmetro extra correria o risco de divergir do
        caminho real por um `if` mal posicionado — e um dry-run que mente é pior
        que não ter dry-run."""
        import os

        from django.conf import settings
        from django.utils import timezone

        from apps.reports.models import ReportJob

        dias = getattr(settings, 'REPORT_RETENTION_DAYS', 7)
        corte = timezone.now() - timezone.timedelta(days=dias)
        vencidos = ReportJob.objects.filter(
            completed_at__lt=corte).exclude(file='').exclude(file=None).count()

        raiz = os.path.join(settings.MEDIA_ROOT, 'reports')
        orfaos = 0
        if os.path.isdir(raiz):
            referenciados = {
                os.path.normpath(os.path.join(settings.MEDIA_ROOT, nome))
                for nome in ReportJob.objects.exclude(file='').exclude(file=None)
                                             .values_list('file', flat=True)
            }
            limite = corte.timestamp()
            for pasta, _dirs, arquivos in os.walk(raiz):
                for nome in arquivos:
                    caminho = os.path.normpath(os.path.join(pasta, nome))
                    if caminho not in referenciados and os.path.getmtime(caminho) < limite:
                        orfaos += 1

        self.stdout.write(
            f'Retenção: {dias} dia(s). Seriam removidos {vencidos} arquivo(s) '
            f'vencido(s) e {orfaos} órfão(s). Nada foi apagado.')
