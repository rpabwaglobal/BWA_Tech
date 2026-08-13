from rest_framework import serializers
from django.conf import settings
from .models import GeekDayDraw, GeekDayGrupo, GeekDayGrupoSetor
from apps.accounts.models import SetorCatalogo, get_cargo_choices
from apps.accounts.profile_picture_utils import get_profile_picture_url


def format_user_name(user):
    """Formata o nome do usuário"""
    if not user:
        return None
    if user.first_name and user.last_name:
        return f"{user.first_name} {user.last_name}"
    elif user.first_name:
        return user.first_name
    elif user.last_name:
        return user.last_name
    return user.username


class GeekDayGrupoSerializer(serializers.ModelSerializer):
    """Grupo de Geek Day (um ou mais setores que sorteiam juntos)."""

    # Declarado à mão de propósito: o DRF marca como READ-ONLY todo M2M com
    # `through` explícito (`has_through_model` em utils/field_mapping.py), e o
    # nosso through existe justamente para o UNIQUE de setor. Sem esta linha,
    # `setores` nunca seria gravável e não haveria como montar/desmontar grupo
    # pela API.
    setores = serializers.PrimaryKeyRelatedField(
        many=True, required=False, queryset=SetorCatalogo.objects.all())
    setores_detalhe = serializers.SerializerMethodField()

    class Meta:
        model = GeekDayGrupo
        fields = ['id', 'nome', 'setores', 'setores_detalhe',
                  'current_cycle', 'updated_at']
        # `current_cycle` só anda por `resetar_sorteios`: deixá-lo gravável aqui
        # permitiria "desfazer" um reset por PATCH e ressuscitar uma fila
        # fechada.
        read_only_fields = ['id', 'current_cycle', 'updated_at']

    def get_setores_detalhe(self, obj):
        """Setores com o que a tela precisa para desenhar o grupo sem uma
        segunda chamada ao catálogo."""
        return [
            {'id': s.id, 'codename': s.codename, 'nome': s.nome, 'cor': s.cor}
            for s in obj.setores.all()
        ]

    def validate_nome(self, value):
        value = (value or '').strip()
        if not value:
            raise serializers.ValidationError('Nome do grupo é obrigatório.')
        return value

    def validate_setores(self, setores):
        """Um setor em dois grupos deixaria o usuário em dois sorteios e o
        ciclo ambíguo. O banco já barra (UNIQUE em GeekDayGrupoSetor.setor);
        aqui a mesma regra vira mensagem legível em vez de erro 500."""
        conflitos = (GeekDayGrupoSetor.objects
                     .filter(setor__in=setores)
                     .select_related('setor', 'grupo'))
        if self.instance is not None:
            conflitos = conflitos.exclude(grupo=self.instance)
        ocupados = list(conflitos)
        if ocupados:
            detalhe = ', '.join(
                f'{v.setor.nome} (já no grupo «{v.grupo.nome}»)' for v in ocupados)
            raise serializers.ValidationError(
                f'Cada setor só pode estar em um grupo de Geek Day: {detalhe}.')
        return setores


