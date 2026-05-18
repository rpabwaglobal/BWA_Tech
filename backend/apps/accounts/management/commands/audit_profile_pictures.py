"""Audita (e opcionalmente limpa) referências órfãs de foto de perfil.

Uso:
    # só lista o que está quebrado
    python manage.py audit_profile_pictures

    # remove as referências órfãs do banco (mantém histórico no log)
    python manage.py audit_profile_pictures --fix
"""
from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model


class Command(BaseCommand):
    help = 'Lista (e opcionalmente remove) referências órfãs de foto de perfil.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--fix',
            action='store_true',
            help='Limpa o campo profile_picture dos usuários cujos arquivos não existem.',
        )

    def handle(self, *args, **options):
        User = get_user_model()
        users_with_pic = User.objects.exclude(profile_picture='').exclude(profile_picture__isnull=True)
        total = users_with_pic.count()
        broken = []
        for user in users_with_pic.iterator():
            pic = user.profile_picture
            try:
                exists = pic.storage.exists(pic.name)
            except Exception as exc:
                self.stderr.write(self.style.WARNING(
                    f'[?] {user.username} ({pic.name}): erro ao checar — {exc}'
                ))
                continue
            if not exists:
                broken.append(user)
                self.stdout.write(self.style.ERROR(
                    f'[X] {user.username} ({user.id}) -> {pic.name}  (arquivo ausente)'
                ))

        self.stdout.write('')
        self.stdout.write(self.style.NOTICE(
            f'Total de usuários com profile_picture: {total}'
        ))
        self.stdout.write(self.style.NOTICE(
            f'Referências órfãs encontradas: {len(broken)}'
        ))

        if options['fix'] and broken:
            for user in broken:
                user.profile_picture = None
                user.save(update_fields=['profile_picture'])
            self.stdout.write(self.style.SUCCESS(
                f'OK — {len(broken)} referência(s) limpa(s) do banco.'
            ))
        elif broken and not options['fix']:
            self.stdout.write('')
            self.stdout.write(
                'Use --fix para limpar as referências órfãs do banco. '
                'O frontend já trata graciosamente (avatar de iniciais) '
                'graças ao helper get_profile_picture_url.'
            )
