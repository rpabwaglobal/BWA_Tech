from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.db.models import Q, Count, Max
from django.utils import timezone
from django.conf import settings
from .models import GeekDayDraw, GeekDayConfig
from .serializers import GeekDayDrawSerializer, GeekDayUserStatusSerializer


class GeekDayDrawViewSet(viewsets.ModelViewSet):
    """
    ViewSet para gerenciar sorteios do Geek Day
    """
    serializer_class = GeekDayDrawSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return GeekDayDraw.objects.select_related('usuario', 'sorteado_por').all()

    def _current_cycle(self) -> int:
        return GeekDayConfig.get_config().current_cycle

    @action(detail=False, methods=['get'])
    def users_status(self, request):
        """
        Retorna lista de usuários com status de sorteio
        Exclui admins
        """
        from apps.accounts.models import User
        
        # Buscar todos os usuários exceto admin
        users = User.objects.exclude(role='admin').select_related()
        
        # Buscar último sorteio de cada usuário
        ultimos_sorteios = GeekDayDraw.objects.values('usuario').annotate(
            ultimo_sorteio=Max('data_sorteio')
        )
        ultimos_sorteios_dict = {item['usuario']: item['ultimo_sorteio'] for item in ultimos_sorteios}
        
        # Contar total de sorteios por usuário
        total_sorteios = GeekDayDraw.objects.values('usuario').annotate(
            total=Count('id')
        )
        total_sorteios_dict = {item['usuario']: item['total'] for item in total_sorteios}
        
        # Já sorteado no ciclo atual (reset não apaga histórico)
        cycle = self._current_cycle()
        ja_sorteado_ids = set(
            GeekDayDraw.objects.filter(cycle=cycle).values_list('usuario_id', flat=True).distinct()
        )
        
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
                'profile_picture_url': request.build_absolute_uri(user.profile_picture.url if user.profile_picture.url.startswith('/') else '/' + user.profile_picture.url) if user.profile_picture else None,
                'ja_sorteado': ja_sorteado,
                'total_sorteios': total_sorteios_dict.get(user.id, 0),
                'ultimo_sorteio': ultimo_sorteio.isoformat() if ultimo_sorteio else None,
            })
        
        serializer = GeekDayUserStatusSerializer(result, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['post'])
    def realizar_sorteio(self, request):
        """
        Realiza um sorteio aleatório entre usuários que ainda não foram sorteados
        Apenas gestores podem realizar sorteios
        """
        if request.user.role not in ['supervisor', 'gerente', 'admin']:
            return Response(
                {'detail': 'Apenas gestores podem realizar sorteios.'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        from apps.accounts.models import User
        import random
        
        try:
            # Buscar usuários que ainda não foram sorteados (exceto admin)
            # Usar a mesma lógica do users_status para consistência (por ciclo)
            cycle = self._current_cycle()
            usuarios_ja_sorteados_ids = list(
                GeekDayDraw.objects.filter(cycle=cycle).values_list('usuario_id', flat=True).distinct()
            )
            
            # Buscar todos os usuários exceto admin
            todos_usuarios = User.objects.exclude(role='admin')
            total_usuarios = todos_usuarios.count()
            
            # Filtrar apenas os que ainda não foram sorteados
            if usuarios_ja_sorteados_ids:
                usuarios_disponiveis = todos_usuarios.exclude(id__in=usuarios_ja_sorteados_ids)
            else:
                usuarios_disponiveis = todos_usuarios
            
            usuarios_disponiveis_count = usuarios_disponiveis.count()
            
            if not usuarios_disponiveis.exists():
                return Response(
                    {
                        'detail': 'Todos os usuários já foram sorteados.',
                        'total_usuarios': total_usuarios,
                        'usuarios_sorteados': len(usuarios_ja_sorteados_ids),
                        'usuarios_disponiveis': 0
                    },
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            # Sortear um usuário aleatório
            usuarios_lista = list(usuarios_disponiveis)
            if not usuarios_lista:
                return Response(
                    {
                        'detail': 'Nenhum usuário disponível para sorteio.',
                        'total_usuarios': total_usuarios,
                        'usuarios_sorteados': len(usuarios_ja_sorteados_ids),
                        'usuarios_disponiveis': usuarios_disponiveis_count
                    },
                    status=status.HTTP_400_BAD_REQUEST
                )
            usuario_sorteado = random.choice(usuarios_lista)
            
            # Criar registro do sorteio
            draw = GeekDayDraw.objects.create(
                usuario=usuario_sorteado,
                sorteado_por=request.user,
                marcado_manual=False,
                data_apresentacao=request.data.get('data_apresentacao') or None,
                cycle=cycle,
            )
            
            serializer = self.get_serializer(draw)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        except Exception as e:
            import traceback
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
        Marca um usuário manualmente como sorteado
        Apenas gestores podem marcar
        """
        if request.user.role not in ['supervisor', 'gerente', 'admin']:
            return Response(
                {'detail': 'Apenas gestores podem marcar usuários como sorteados.'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        usuario_id = request.data.get('usuario_id')
        observacoes = request.data.get('observacoes', '')
        data_apresentacao = request.data.get('data_apresentacao') or None
        
        if not usuario_id:
            return Response(
                {'detail': 'usuario_id é obrigatório.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        from apps.accounts.models import User
        try:
            usuario = User.objects.get(id=usuario_id)
        except User.DoesNotExist:
            return Response(
                {'detail': 'Usuário não encontrado.'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        # Verificar se já foi sorteado hoje
        hoje = timezone.now().date()
        ja_sorteado_hoje = GeekDayDraw.objects.filter(
            usuario=usuario,
            data_sorteio__date=hoje
        ).exists()
        
        if ja_sorteado_hoje:
            return Response(
                {'detail': 'Este usuário já foi sorteado hoje.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Criar registro
        cycle = self._current_cycle()
        draw = GeekDayDraw.objects.create(
            usuario=usuario,
            sorteado_por=request.user,
            marcado_manual=True,
            observacoes=observacoes,
            data_apresentacao=data_apresentacao,
            cycle=cycle,
        )
        
        serializer = self.get_serializer(draw)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['post'])
    def desmarcar_como_sorteado(self, request):
        """
        Remove o status de sorteado de um usuário (apaga o último sorteio dele)
        Apenas gestores podem desmarcar
        """
        if request.user.role not in ['supervisor', 'gerente', 'admin']:
            return Response(
                {'detail': 'Apenas gestores podem desmarcar usuários como sorteados.'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        usuario_id = request.data.get('usuario_id')
        
        if not usuario_id:
            return Response(
                {'detail': 'usuario_id é obrigatório.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        from apps.accounts.models import User
        try:
            usuario = User.objects.get(id=usuario_id)
        except User.DoesNotExist:
            return Response(
                {'detail': 'Usuário não encontrado.'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        # Deletar o último sorteio do usuário no ciclo atual
        cycle = self._current_cycle()
        ultimo_sorteio = GeekDayDraw.objects.filter(usuario=usuario, cycle=cycle).order_by('-data_sorteio').first()
        
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
        Reseta todos os sorteios (permite que todos sejam sorteados novamente)
        Apenas gestores podem resetar
        """
        if request.user.role not in ['supervisor', 'gerente', 'admin']:
            return Response(
                {'detail': 'Apenas gestores podem resetar sorteios.'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        config = GeekDayConfig.get_config()
        config.current_cycle = config.current_cycle + 1
        config.save(update_fields=['current_cycle', 'updated_at'])
        return Response({
            'message': 'Sorteios resetados com sucesso (histórico preservado).',
            'cycle': config.current_cycle
        })

    @action(detail=False, methods=['get'])
    def historico(self, request):
        """
        Retorna histórico de sorteios
        """
        # Histórico completo, mais recente -> mais antigo
        queryset = self.get_queryset().order_by('-data_sorteio')
        serializer = self.get_serializer(queryset, many=True)
        return Response(serializer.data)
