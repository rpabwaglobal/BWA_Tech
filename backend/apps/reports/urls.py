from rest_framework.routers import DefaultRouter

from .views import ReportJobViewSet

router = DefaultRouter()
router.register(r'reports', ReportJobViewSet, basename='reports')

urlpatterns = router.urls
