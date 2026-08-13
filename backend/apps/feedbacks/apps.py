from django.apps import AppConfig


class FeedbacksConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.feedbacks'
    verbose_name = 'Feedbacks'

    def ready(self):
        # Registra o gatilho da fase 2 (`Project.status` -> 'entregue').
        # Mesmo padrão de `ProjectsConfig.ready()`. O módulo importado NÃO puxa
        # `apps.projects`: o sender dos receivers é a string 'projects.Project',
        # resolvida preguiçosamente pelo Django.
        from . import signals  # noqa: F401
