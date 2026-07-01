from django.core.management.base import BaseCommand

from apps.projects.business_time import apply_development_time_metrics
from apps.projects.models import Card, CardStatus


class Command(BaseCommand):
    help = 'Recalcula dias corridos/úteis e horas úteis de desenvolvimento nos cards finalizados.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--apply',
            action='store_true',
            help='Persiste no banco (padrão: apenas lista quantos seriam atualizados).',
        )

    def handle(self, *args, **options):
        qs = Card.objects.filter(
            status=CardStatus.FINALIZADO,
            data_inicio__isnull=False,
            finalizado_em__isnull=False,
        )
        total = qs.count()
        self.stdout.write(f'Cards finalizados com data_inicio e finalizado_em: {total}')

        if not options['apply']:
            self.stdout.write(self.style.WARNING('Dry-run. Use --apply para gravar.'))
            return

        updated = 0
        for card in qs.iterator():
            apply_development_time_metrics(card)
            card.save(update_fields=[
                'segundos_corridos_desenvolvimento',
                'dias_uteis_desenvolvimento',
                'minutos_uteis_desenvolvimento',
                'updated_at',
            ])
            updated += 1
        self.stdout.write(self.style.SUCCESS(f'Atualizados: {updated}'))
