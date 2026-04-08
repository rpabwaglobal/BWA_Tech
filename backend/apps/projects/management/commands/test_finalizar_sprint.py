"""
Comando para testar a regra de finalização de sprint: cria sprints, projeto e cards
de teste, finaliza a sprint e verifica se o projeto com cards ativos foi replicado
para a próxima sprint.
"""
from datetime import datetime, time, timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone
from django.contrib.auth import get_user_model

from apps.projects.models import Sprint, Project, Card, CardStatus
from apps.projects.services import get_proxima_sprint, finalizar_sprint_replicacao


class Command(BaseCommand):
    help = 'Testa a regra de finalização de sprint com dados reais (sprints, projeto, cards).'

    def add_arguments(self, parser):
        parser.add_argument(
            '--clean',
            action='store_true',
            help='Remove os dados de teste criados (sprints/projeto/cards com nomes específicos).',
        )

    def handle(self, *args, **options):
        User = get_user_model()
        hoje = timezone.now().date()
        tz = timezone.get_current_timezone()

        if options.get('clean'):
            self._clean_test_data()
            return

        # 1) Usuário supervisor para as sprints
        user = User.objects.filter(role__in=['supervisor', 'admin']).first()
        if not user:
            user = User.objects.first()
        if not user:
            self.stdout.write(self.style.ERROR('Nenhum usuário no banco. Crie um usuário antes.'))
            return
        self.stdout.write(f'Usando usuário: {user.username} (role={user.role})')

        # 2) Sprint que será finalizada (fechamento_em já passou)
        data_fim_origem = hoje - timedelta(days=2)
        data_inicio_origem = data_fim_origem - timedelta(days=14)
        fechamento_origem = timezone.make_aware(
            datetime.combine(data_fim_origem, time(18, 0, 0)),
            tz,
        )
        data_inicio_origem_dt = timezone.make_aware(
            datetime.combine(data_inicio_origem, time.min),
            tz,
        )
        sprint_origem, created = Sprint.objects.update_or_create(
            nome='[TESTE] Sprint Origem Finalizar',
            defaults={
                'data_inicio': data_inicio_origem_dt,
                'fechamento_em': fechamento_origem,
                'duracao_dias': 14,
                'supervisor': user,
                'finalizada': False,
            },
        )
        if created:
            self.stdout.write(self.style.SUCCESS(f'Sprint origem criada: {sprint_origem.nome} (id={sprint_origem.id})'))
        else:
            self.stdout.write(f'Sprint origem já existia: {sprint_origem.nome} (id={sprint_origem.id}), datas e finalizada atualizados.')

        # 3) Sprint destino (em andamento: já começou e fechamento_em ainda no futuro)
        data_inicio_destino = hoje - timedelta(days=1)
        data_fim_destino = hoje + timedelta(days=13)
        fechamento_destino = timezone.make_aware(
            datetime.combine(data_fim_destino, time(18, 0, 0)),
            tz,
        )
        data_inicio_destino_dt = timezone.make_aware(
            datetime.combine(data_inicio_destino, time.min),
            tz,
        )
        sprint_destino, created_dest = Sprint.objects.update_or_create(
            nome='[TESTE] Sprint Destino Em Andamento',
            defaults={
                'data_inicio': data_inicio_destino_dt,
                'fechamento_em': fechamento_destino,
                'duracao_dias': 14,
                'supervisor': user,
            },
        )
        if created_dest:
            self.stdout.write(self.style.SUCCESS(f'Sprint destino criada: {sprint_destino.nome} (id={sprint_destino.id})'))
        else:
            self.stdout.write(f'Sprint destino já existia: {sprint_destino.nome} (id={sprint_destino.id})')

        # 4) Projeto na sprint origem
        proj, created_proj = Project.objects.get_or_create(
            nome='[TESTE] Projeto Replicação',
            sprint=sprint_origem,
            defaults={'descricao': 'Projeto de teste para finalizar sprint', 'status': 'criado'},
        )
        if created_proj:
            self.stdout.write(self.style.SUCCESS(f'Projeto criado: {proj.nome} (id={proj.id}) na sprint {sprint_origem.nome}'))

        # 5) Cards: um ativo (a_desenvolver) e um finalizado
        card_ativo, _ = Card.objects.get_or_create(
            nome='[TESTE] Card Ativo',
            projeto=proj,
            defaults={
                'descricao': 'Card que deve ir para a próxima sprint',
                'status': CardStatus.A_DESENVOLVER,
                'criado_por': user,
            },
        )
        card_finalizado, _ = Card.objects.get_or_create(
            nome='[TESTE] Card Finalizado',
            projeto=proj,
            defaults={
                'descricao': 'Card que NÃO deve ser replicado',
                'status': CardStatus.FINALIZADO,
                'criado_por': user,
            },
        )
        self.stdout.write(f'Cards no projeto: "{card_ativo.nome}" (status={card_ativo.status}), "{card_finalizado.nome}" (status={card_finalizado.status})')

        # 6) Verificar próxima sprint antes de finalizar
        proxima = get_proxima_sprint(sprint_origem)
        if not proxima:
            self.stdout.write(self.style.ERROR('Nenhuma sprint de destino encontrada. Crie uma sprint "em andamento" ou com data_inicio após o dia de fechamento da origem.'))
            return
        self.stdout.write(f'Próxima sprint calculada: {proxima.nome} (id={proxima.id})')

        # 7) Finalizar a sprint origem (replicação)
        self.stdout.write('Executando finalizar_sprint_replicacao(sprint_origem)...')
        result = finalizar_sprint_replicacao(sprint_origem, criado_por_user=user)

        if result is None:
            self.stdout.write(self.style.ERROR('Finalização retornou None (sem próxima sprint).'))
            return

        self.stdout.write(self.style.SUCCESS(f'Resultado: {result}'))

        # 8) Verificações
        sprint_origem.refresh_from_db()
        if not sprint_origem.finalizada:
            self.stdout.write(self.style.ERROR('FALHA: Sprint origem deveria estar finalizada.'))
        else:
            self.stdout.write(self.style.SUCCESS('OK: Sprint origem está finalizada.'))

        projetos_destino = Project.objects.filter(sprint=proxima, nome=proj.nome)
        if not projetos_destino.exists():
            self.stdout.write(self.style.ERROR('FALHA: Nenhum projeto replicado na sprint destino.'))
        else:
            novo_projeto = projetos_destino.first()
            self.stdout.write(self.style.SUCCESS(f'OK: Projeto replicado na sprint destino: {novo_projeto.nome} (id={novo_projeto.id})'))
            cards_novo = list(novo_projeto.cards.all())
            ativos = [c for c in cards_novo if c.status != CardStatus.FINALIZADO and c.status != CardStatus.INVIABILIZADO]
            if len(ativos) != 1 or ativos[0].nome != card_ativo.nome:
                self.stdout.write(self.style.ERROR(f'FALHA: Esperado 1 card ativo "{card_ativo.nome}" no novo projeto; encontrado: {[c.nome for c in cards_novo]}'))
            else:
                self.stdout.write(self.style.SUCCESS(f'OK: Novo projeto tem 1 card ativo: "{ativos[0].nome}" (status={ativos[0].status}).'))
            if any(c.nome == card_finalizado.nome for c in cards_novo):
                self.stdout.write(self.style.ERROR('FALHA: Card finalizado não deveria ter sido replicado.'))
            else:
                self.stdout.write(self.style.SUCCESS('OK: Card finalizado não foi replicado.'))

        self.stdout.write(self.style.SUCCESS('Teste da regra de finalização concluído.'))

    def _clean_test_data(self):
        """Remove sprints, projeto e cards de teste."""
        from apps.projects.models import Sprint, Project, Card
        # Ordem: cards -> projeto -> sprints (por causa de FKs)
        Card.objects.filter(nome__in=['[TESTE] Card Ativo', '[TESTE] Card Finalizado']).delete()
        Project.objects.filter(nome='[TESTE] Projeto Replicação').delete()
        Sprint.objects.filter(nome__in=['[TESTE] Sprint Origem Finalizar', '[TESTE] Sprint Destino Em Andamento']).delete()
        self.stdout.write(self.style.SUCCESS('Dados de teste removidos.'))
