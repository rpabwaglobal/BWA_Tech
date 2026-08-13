from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import (NotFound, PermissionDenied,
                                       ValidationError as DRFValidationError)
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Count, Max, Q
from django.utils import timezone
from .models import (GeekDayDraw, GeekDayGrupo, GeekDayGrupoSetor,
                     grupo_do_usuario, participantes_do_sorteio,
                     usuarios_do_grupo)
from .serializers import (GeekDayDrawSerializer, GeekDayGrupoSerializer,
                          GeekDayUserStatusSerializer)
from apps.accounts.profile_picture_utils import get_profile_picture_url
from apps.accounts.permissions import (HasPerm, HasQualquerPerm,
                                       ids_que_participam_do_trabalho)


# Ler o Geek Day: `view_geekday` OU `manage_geekday`. Quem organiza o sorteio
# tem de enxergá-lo por definição, e exigir as duas no template só criaria uma
# forma de configurar errado — um organizador que não vê a própria tela.
PODE_VER_GEEKDAY = HasQualquerPerm('view_geekday', 'manage_geekday')


class PodeGerenciarGeekDay(permissions.BasePermission):
    """Escrita no Geek Day: exige `accounts.manage_geekday`.

    É o mesmo gate de `HasPerm('manage_geekday')` — autorização por permissão,
    nunca por cargo. Existe como classe própria só para devolver a mensagem em
    português que as telas já mostravam quando a checagem morava dentro de cada
    @action.
    """
    message = 'Apenas gestores podem alterar sorteios e grupos do Geek Day.'

    def has_permission(self, request, view):
        return (request.user.is_authenticated
                and request.user.has_perm('accounts.manage_geekday'))


def _pode_ver_outro_grupo(user):
    """Quem pode espiar o Geek Day de um grupo que não é o seu: quem administra
    o ritual (`manage_geekday`) ou quem já enxerga tudo (`view_cross_setor`)."""
    return (user.has_perm('accounts.manage_geekday')
            or user.has_perm('accounts.view_cross_setor'))


class GeekDayGrupoViewSet(viewsets.ModelViewSet):
    """Administração dos grupos de Geek Day (quais setores sorteiam juntos).

    Leitura para quem já acessa a tela do Geek Day (`view_metrics`) — a tela
    precisa saber o nome do grupo e o ciclo. Criar, renomear e mexer nos
    setores exige `manage_geekday`.
    """
    serializer_class = GeekDayGrupoSerializer
    queryset = GeekDayGrupo.objects.prefetch_related('setores').all()
    http_method_names = ['get', 'post', 'patch', 'delete', 'head', 'options']

    def get_permissions(self):
        classes = [IsAuthenticated, PODE_VER_GEEKDAY]
        if self.request.method not in permissions.SAFE_METHODS:
            classes.append(PodeGerenciarGeekDay)
        return [c() for c in classes]

    @action(detail=False, methods=['get'])
    def meu(self, request):
        """Grupo do próprio usuário — cria o grupo do setor dele se ainda não
        existir. É a chamada que a tela faz para saber em que Geek Day está."""
        grupo = grupo_do_usuario(request.user)
        return Response(self.get_serializer(grupo).data)

    @action(detail=True, methods=['post'], url_path='adicionar-setor')
    def adicionar_setor(self, request, pk=None):
        """Junta um setor a este grupo. Body: {"setor": <id>}."""
        grupo = self.get_object()
        setor = self._resolver_setor(request)
        vinculo = (GeekDayGrupoSetor.objects
                   .select_related('grupo')
                   .filter(setor=setor).first())
        if vinculo and vinculo.grupo_id != grupo.pk:
            return Response(
                {'detail': f'O setor «{setor.nome}» já está no grupo '
                           f'«{vinculo.grupo.nome}». Remova-o de lá antes.'},
                status=status.HTTP_400_BAD_REQUEST)
        if not vinculo:
            GeekDayGrupoSetor.objects.create(grupo=grupo, setor=setor)
        return Response(self.get_serializer(self._recarregar(grupo)).data)

    @action(detail=True, methods=['post'], url_path='remover-setor')
    def remover_setor(self, request, pk=None):
        """Tira um setor deste grupo. Body: {"setor": <id>}.

        O setor não fica órfão: no próximo acesso `grupo_do_usuario` cria o
        grupo dele (a priori cada setor é o seu próprio grupo). Os sorteios já
        registrados continuam no grupo antigo — é histórico, não muda de dono.
        """
        grupo = self.get_object()
        setor = self._resolver_setor(request)
        apagados, _ = GeekDayGrupoSetor.objects.filter(grupo=grupo, setor=setor).delete()
        if not apagados:
            return Response(
                {'detail': f'O setor «{setor.nome}» não faz parte deste grupo.'},
                status=status.HTTP_400_BAD_REQUEST)
        return Response(self.get_serializer(self._recarregar(grupo)).data)

    def destroy(self, request, *args, **kwargs):
        """Excluir grupo só enquanto ele não tem memória.

        A FK do sorteio é PROTECT: apagar um grupo com histórico apagaria (ou
        recusaria com erro de banco) o registro de quem já apresentou. Melhor
        dizer isso em português.
        """
        grupo = self.get_object()
        sorteios = GeekDayDraw.objects.filter(grupo=grupo).count()
        if sorteios:
            return Response(
                {'detail': f'Este grupo tem {sorteios} sorteio(s) registrado(s) '
                           'e não pode ser excluído. Remova os setores dele se '
                           'quiser desativá-lo.'},
                status=status.HTTP_409_CONFLICT)
        return super().destroy(request, *args, **kwargs)

    @staticmethod
    def _recarregar(grupo):
        """Descarta o cache do `prefetch_related('setores')` antes de serializar.

        `get_object()` vem do queryset com prefetch; sem isto a resposta de
        adicionar/remover setor mostraria a lista de ANTES da alteração — o
        cliente veria o vínculo que acabou de mexer como se nada tivesse
        acontecido.
        """
        grupo.refresh_from_db()
        return grupo

    def _resolver_setor(self, request):
        from apps.accounts.models import SetorCatalogo
        setor_id = request.data.get('setor') or request.data.get('setor_id')
        if not setor_id:
            raise DRFValidationError({'setor': ['Campo obrigatório.']})
        setor = SetorCatalogo.objects.filter(pk=setor_id).first()
        if setor is None:
            raise NotFound('Setor não encontrado.')
        return setor


