from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import ChamadoSuporteTimelineViewSet, ChamadoSuporteViewSet

router = DefaultRouter()
router.register(r'suporte', ChamadoSuporteViewSet, basename='formulario-suporte')
router.register(r'suporte-timeline', ChamadoSuporteTimelineViewSet, basename='formulario-suporte-timeline')

urlpatterns = [
    path('', include(router.urls)),
]
