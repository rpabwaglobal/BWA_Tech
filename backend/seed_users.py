"""
Seed inicial de usuários (apenas dev/staging).

Senhas NÃO são hardcoded; geradas via `secrets.token_urlsafe` e impressas
UMA VEZ no console para captura manual. Em produção, prefira criar usuários
pelo admin Django (já protegido por autenticação + 2FA quando ativado).
"""

import secrets

from apps.accounts.models import User, Role


def _make_password() -> str:
    """Senha forte aleatória (URL-safe, ~24 chars, ~144 bits de entropia)."""
    return secrets.token_urlsafe(18)


def seed_users():
    initial_users = [
        ('admin', 'admin@example.com', Role.ADMIN),
        ('supervisor', 'supervisor@example.com', Role.SUPERVISOR),
        ('gerente', 'gerente@example.com', Role.GERENTE),
        ('dev', 'dev@example.com', Role.DESENVOLVEDOR),
    ]
    new_users = [
        ('gustavo', 'gustavo@gmail.com', Role.DESENVOLVEDOR),
        ('elton', 'elton@gmail.com', Role.DESENVOLVEDOR),
        ('jefferson', 'jefferson@gmail.com', Role.DESENVOLVEDOR),
        ('thiago', 'thiago@gmail.com', Role.DESENVOLVEDOR),
        ('robert', 'robert@gmail.com', Role.DESENVOLVEDOR),
        ('ilton', 'ilton@gmail.com', Role.DESENVOLVEDOR),
        ('lucas', 'lucas@gmail.com', Role.DESENVOLVEDOR),
        ('italo', 'italo@gmail.com', Role.DESENVOLVEDOR),
        ('geymerson', 'geymerson@gmail.com', Role.DESENVOLVEDOR),
    ]
    all_users = initial_users + new_users

    print("\n=== Senhas geradas (anote AGORA — não serão exibidas novamente) ===\n")
    for username, email, role in all_users:
        if User.objects.filter(username=username).exists():
            print(f"  [skip] {username:12} (já existe)")
            continue
        password = _make_password()
        User.objects.create_user(
            username=username,
            email=email,
            password=password,
            role=role,
            is_staff=role in (Role.ADMIN, Role.SUPERVISOR),
            is_superuser=role == Role.ADMIN,
        )
        print(f"  {username:12}  {email:32}  senha: {password}")

    print("\n=== Resumo ===")
    print("Cada usuário foi criado com senha aleatória forte exibida acima.")
    print("Guarde-as num gerenciador de senhas. Trocar via /api/users/change-password/.")


if __name__ == '__main__':
    seed_users()
