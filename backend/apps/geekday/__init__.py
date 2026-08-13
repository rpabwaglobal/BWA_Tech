# Este arquivo precisa existir — e a falta dele foi um defeito REAL, não
# formalidade: sem `__init__.py` o diretório vira NAMESPACE PACKAGE (PEP 420), e
# a descoberta de testes do unittest PULA namespace packages sem dizer nada.
#
# Consequência concreta enquanto ele não existia: `python manage.py test apps`
# — o comando de verificação do projeto — rodava a suíte inteira, dava OK e
# NUNCA executava um só teste de `apps/geekday/tests.py`. Um teste que não roda
# no comando padrão apodrece em silêncio, que é pior do que não ter teste.
# (`python manage.py test apps.geekday` nem chegava a rodar: estourava
# `TypeError: expected str, bytes or os.PathLike object, not NoneType`, porque
# o `__file__` de um namespace package é None.)
#
# Todos os outros apps de `backend/apps/` já tinham o seu; o `geekday` era o
# único de fora.
