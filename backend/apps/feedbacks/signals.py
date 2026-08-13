"""
O GATILHO: um CARD virando 'finalizado' gera o pedido de feedback dele.

>>> POR QUE O CARD, E NÃO O PROJETO <<<
A primeira versão observava `Project.status` virando 'entregue'. Estava errado, e
os dados diziam isso: dos 106 projetos do banco, os 106 estão em 'criado' e
NENHUM tem `data_entrega` preenchida. `Project.status` existe no model, mas nada
no produto o move.

Neste sistema o projeto é uma PASTA — agrupa cards por um denominador comum. Quem
tem ciclo de vida, data de entrega e homologação é o CARD. Logo é a conclusão do
CARD que significa "entregue", e é dela que os 30 dias contam.

Consequência prática: com o gatilho antigo, nenhum pedido nasceria em produção —
a feature ficaria inerte sem ninguém perceber, porque a falha é a AUSÊNCIA de
algo.

`sender='projects.Card'` é uma STRING de propósito. `ModelSignal.connect` aceita
'app_label.Model' e resolve preguiçosamente, então este módulo NÃO importa
`apps.projects` no carregamento — a mesma regra que a fase 1 se impôs (a FK do
motor também é declarada por string). Não há ciclo com `projects/apps.py:ready`.

PADRÃO DE DETECÇÃO DE MUDANÇA: é o da casa. Não existe mixin nem `FieldTracker`
neste projeto — existe um `pre_save` que relê a linha antiga e pendura o valor
anterior na instância, e um `post_save` que compara (ver `card_pre_save` em
projects/signals.py). Custa um SELECT por save de card.

SÓ 'finalizado', NUNCA 'inviabilizado': não se pede opinião sobre uma entrega que
foi cancelada. Um card inviabilizado não gera pedido nenhum.
"""
from __future__ import annotations

import logging
from functools import partial

from django.db import transaction
from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver

from .estrutura import gerar_pedido_do_card_finalizado

logger = logging.getLogger(__name__)

# Onde o `pre_save` pendura o status anterior. Nome prefixado para não colidir
# com o `_previous_status` que os signals de `apps.projects` usam no mesmo Card.
ATRIBUTO_STATUS_ANTERIOR = '_feedback_card_status_anterior'

# O valor de `CardStatus.FINALIZADO`, escrito à mão. Importar o enum traria
# `apps.projects` para o load deste módulo e derrubaria o desacoplamento que a
# string em `sender=` existe para manter. Um teste trava os dois juntos.
STATUS_FINALIZADO = 'finalizado'


@receiver(pre_save, sender='projects.Card', dispatch_uid='feedbacks_card_pre_save')
def card_pre_save(sender, instance, **kwargs):
    """Relê o status gravado ANTES deste save e o pendura na instância."""
    anterior = None
    if instance.pk:
        # `values_list(...).first()`: a mesma leitura com UMA coluna, sem
        # materializar o modelo e sem exceção para tratar quando a linha não
        # existe (create com pk forçado).
        anterior = (
            sender.objects.filter(pk=instance.pk)
            .values_list('status', flat=True)
            .first()
        )
    setattr(instance, ATRIBUTO_STATUS_ANTERIOR, anterior)


@receiver(post_save, sender='projects.Card', dispatch_uid='feedbacks_card_post_save')
def card_post_save(sender, instance, created, **kwargs):
    """Agenda o pedido na TRANSIÇÃO do card para 'finalizado'.

    TRANSIÇÃO, e não estado: `anterior != FINALIZADO` impede que um segundo save
    de um card já finalizado (renomear, anexar arquivo, mudar responsável)
    reprocesse tudo. A idempotência do motor cobriria de qualquer forma, mas
    trabalho que não precisa acontecer é melhor não acontecer.

    REABERTURA E NOVA CONCLUSÃO: um card reaberto volta para 'a_desenvolver' e,
    ao ser finalizado de novo, passa por aqui outra vez. Não duplica — o
    `get_or_create` do motor tem constraint de OneToOne no card —, e o pedido
    que já existia é reaproveitado com a data original. Se a intenção for
    recontar os 30 dias a partir da nova entrega, é aqui que a regra mudaria.
    """
    # `raw=True` = `loaddata`. Restaurar um dump de produção não pode disparar
    # geração de pedidos — mesmo cuidado documentado em projects/services.py.
    if kwargs.get('raw'):
        return

    # Sem a caixa marcada, nada a fazer. É o filtro mais barato e o mais comum:
    # a esmagadora maioria dos cards não pede feedback.
    if not getattr(instance, 'gerar_formulario_feedback', False):
        return

    # `getattr` defensivo: uma instância montada à mão (ou salva por um caminho
    # que não passe pelo `pre_save`) pode não ter o atributo.
    anterior = getattr(instance, ATRIBUTO_STATUS_ANTERIOR, None)
    if instance.status != STATUS_FINALIZADO or anterior == STATUS_FINALIZADO:
        return

    # `on_commit` por recomendação EXPLÍCITA da docstring do motor: um pedido
    # criado numa transação que der rollback deixaria um token vivo apontando
    # para nada — e o link já é válido no instante em que nasce.
    #
    # `gerar_pedido_do_card_finalizado` engole as próprias exceções, e isso é
    # obrigatório: um callback de `on_commit` que levanta propaga para quem
    # chamou o commit, então o PATCH do card responderia 500 com o status já
    # gravado no banco.
    transaction.on_commit(partial(gerar_pedido_do_card_finalizado, instance.pk))
