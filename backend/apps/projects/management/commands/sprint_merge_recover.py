"""
Correção pós fechamento automático incorreto:

1) Consolida N sprints abertas numa sprint destino, fundindo projetos homônimos.

2) Pode **reutilizar uma sprint existente** (ex.: "Sprint 3.26") com
   `--usar-sprint-existente-por-nome` — não cria sprint nova.

3) Opcional: `--fechamento-hoje-2359` define fechamento_em para **hoje 23:59:59**
   (fuso TIME_ZONE do Django).

4) Remove sprints de origem vazias (salvo --no-delete-origem).

5) Opcional: CSV para mover projetos para sprints fechadas (restauração histórica).

Exemplo — fundir 3 sprints na "Sprint 3.26" existente, fechamento hoje às 23:59:

  python manage.py sprint_merge_recover \\
    --origem-ids=10,11,12 \\
    --nome-destino="Sprint 3.26" \\
    --usar-sprint-existente-por-nome \\
    --fechamento-hoje-2359 \\
    --dry-run

  python manage.py sprint_merge_recover \\
    --origem-ids=10,11,12 \\
    --nome-destino="Sprint 3.26" \\
    --usar-sprint-existente-por-nome \\
    --fechamento-hoje-2359 \\
    --commit
"""
from __future__ import annotations

import csv
from collections import defaultdict
from datetime import datetime, time
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.projects.models import Sprint, Project, Card
from apps.projects.services import merge_project_kanban_into


def _norm_name(nome: str) -> str:
    return (nome or "").strip().casefold()


def _duracao_dias(data_inicio, fechamento_em):
    fe = fechamento_em
    if timezone.is_naive(fe):
        fe = timezone.make_aware(fe, timezone.get_current_timezone())
    di = data_inicio
    if di is not None and timezone.is_naive(di):
        di = timezone.make_aware(di, timezone.get_current_timezone())
    end_d = timezone.localtime(fe).date()
    start_d = timezone.localtime(di).date() if di is not None else None
    if start_d is None:
        return 1
    return max(1, (end_d - start_d).days + 1)


def _fechamento_hoje_2359_local():
    """Hoje (data local) às 23:59:59 no timezone atual do Django."""
    hoje = timezone.localdate()
    dt_naive = datetime.combine(hoje, time(23, 59, 59))
    return timezone.make_aware(dt_naive, timezone.get_current_timezone())


