"""Helpers de escopo por setor (segmentação da plataforma).

Regra: cada usuário vê apenas dados dos SEUS setores + dados compartilhados
com esses setores (fail-closed). Quem tem `view_cross_setor` (ou é superuser)
vê tudo. Enquanto `SETOR_SCOPING_ENABLED` for False, tudo é fail-open (nada
filtrado) — permite migrar/backfillar sem quebrar produção.

O escopo é ORTOGONAL às permissões granulares (`has_perm`): um usuário pode
ter permissão de editar sprint, mas só das sprints do seu setor.
"""
from django.conf import settings
from django.db.models import Q

BYPASS_PERM = 'accounts.view_cross_setor'


def setores_do_usuario(user):
    """Conjunto de codenames de setor do usuário (via M2M UserSetor)."""
    return set(user.setores.values_list('codename', flat=True))


def setor_primario_do_usuario(user):
    """Objeto SetorCatalogo primário do usuário: vínculo M2M is_primary,
    senão qualquer vínculo M2M, senão o CharField legado `user.setor`.
    Retorna None se não houver nada."""
    from .models import SetorCatalogo, UserSetor
    vinculo = (UserSetor.objects.filter(user=user)
               .order_by('-is_primary', 'added_at')
               .select_related('setor')
               .first())
    if vinculo:
        return vinculo.setor
    if getattr(user, 'setor', None):
        return SetorCatalogo.objects.filter(codename=user.setor).first()
    return None


def usuario_ve_tudo(user):
    return bool(getattr(user, 'is_superuser', False) or user.has_perm(BYPASS_PERM))


def _scoping_on():
    return getattr(settings, 'SETOR_SCOPING_ENABLED', False)


def scope_sprints(qs, user):
    if not _scoping_on() or usuario_ve_tudo(user):
        return qs
    U = setores_do_usuario(user)
    if not U:
        return qs.none()
    return qs.filter(Q(setor__codename__in=U) | Q(setores_compartilhados__codename__in=U)).distinct()


def scope_projects(qs, user):
    if not _scoping_on() or usuario_ve_tudo(user):
        return qs
    U = setores_do_usuario(user)
    if not U:
        return qs.none()
    return qs.filter(
        Q(setor__codename__in=U)
        | Q(setores_compartilhados__codename__in=U)
        | Q(sprint__setores_compartilhados__codename__in=U)
    ).distinct()


def scope_cards(qs, user):
    if not _scoping_on() or usuario_ve_tudo(user):
        return qs
    U = setores_do_usuario(user)
    if not U:
        return qs.none()
    return qs.filter(
        Q(setor__codename__in=U)
        | Q(projeto__setores_compartilhados__codename__in=U)
        | Q(projeto__sprint__setores_compartilhados__codename__in=U)
    ).distinct()


def scope_card_scores(qs, user):
    """Escopa CardScore pelo setor do card dono (card.setor é espelho do
    projeto). Mesma semântica do scope_cards, com o prefixo card__."""
    if not _scoping_on() or usuario_ve_tudo(user):
        return qs
    U = setores_do_usuario(user)
    if not U:
        return qs.none()
    return qs.filter(
        Q(card__setor__codename__in=U)
        | Q(card__projeto__setores_compartilhados__codename__in=U)
        | Q(card__projeto__sprint__setores_compartilhados__codename__in=U)
    ).distinct()


def scope_users(qs, user):
    """Usuários visíveis: os que compartilham algum setor com o operador
    (mais ele mesmo). Sem setor → só a si mesmo."""
    if not _scoping_on() or usuario_ve_tudo(user):
        return qs
    U = setores_do_usuario(user)
    if not U:
        return qs.filter(pk=user.pk)
    return qs.filter(Q(setores__codename__in=U) | Q(pk=user.pk)).distinct()
