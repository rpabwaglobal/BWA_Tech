"""Move TODOS os dados existentes (sprints, projetos, cards, usuários) para o
setor "Tecnologia", garantindo que NADA fique órfão. Idempotente e atômico.

Uso:
    python manage.py migrar_tudo_para_tecnologia --dry-run
    python manage.py migrar_tudo_para_tecnologia
"""
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.accounts.models import User, SetorCatalogo, UserSetor
from apps.projects.models import Sprint, Project, Card


class Command(BaseCommand):
    help = 'Associa todas as sprints/projetos/cards/usuários ao setor Tecnologia (sem órfãos).'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true')

    def handle(self, *args, **opts):
        dry = opts['dry_run']
        tec = SetorCatalogo.objects.filter(codename='tecnologia').first()
        if not tec:
            self.stderr.write(self.style.ERROR('Setor "tecnologia" não existe. Rode as migrations primeiro.'))
            return

        orf_sprint = Sprint.objects.filter(setor__isnull=True).count()
        orf_proj = Project.objects.filter(setor__isnull=True).count()
        orf_card = Card.objects.filter(setor__isnull=True).count()
        sem_link = User.objects.exclude(setor_links__setor=tec).count()
        self.stdout.write(f'Orfaos -> sprints:{orf_sprint} projetos:{orf_proj} cards:{orf_card} '
                          f'| usuarios sem vinculo com Tecnologia:{sem_link}')

        if dry:
            self.stdout.write(self.style.WARNING('DRY-RUN: nada gravado.'))
            return

        with transaction.atomic():
            Sprint.objects.filter(setor__isnull=True).update(setor=tec)
            Project.objects.filter(setor__isnull=True).update(setor=tec)
            Card.objects.filter(setor__isnull=True).update(setor=tec)
            for u in User.objects.all():
                link, created = UserSetor.objects.get_or_create(
                    user=u, setor=tec, defaults={'is_primary': not u.setor})
                # Sincroniza o CharField primário se ainda vazio.
                if not u.setor:
                    u.setor = tec.codename
                    u.save(update_fields=['setor'])

            # Garantia: NÃO deve restar nada de fora.
            rest_s = Sprint.objects.filter(setor__isnull=True).count()
            rest_p = Project.objects.filter(setor__isnull=True).count()
            rest_c = Card.objects.filter(setor__isnull=True).count()
            assert rest_s == 0 and rest_p == 0 and rest_c == 0, (
                f'ORFAOS RESTANTES: sprints={rest_s} projetos={rest_p} cards={rest_c}')

        self.stdout.write(self.style.SUCCESS(
            f'Concluido. Sprints/Projetos/Cards e {User.objects.count()} usuario(s) agora em Tecnologia. Zero orfaos.'))
