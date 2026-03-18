from django.core.management.base import BaseCommand
from django.utils import timezone
from datetime import datetime

from apps.projects.models import Sprint, WeeklyPriorityConfig
from apps.projects.tasks import fechar_sprint_em_hora


class Command(BaseCommand):
    help = "Agenda o fechamento exato (Celery ETA) das sprints ainda não finalizadas."

    def handle(self, *args, **options):
        config = WeeklyPriorityConfig.get_config()
        horario_limite = config.horario_limite

        now = timezone.now()
        sprints = Sprint.objects.filter(finalizada=False).order_by('data_fim')

        total = sprints.count()
        agendadas = 0

        for sprint in sprints:
            if not sprint.data_fim:
                continue

            expected_close_at = timezone.make_aware(
                datetime.combine(sprint.data_fim, horario_limite),
                timezone.get_current_timezone(),
            )

            eta = expected_close_at if expected_close_at > now else now
            fechar_sprint_em_hora.apply_async(
                args=[sprint.id, expected_close_at.isoformat()],
                eta=eta,
            )
            agendadas += 1

        self.stdout.write(self.style.SUCCESS(f"Agendadas {agendadas}/{total} sprints para fechamento ETA."))

