"""
URL configuration for config project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import path, re_path, include
from django.conf import settings
from .views import api_root, serve_spa, serve_media
from apps.accounts.views import RegisterView, LoginView

from apps.formularios.portal_views import PortalFormulariosJWTView
from apps.formularios.portal_proxy_views import PortalFormulariosProxyView

urlpatterns = [
    path('api/', api_root, name='api-root'),
    path('admin/', admin.site.urls),
    # Rotas públicas antes do include para não serem capturadas pelo router (users/<pk>/)
    path('api/users/register/', RegisterView.as_view(), name='register'),
    path('api/users/login/', LoginView.as_view(), name='login'),
    path('api/portal/formularios-access/', PortalFormulariosJWTView.as_view(), name='portal-formularios-access'),
    path('api/portal-formularios/<path:path>', PortalFormulariosProxyView.as_view(), name='portal-formularios-proxy'),
    path('api/', include('apps.accounts.urls')),
    path('api/', include('apps.projects.urls')),
    path('api/', include('apps.teams.urls')),
    path('api/', include('apps.timeline.urls')),
    path('api/', include('apps.suggestions.urls')),
    path('api/', include('apps.geekday.urls')),
    path('api/', include('apps.reports.urls')),
    path('api/formularios/', include('apps.formularios.urls')),
    # serve_media trata /media/ em dev E prod (com cache imutável + 304), então
    # dispensa o django.conf.urls.static.static() do modo DEBUG.
    path('media/<path:path>', serve_media),
    re_path(r'^(?P<path>.*)$', serve_spa),
]
