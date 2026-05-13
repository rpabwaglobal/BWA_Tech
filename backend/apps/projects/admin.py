from django.contrib import admin

from .models import UserNotificationPreference, UserNote, UserNoteTodo


class UserNoteTodoInline(admin.TabularInline):
    model = UserNoteTodo
    extra = 0
    fields = ('label', 'done', 'order')


@admin.register(UserNote)
class UserNoteAdmin(admin.ModelAdmin):
    list_display = ('title', 'user', 'color', 'pinned', 'archived', 'updated_at')
    list_filter = ('color', 'pinned', 'archived')
    search_fields = ('title', 'body', 'user__username', 'user__email')
    readonly_fields = ('created_at', 'updated_at')
    inlines = [UserNoteTodoInline]


@admin.register(UserNotificationPreference)
class UserNotificationPreferenceAdmin(admin.ModelAdmin):
    list_display = (
        'user',
        # 7 default ON
        'card_updated', 'card_deleted', 'project_created',
        'card_overdue', 'card_due_24h', 'card_due_1h', 'card_due_10min',
        # 4 default OFF
        'card_created', 'card_moved', 'sprint_created', 'role_changed',
        'updated_at',
    )
    list_filter = (
        'card_updated', 'card_deleted', 'sprint_created', 'role_changed',
    )
    search_fields = ('user__username', 'user__email')
    readonly_fields = ('updated_at',)
