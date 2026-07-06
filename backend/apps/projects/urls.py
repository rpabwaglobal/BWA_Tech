from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    SprintViewSet, ProjectViewSet, CardViewSet, UserNoteViewSet, CardPinViewSet,
    EventViewSet, CardLogViewSet,
    NotificationViewSet, NotificationPreferenceView,
    WeeklyPriorityViewSet, WeeklyPriorityConfigViewSet, CardDueDateChangeRequestViewSet,
    KanbanStageViewSet,
    ScoreCriterionViewSet, CardScoreViewSet,
)

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
router.register(r'kanban-stages', KanbanStageViewSet, basename='kanbanstage')
router.register(r'score-criterios', ScoreCriterionViewSet, basename='scorecriterion')
router.register(r'card-scores', CardScoreViewSet, basename='cardscore')

urlpatterns = [
    # Preferências de notificação (single-resource — não usa router)
    path('notifications/preferences/', NotificationPreferenceView.as_view(), name='notification-preferences'),
    path('', include(router.urls)),
]
