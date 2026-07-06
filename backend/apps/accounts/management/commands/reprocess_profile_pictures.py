"""Reprocessa fotos de perfil já existentes: redimensiona, re-encoda como JPEG e
renomeia com uuid — o mesmo tratamento aplicado a novos uploads.

Deixa os avatares antigos leves (máx 512px) e com nome único, permitindo o cache
imutável no browser. O arquivo antigo é removido do storage após o sucesso.

Uso:
    # mostra o que seria feito, sem alterar nada
    python manage.py reprocess_profile_pictures --dry-run

    # reprocessa de fato
    python manage.py reprocess_profile_pictures
"""
import io

from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model

from apps.accounts.image_processing import process_profile_picture


class Command(BaseCommand):
    help = 'Redimensiona e re-encoda as fotos de perfil já existentes (nome uuid + JPEG 512px).'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Apenas lista o que seria reprocessado, sem gravar nada.',
        )

    def handle(self, *args, **options):
        User = get_user_model()
        dry_run = options['dry_run']
        users = (
            User.objects
            .exclude(profile_picture='')
            .exclude(profile_picture__isnull=True)
        )
        total = users.count()

        processed = 0
        skipped = 0
        missing = 0

        for user in users.iterator():
            pic = user.profile_picture
            old_name = pic.name

            # Referência órfã: arquivo não existe mais no storage.
            try:
                if not pic.storage.exists(old_name):
                    missing += 1
                    self.stdout.write(self.style.WARNING(
                        f'[--] {user.username}: arquivo ausente ({old_name}) — pulado. '
                        f'Use audit_profile_pictures --fix para limpar.'
                    ))
                    continue
            except Exception as exc:
                self.stderr.write(self.style.WARNING(
                    f'[?] {user.username}: erro ao checar {old_name} — {exc}'
                ))
                skipped += 1
                continue

            # Lê os bytes atuais para dentro da memória e reprocessa.
            try:
                pic.open('rb')
                try:
                    raw = pic.read()
                finally:
                    pic.close()
                new_file = process_profile_picture(io.BytesIO(raw))
            except Exception as exc:
                self.stderr.write(self.style.ERROR(
                    f'[X] {user.username}: falha ao ler/processar {old_name} — {exc}'
                ))
                skipped += 1
                continue

            if new_file is None:
                self.stderr.write(self.style.ERROR(
                    f'[X] {user.username}: não foi possível processar {old_name} '
                    f'(Pillow ausente ou imagem inválida) — pulado.'
                ))
                skipped += 1
                continue

            if dry_run:
                self.stdout.write(
                    f'[dry] {user.username}: {old_name} -> {new_file.name} '
                    f'({len(raw)} B -> {new_file.size} B)'
                )
                processed += 1
                continue

            # Grava o novo arquivo e remove o antigo.
            user.profile_picture.save(new_file.name, new_file, save=False)
            user.save(update_fields=['profile_picture'])
            try:
                pic.storage.delete(old_name)
            except Exception as exc:
                self.stderr.write(self.style.WARNING(
                    f'[!] {user.username}: nova foto salva, mas falha ao apagar antiga '
                    f'{old_name} — {exc}'
                ))
            self.stdout.write(self.style.SUCCESS(
                f'[ok] {user.username}: {old_name} -> {user.profile_picture.name} '
                f'({len(raw)} B -> {new_file.size} B)'
            ))
            processed += 1

        self.stdout.write('')
        self.stdout.write(self.style.NOTICE(f'Usuários com foto: {total}'))
        verbo = 'seriam reprocessadas' if dry_run else 'reprocessadas'
        self.stdout.write(self.style.NOTICE(f'Fotos {verbo}: {processed}'))
        if skipped:
            self.stdout.write(self.style.NOTICE(f'Puladas (erro/inválida): {skipped}'))
        if missing:
            self.stdout.write(self.style.NOTICE(f'Arquivo ausente: {missing}'))
        if dry_run:
            self.stdout.write('')
            self.stdout.write('Rode sem --dry-run para aplicar as mudanças.')
