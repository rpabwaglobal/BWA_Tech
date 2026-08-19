"""
Paginação padrão da API, com tamanho de página negociável pelo cliente.

POR QUE ISTO EXISTE: o `PageNumberPagination` do DRF, sem
`page_size_query_param`, fixa a página em 20 e não deixa o cliente pedir mais.
A tela do projeto precisa de TODOS os cards para desenhar o quadro, então ela
percorria as páginas em SEQUÊNCIA — um projeto com 56 cards custava três idas
ao servidor, uma esperando a outra. Medido: ~1,2 s por página, ~3,7 s no total,
e a bolinha de carregamento girando o tempo inteiro.

O TETO NÃO É DECORAÇÃO. Sem `max_page_size`, `?page_size=100000` viraria um
jeito trivial de fazer o servidor montar uma resposta gigante — e as respostas
aqui são caras (o card embute o projeto inteiro). O limite mantém a escolha com
o cliente sem entregar a ele o custo do servidor.
"""
from rest_framework.pagination import PageNumberPagination


class PaginacaoPadrao(PageNumberPagination):
    page_size = 20
    page_size_query_param = 'page_size'
    max_page_size = 200
