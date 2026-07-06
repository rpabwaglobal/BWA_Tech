from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    ChamadoSuporteResolucaoViewSet,
    ChamadoSuporteTimelineViewSet,
    ChamadoSuporteViewSet,
)

router = DefaultRouter()
router.register(r'suporte', ChamadoSuporteViewSet, basename='formulario-suporte')
router.register(r'suporte-timeline', ChamadoSuporteTimelineViewSet, basename='formulario-suporte-timeline')
router.register(r'suporte-resolucao', ChamadoSuporteResolucaoViewSet, basename='formulario-suporte-resolucao')

urlpatterns = [
    path('', include(router.urls)),
]
