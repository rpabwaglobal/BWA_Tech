"""
A VERSÃO DO BWA TECH, LIDA DE UM LUGAR SÓ.

O número mora no arquivo `VERSION` da raiz do repositório, e não em código. É o
que permite subir a versão sem tocar em Python, e é o que faz `git show
v1.2.0:VERSION` responder sozinho qual versão era aquela — a condição para
verificar e reverter depois.

Antes disso, `'1.0.0'` estava cravado à mão em `config/views.py` e nunca havia
sido atualizado: dizia 1.0.0 num sistema com feedbacks, relatórios e Geek Day.
Uma versão que ninguém mantém é pior que nenhuma, porque parece informação.
"""
from pathlib import Path

# `config/versao.py` -> `config/` -> `backend/` -> raiz do repositório.
_RAIZ = Path(__file__).resolve().parent.parent.parent

VERSAO_DESCONHECIDA = '0.0.0-desconhecida'


def versao_atual() -> str:
    """Lê o arquivo VERSION a cada chamada, SEM CACHE — e isso é deliberado.

    A primeira versão tinha `lru_cache`, e ela mentiu na estreia: o arquivo já
    dizia 2.1.0 e a API respondia 1.2.0, porque o processo tinha guardado o
    valor de antes da edição. O Django não reinicia por mudança em arquivo que
    não é `.py`, então a divergência sobrevivia até alguém derrubar o servidor.
    Uma função cujo trabalho é dizer o que está no ar não pode ter um estado em
    que ela responde o que estava.

    O cache também não comprava nada: são ~6 bytes lidos do cache de página do
    sistema, num endpoint que a tela de perfil chama uma vez.

    Devolve um marcador explícito quando o arquivo não está lá, em vez de um
    número plausível. Um `0.0.0-desconhecida` na tela faz alguém investigar; um
    `1.0.0` inventado passa despercebido e mente sobre o que está no ar — que é
    exatamente o problema que este módulo veio resolver.

    O arquivo entra na imagem por um COPY dedicado no Dockerfile: a imagem só
    leva `backend/`, então sem aquela linha a versão sumiria justamente em
    produção, que é onde ela importa.
    """
    for caminho in (_RAIZ / 'VERSION', Path('/app/VERSION')):
        try:
            texto = caminho.read_text(encoding='utf-8').strip()
        except OSError:
            continue
        if texto:
            return texto.splitlines()[0].strip()
    return VERSAO_DESCONHECIDA
