"""Preenche `etapa_destino` nos eventos de troca de etapa já gravados.

O PARSING ACONTECE AQUI, UMA VEZ, E NÃO A CADA CONSULTA. A descrição do evento
é montada pelo frontend com o RÓTULO de exibição da etapa:

    Etapa do quadro: "Em desenvolvimento" → "Concluído".

Ler isso num relatório faria o backend depender de um texto de interface —
renomear a etapa na tela derrubaria o número em silêncio. Guardando a chave,
o acoplamento fica confinado a esta migração, que é inspecionável, reversível,
e roda uma vez só.

COBERTURA MEDIDA ANTES DE ESCREVER, sobre os 1.010 eventos de troca de etapa da
base de 19/10/2026 — apenas cinco rótulos aparecem, e o mapa cobre os cinco:

    Concluído                550
    Em desenvolvimento       447
    Inviabilizado              8
    Parado por pendências      3
    A desenvolver              2

A migração CONTA o que não conseguiu mapear e falha se encontrar algo. Um
rótulo desconhecido significa que o mapa está incompleto, e seguir em frente
deixaria aqueles eventos fora de toda contagem — exatamente o tipo de omissão
silenciosa que este campo existe para evitar.
"""
from django.db import migrations

#: Rótulo exibido → chave da etapa. Os rótulos vêm de `STAGES` em
#: `frontend/src/pages/Support.tsx`; as chaves são as mesmas do kanban.
ROTULO_PARA_CHAVE = {
    'A desenvolver': 'a_desenvolver',
    'Em desenvolvimento': 'em_desenvolvimento',
    'Parado por pendências': 'parado_pendencias',
    'Inviabilizado': 'inviabilizado',
    'Concluído': 'finalizado',
}

SETA = '→'


def _destino_da_descricao(descricao: str) -> str | None:
    """O rótulo depois da seta, sem aspas nem ponto final."""
    if not descricao or SETA not in descricao:
        return None
    return descricao.rsplit(SETA, 1)[-1].strip().strip('.').strip('"').strip()


def preencher(apps, schema_editor):
    Timeline = apps.get_model('formularios', 'ChamadoSuporteTimeline')

    desconhecidos = {}
    atualizados = 0
    sem_seta = 0

    # `iterator()` com lote: a base tem poucos milhares de linhas hoje, mas a
    # migração roda no start do container e não deve carregar tudo de uma vez.
    for evento in Timeline.objects.filter(tipo_evento='etapa_alterada').iterator(chunk_size=500):
        rotulo = _destino_da_descricao(evento.descricao)
        if rotulo is None:
            sem_seta += 1
            continue
        chave = ROTULO_PARA_CHAVE.get(rotulo)
        if chave is None:
            desconhecidos[rotulo] = desconhecidos.get(rotulo, 0) + 1
            continue
        Timeline.objects.filter(pk=evento.pk).update(etapa_destino=chave)
        atualizados += 1

    if desconhecidos:
        raise RuntimeError(
            'Rótulo(s) de etapa fora do mapa desta migração: %s. '
            'Acrescente-os em ROTULO_PARA_CHAVE antes de rodar — sem isso, '
            'esses eventos ficariam fora de toda contagem de chamados '
            'resolvidos, em silêncio.' % desconhecidos
        )

    print(
        '\n  [timeline] etapa_destino preenchido em %d evento(s); '
        '%d sem seta na descrição (formato antigo ou texto livre).'
        % (atualizados, sem_seta)
    )


def limpar(apps, schema_editor):
    """Reverter apenas esvazia a coluna; a descrição original fica intacta."""
    Timeline = apps.get_model('formularios', 'ChamadoSuporteTimeline')
    Timeline.objects.exclude(etapa_destino='').update(etapa_destino='')


class Migration(migrations.Migration):

    dependencies = [
        ('formularios', '0013_timeline_guarda_a_chave_da_etapa'),
    ]

    operations = [
        migrations.RunPython(preencher, limpar),
    ]
