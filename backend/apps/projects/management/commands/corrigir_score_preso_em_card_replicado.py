"""Move o score que ficou preso no card de uma sprint encerrada.

POR QUE ESTE COMANDO EXISTE: até a correção em `_mover_score_do_card`, a virada
de sprint criava o card novo e deixava o `CardScore` no card antigo. Como
`CardScore.card` é OneToOne, a tela de Score passava a mostrar o status
CONGELADO no instante do fechamento — trabalho já entregue aparecia como "Em
Desenvolvimento", "Em Homologação" ou "A Desenvolver", e o card realmente
entregue não tinha score nenhum.

A correção na replicação resolve as viradas FUTURAS. Os registros que já estão
errados precisam deste passe.

COMO A LINHAGEM É RECONSTRUÍDA, já que não há campo de origem no `Card`: a
replicação copia `created_at` do original para a cópia
(`Card.objects.filter(pk=novo.pk).update(created_at=card.created_at)`), então
`(nome, created_at)` identifica a cadeia. Os membros são ordenados pela
`data_inicio` da sprint, e o último é o card vivo.

ONDE ISSO PODE ERRAR: dois cards criados com o MESMO nome no MESMO instante
seriam confundidos. O comando não adivinha — quando a cadeia tem mais de um card
na mesma sprint, ele PULA e avisa, porque nesse caso não há como saber qual é o
sucessor.

Simula por padrão. Só escreve com `--aplicar`.
"""
from collections import defaultdict

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.projects.models import Card, CardScore, ScoreHistory


class Command(BaseCommand):
    help = 'Move o score preso no card de uma sprint encerrada para o card vivo.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--aplicar',
            action='store_true',
            help='Grava as mudanças. Sem isto o comando apenas simula.',
        )

    def handle(self, *args, **opcoes):
        aplicar = opcoes['aplicar']

        cadeias = defaultdict(list)
        for card in Card.objects.select_related('projeto__sprint').iterator():
            if not card.projeto_id or not card.projeto.sprint_id:
                continue
            cadeias[(card.nome, card.created_at)].append(card)

        scores = list(
            CardScore.objects
            .select_related('card__projeto__sprint')
            .order_by('id')
        )

        self.stdout.write('')
        self.stdout.write('Scores no sistema: %d' % len(scores))
        self.stdout.write('')

        mover, pulados, ja_certos = [], [], 0

        for score in scores:
            card = score.card
            if not card.projeto_id or not card.projeto.sprint_id:
                pulados.append((score, card, 'card sem sprint'))
                continue

            cadeia = cadeias[(card.nome, card.created_at)]

            # Duas cópias na MESMA sprint: a cadeia é ambígua e adivinhar aqui
            # moveria o score para o card errado, que é pior que não mover.
            por_sprint = defaultdict(int)
            for membro in cadeia:
                por_sprint[membro.projeto.sprint_id] += 1
            if any(n > 1 for n in por_sprint.values()):
                pulados.append((score, card, 'cadeia ambigua (dois cards na mesma sprint)'))
                continue

            cadeia = sorted(cadeia, key=lambda c: c.projeto.sprint.data_inicio)
            vivo = cadeia[-1]

            if vivo.id == card.id:
                ja_certos += 1
                continue

            if CardScore.objects.filter(card=vivo).exists():
                pulados.append((score, card, 'o card vivo #%d JA tem score' % vivo.id))
                continue

            mover.append((score, card, vivo, len(cadeia)))

        self.stdout.write('Já no card certo ....... %d' % ja_certos)
        self.stdout.write('A mover ................ %d' % len(mover))
        self.stdout.write('Pulados ................ %d' % len(pulados))
        self.stdout.write('')

        for score, velho, vivo, tamanho in mover:
            self.stdout.write('score #%-4d  %s' % (score.id, velho.nome))
            self.stdout.write('    de   card #%-5d status=%-20s sprint=%s'
                              % (velho.id, velho.status, velho.projeto.sprint.nome))
            self.stdout.write('    para card #%-5d status=%-20s sprint=%s  (cadeia de %d)'
                              % (vivo.id, vivo.status, vivo.projeto.sprint.nome, tamanho))
            historico = ScoreHistory.objects.filter(card=velho).count()
            self.stdout.write('    histórico a levar: %d entrada(s)' % historico)
            self.stdout.write('')

        for score, card, motivo in pulados:
            self.stdout.write(self.style.WARNING(
                'PULADO  score #%-4d card #%-5d %-28s -> %s'
                % (score.id, card.id, card.nome[:28], motivo)))
        if pulados:
            self.stdout.write('')

        if not mover:
            self.stdout.write(self.style.SUCCESS('Nada a fazer.'))
            return

        if not aplicar:
            self.stdout.write(self.style.WARNING(
                'SIMULAÇÃO — nada foi gravado. Rode com --aplicar para valer.'))
            return

        # Uma transação para as duas tabelas: o score sem o histórico dele
        # deixaria a coluna "Histórico do Score" vazia no card que passou a
        # carregar a nota.
        with transaction.atomic():
            for score, velho, vivo, _ in mover:
                ScoreHistory.objects.filter(card=velho).update(card=vivo)
                # `update()` e não `save()`: mover o ponteiro não é alguém
                # reavaliando o card, e `updated_at` ordena a tela.
                CardScore.objects.filter(pk=score.pk).update(card=vivo)

        self.stdout.write(self.style.SUCCESS(
            '%d score(s) movido(s) para o card vivo.' % len(mover)))
