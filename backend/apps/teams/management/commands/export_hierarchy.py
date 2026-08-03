"""Exporta todo o conteúdo do app `teams` (Team, TeamMember, Hierarchy,
NodePosition) para um JSON legível.

Fase 6: o organograma baseado em ReactFlow foi substituído pelo mural read-only
por setor (`People.tsx`). O app `teams` está DEPRECADO — as tabelas serão
dropadas numa migração separada mais adiante. Este command preserva os dados
antes do drop, para consulta histórica ou eventual reimportação manual.

Uso:
    python manage.py export_hierarchy                 # imprime no stdout
    python manage.py export_hierarchy --out backup.json
"""
import json

from django.core.management.base import BaseCommand

from apps.teams.models import Team, TeamMember, Hierarchy, NodePosition


def _iso(dt):
    return dt.isoformat() if dt else None


class Command(BaseCommand):
    help = 'Exporta Team/TeamMember/Hierarchy/NodePosition (app teams, deprecado) para JSON.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--out',
            dest='out',
            default=None,
            help='Caminho do arquivo de saída. Sem isto, imprime no stdout.',
        )

    def handle(self, *args, **options):
        data = {
            'teams': [
                {
                    'id': t.id,
                    'nome': t.nome,
                    'tipo': t.tipo,
                    'supervisor_id': t.supervisor_id,
                    'cor': t.cor,
                    'posicao': {'x': t.posicao_x, 'y': t.posicao_y, 'largura': t.largura, 'altura': t.altura},
                    'ordem': t.ordem,
                    'created_at': _iso(t.created_at),
                }
                for t in Team.objects.all()
            ],
            'team_members': [
                {
                    'id': m.id,
                    'user_id': m.user_id,
                    'team_id': m.team_id,
                    'role': m.role,
                    'created_at': _iso(m.created_at),
                }
                for m in TeamMember.objects.all()
            ],
            'hierarchies': [
                {
                    'id': h.id,
                    'supervisor_id': h.supervisor_id,
                    'gerente_id': h.gerente_id,
                    'desenvolvedor_id': h.desenvolvedor_id,
                    'created_at': _iso(h.created_at),
                }
                for h in Hierarchy.objects.all()
            ],
            'node_positions': [
                {'id': n.id, 'user_id': n.user_id, 'x': n.x, 'y': n.y, 'updated_at': _iso(n.updated_at)}
                for n in NodePosition.objects.all()
            ],
        }
        data['_meta'] = {
            'counts': {k: len(v) for k, v in data.items()},
            'note': 'App teams deprecado na Fase 6 (organograma -> mural por setor).',
        }

        payload = json.dumps(data, ensure_ascii=False, indent=2)

        if options['out']:
            with open(options['out'], 'w', encoding='utf-8') as fh:
                fh.write(payload)
            self.stdout.write(self.style.SUCCESS(
                f"Exportado para {options['out']} "
                f"(teams={len(data['teams'])}, membros={len(data['team_members'])}, "
                f"hierarquias={len(data['hierarchies'])}, posicoes={len(data['node_positions'])})."
            ))
        else:
            self.stdout.write(payload)
