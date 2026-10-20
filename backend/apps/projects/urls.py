from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    SprintViewSet, ProjectViewSet, CardViewSet, UserNoteViewSet, CardPinViewSet,
    EventViewSet, CardLogViewSet,
    NotificationViewSet, NotificationPreferenceView,
    WeeklyPriorityViewSet, WeeklyPriorityConfigViewSet, CardDueDateChangeRequestViewSet,
    CardReopenRequestViewSet,
    KanbanStageViewSet,
    ScoreCriterionViewSet, CardScoreViewSet,
    CardAnexoViewSet,
)
from .dashboard import DashboardResumoView
from .feriados_api import FeriadosCadastradosViewSet, FeriadosView

router = DefaultRouter()
router.register(r'sprints', SprintViewSet, basename='sprint')
router.register(r'projects', ProjectViewSet, basename='project')
router.register(r'cards', CardViewSet, basename='card')
router.register(r'notes', UserNoteViewSet, basename='usernote')
router.register(r'card-pins', CardPinViewSet, basename='cardpin')
router.register(r'events', EventViewSet, basename='event')
router.register(r'card-logs', CardLogViewSet, basename='cardlog')
router.register(r'notifications', NotificationViewSet, basename='notification')
router.register(r'weekly-priorities', WeeklyPriorityViewSet, basename='weeklypriority')
router.register(r'weekly-priority-config', WeeklyPriorityConfigViewSet, basename='weeklypriorityconfig')
router.register(r'card-date-change-requests', CardDueDateChangeRequestViewSet, basename='carddatechangerequest')
router.register(r'card-reopen-requests', CardReopenRequestViewSet, basename='cardreopenrequest')
router.register(r'kanban-stages', KanbanStageViewSet, basename='kanbanstage')
router.register(r'score-criterios', ScoreCriterionViewSet, basename='scorecriterion')
router.register(r'card-scores', CardScoreViewSet, basename='cardscore')
router.register(r'card-anexos', CardAnexoViewSet, basename='cardanexo')
# As LINHAS cadastradas. A rota `feriados/` abaixo responde outra pergunta:
# quais dias sao feriado, juntando o calculado com o cadastrado.
router.register(r'feriados-cadastrados', FeriadosCadastradosViewSet, basename='feriadocadastrado')

urlpatterns = [
    path('dashboard/resumo/', DashboardResumoView.as_view(), name='dashboard-resumo'),
    # Feriados para o SLA do Suporte, calculado no navegador. Ver feriados_api.py.
    path('feriados/', FeriadosView.as_view(), name='feriados'),
    # Preferências de notificação (single-resource — não usa router)
    path('notifications/preferences/', NotificationPreferenceView.as_view(), name='notification-preferences'),
    path('', include(router.urls)),
]