class GeekDayDrawViewSet(viewsets.ModelViewSet):
    """Sorteios do Geek Day, sempre no escopo de um GRUPO de setores.

    Leitura exige `view_metrics` (Visitante não acessa). Toda ESCRITA exige
    `manage_geekday` — inclusive as rotas CRUD herdadas do ModelViewSet
    (POST /geekday-draws/, PUT/PATCH/DELETE /geekday-draws/<id>/), que antes
    passavam só com `view_metrics` e deixavam quem lê Métricas criar e apagar
    sorteio.

    O grupo é o do próprio usuário; `?grupo=<id>` permite olhar outro, para
    quem administra o ritual ou enxerga todos os setores.
    """
    serializer_class = GeekDayDrawSerializer
    permission_classes = [IsAuthenticated, PODE_VER_GEEKDAY]

    def get_permissions(self):
        # O gate de escrita é por MÉTODO, não por lista de actions: qualquer
        # rota que não seja segura (as @actions de POST e o CRUD herdado) cai
        # na mesma exigência, e uma @action nova nasce protegida por padrão.
        classes = [IsAuthenticated, PODE_VER_GEEKDAY]
        if self.request.method not in permissions.SAFE_METHODS:
            classes.append(PodeGerenciarGeekDay)
        return [c() for c in classes]

    def _grupo_atual(self):
        """Grupo em que esta requisição opera.

        Sem `?grupo=`, é sempre o grupo do próprio usuário — o default nunca é
        "a empresa inteira". Com o parâmetro, exige `manage_geekday` ou
        `view_cross_setor`: ver a fila de outro setor é privilégio.
        """
        cache = getattr(self, '_grupo_cache', None)
        if cache is not None:
            return cache
        request = self.request
        bruto = request.query_params.get('grupo')
        if bruto:
            grupo = GeekDayGrupo.objects.filter(pk=bruto).first() if str(bruto).isdigit() else None
            if grupo is None:
                raise NotFound('Grupo de Geek Day não encontrado.')
            if not _pode_ver_outro_grupo(request.user):
                if grupo.pk != grupo_do_usuario(request.user).pk:
                    raise PermissionDenied(
                        'Você só pode acessar o Geek Day do seu setor.')
        else:
            grupo = grupo_do_usuario(request.user)
        self._grupo_cache = grupo
        return grupo

    def get_queryset(self):
        # Sorteio é do grupo: listar/abrir sorteio de outro grupo só passando
        # `?grupo=` (que tem gate próprio em `_grupo_atual`).
        return (GeekDayDraw.objects
                .select_related('usuario', 'sorteado_por', 'grupo')
                .filter(grupo=self._grupo_atual()))

    def perform_create(self, serializer):
        # Sem `grupo` no corpo, o sorteio nasce no grupo do requisitante — a
        # coluna é NOT NULL e não existe sorteio "da empresa".
        serializer.save(grupo=serializer.validated_data.get('grupo') or self._grupo_atual())

    @action(detail=False, methods=['get'])
    def users_status(self, request):
        """Roster da aba Sorteio: usuários do GRUPO com o status de já sorteado.

        Não passa por `scope_users` porque a pergunta aqui não é "o que posso
        ver", e sim "quem participa" — a roleta do frontend é montada com esta
        lista. A segmentação é a do grupo e vale com as flags de escopo
        desligadas, por ser decisão de produto.
        """
        grupo = self._grupo_atual()

        # Agregados restritos ao grupo: contar sorteio de outro grupo inflaria
        # o "total de participações" e o "último sorteio" de quem já mudou de
        # setor.
        sorteios_do_grupo = GeekDayDraw.objects.filter(grupo=grupo)

        ultimos_sorteios = sorteios_do_grupo.values('usuario').annotate(
            ultimo_sorteio=Max('data_sorteio')
        )
        ultimos_sorteios_dict = {item['usuario']: item['ultimo_sorteio'] for item in ultimos_sorteios}

        total_sorteios = sorteios_do_grupo.values('usuario').annotate(
            total=Count('id')
        )
        total_sorteios_dict = {item['usuario']: item['total'] for item in total_sorteios}

        # Já sorteado no ciclo atual DO GRUPO (reset não apaga histórico).
        # `usuario` é SET_NULL: sorteio de conta apagada entra como None e não
        # representa pessoa nenhuma — fora do conjunto.
        cycle = grupo.current_cycle
        ja_sorteado_ids = set(
            sorteios_do_grupo.filter(cycle=cycle, usuario__isnull=False)
            .values_list('usuario_id', flat=True).distinct()
        )

        ids_participantes = ids_que_participam_do_trabalho()

        # A lista é a UNIÃO de duas perguntas diferentes, e é de propósito:
        #   - quem PODE ser sorteado (participa do trabalho) — vai para a fila
        #     e para a roleta;
        #   - quem JÁ FOI sorteado neste ciclo, participando ou não — fica só
        #     na coluna "Já Sorteados".
        # A segunda parcela é o que mantém o DESFAZER possível: o único gatilho
        # de `desmarcar_como_sorteado` na tela é arrastar o card de volta, e
        # card só existe para quem vem nesta resposta. Sem ela, um visitante já
        # marcado sumiria da tela E ficaria impossível de corrigir fora do
        # /admin. Também é o que impede a aba Sorteio de discordar do Histórico
        # no ciclo em andamento.
        users = usuarios_do_grupo(grupo).filter(
            Q(pk__in=ids_participantes) | Q(pk__in=ja_sorteado_ids))

        result = []
        for user in users:
            # Comparar IDs como números, não strings
            ja_sorteado = user.id in ja_sorteado_ids
            ultimo_sorteio = ultimos_sorteios_dict.get(user.id)

            result.append({
                'id': str(user.id),
                'username': user.username,
                'first_name': user.first_name,
                'last_name': user.last_name,
                'email': user.email,
                'role': user.role,  # Adicionar role para cores na roleta
                'profile_picture_url': get_profile_picture_url(user, request=request),
                'ja_sorteado': ja_sorteado,
                # Explícito no payload para a tela não precisar adivinhar por
                # CARGO quem entra na roleta: um cargo novo sem `view_content`
                # já chega aqui com `false`, sem tocar no frontend.
                'participa_do_trabalho': user.id in ids_participantes,
                'total_sorteios': total_sorteios_dict.get(user.id, 0),
                'ultimo_sorteio': ultimo_sorteio.isoformat() if ultimo_sorteio else None,
            })

        serializer = GeekDayUserStatusSerializer(result, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['post'])
    def realizar_sorteio(self, request):
        """
        Realiza um sorteio aleatório entre os usuários do GRUPO que ainda não
        foram sorteados no ciclo atual dele.
        """
        import random

        grupo = self._grupo_atual()
        try:
            # Mesma lógica de users_status para consistência (por grupo e ciclo).
            # `usuario__isnull=False` porque a FK é SET_NULL: um None nesta
            # lista vira `NOT (id IN (NULL, ...))` no `exclude` abaixo, que o
            # SQL avalia como desconhecido para TODA linha e esvaziaria a
            # roleta — o erro apareceria como "todos já foram sorteados".
            cycle = grupo.current_cycle
            usuarios_ja_sorteados_ids = list(
                GeekDayDraw.objects.filter(grupo=grupo, cycle=cycle, usuario__isnull=False)
                .values_list('usuario_id', flat=True).distinct()
            )

            # Sortear é ESCOLHER: só entra quem participa do trabalho. Quem só
            # assiste ao Geek Day não tem o que apresentar.
            todos_usuarios = participantes_do_sorteio(grupo)
            total_usuarios = todos_usuarios.count()

            # Filtrar apenas os que ainda não foram sorteados
            if usuarios_ja_sorteados_ids:
                usuarios_disponiveis = todos_usuarios.exclude(id__in=usuarios_ja_sorteados_ids)
            else:
                usuarios_disponiveis = todos_usuarios

            usuarios_lista = list(usuarios_disponiveis)
            if not usuarios_lista:
                return Response(
                    {
                        'detail': 'Todos os usuários já foram sorteados.',
                        'grupo': grupo.pk,
                        'grupo_nome': grupo.nome,
                        'total_usuarios': total_usuarios,
                        # Contados DENTRO do roster: sorteio de quem já não
                        # participa (ou já saiu do grupo) continua no histórico,
                        # mas somá-lo aqui produziria o absurdo
                        # "sorteados: 5 de um total de 3".
                        'usuarios_sorteados': todos_usuarios.filter(
                            id__in=usuarios_ja_sorteados_ids).count(),
                        'usuarios_disponiveis': 0
                    },
                    status=status.HTTP_400_BAD_REQUEST
                )
            usuario_sorteado = random.choice(usuarios_lista)

            # Criar registro do sorteio
            draw = GeekDayDraw.objects.create(
                grupo=grupo,
                usuario=usuario_sorteado,
                sorteado_por=request.user,
                marcado_manual=False,
                data_apresentacao=request.data.get('data_apresentacao') or None,
                cycle=cycle,
            )

            serializer = self.get_serializer(draw)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        except Exception as e:
            return Response(
                {
                    'detail': f'Erro ao realizar sorteio: {str(e)}',
                    'error_type': type(e).__name__
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=False, methods=['post'])
    def marcar_como_sorteado(self, request):
        """
        Marca um usuário manualmente como sorteado, no grupo em que ele participa.
        """
        grupo = self._grupo_atual()
        usuario_id = request.data.get('usuario_id')
        observacoes = request.data.get('observacoes', '')
        data_apresentacao = request.data.get('data_apresentacao') or None

        if not usuario_id:
            return Response(
                {'detail': 'usuario_id é obrigatório.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        usuario = self._usuario_do_grupo(grupo, usuario_id)
        if usuario is None:
            return Response(
                {'detail': 'Usuário não encontrado neste grupo de Geek Day.'},
                status=status.HTTP_404_NOT_FOUND
            )

        # Marcar é ESCOLHER (ação nova), então recorta aqui — e SÓ aqui: o
        # `desmarcar` logo abaixo usa o mesmo `_usuario_do_grupo` e tem de
        # continuar aceitando quem não participa, senão um visitante marcado
        # antes desta regra ficaria travado como sorteado para sempre.
        #
        # Erro diferente do 404 de propósito: "não é deste grupo" e "não
        # participa do sorteio" são dois problemas distintos, e o gestor precisa
        # saber qual dos dois está vendo.
        if usuario.pk not in ids_que_participam_do_trabalho():
            return Response(
                {'detail': 'Este usuário não participa do sorteio do Geek Day: '
                           'ele não tem acesso a sprints, projetos e cards.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Verificar se já foi sorteado hoje NESTE grupo
        hoje = timezone.localdate()  # data LOCAL: `now().date()` é UTC e, das 21h à meia-noite, já é o dia seguinte
        ja_sorteado_hoje = GeekDayDraw.objects.filter(
            grupo=grupo,
            usuario=usuario,
            data_sorteio__date=hoje
        ).exists()

        if ja_sorteado_hoje:
            return Response(
                {'detail': 'Este usuário já foi sorteado hoje.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Criar registro
        draw = GeekDayDraw.objects.create(
            grupo=grupo,
            usuario=usuario,
            sorteado_por=request.user,
            marcado_manual=True,
            observacoes=observacoes,
            data_apresentacao=data_apresentacao,
            cycle=grupo.current_cycle,
        )

        serializer = self.get_serializer(draw)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['post'])
    def desmarcar_como_sorteado(self, request):
        """
        Remove o status de sorteado de um usuário (apaga o último sorteio dele
        no ciclo atual do grupo).

        DESFAZER O PASSADO, e por isso NÃO recorta por participação: o sorteio
        que se quer apagar já aconteceu, e quem deixou de participar depois
        (virou visitante, perdeu o cargo) tem de continuar sendo desmarcável.
        Exigir participação aqui deixaria o histórico do ciclo impossível de
        corrigir pela tela. Só a ação nova (`marcar_como_sorteado`) recorta.
        """
        grupo = self._grupo_atual()
        usuario_id = request.data.get('usuario_id')

        if not usuario_id:
            return Response(
                {'detail': 'usuario_id é obrigatório.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        usuario = self._usuario_do_grupo(grupo, usuario_id)
        if usuario is None:
            return Response(
                {'detail': 'Usuário não encontrado neste grupo de Geek Day.'},
                status=status.HTTP_404_NOT_FOUND
            )

        # Deletar o último sorteio do usuário no ciclo atual DO GRUPO
        ultimo_sorteio = (GeekDayDraw.objects
                          .filter(grupo=grupo, usuario=usuario, cycle=grupo.current_cycle)
                          .order_by('-data_sorteio').first())

        if not ultimo_sorteio:
            return Response(
                {'detail': 'Este usuário não possui sorteios para remover.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        ultimo_sorteio.delete()

        # Formatar nome do usuário
        if usuario.first_name and usuario.last_name:
            usuario_name = f"{usuario.first_name} {usuario.last_name}"
        elif usuario.first_name:
            usuario_name = usuario.first_name
        elif usuario.last_name:
            usuario_name = usuario.last_name
        else:
            usuario_name = usuario.username

        return Response({
            'message': f'Sorteio de {usuario_name} removido com sucesso.',
            'usuario_id': str(usuario.id)
        }, status=status.HTTP_200_OK)

    @action(detail=False, methods=['post'])
    def resetar_sorteios(self, request):
        """
        Abre um novo ciclo NO GRUPO (todos podem ser sorteados de novo).

        O ciclo é do grupo justamente para que resetar a fila de um setor não
        zere a fila do vizinho.
        """
        grupo = self._grupo_atual()
        grupo.current_cycle = grupo.current_cycle + 1
        grupo.save(update_fields=['current_cycle', 'updated_at'])
        return Response({
            'message': 'Sorteios resetados com sucesso (histórico preservado).',
            'cycle': grupo.current_cycle,
            'grupo': grupo.pk,
            'grupo_nome': grupo.nome,
        })

    @action(detail=False, methods=['get'])
    def historico(self, request):
        """
        Histórico de sorteios do grupo (todos os ciclos), do mais recente para
        o mais antigo. É a memória daquele ritual — misturar grupos faria um
        setor concluir que gente que nunca apresentou lá já está fora da fila.
        """
        queryset = self.get_queryset().order_by('-data_sorteio')
        serializer = self.get_serializer(queryset, many=True)
        return Response(serializer.data)

    def _usuario_do_grupo(self, grupo, usuario_id):
        """Usuário `usuario_id` DESDE QUE pertença ao grupo.

        Restringir aqui fecha, de graça, o caminho de marcar/desmarcar alguém
        de outro setor: sem isto, o id bastaria para escrever na fila alheia.

        Pertencer ao grupo, e não "poder ser sorteado": este método serve
        marcar E desmarcar, e o recorte de participação vale só para o primeiro
        (ver `marcar_como_sorteado`). Acrescentar o filtro aqui pareceria mais
        limpo e quebraria o desfazer.
        """
        try:
            return usuarios_do_grupo(grupo).filter(pk=usuario_id).first()
        except (ValueError, TypeError, DjangoValidationError):
            # id malformado (texto onde o banco espera número/uuid): é "não
            # encontrado", não erro 500.
            return None
