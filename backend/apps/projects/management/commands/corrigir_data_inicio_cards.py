"""Limpa data_inicio de cards em 'a_desenvolver' (dado legado / replicação incorreta)."""
from django.core.management.base import BaseCommand

from apps.projects.models import Card, CardStatus


class Command(BaseCommand):
    help = (
        "Remove data_inicio de cards com status 'a_desenvolver'. "
        "Use --apply para persistir (padrão é dry-run)."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--apply',
            action='store_true',
            help='Aplica a correção no banco (sem esta flag, apenas lista).',
        )

    def handle(self, *args, **options):
        qs = Card.objects.filter(status=CardStatus.A_DESENVOLVER).exclude(data_inicio__isnull=True)
        count = qs.count()
        if count == 0:
            self.stdout.write(self.style.SUCCESS('Nenhum card afetado.'))
            return

        self.stdout.write(f'Cards com data_inicio indevida em a_desenvolver: {count}')
        for card in qs.only('id', 'nome', 'data_inicio')[:20]:
            self.stdout.write(f'  - #{card.id} {card.nome!r} data_inicio={card.data_inicio}')
        if count > 20:
            self.stdout.write(f'  ... e mais {count - 20}')

        if not options['apply']:
            self.stdout.write(self.style.WARNING('Dry-run. Use --apply para corrigir.'))
            return

        updated = qs.update(data_inicio=None)
        self.stdout.write(self.style.SUCCESS(f'Corrigidos: {updated} card(s).'))
