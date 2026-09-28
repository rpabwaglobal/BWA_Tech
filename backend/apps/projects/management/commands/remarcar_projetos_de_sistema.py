"""Devolve a flag `is_system` aos projetos sistêmicos que a perderam na virada.

A replicação de sprint não copiava `is_system`, então cada virada criava uma
cópia de "Sugestões", "Suporte" e "Descartados" como projeto de trabalho COMUM.
Medido na base antes do conserto: marcado até a Sprint 6.26, desmarcado da 7.26
em diante — 5 cards em projetos que deveriam ser sistêmicos e não eram.

A replicação já foi corrigida e passa a flag adiante. Este comando é para o que
já está gravado errado.

COMO ELE DECIDE, e por que não é pelo nome: usa a **linhagem**. Um projeto só é
remarcado quando existe, em OUTRA sprint, um projeto de mesmo nome já marcado
como sistêmico — ou seja, quando há prova no próprio banco de que aquele nome
designa um projeto de sistema. Decidir por uma lista de nomes cravada aqui faria
o comando mentir no dia em que alguém criasse um projeto de trabalho chamado
"Suporte", e a documentação do produto já pede para não renomear os sistêmicos
justamente porque regras dependem do nome.

Simula por padrão. Só escreve com `--aplicar`.
"""
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.projects.models import Card, Project
from apps.projects.services import _norm_nome_projeto


class Command(BaseCommand):
    help = 'Remarca como sistêmicos os projetos que perderam a flag na virada de sprint.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--aplicar',
            action='store_true',
            help='Grava as mudanças. Sem isto o comando apenas simula.',
        )

    def handle(self, *args, **opcoes):
        aplicar = opcoes['aplicar']

        # Os nomes que o BANCO atesta serem de sistema, em qualquer sprint.
        nomes_sistemicos = {
            _norm_nome_projeto(nome)
            for nome in Project.objects.filter(is_system=True).values_list('nome', flat=True)
        }

        self.stdout.write('')
        if not nomes_sistemicos:
            self.stdout.write(self.style.WARNING(
                'Nenhum projeto marcado como sistêmico na base. Sem referência de '
                'linhagem, o comando não tem como decidir nada — nada a fazer.'))
            return

        self.stdout.write('Nomes que o banco atesta serem de sistema: %s'
                          % ', '.join(sorted(nomes_sistemicos)))
        self.stdout.write('')

        candidatos = []
        for projeto in (Project.objects
                        .filter(is_system=False)
                        .select_related('sprint')
                        .order_by('id')):
            if _norm_nome_projeto(projeto.nome) in nomes_sistemicos:
                candidatos.append(projeto)

        self.stdout.write('Projetos a remarcar: %d' % len(candidatos))
        self.stdout.write('')

        total_cards = 0
        for projeto in candidatos:
            cards = Card.objects.filter(projeto=projeto).count()
            total_cards += cards
            self.stdout.write(
                '  #%-5d %-28s sprint=%-14s %d card(s)'
                % (projeto.id, projeto.nome[:28],
                   projeto.sprint.nome[:14] if projeto.sprint_id else '--', cards))

        self.stdout.write('')
        self.stdout.write('Cards que saem das contagens de trabalho: %d' % total_cards)
        self.stdout.write('')

        if not candidatos:
            self.stdout.write(self.style.SUCCESS('Nada a fazer.'))
            return

        if not aplicar:
            self.stdout.write(self.style.WARNING(
                'SIMULAÇÃO — nada foi gravado. Rode com --aplicar para valer.'))
            return

        with transaction.atomic():
            atualizados = (Project.objects
                           .filter(pk__in=[p.pk for p in candidatos])
                           .update(is_system=True))

        self.stdout.write(self.style.SUCCESS(
            '%d projeto(s) remarcado(s) como sistêmico(s).' % atualizados))
