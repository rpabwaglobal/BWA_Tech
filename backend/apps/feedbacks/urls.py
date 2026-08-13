"""
Rotas AUTENTICADAS do app de feedback.

A rota PÚBLICA (`/api/feedback/<token>/`) NÃO está aqui de propósito: ela é
registrada direto em config/urls.py, na faixa que vem ANTES dos `include()`.
O urlconf termina com o catch-all `serve_spa`, que devolve index.html com HTTP
200 para qualquer caminho não casado — uma rota de API registrada tarde não
daria 404, daria HTML onde o front espera JSON, e a falha seria silenciosa.
"""
from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (ExportarFeedbacksView, PedidoFeedbackViewSet,
                    PreviaFeedbacksView)

router = DefaultRouter()
router.register(r'feedbacks/pedidos', PedidoFeedbackViewSet, basename='feedback-pedidos')

urlpatterns = router.urls + [
    # Fora do router de propósito: não é um recurso REST, é um DOWNLOAD.
    path('feedbacks/exportar/', ExportarFeedbacksView.as_view(), name='feedbacks-exportar'),
    path('feedbacks/exportar/previa/', PreviaFeedbacksView.as_view(), name='feedbacks-previa'),
]
