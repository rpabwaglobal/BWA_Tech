from django.core.management.base import BaseCommand
from apps.accounts.models import User, Role


class Command(BaseCommand):
    help = 'Cadastra os novos usuários do sistema'

    def handle(self, *args, **options):
        new_users = [
            ('gustavo', 'gustavo@gmail.com', 'gustavo123'),
            ('elton', 'elton@gmail.com', 'elton123'),
            ('jefferson', 'jefferson@gmail.com', 'jefferson123'),
            ('thiago', 'thiago@gmail.com', 'thiago123'),
            ('robert', 'robert@gmail.com', 'robert123'),
            ('ilton', 'ilton@gmail.com', 'ilton123'),
            ('lucas', 'lucas@gmail.com', 'lucas123'),
            ('italo', 'italo@gmail.com', 'italo123'),
            ('geymerson', 'geymerson@gmail.com', 'geymerson123'),
            ('neilton', 'neilton@gmail.com', 'neilton123'),
        ]

        created_count = 0
        existing_count = 0

        for username, email, password in new_users:
            if not User.objects.filter(username=username).exists():
                User.objects.create_user(
                    username=username,
                    email=email,
                    password=password,
                    # Visitante é o cargo padrão do sistema; o cargo real
                    # (e o setor) é atribuído manualmente pelo admin.
                    role=Role.VISITANTE,
                    is_staff=False,
                    is_superuser=False
                )
                self.stdout.write(
                    self.style.SUCCESS(
                        f'[OK] Usuario criado: {username} - Email: {email} - Senha: {password}'
                    )
                )
                created_count += 1
            else:
                self.stdout.write(
                    self.style.WARNING(f'[EXISTE] Usuario ja existe: {username}')
                )
                existing_count += 1

        self.stdout.write(self.style.SUCCESS(f'\n=== Resumo ==='))
        self.stdout.write(f'Usuarios criados: {created_count}')
        self.stdout.write(f'Usuarios ja existentes: {existing_count}')
        self.stdout.write(self.style.WARNING(
            '\n[ATENCAO] Todos os novos usuarios foram criados como VISITANTE.'
        ))
        self.stdout.write(
            '[INFO] O ADMIN deve atribuir cargo, setor e permissoes de cada um '
            'na tela de usuarios.'
        )
