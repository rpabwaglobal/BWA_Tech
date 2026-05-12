from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    UserViewSet,
    LoginView,
    LogoutView,
    LogoutAllView,
    RegisterView,
    RecoverAccountView,
)

router = DefaultRouter()
router.register(r'users', UserViewSet, basename='user')

urlpatterns = [
    path('users/register/', RegisterView.as_view(), name='register'),
    path('users/login/', LoginView.as_view(), name='login'),
    path('users/logout/', LogoutView.as_view(), name='logout'),
    path('users/logout-all/', LogoutAllView.as_view(), name='logout-all'),
    path('users/recover-account/', RecoverAccountView.as_view(), name='recover-account'),
    path('', include(router.urls)),
]
