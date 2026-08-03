"""Compartilhamento de um item entre setores.

Um mesmo dado (sprint, projeto, card, chamado) pode pertencer a mais de um
setor: o setor DONO (campo `setor`) e os setores CONVIDADOS (tabela de vínculo
`compartilhamentos`). Cada convite tem um NÍVEL:

- `leitura`: o setor convidado enxerga o item, mas não escreve nele;
- `edicao`: o setor convidado trabalha no item como se fosse dele.

O nível governa só o que o empréstimo concede. O que a pessoa pode fazer
continua decidido pelas permissões do cargo: um convite em nível de edição não
dá a ninguém uma permissão que ela não tem no próprio setor.

O compartilhamento é hierárquico: compartilhar uma sprint alcança os projetos e
cards dela; compartilhar um projeto alcança seus cards. A cascata está nas
queries de `scoping.py`, não copiada para os filhos — assim, descompartilhar
remove o acesso de toda a árvore de uma vez.
"""
from django.db import transaction
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import NivelCompartilhamento, SetorCatalogo
from .permissions import HasPerm, SetorPermiteEscrita
from .scoping import nivel_de_acesso

NIVEIS_VALIDOS = {n.value for n in NivelCompartilhamento}


def _normalizar_pedidos(bruto):
    """Aceita `["comercial"]` e `[{"setor": "comercial", "nivel": "edicao"}]`.

    A forma curta existe porque compartilhar para leitura é o caso comum, e
    obrigar o objeto inteiro só para dizer o óbvio deixaria a chamada pior.

    Retorna `(dict codename->nivel, lista de erros)`.
    """
    if not isinstance(bruto, list):
        return None, ['Envie a lista de setores (pode ser vazia para descompartilhar).']

    pedidos, erros = {}, []
    for item in bruto:
        if isinstance(item, str):
            pedidos[item] = NivelCompartilhamento.LEITURA
            continue
        if not isinstance(item, dict) or not isinstance(item.get('setor'), str):
            erros.append(f'Item inválido: {item!r}. Use "codename" ou '
                         '{"setor": "codename", "nivel": "leitura|edicao"}.')
            continue
        nivel = item.get('nivel') or NivelCompartilhamento.LEITURA
        if nivel not in NIVEIS_VALIDOS:
            erros.append(f'Nível inválido para {item["setor"]}: {nivel!r}. '
                         f'Use um de: {", ".join(sorted(NIVEIS_VALIDOS))}.')
            continue
        pedidos[item['setor']] = nivel
    return pedidos, erros


class CompartilhamentoSetorMixin:
    """Adiciona `GET/POST <recurso>/<id>/compartilhar/` a um viewset cujo model
    tenha `setor` e a relação `compartilhamentos`, e aplica o gate de escrita
    por setor a todo acesso a objeto."""

    def check_object_permissions(self, request, obj):
        """Acopla `SetorPermiteEscrita` a QUALQUER rota de detalhe.

        Por que aqui e não em `permission_classes`: os quatro viewsets montam
        as próprias listas em `get_permissions()`, então uma entrada declarada
        no mixin seria descartada por quem não chamasse `super()`. Um gate de
        segurança que depende de cada viewset lembrar de incluí-lo é um gate
        que uma hora vai faltar em algum lugar. `check_object_permissions` é
        chamado pelo `get_object()` do próprio DRF, para todos.
        """
        super().check_object_permissions(request, obj)
        gate = SetorPermiteEscrita()
        if not gate.has_object_permission(request, self, obj):
            self.permission_denied(request, message=gate.message)

    @action(detail=True, methods=['get', 'post'], url_path='compartilhar',
            permission_classes=[HasPerm('manage_setor_sharing')])
    def compartilhar(self, request, pk=None):
        obj = self.get_object()

        if request.method == 'GET':
            return Response(self._payload_compartilhamento(obj, request.user))

        pedidos, erros = _normalizar_pedidos(request.data.get('setores'))
        if pedidos is None or erros:
            return Response({'setores': erros or ['Formato inválido.']},
                            status=status.HTTP_400_BAD_REQUEST)

        encontrados = {s.codename: s for s in
                       SetorCatalogo.objects.filter(codename__in=pedidos.keys())}
        invalidos = sorted(set(pedidos) - set(encontrados))
        if invalidos:
            return Response({'setores': [f'Setores inexistentes: {", ".join(invalidos)}']},
                            status=status.HTTP_400_BAD_REQUEST)

        # Compartilhar com o próprio dono é ruído: ele já tem acesso, e deixar
        # passar faria a lista crescer sozinha a cada reatribuição de setor.
        dono_id = getattr(obj, 'setor_id', None)
        desejado = {s.pk: pedidos[code] for code, s in encontrados.items()
                    if s.pk != dono_id}

        self._sincronizar(obj, desejado, request.user)
        return Response(self._payload_compartilhamento(obj, request.user))

    @staticmethod
    def _sincronizar(obj, desejado, autor):
        """Deixa os vínculos exatamente iguais a `desejado` ({setor_id: nivel}).

        Atualiza em vez de recriar: quem já tinha acesso mantém a data e o autor
        originais do empréstimo, e só o nível muda. Recriar tudo apagaria esse
        histórico toda vez que alguém mexesse na lista.
        """
        with transaction.atomic():
            atuais = {c.setor_id: c for c in obj.compartilhamentos.all()}

            removidos = set(atuais) - set(desejado)
            if removidos:
                obj.compartilhamentos.filter(setor_id__in=removidos).delete()

            novos = []
            for setor_id, nivel in desejado.items():
                atual = atuais.get(setor_id)
                if atual is None:
                    novos.append(setor_id)
                elif atual.nivel != nivel:
                    atual.nivel = nivel
                    atual.save(update_fields=['nivel'])

            criador = autor if getattr(autor, 'is_authenticated', False) else None
            for setor_id in novos:
                obj.compartilhamentos.create(
                    setor_id=setor_id, nivel=desejado[setor_id],
                    compartilhado_por=criador)

    def _payload_compartilhamento(self, obj, user=None):
        dono = getattr(obj, 'setor', None)
        return {
            'id': obj.pk,
            'setor': (
                {'codename': dono.codename, 'nome': dono.nome, 'cor': dono.cor}
                if dono else None
            ),
            'setores_compartilhados': [
                {
                    'codename': c.setor.codename,
                    'nome': c.setor.nome,
                    'cor': c.setor.cor,
                    'nivel': c.nivel,
                    'compartilhado_em': c.compartilhado_em,
                }
                for c in obj.compartilhamentos.select_related('setor')
                                              .order_by('setor__nome')
            ],
            # Como QUEM ESTÁ PERGUNTANDO alcança o item. A tela precisa disso
            # para decidir entre mostrar o formulário e mostrar o aviso de
            # somente leitura — sem uma segunda requisição e sem refazer a
            # regra no frontend.
            'meu_acesso': nivel_de_acesso(user, obj) if user is not None else None,
        }
