from __future__ import annotations

from collections import defaultdict

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Count
from django.db.models.functions import Lower, Trim
from django.utils import timezone

from apps.projects.models import Sprint, Project, Card
from apps.projects.services import merge_project_kanban_into, dedupe_cards_mesmo_nome_em_todos_projetos_da_sprint


def _norm_name(nome: str) -> str:
    return (nome or "").strip().casefold()


class Command(BaseCommand):
    help = (
        "Consolida projetos duplicados na sprint em andamento (por nome), "
        "fundindo Kanban, movendo cards para um projeto canônico, apagando projetos vazios "
        "e removendo cards duplicados (mesmo nome) mantendo o mais avançado no Kanban."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--sprint-id",
            type=int,
            default=None,
            help="ID da sprint alvo. Se omitido, usa a sprint em andamento (não finalizada, já iniciada e fechamento_em ainda no futuro).",
        )
        parser.add_argument(
            "--commit",
            action="store_true",
            help="Aplica as alterações no banco. Se omitido, roda em dry-run (somente exibe o que faria).",
        )
        parser.add_argument(
            "--keep",
            choices=["most_cards", "oldest", "newest"],
            default="newest",
            help="Critério para escolher o projeto canônico entre duplicados: newest (padrão), most_cards, oldest.",
        )

    def handle(self, *args, **options):
        agora = timezone.now()
        sprint_id = options.get("sprint_id")
        do_commit = bool(options.get("commit"))
        keep = options.get("keep")

        if sprint_id:
            sprint = Sprint.objects.filter(pk=sprint_id).first()
            if not sprint:
                raise CommandError(f"Sprint id={sprint_id} não encontrada.")
        else:
            sprint = (
                Sprint.objects.filter(
                    finalizada=False,
                    data_inicio__lte=agora,
                    fechamento_em__gt=agora,
                )
                .order_by("data_inicio")
                .first()
            )
            if not sprint:
                raise CommandError(
                    "Nenhuma sprint em andamento encontrada (finalizada=False, já iniciada e fechamento_em no futuro). "
                    "Informe --sprint-id."
                )

        self.stdout.write(f"Sprint alvo: {sprint.nome} (id={sprint.id})")
        self.stdout.write("Modo: COMMIT" if do_commit else "Modo: DRY-RUN (sem alterações)")

        qs = (
            Project.objects.filter(sprint=sprint)
            .annotate(nome_norm=Lower(Trim("nome")))
            .annotate(card_count=Count("cards"))
            .order_by("id")
        )
        projects = list(qs)
        if not projects:
            self.stdout.write(self.style.WARNING("Nenhum projeto na sprint alvo."))
            return

        by_name: dict[str, list[Project]] = defaultdict(list)
        for p in projects:
            by_name[_norm_name(p.nome)].append(p)

        duplicate_groups = {k: v for k, v in by_name.items() if k and len(v) > 1}

        empty_projects = [p for p in projects if getattr(p, "card_count", 0) == 0]
        self.stdout.write(f"Projetos na sprint: {len(projects)}")
        self.stdout.write(f"Grupos de duplicados (por nome): {len(duplicate_groups)}")
        self.stdout.write(f"Projetos vazios (0 cards): {len(empty_projects)}")

        def pick_canonical(group: list[Project]) -> Project:
            if keep == "oldest":
                return min(group, key=lambda p: (p.created_at, p.id))
            if keep == "newest":
                return max(group, key=lambda p: (p.created_at, p.id))
            # most_cards
            return max(group, key=lambda p: (getattr(p, "card_count", 0), p.created_at, -p.id))

        planned_moves: list[tuple[int, int, int]] = []  # (from_project_id, to_project_id, cards_moved)
        planned_deletes: list[int] = []

        # 1) Consolidar duplicados por nome na sprint atual
        for norm, group in sorted(duplicate_groups.items(), key=lambda kv: kv[0]):
            canonical = pick_canonical(group)
            others = [p for p in group if p.id != canonical.id]

            # Recalcular counts (se o queryset não populou por algum motivo)
            canonical_cards = getattr(canonical, "card_count", None)
            if canonical_cards is None:
                canonical_cards = Card.objects.filter(projeto=canonical).count()

            self.stdout.write("")
            self.stdout.write(self.style.MIGRATE_HEADING(f'Projeto "{canonical.nome}" (norm="{norm}")'))
            self.stdout.write(f"  Canônico: id={canonical.id} cards={canonical_cards}")

            for other in others:
                other_cards = getattr(other, "card_count", None)
                if other_cards is None:
                    other_cards = Card.objects.filter(projeto=other).count()

                if other_cards > 0:
                    planned_moves.append((other.id, canonical.id, other_cards))
                    self.stdout.write(f"  - MOVER {other_cards} cards: id={other.id} -> id={canonical.id}")
                else:
                    self.stdout.write(f"  - APAGAR (vazio): id={other.id}")
                planned_deletes.append(other.id)

        # 2) Apagar vazios "soltos" (não necessariamente duplicados)
        for p in empty_projects:
            if p.id in planned_deletes:
                continue
            planned_deletes.append(p.id)

        planned_deletes = sorted(set(planned_deletes))

        self.stdout.write("")
        self.stdout.write(self.style.NOTICE(f"Total de movimentos planejados: {len(planned_moves)}"))
        self.stdout.write(self.style.NOTICE(f"Total de projetos para apagar: {len(planned_deletes)}"))
        self.stdout.write(
            self.style.NOTICE(
                "Após fundir projetos, com --commit também remove cards duplicados (mesmo nome) "
                "em cada projeto da sprint, mantendo o mais avançado."
            )
        )

        if not do_commit:
            self.stdout.write("")
            self.stdout.write(self.style.WARNING("DRY-RUN: nenhuma alteração foi aplicada. Rode com --commit para aplicar."))
            return

        with transaction.atomic():
            # Moves: fundir Kanban, depois mover cards
            for from_id, to_id, _cnt in planned_moves:
                canonical = Project.objects.select_for_update().get(pk=to_id)
                other = Project.objects.select_for_update().get(pk=from_id)
                merge_project_kanban_into(canonical, other)
                updated = Card.objects.filter(projeto_id=from_id).update(projeto_id=to_id)
                self.stdout.write(f"MOV: projeto {from_id} -> {to_id} | cards atualizados: {updated}")

            # Deletes (somente se ainda estiverem sem cards depois dos moves)
            deleted_ok = 0
            skipped_not_empty = 0
            for pid in planned_deletes:
                remaining = Card.objects.filter(projeto_id=pid).count()
                if remaining > 0:
                    skipped_not_empty += 1
                    self.stdout.write(self.style.WARNING(f"SKIP delete projeto id={pid}: ainda tem {remaining} cards."))
                    continue
                Project.objects.filter(id=pid, sprint=sprint).delete()
                deleted_ok += 1

            removed_card_ids = dedupe_cards_mesmo_nome_em_todos_projetos_da_sprint(sprint.id)
            self.stdout.write("")
            self.stdout.write(
                self.style.SUCCESS(
                    f"Cards duplicados (mesmo nome) removidos na sprint: {len(removed_card_ids)}"
                )
            )

            self.stdout.write("")
            self.stdout.write(self.style.SUCCESS(f"Consolidação aplicada. Projetos apagados: {deleted_ok}. Skips (ainda tinham cards): {skipped_not_empty}."))

