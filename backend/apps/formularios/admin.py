from django.contrib import admin

from .models import ChamadoSuporte, SuporteItem, SuporteMotivo, SuporteTipo


class SuporteItemInline(admin.TabularInline):
    model = SuporteItem
    extra = 1


@admin.register(SuporteTipo)
class SuporteTipoAdmin(admin.ModelAdmin):
    list_display = ('id', 'nome', 'ativo')
    list_filter = ('ativo',)
    search_fields = ('nome',)
    inlines = [SuporteItemInline]


@admin.register(SuporteItem)
class SuporteItemAdmin(admin.ModelAdmin):
    list_display = ('id', 'nome', 'tipo', 'ativo')
    list_filter = ('ativo', 'tipo')
    search_fields = ('nome',)


@admin.register(SuporteMotivo)
class SuporteMotivoAdmin(admin.ModelAdmin):
    list_display = ('id', 'nome', 'ativo')
    list_filter = ('ativo',)


@admin.register(ChamadoSuporte)
class ChamadoSuporteAdmin(admin.ModelAdmin):
    list_display = ('id', 'usuario_email', 'status', 'data_abertura')
    list_filter = ('status',)
    search_fields = ('usuario_email', 'usuario_nome', 'descricao')
    raw_id_fields = ('tipo', 'item', 'motivo')
