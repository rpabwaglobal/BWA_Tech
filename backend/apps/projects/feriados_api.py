"""O endpoint que leva os feriados ao frontend.

POR QUE O FRONTEND PRECISA PERGUNTAR. O SLA dos chamados de suporte é calculado
no navegador (`frontend/src/lib/businessHours.ts`), e metade da regra de feriado
não dá para calcular: estaduais do RN, municipais de Natal e recessos da empresa
são decisão de alguém e vivem no banco. A outra metade — os nacionais — o
frontend calcula sozinho, e é por isso que ele NÃO fica esperando esta resposta
para funcionar: sem ela desconta os nacionais, com ela desconta tudo.

Essa escolha é deliberada e já custou caro uma vez neste projeto: um card que
depende de uma segunda requisição e não trata o estado de carregamento aparece
vazio sem explicação. Aqui o pior caso é um feriado municipal não descontado por
alguns segundos, nunca uma tela em branco.

DOIS ENDPOINTS, E A SEPARAÇÃO É A DO MÓDULO DE FERIADOS:

  `GET /api/feriados/` responde "quais dias são feriado", juntando o calculado
  com o cadastrado. É o que o SLA consome, e é só leitura — não há como editar
  um feriado nacional, porque ele não existe como linha no banco.

  `/api/feriados-cadastrados/` administra as LINHAS: a metade que depende de
  decisão humana. Escrita exige `manage_feriados`.

Juntar os dois numa rota só convidaria o erro de alguém tentar apagar o Natal e
receber um 404 confuso, ou pior, de a listagem de administração mostrar dias que
não dá para editar.
"""
from __future__ import annotations

from datetime import date, timedelta

from rest_framework import serializers, status, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import CanManageFeriados

from .feriados import feriados_entre
from .models import Feriado

#: Teto do intervalo aceito. O frontend pede um ou dois anos; um pedido de
#: séculos só gastaria CPU montando um conjunto que ninguém usa.
MAX_DIAS = 366 * 5

#: Janela devolvida quando o cliente não pede nada: do começo do ano passado ao
#: fim do ano que vem. Cobre qualquer chamado aberto que ainda esteja em
#: discussão e os prazos à frente, sem o cliente ter que calcular isso.
ANOS_PARA_TRAS = 1
ANOS_PARA_FRENTE = 1


class _Entrada(serializers.Serializer):
    inicio = serializers.DateField(required=False)
    fim = serializers.DateField(required=False)

    def validate(self, attrs):
        hoje = date.today()
        inicio = attrs.get('inicio') or date(hoje.year - ANOS_PARA_TRAS, 1, 1)
        fim = attrs.get('fim') or date(hoje.year + ANOS_PARA_FRENTE, 12, 31)

        if inicio > fim:
            raise serializers.ValidationError(
                {'inicio': 'O início não pode ser depois do fim.'})
        if (fim - inicio) > timedelta(days=MAX_DIAS):
            raise serializers.ValidationError(
                {'fim': 'Intervalo maior que %d anos.' % (MAX_DIAS // 366)})

        attrs['inicio'] = inicio
        attrs['fim'] = fim
        return attrs


class FeriadosView(APIView):
    """`GET /api/feriados/?inicio=YYYY-MM-DD&fim=YYYY-MM-DD`

    Devolve as datas não úteis por feriado no intervalo, ordenadas. Fim de
    semana NÃO entra: quem chama já sabe reconhecer sábado e domingo, e
    misturar as duas coisas esconderia qual delas tirou o dia.
    """

    def get(self, request):
        entrada = _Entrada(data=request.query_params)
        entrada.is_valid(raise_exception=True)
        inicio = entrada.validated_data['inicio']
        fim = entrada.validated_data['fim']

        dias = sorted(feriados_entre(inicio, fim))
        return Response(
            {
                'inicio': inicio.isoformat(),
                'fim': fim.isoformat(),
                'feriados': [d.isoformat() for d in dias],
            },
            status=status.HTTP_200_OK,
        )


class FeriadoSerializer(serializers.ModelSerializer):
    abrangencia_display = serializers.CharField(
        source='get_abrangencia_display', read_only=True)

    class Meta:
        model = Feriado
        fields = ('id', 'data', 'nome', 'abrangencia', 'abrangencia_display',
                  'recorrente', 'observacao', 'criado_em')
        read_only_fields = ('id', 'criado_em')

    def validate_data(self, valor):
        """Recusa cadastrar um dia que JÁ é feriado nacional.

        Sem esta trava, alguém cadastraria "Natal" em 25/12 achando que estava
        fazendo falta. O registro não mudaria nada — o dia já não é útil — mas
        passaria a existir uma segunda resposta para o mesmo dia, que é
        exatamente o que o módulo de feriados foi criado para encerrar.

        A CHECAGEM É SOBRE O ANO DA DATA INFORMADA, inclusive para recorrente.
        Para os nacionais FIXOS isso basta, porque eles caem no mesmo dia todo
        ano. Para os MÓVEIS não cobre tudo: um recorrente em 3 de abril coincide
        com a Sexta-feira Santa em 2026 e não em outros anos. Varrer todos os
        anos futuros para recusar uma colisão eventual seria recusar um cadastro
        legítimo por causa de um ano distante — e a sobreposição, quando
        acontece, não produz número errado: o dia já não é útil pelos dois
        motivos.
        """
        from .feriados import nacionais_do_ano

        if valor in nacionais_do_ano(valor.year):
            raise serializers.ValidationError(
                'Este dia já é feriado nacional e é calculado automaticamente. '
                'Cadastre aqui apenas feriados estaduais, municipais ou '
                'recessos da empresa.')
        return valor


class FeriadosCadastradosViewSet(viewsets.ModelViewSet):
    """CRUD da metade cadastrada. Mesmo padrão do `SetorViewSet`.

    Ler é para qualquer pessoa autenticada — a tela de Configurações mostra a
    lista a quem só pode consultar. Escrever exige `manage_feriados`.
    """

    queryset = Feriado.objects.all()
    serializer_class = FeriadoSerializer
    http_method_names = ['get', 'post', 'patch', 'delete', 'head', 'options']

    def get_permissions(self):
        if self.action in ('create', 'update', 'partial_update', 'destroy'):
            return [CanManageFeriados()]
        return [IsAuthenticated()]
