from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.projects.models import Sprint
from apps.projects.tasks import fechar_sprint_em_hora


class Command(BaseCommand):
    help = "Agenda o fechamento exato (Celery ETA) das sprints ainda não finalizadas, usando fechamento_em de cada sprint."

    def handle(self, *args, **options):
        now = timezone.now()
        sprints = Sprint.objects.filter(finalizada=False).order_by('fechamento_em')

        total = sprints.count()
        agendadas = 0

        for sprint in sprints:
            if not sprint.fechamento_em:
                continue

            expected_close_at = sprint.fechamento_em
            if timezone.is_naive(expected_close_at):
                expected_close_at = timezone.make_aware(
                    expected_close_at, timezone.get_current_timezone()
                )

            eta = expected_close_at if expected_close_at > now else now
            fechar_sprint_em_hora.apply_async(
                args=[sprint.id, expected_close_at.isoformat()],
                eta=eta,
            )
            agendadas += 1

        self.stdout.write(self.style.SUCCESS(f"Agendadas {agendadas}/{total} sprints para fechamento ETA."))
