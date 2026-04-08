"""
Remove cards duplicados no mesmo projeto (mesmo nome, ignorando maiúsculas/espaços).

Em cada grupo, mantém o card na etapa (status) mais avançada; em empate, mantém o de menor id.

Uso:
  python manage.py cards_dedupe_por_projeto
  python manage.py cards_dedupe_por_projeto --commit
  python manage.py cards_dedupe_por_projeto --project-id=42 --commit
"""
from __future__ import annotations

from collections import defaultdict

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.projects.models import Card, CardStatus, Project
from apps.projects.services import dedupe_cards_mesmo_nome_no_projeto


def _norm(nome: str) -> str:
    return (nome or "").strip().casefold()


_STATUS_RANK = {
    CardStatus.A_DESENVOLVER: 1,
    CardStatus.PARADO_PENDENCIAS: 2,
    CardStatus.EM_DESENVOLVIMENTO: 3,
    CardStatus.EM_HOMOLOGACAO: 4,
    CardStatus.FINALIZADO: 5,
    CardStatus.INVIABILIZADO: 5,
}


def _rank(card: Card) -> int:
    return _STATUS_RANK.get(card.status, 0)


def _pick_winner(cards: list[Card]) -> Card:
    """Maior rank; em empate, menor id (registro mais antigo)."""
    return max(cards, key=lambda c: (_rank(c), -c.id))


class Command(BaseCommand):
    help = "Remove cards duplicados por (projeto, nome); mantém o mais avançado no Kanban."

    def add_arguments(self, parser):
        parser.add_argument(
            "--project-id",
            type=int,
            default=None,
            help="Limitar a um projeto (ID).",
        )
        parser.add_argument(
            "--commit",
            action="store_true",
            help="Aplica exclusões. Sem isso, apenas lista (dry-run).",
        )

    def handle(self, *args, **options):
        project_id = options["project_id"]
        commit = options["commit"]

        qs = Card.objects.select_related("projeto").order_by("projeto_id", "id")
        if project_id is not None:
            qs = qs.filter(projeto_id=project_id)

        by_key: dict[tuple[int, str], list[Card]] = defaultdict(list)
        for card in qs:
            by_key[(card.projeto_id, _norm(card.nome))].append(card)

        to_delete: list[tuple[Card, Card]] = []
        dup_groups = 0
        for key, group in by_key.items():
            if len(group) < 2:
                continue
            dup_groups += 1
            winner = _pick_winner(group)
            for c in group:
                if c.id != winner.id:
                    to_delete.append((c, winner))

        if not to_delete:
            self.stdout.write(self.style.SUCCESS("Nenhum duplicado encontrado."))
            return

        self.stdout.write(f"Grupos com duplicados: {dup_groups}")
        self.stdout.write(f"Cards a remover: {len(to_delete)}")
        for c, w in to_delete[:80]:
            self.stdout.write(
                f"  remover id={c.id} projeto={c.projeto_id} status={c.status!r} "
                f"nome={c.nome!r} (mantém id={w.id} status={w.status!r})"
            )
        if len(to_delete) > 80:
            self.stdout.write(f"  ... e mais {len(to_delete) - 80}.")

        if not commit:
            self.stdout.write(self.style.WARNING("Dry-run. Rode com --commit para aplicar."))
            return

        with transaction.atomic():
            if project_id is not None:
                removed = dedupe_cards_mesmo_nome_no_projeto(project_id)
            else:
                removed = []
                for pid in Project.objects.values_list("id", flat=True):
                    removed.extend(dedupe_cards_mesmo_nome_no_projeto(pid))
        self.stdout.write(self.style.SUCCESS(f"Removidos {len(removed)} cards duplicados."))
