"""Migra usuários dos cargos legados (gerente/dados/processos) para o cargo
`desenvolvedor`, SEM tocar em `user_permissions` (cada usuário preserva
exatamente as permissões que tem hoje).

Uso:
    python manage.py migrate_legacy_cargos --dry-run     # relatório, não grava
    python manage.py migrate_legacy_cargos               # aplica
    python manage.py migrate_legacy_cargos --delete-empty-cargos   # + apaga cargos legados sem usuários
"""
from collections import Counter

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.accounts.models import User, Cargo, CARGO_CHOICES_CACHE_KEY
from django.core.cache import cache

SOURCE_ROLES = ['gerente', 'dados', 'processos']
TARGET_ROLE = 'desenvolvedor'


class Command(BaseCommand):
    help = 'Migra cargos legados (gerente/dados/processos) para desenvolvedor sem alterar permissões.'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true', help='Só relata, não grava.')
        parser.add_argument('--delete-empty-cargos', action='store_true',
                            help='Após migrar, apaga cargos legados (is_system=False) sem usuários.')

    def handle(self, *args, **opts):
        dry = opts['dry_run']
        alvo = Cargo.objects.filter(codename=TARGET_ROLE).first()
        if not alvo:
            self.stderr.write(self.style.ERROR(
                f'Cargo alvo "{TARGET_ROLE}" não existe. Rode as migrations primeiro.'))
            return

        antes = Counter(User.objects.values_list('role', flat=True))
        self.stdout.write(f'Distribuição ANTES: {dict(antes)}')

        qs = User.objects.filter(role__in=SOURCE_ROLES)
        total = qs.count()
        superusers = qs.filter(is_superuser=True).count()
        self.stdout.write(f'A migrar: {total} usuario(s) em {SOURCE_ROLES} -> "{TARGET_ROLE}" '
                          f'(pulando {superusers} superuser(s), que voltam a admin no save()).')

        if dry:
            self.stdout.write(self.style.WARNING('DRY-RUN: nada foi gravado.'))
            return

        migrados = 0
        with transaction.atomic():
            for u in User.objects.select_for_update().filter(role__in=SOURCE_ROLES):
                if u.is_superuser:
                    continue  # save() força admin
                u.role = TARGET_ROLE
                # NUNCA tocamos user_permissions → permissões preservadas.
                u.save(update_fields=['role', 'updated_at'])  # dispara signal user_role_changed
                migrados += 1

        cache.delete(CARGO_CHOICES_CACHE_KEY)
        depois = Counter(User.objects.values_list('role', flat=True))
        self.stdout.write(self.style.SUCCESS(f'Migrados {migrados} usuário(s).'))
        self.stdout.write(f'Distribuição DEPOIS: {dict(depois)}')

        if opts['delete_empty_cargos']:
            apagados = []
            for cn in SOURCE_ROLES:
                cargo = Cargo.objects.filter(codename=cn, is_system=False).first()
                if cargo and not User.objects.filter(role=cn).exists():
                    cargo.delete()
                    apagados.append(cn)
            cache.delete(CARGO_CHOICES_CACHE_KEY)
            self.stdout.write(self.style.SUCCESS(f'Cargos legados vazios apagados: {apagados or "nenhum"}'))
        else:
            self.stdout.write(self.style.WARNING(
                'Cargos legados NÃO apagados (rede de segurança). Use --delete-empty-cargos após dias estáveis.'))
