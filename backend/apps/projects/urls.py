from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    SprintViewSet, ProjectViewSet, CardViewSet, CardTodoViewSet, EventViewSet, CardLogViewSet, 
    NotificationViewSet, WeeklyPriorityViewSet, WeeklyPriorityConfigViewSet, CardDueDateChangeRequestViewSet
    ,KanbanStageViewSet
)

router = DefaultRouter()
router.register(r'sprints', SprintViewSet, basename='sprint')
router.register(r'projects', ProjectViewSet, basename='project')
router.register(r'cards', CardViewSet, basename='card')
router.register(r'card-todos', CardTodoViewSet, basename='cardtodo')
router.register(r'events', EventViewSet, basename='event')
router.register(r'card-logs', CardLogViewSet, basename='cardlog')
router.register(r'notifications', NotificationViewSet, basename='notification')
router.register(r'weekly-priorities', WeeklyPriorityViewSet, basename='weeklypriority')
router.register(r'weekly-priority-config', WeeklyPriorityConfigViewSet, basename='weeklypriorityconfig')
router.register(r'card-date-change-requests', CardDueDateChangeRequestViewSet, basename='carddatechangerequest')
router.register(r'kanban-stages', KanbanStageViewSet, basename='kanbanstage')

urlpatterns = [
    path('', include(router.urls)),
]
