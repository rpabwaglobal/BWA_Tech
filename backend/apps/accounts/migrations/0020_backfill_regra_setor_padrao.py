"""Backfill do invariante do balde de não classificados ("Sem Setor").

A regra passou a valer nas escritas (`aplicar_regra_do_setor_padrao`, em
accounts/serializers.py), mas escrita nova não conserta o passado: quem já
estava em "Sem Setor" E num setor de verdade — o caso que motivou o pedido,
italo.martins em `tecnologia` + `sem_setor` — continuaria contraditório na tela
até alguém por acaso reatribuir o setor dessa pessoa. Sem este backfill, o
sintoma relatado permanece visível depois do deploy, que é o oposto do que a
mudança promete.

Duas metades, as mesmas do runtime:
  1. tem setor real E o padrão → o vínculo com o padrão sai. Com
     `SETOR_SCOPING_ENABLED` ligado, esse vínculo residual entregaria à pessoa
     todo o conteúdo não classificado da empresa (os setores do usuário são
     somados, nunca interseccionados — ver scoping.setores_ids_do_usuario).
  2. ficou sem vínculo nenhum → volta para o padrão. O escopo é fail-closed
     (`qs.none()` sem setor), então zero vínculos abre a plataforma em branco.

POR QUE reimplementa a regra em vez de importar `aplicar_regra_do_setor_padrao`:
migration histórica não pode depender do código atual do app — se a função for
renomeada ou mudar de módulo numa release futura, `migrate` num banco novo
quebra no meio. O preço é esta duplicação, que é aceitável porque este arquivo
está congelado: ele descreve o estado do banco em 2026-08, não a regra viva.

Idempotente: rodar de novo não muda nada. `backwards` é no-op de propósito —
recriar o vínculo com "Sem Setor" ao lado de um setor real seria recolocar
exatamente o estado que esta migration existe para eliminar.
"""
from django.db import migrations

SETOR_PADRAO_CODENAME = 'sem_setor'


def forwards(apps, schema_editor):
    SetorCatalogo = apps.get_model('accounts', 'SetorCatalogo')
    UserSetor = apps.get_model('accounts', 'UserSetor')
    User = apps.get_model('accounts', 'User')

    # Resolvido ESTRITAMENTE pelo codename, sem o fallback "primeiro setor do
    # catálogo" de `setor_padrao_do_sistema()`. Aqui se APAGA e se CRIA vínculo
    # de usuário: num banco sem "Sem Setor", o fallback expulsaria gente do
    # primeiro setor da lista ou empurraria alguém para dentro dele, entregando
    # de brinde o conteúdo daquele setor. Sem o balde de verdade, não roda.
    padrao = SetorCatalogo.objects.filter(codename=SETOR_PADRAO_CODENAME).first()
    if padrao is None:
        return

    for user in User.objects.all():
        vinculos = list(UserSetor.objects.filter(user=user))
        reais = [v for v in vinculos if v.setor_id != padrao.pk]
        no_padrao = [v for v in vinculos if v.setor_id == padrao.pk]

        if reais and no_padrao:
            perdeu_primario = any(v.is_primary for v in no_padrao)
            UserSetor.objects.filter(user=user, setor=padrao).delete()
            # Se o vínculo apagado era o primário, alguém precisa assumir: sem
            # primário o CharField `User.setor` (o que a tela mostra) esvaziaria
            # sozinho. O mais antigo assume — mesmo critério de `remover_setor`.
            if perdeu_primario and not any(v.is_primary for v in reais):
                proximo = UserSetor.objects.filter(user=user).order_by('added_at').first()
                if proximo is not None:
                    proximo.is_primary = True
                    proximo.save(update_fields=['is_primary'])
        elif not vinculos:
            UserSetor.objects.create(user=user, setor=padrao, is_primary=True)
        else:
            # Só o padrão, ou só setores reais: já é o estado correto.
            continue

        # Reespelha o CharField a partir do vínculo primário resultante. Só aqui
        # dentro, porque fora deste `if` o CharField pode estar vazio de
        # propósito (operador limpou o setor primário) e reescrevê-lo desfaria
        # uma decisão deliberada.
        primario = (UserSetor.objects.filter(user=user, is_primary=True)
                    .select_related('setor').first())
        codename = primario.setor.codename if primario else ''
        if (user.setor or '') != codename:
            user.setor = codename
            user.save(update_fields=['setor'])


def backwards(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0019_split_manage_catalog'),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
