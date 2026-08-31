"""Limites que o BWA Tech NÃO decide — quem decide é a API do portal.

Estão aqui, num módulo só, porque são acoplamento com outro serviço: mudar o número
deste lado sem mudar lá (ou vice-versa) abre uma faixa em que o arquivo é aceito por
uma ponta e recusado pela outra, que foi exatamente o defeito que este módulo nasceu
para evitar.
"""

#: Teto de anexo aceito pela API do portal, em `formularios/serializers.py`
#: (TAMANHO_MAXIMO_ANEXO_SUPORTE). Vale para o anexo do solicitante e o da resolução.
#: A UI do quadro repete o mesmo número em `RESOLUCAO_MAX_FILE_SIZE`.
LIMITE_ANEXO_PORTAL_BYTES = 10 * 1024 * 1024
