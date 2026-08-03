from django.core.management.base import BaseCommand
from apps.accounts.models import User, Role


class Command(BaseCommand):
    help = 'Cadastra os usuários do time de Dados'

    def handle(self, *args, **options):
        # O command não remove usuários legados (dev, gerente, supervisor):
        # Sprint.supervisor é on_delete=CASCADE, então apagar um usuário que
        # supervisiona sprints leva junto as sprints dele e, por
        # Project.sprint, os cards. Para tirar alguém de circulação use
        # is_active=False pela tela de usuários.
        dados_users = [
            ('pedro', 'pedro@gmail.com', 'pedro123'),
            ('levy', 'levy@gmail.com', 'levy123'),
            ('douglas', 'douglas@gmail.com', 'douglas123'),
            ('jhonnatan', 'jhonnatan@gmail.com', 'jhonnatan123'),
        ]

        created_count = 0
        existing_count = 0

        for username, email, password in dados_users:
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
            '\n[ATENCAO] Todos nasceram como VISITANTE.'
        ))
        self.stdout.write(
            '[INFO] O ADMIN deve atribuir cargo e setor de cada um na tela de usuarios.'
        )
