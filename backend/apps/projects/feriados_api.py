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

SÓ LEITURA. Cadastrar feriado é pelo admin, que já tem controle de acesso,
auditoria e histórico. Um endpoint de escrita aqui seria uma segunda porta para
a mesma mesa.
"""
from __future__ import annotations

from datetime import date, timedelta

from rest_framework import serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .feriados import feriados_entre

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