class Command(BaseCommand):
    help = (
        "Consolida sprints abertas numa sprint destino, funde projetos homônimos e opcionalmente "
        "move projetos para sprints fechadas via CSV."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--origem-ids",
            type=str,
            default="",
            help="IDs das sprints a fundir, separados por vírgula (ex: 10,11,12). Obrigatório exceto com --somente-restauracao.",
        )
        parser.add_argument(
            "--nome-destino",
            type=str,
            default="Sprint 3.26",
            help='Nome da sprint criada (se não usar --destino-id nem --usar-sprint-existente-por-nome) ou nome a procurar com --usar-sprint-existente-por-nome (default: "Sprint 3.26").',
        )
        parser.add_argument(
            "--destino-id",
            type=int,
            default=None,
            help="Usar sprint existente como destino (ID). Pode ser um dos IDs em --origem-ids.",
        )
        parser.add_argument(
            "--usar-sprint-existente-por-nome",
            action="store_true",
            help='Procura sprint com nome igual a --nome-destino (iexact), usa como destino e não cria nova. '
            "Se estiver finalizada, reabre (finalizada=False) ao consolidar.",
        )
        parser.add_argument(
            "--fechamento-hoje-2359",
            action="store_true",
            help="Define fechamento_em da sprint destino para hoje às 23:59:59 (fuso do Django).",
        )
        parser.add_argument(
            "--supervisor-id",
            type=int,
            default=None,
            help="ID do usuário supervisor da sprint nova (default: supervisor da primeira sprint origem). Ignorado se só reutilizar sprint existente.",
        )
        parser.add_argument(
            "--data-inicio",
            type=str,
            default=None,
            help="YYYY-MM-DD da sprint destino ao criar nova (default: menor data_inicio entre as origens).",
        )
        parser.add_argument(
            "--fechamento-em",
            type=str,
            default=None,
            help="ISO datetime do fechamento da sprint destino (sobrepõe cálculo a partir das origens).",
        )
        parser.add_argument(
            "--keep",
            choices=["oldest", "newest", "most_cards"],
            default="oldest",
            help="Projeto canônico ao fundir pelo mesmo nome: oldest (default), newest, most_cards.",
        )
        parser.add_argument(
            "--commit",
            action="store_true",
            help="Aplica alterações. Sem isso, apenas simula (equivalente a dry-run).",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Força modo simulação (não grava). Igual a omitir --commit.",
        )
        parser.add_argument(
            "--no-delete-origem",
            action="store_true",
            help="Após mover projetos, não apaga as sprints de origem (só para diagnóstico).",
        )
        parser.add_argument(
            "--somente-restauracao",
            action="store_true",
            help="Só executa a fase de restauração via --csv-restauracao (não faz merge de sprints).",
        )
        parser.add_argument(
            "--csv-restauracao",
            type=str,
            default="",
            help="CSV com colunas project_id,sprint_destino_id para mover projetos para sprints fechadas.",
        )
        parser.add_argument(
            "--permitir-sprint-aberta-restauracao",
            action="store_true",
            help="Com --csv-restauracao: permite sprint destino não finalizada (uso excepcional).",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"] or not options["commit"]
        if dry_run:
            self.stdout.write(self.style.WARNING("MODO SIMULAÇÃO — nenhuma alteração será gravada."))

        if options["somente_restauracao"]:
            if not options["csv_restauracao"]:
                raise CommandError("Use --csv-restauracao com --somente-restauracao.")
            self._run_restore_csv(
                Path(options["csv_restauracao"]),
                dry_run,
                allow_open=options["permitir_sprint_aberta_restauracao"],
            )
            return

        orig_raw = (options["origem_ids"] or "").strip()
        if not orig_raw:
            raise CommandError("Informe --origem-ids (ou use --somente-restauracao).")

        try:
            origem_ids = [int(x.strip()) for x in orig_raw.split(",") if x.strip()]
        except ValueError as e:
            raise CommandError(f"IDs inválidos em --origem-ids: {e}") from e

        if len(origem_ids) < 1:
            raise CommandError("Pelo menos um ID em --origem-ids.")

        self._run_merge(
            origem_ids=origem_ids,
            nome_destino=options["nome_destino"],
            destino_id=options["destino_id"],
            usar_sprint_existente_por_nome=options["usar_sprint_existente_por_nome"],
            fechamento_hoje_2359=options["fechamento_hoje_2359"],
            supervisor_id=options["supervisor_id"],
            data_inicio_opt=options["data_inicio"],
            fechamento_em_opt=options["fechamento_em"],
            keep=options["keep"],
            dry_run=dry_run,
            no_delete_origem=options["no_delete_origem"],
        )

    def _run_merge(
        self,
        *,
        origem_ids: list[int],
        nome_destino: str,
        destino_id: int | None,
        usar_sprint_existente_por_nome: bool,
        fechamento_hoje_2359: bool,
        supervisor_id: int | None,
        data_inicio_opt: str | None,
        fechamento_em_opt: str | None,
        keep: str,
        dry_run: bool,
        no_delete_origem: bool,
    ) -> None:
        User = get_user_model()
        nome_limpo = nome_destino.strip()

        dest_sprint: Sprint | None = None
        ids_to_delete: list[int] = []
        created_new_sprint = False

        # --- Resolver sprint destino
        if destino_id is not None:
            if destino_id in origem_ids:
                dest_sprint = Sprint.objects.filter(pk=destino_id).first()
                if not dest_sprint:
                    raise CommandError(f"--destino-id={destino_id} não encontrado.")
                ids_to_delete = [sid for sid in origem_ids if sid != destino_id]
            else:
                dest_sprint = Sprint.objects.filter(pk=destino_id).first()
                if not dest_sprint:
                    raise CommandError(f"--destino-id={destino_id} não encontrado.")
                if dest_sprint.finalizada and not usar_sprint_existente_por_nome:
                    raise CommandError(
                        "A sprint destino (--destino-id) está finalizada. "
                        "Use também --usar-sprint-existente-por-nome (e o mesmo --nome-destino) "
                        "para reabrir essa sprint ao consolidar."
                    )
                ids_to_delete = list(origem_ids)
        elif usar_sprint_existente_por_nome:
            dest_sprint = Sprint.objects.filter(nome__iexact=nome_limpo[:100]).first()
            if not dest_sprint:
                raise CommandError(
                    f'Não existe sprint com nome "{nome_limpo}". '
                    "Crie a sprint no sistema ou ajuste --nome-destino."
                )
            if dest_sprint.id in origem_ids:
                ids_to_delete = [sid for sid in origem_ids if sid != dest_sprint.id]
            else:
                ids_to_delete = list(origem_ids)
        else:
            existing = Sprint.objects.filter(nome__iexact=nome_limpo[:100]).first()
            if existing:
                raise CommandError(
                    f'Já existe sprint com nome "{nome_limpo}" (id={existing.id}). '
                    "Use --usar-sprint-existente-por-nome para reutilizá-la, "
                    "--destino-id, ou outro --nome-destino."
                )

        sprints = list(Sprint.objects.filter(pk__in=origem_ids).order_by("data_inicio"))
        if len(sprints) != len(set(origem_ids)):
            found = {s.id for s in sprints}
            missing = set(origem_ids) - found
            raise CommandError(f"Sprints não encontradas: {sorted(missing)}")

        for sp in sprints:
            if sp.finalizada:
                if dest_sprint and sp.id == dest_sprint.id:
                    continue
                raise CommandError(
                    f"A sprint id={sp.id} ({sp.nome}) está finalizada. "
                    "Só a sprint destino pode estar finalizada (será reaberta ao consolidar)."
                )

        # --- fechamento_em e datas para relatório / criação
        dis = [s.data_inicio for s in sprints]
        fes = [s.fechamento_em for s in sprints]
        min_di = min(dis)
        max_fe_from_origens = max(fes)

        if fechamento_hoje_2359:
            max_fe = _fechamento_hoje_2359_local()
        elif fechamento_em_opt:
            raw = fechamento_em_opt.strip()
            max_fe = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            if timezone.is_naive(max_fe):
                max_fe = timezone.make_aware(max_fe, timezone.get_current_timezone())
        elif dest_sprint is not None:
            max_fe = dest_sprint.fechamento_em
        else:
            max_fe = max_fe_from_origens

        if data_inicio_opt:
            d = datetime.strptime(data_inicio_opt.strip(), "%Y-%m-%d").date()
            min_di = timezone.make_aware(datetime.combine(d, time.min), timezone.get_current_timezone())

        if max_fe <= timezone.now() and not fechamento_hoje_2359:
            self.stdout.write(
                self.style.WARNING(
                    "Atenção: fechamento_em está no passado ou agora; "
                    "o fechamento automático pode disparar em seguida (Celery)."
                )
            )

        if supervisor_id:
            sup = User.objects.filter(pk=supervisor_id).first()
            if not sup:
                raise CommandError(f"supervisor-id={supervisor_id} não encontrado.")
        else:
            sup = sprints[0].supervisor

        if dest_sprint is not None:
            duracao = _duracao_dias(dest_sprint.data_inicio, max_fe)
        else:
            duracao = _duracao_dias(min_di, max_fe)

        # --- relatório prévio
        all_projects = list(Project.objects.filter(sprint_id__in=origem_ids).select_related("sprint"))
        self.stdout.write(f"Sprints origem: {[s.id for s in sprints]} — projetos encontrados: {len(all_projects)}")

        by_name: dict[str, list[Project]] = defaultdict(list)
        for p in all_projects:
            by_name[_norm_name(p.nome)].append(p)

        merge_plan: list[tuple[Project, list[Project]]] = []
        for norm, plist in sorted(by_name.items(), key=lambda x: x[0]):
            if len(plist) == 1:
                continue
            canonical = self._pick_canonical(plist, keep)
            others = [x for x in plist if x.id != canonical.id]
            merge_plan.append((canonical, others))

        self.stdout.write(f"Grupos de nome duplicado a fundir: {len(merge_plan)}")
        for can, others in merge_plan:
            self.stdout.write(
                f"  • Canônico projeto id={can.id} \"{can.nome}\" <- absorve ids={[o.id for o in others]}"
            )

        if dest_sprint is None:
            self.stdout.write(
                self.style.NOTICE(
                    f"Criará sprint \"{nome_limpo}\" data_inicio={min_di} fechamento_em={max_fe} "
                    f"duracao_dias={duracao} supervisor={sup_id_label(sup)}"
                )
            )
        else:
            reopen = ""
            if dest_sprint.finalizada:
                reopen = " (reabrirá sprint finalizada)"
            self.stdout.write(
                self.style.NOTICE(
                    f"Destino: sprint id={dest_sprint.id} \"{dest_sprint.nome}\"{reopen} - "
                    f"fechamento_em após operação: {max_fe} — apagar sprints: {ids_to_delete}"
                )
            )

        if dry_run:
            self.stdout.write(self.style.SUCCESS("Simulação concluída. Rode com --commit para aplicar."))
            return

        with transaction.atomic():
            if dest_sprint is None:
                dest_sprint = Sprint.objects.create(
                    nome=nome_limpo[:100],
                    data_inicio=min_di,
                    fechamento_em=max_fe,
                    duracao_dias=duracao,
                    supervisor=sup,
                    finalizada=False,
                )
                created_new_sprint = True
                self.stdout.write(self.style.SUCCESS(f"Sprint destino criada: id={dest_sprint.id}"))

            for canonical, others in merge_plan:
                for other in others:
                    merge_project_kanban_into(canonical, other)
                    n = Card.objects.filter(projeto=other).update(projeto=canonical)
                    self.stdout.write(f"  Movidos {n} cards projeto {other.id} -> {canonical.id}")
                    other.delete()

            updated = Project.objects.filter(sprint_id__in=origem_ids).update(sprint=dest_sprint)
            self.stdout.write(self.style.SUCCESS(f"Projetos associados à sprint destino (update em lote): {updated}"))

            # Atualizar destino existente: reabrir, fechamento e duração
            if not created_new_sprint:
                dest_sprint.refresh_from_db()
                uf = []
                if dest_sprint.finalizada:
                    dest_sprint.finalizada = False
                    uf.append("finalizada")
                if fechamento_hoje_2359 or fechamento_em_opt:
                    dest_sprint.fechamento_em = max_fe
                    dest_sprint.duracao_dias = _duracao_dias(dest_sprint.data_inicio, max_fe)
                    uf.extend(["fechamento_em", "duracao_dias"])
                if uf:
                    uf.append("updated_at")
                    dest_sprint.save(update_fields=list(dict.fromkeys(uf)))

            if no_delete_origem:
                self.stdout.write(self.style.WARNING("--no-delete-origem: sprints de origem mantidas."))
            else:
                for sid in ids_to_delete:
                    sp = Sprint.objects.filter(pk=sid).first()
                    if not sp:
                        continue
                    pc = sp.projects.count()
                    if pc > 0:
                        raise CommandError(
                            f"Bug de segurança: sprint id={sid} ainda tem {pc} projetos; abortando antes de apagar."
                        )
                    sp.delete()
                    self.stdout.write(self.style.SUCCESS(f"Sprint id={sid} apagada."))

        self.stdout.write(self.style.SUCCESS("Consolidação concluída."))

    def _pick_canonical(self, plist: list[Project], keep: str) -> Project:
        if keep == "newest":
            return max(plist, key=lambda p: (p.created_at, p.id))
        if keep == "most_cards":
            return max(plist, key=lambda p: (p.cards.count(), -p.id))
        return min(plist, key=lambda p: (p.created_at, p.id))

    def _run_restore_csv(self, path: Path, dry_run: bool, *, allow_open: bool) -> None:
        if not path.is_file():
            raise CommandError(f"Arquivo não encontrado: {path}")

        rows: list[tuple[int, int]] = []
        with path.open(newline="", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            if not reader.fieldnames:
                raise CommandError("CSV vazio ou sem cabeçalho.")
            fields = {h.strip().lower(): h for h in reader.fieldnames}
            for key in ("project_id", "sprint_destino_id"):
                if key not in fields:
                    raise CommandError(
                        f'CSV deve conter colunas project_id e sprint_destino_id (encontrado: {reader.fieldnames})'
                    )
            pk_proj = fields["project_id"]
            pk_spr = fields["sprint_destino_id"]
            for row in reader:
                try:
                    pid = int(str(row.get(pk_proj, "")).strip())
                    sid = int(str(row.get(pk_spr, "")).strip())
                except (TypeError, ValueError):
                    continue
                if pid and sid:
                    rows.append((pid, sid))

        if not rows:
            raise CommandError("Nenhuma linha válida no CSV.")

        self.stdout.write(f"Restauração: {len(rows)} movimentações de projeto.")
        for pid, sid in rows[:50]:
            self.stdout.write(f"  projeto {pid} -> sprint {sid}")
        if len(rows) > 50:
            self.stdout.write(f"  ... e mais {len(rows) - 50} linhas.")

        if dry_run:
            self.stdout.write(self.style.SUCCESS("Simulação CSV concluída. Use --commit."))
            return

        with transaction.atomic():
            for pid, sid in rows:
                p = Project.objects.filter(pk=pid).select_for_update().first()
                if not p:
                    raise CommandError(f"Projeto id={pid} não existe.")
                sp = Sprint.objects.filter(pk=sid).select_for_update().first()
                if not sp:
                    raise CommandError(f"Sprint id={sid} não existe.")
                if not sp.finalizada and not allow_open:
                    raise CommandError(
                        f"Restauração histórica: sprint id={sid} deve estar finalizada "
                        f"(ou use --permitir-sprint-aberta-restauracao)."
                    )
                p.sprint = sp
                p.save(update_fields=["sprint", "updated_at"])
                self.stdout.write(self.style.SUCCESS(f"OK projeto {pid} -> sprint \"{sp.nome}\" (id={sid})"))

        self.stdout.write(self.style.SUCCESS("Restauração via CSV concluída."))


def sup_id_label(sup) -> str:
    return f"{sup.pk} ({getattr(sup, 'username', sup)})"
