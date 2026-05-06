from django.urls import re_path

from apps.formularios import consumers as formularios_consumers

from . import consumers

websocket_urlpatterns = [
    re_path(r'ws/notifications/$', consumers.NotificationConsumer.as_asgi()),
    re_path(r'ws/suporte/$', formularios_consumers.SuporteKanbanConsumer.as_asgi()),
]
