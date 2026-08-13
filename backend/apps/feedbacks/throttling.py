"""
Rate limit da única rota anônima do sistema.

Molde das classes: apps/accounts/views.py:61-72 (subclasse com `scope` próprio).
As taxas ficam em REST_FRAMEWORK['DEFAULT_THROTTLE_RATES'] no settings —
scope ausente faz o DRF levantar ImproperlyConfigured NA REQUISIÇÃO, não no
boot, então o acréscimo em settings não é opcional.
"""
from __future__ import annotations

import hashlib

from rest_framework.throttling import AnonRateThrottle, SimpleRateThrottle


class FeedbackIPThrottle(AnonRateThrottle):
    """Limite por IP.

    LIMITE HONESTO DESTA CLASSE: `NUM_PROXIES` não está definido em
    REST_FRAMEWORK, então o DRF usa o X-Forwarded-For BRUTO. Atrás do Traefik
    esse header sempre existe, e quem acrescentar o próprio ganha um bucket novo
    a cada requisição. Por isso o limite por token abaixo NÃO é redundância —
    é a única barreira que o atacante não controla.
    """

    scope = 'feedback_ip'


class FeedbackTokenThrottle(SimpleRateThrottle):
    """Limite de LEITURA por token, derivado do TEXTO do token — nunca do objeto.

    Duas razões para a chave sair da URL e não do banco:

    1. O 429 não pode denunciar existência. Se o bucket só existisse para
       tokens válidos, um 429 já diria ao atacante que aquele token existe, e o
       rate limit viraria o oráculo que o resto do desenho evita. Chaveando pelo
       texto, token inexistente e token válido consomem o mesmo tipo de bucket.

    2. Nenhuma consulta ao banco acontece antes do throttle — o custo de uma
       tentativa às cegas fica em cache, não em SQL.

    A chave é o SHA-256 do token, nunca o token cru: chave de cache acaba em
    dump de memória e em log de erro, e a regra "nunca registrar o token
    inteiro" vale também aí.
    """

    scope = 'feedback_token'

    def get_cache_key(self, request, view):
        token = view.kwargs.get('token') or ''
        digest = hashlib.sha256(token.encode('utf-8')).hexdigest()[:32]
        return f'throttle_feedback_token_{digest}'


class FeedbackEnvioThrottle(FeedbackTokenThrottle):
    """Limite de ESCRITA por token — balde SEPARADO do de leitura.

    Existe porque um único balde para GET e POST estava errado nos dois
    sentidos. Frouxo como teto de escrita: nenhuma entrega real recebe dezenas
    de opiniões por hora, e o número original foi dimensionado para REABRIR o
    link, não para inserir. Apertado como teto de leitura: agora o mesmo link vai
    para várias pessoas, e os GETs delas consumiam o balde até o cliente legítimo
    ver "Muitas tentativas em pouco tempo".

    O prefixo da chave é PRÓPRIO, senão os dois escopos dividiriam o mesmo bucket
    no cache e a separação seria só aparente. A chave continua sendo o SHA-256
    dos primeiros 32 hex, nunca o token cru, para o 429 não virar oráculo.
    """

    scope = 'feedback_envio'

    def get_cache_key(self, request, view):
        token = view.kwargs.get('token') or ''
        digest = hashlib.sha256(token.encode('utf-8')).hexdigest()[:32]
        return f'throttle_feedback_envio_{digest}'