class GeekDayDrawSerializer(serializers.ModelSerializer):
    usuario_name = serializers.SerializerMethodField()
    sorteado_por_name = serializers.SerializerMethodField()
    usuario_profile_picture = serializers.SerializerMethodField()
    grupo_nome = serializers.CharField(source='grupo.nome', read_only=True)

    class Meta:
        model = GeekDayDraw
        fields = [
            'id', 'usuario', 'usuario_name', 'usuario_profile_picture',
            'sorteado_por', 'sorteado_por_name', 'data_sorteio',
            'data_apresentacao',
            'marcado_manual', 'observacoes',
            'cycle', 'grupo', 'grupo_nome',
        ]
        read_only_fields = ['data_sorteio']
        # `grupo` é NOT NULL no banco, mas opcional no payload: a view preenche
        # com o grupo do requisitante quando o cliente não manda (é o caso de
        # todas as @actions). Exigi-lo no serializer quebraria essas rotas.
        extra_kwargs = {'grupo': {'required': False}}

    def validate_usuario(self, usuario):
        """Sorteio gravado pelo CRUD cru também recorta por participação.

        `marcar_como_sorteado` não é a única porta: este serializer atende o
        `POST /geekday-draws/` (e o PUT/PATCH) do ModelViewSet, com `usuario`
        gravável. Sem esta validação a regra valeria para a tela e não para a
        API — bastaria mandar o id do visitante no corpo para ele voltar ao
        histórico e à coluna "Já Sorteados".

        Por PERMISSÃO (`view_content`, via `ids_que_participam_do_trabalho`) e
        com a mesma explicação da @action, para o gestor não receber dois
        motivos diferentes pela mesma regra.

        A EXCEÇÃO é a de sempre — escolher recorta, desfazer/corrigir o passado
        não: se o sorteio já existe e o `usuario` não está MUDANDO (um PUT que
        reenvia o mesmo id), passa. Anotar a observação ou a data de uma
        apresentação que aconteceu continua possível depois que a pessoa virou
        visitante; apagar o sorteio é DELETE e nem chega aqui.
        """
        if usuario is None:
            return usuario
        if self.instance is not None and self.instance.usuario_id == usuario.pk:
            return usuario

        from apps.accounts.permissions import ids_que_participam_do_trabalho

        if usuario.pk not in ids_que_participam_do_trabalho():
            raise serializers.ValidationError(
                'Este usuário não participa do sorteio do Geek Day: '
                'ele não tem acesso a sprints, projetos e cards.')
        return usuario

    def get_usuario_name(self, obj):
        return format_user_name(obj.usuario)

    def get_sorteado_por_name(self, obj):
        return format_user_name(obj.sorteado_por) if obj.sorteado_por else None

    def get_usuario_profile_picture(self, obj):
        return get_profile_picture_url(obj.usuario, request=self.context.get('request'))


class GeekDayUserStatusSerializer(serializers.Serializer):
    """Serializer para status de sorteio dos usuários"""
    id = serializers.UUIDField()
    username = serializers.CharField()
    first_name = serializers.CharField(allow_null=True)
    last_name = serializers.CharField(allow_null=True)
    email = serializers.EmailField()
    # `role` continua sendo o CODENAME do cargo, e não o rótulo: a roleta do
    # frontend decide cor e ordenação por `switch (role)` sobre codenames
    # ('supervisor', 'gerente', ...). Devolver o rótulo aqui derrubaria todos
    # esses casos para o `default`. O rótulo vai à parte, em `role_display` —
    # mesma convenção de `apps/accounts/serializers.py`.
    role = serializers.CharField(allow_blank=True)
    role_display = serializers.SerializerMethodField()
    profile_picture_url = serializers.URLField(allow_null=True)
    ja_sorteado = serializers.BooleanField()
    # `true` quando a pessoa tem `view_content` — o piso de leitura de
    # sprint/projeto/card, que é o critério de PARTICIPAR do sorteio. Vem
    # `false` para quem só assiste ao Geek Day (Visitante, cargo criado sem
    # essa permissão); esses só aparecem na lista quando já têm sorteio no
    # ciclo, para o gestor conseguir desfazê-lo.
    participa_do_trabalho = serializers.BooleanField()
    total_sorteios = serializers.IntegerField()
    ultimo_sorteio = serializers.DateTimeField(allow_null=True)

    def get_role_display(self, obj):
        """A view monta dicts (não instâncias de User), então não há
        `get_role_display()` do model — o rótulo sai do catálogo de cargos.
        Cargo sem linha no catálogo cai no próprio codename para não exibir
        vazio."""
        codename = obj.get('role') or ''
        return dict(get_cargo_choices()).get(codename, codename)
