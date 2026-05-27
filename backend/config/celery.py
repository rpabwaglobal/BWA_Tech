import os
from celery import Celery

# Set the default Django settings module for the 'celery' program.
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

# Carregamos o settings ANTES de instanciar o Celery — settings.py faz
# `load_dotenv` dos .envs (backend/.env e ../env) e reescreve `@redis:` para
# `@127.0.0.1:` em dev local (hostname só resolve dentro do compose).
# Importante: precisamos refletir essa reescrita NAS env vars CELERY_*, porque
# o Celery prioriza env vars sobre config_from_object.
import django
django.setup()
from django.conf import settings as _settings  # noqa: E402

# Sobrescreve env vars com o URL pós-reescrita do settings.py (em prod isso
# é no-op, pois settings mantém o hostname `redis` resolvido na network).
os.environ['CELERY_BROKER_URL'] = _settings.CELERY_BROKER_URL
os.environ['CELERY_RESULT_BACKEND'] = _settings.CELERY_RESULT_BACKEND

app = Celery('bwaproj')

# Using a string here means the worker doesn't have to serialize
# the configuration object to child processes.
# - namespace='CELERY' means all celery-related configuration keys
#   should have a `CELERY_` prefix.
app.config_from_object('django.conf:settings', namespace='CELERY')

# Load task modules from all registered Django apps.
app.autodiscover_tasks()

# Não tentar conectar ao broker na inicialização (evita erros quando Redis não está rodando)
app.conf.broker_connection_retry_on_startup = False


@app.task(bind=True, ignore_result=True)
def debug_task(self):
    print(f'Request: {self.request!r}')
