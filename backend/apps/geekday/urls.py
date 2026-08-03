from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import GeekDayDrawViewSet, GeekDayGrupoViewSet

router = DefaultRouter()
router.register(r'geekday-draws', GeekDayDrawViewSet, basename='geekdaydraw')
# Administração dos grupos (quais setores sorteiam juntos).
router.register(r'geekday-grupos', GeekDayGrupoViewSet, basename='geekdaygrupo')

urlpatterns = [
    path('', include(router.urls)),
]
