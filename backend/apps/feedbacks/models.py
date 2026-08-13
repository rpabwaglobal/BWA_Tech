"""
Domínio de feedback pós-entrega — FASE 1 (o motor).

O que este app faz: gera um PEDIDO de feedback por card marcado, cada um com o
seu LINK PÚBLICO. Quem envia o link é uma PESSOA, pela ferramenta que quiser
(WhatsApp, e-mail próprio, telefone) — o sistema não envia nada. Por isso aqui
não existe destinatário, não existe tentativa de envio e não existe erro de
envio: sem envio, essas colunas seriam trabalho morto.

São três tabelas, e a divisão entre elas é proposital:

  - FeedbackFormulario → a DEFINIÇÃO dos campos, guardada como DADO (JSON).
    É isso que faz trocar o formulário ser uma data migration, e não uma
    migration de schema.

  - PedidoFeedback → o pedido e sua máquina de estados. É a FONTE DA VERDADE.
    Duas das três transições não têm humano no laço — a promoção dos 30 dias é
    uma varredura do Celery e a resposta chega de um visitante anônimo, sem
    sessão e sem card. Nenhuma das duas é expressável como "alguém arrastou o
    card", logo a coluna do kanban é uma PROJEÇÃO deste estado, nunca o
    contrário.

  - RespostaFeedback → o texto respondido, em tabela própria porque é ele que
    concentra o dado pessoal (LGPD). A retenção apaga a LINHA inteira e o
    PedidoFeedback sobrevive com `estado='respondido'` + `respondido_em`: o
    FATO e a DATA (a métrica) ficam, o conteúdo some. É literalmente a política
    já escrita em apps/reports/tasks.py — a linha de auditoria fica, o peso e o
    risco estão no conteúdo. São VÁRIAS respostas por pedido (uma LINHA por
    pessoa que responde) e cada linha cumpre o SEU próprio prazo de retenção,
    contado de `enviado_em` — nunca do `respondido_em` do pedido, que congela na
    primeira resposta.
"""
from __future__ import annotations

from django.conf import settings
from django.db import models
from django.db.models import Q


class EstadoPedido(models.TextChoices):
    """Estados do pedido.

    Os VALORES são literalmente as keys das 3 etapas de kanban que a fase 2 vai
    criar, para que a sincronização da coluna seja uma linha
    (`Card.objects.filter(pk=...).update(status=pedido.estado)`) e não uma
    tabela de-para.

    ARMADILHA CONFIRMADA NO CÓDIGO: `Card.status` é CharField(max_length=20)
    (projects/models.py:365) enquanto `KanbanStage.key` é max_length=50 (:233).
    'aguardando_resposta' tem 19 caracteres — fica a UM do limite. Renomear para
    algo mais descritivo (ou prefixar com 'feedback_') estoura: no Postgres
    levanta DataError, no SQLite de dev passa calado.
    """

    AGUARDANDO_PRAZO = 'aguardando_prazo', 'Aguardando 30 dias'
    AGUARDANDO_RESPOSTA = 'aguardando_resposta', 'Aguardando Feedback'
    RESPONDIDO = 'respondido', 'Feedback colhido'
    # POR QUE A KEY É 'feedback_encerrado' E NÃO 'encerrado' NEM 'finalizado':
    #
    #   - 'finalizado' está OCUPADA. É a etapa terminal dos projetos NORMAIS
    #     (projects/0028_seed_kanban_stages) e o valor de `CardStatus.FINALIZADO`.
    #     `KanbanStage.key` é UNIQUE GLOBAL, então reusá-la faria o board de
    #     monitoramento e o board comum apontarem para a MESMA linha de etapa —
    #     e, pior, `_card_edicao_restrita` trata `status='finalizado'` como card
    #     travado, o que congelaria o arraste que este estado existe para
    #     permitir.
    #   - 'encerrado' está livre, mas é genérica demais para um catálogo GLOBAL:
    #     é exatamente o nome que um projeto comum vai querer amanhã, e aí a
    #     colisão apareceria como um bug de board alheio.
    #   - 'feedback_encerrado' tem 18 caracteres e cabe em `Card.status`
    #     (max_length=20) COM folga. A advertência de `etapas_monitoramento()`
    #     ("não prefixar com 'feedback_'") vale para RENOMEAR 'aguardando_resposta'
    #     (19 chars + prefixo = 28, estouro); um nome NOVO curto o bastante não
    #     esbarra nela.
    ENCERRADO = 'feedback_encerrado', 'Feedback Finalizado'


# Estados a partir dos quais uma resposta PROMOVE o pedido para "Feedback
# colhido". NÃO é mais "estados em que o link abre": desde que o link passou a
# aceitar várias respostas e a nunca expirar, RESPONDIDO também abre (a rota
# pública devolve o formulário para sempre) — o nome antigo, ESTADOS_ABERTOS,
# virou mentira e por isso foi trocado.
#
# RESPONDIDO fica DE FORA de propósito: esta tupla é o WHERE do UPDATE de
# promoção (views.py), e incluí-lo faria a 2ª resposta em diante re-disparar
# `notificar_transicao` e reescrever `respondido_em` a cada envio. O card entra
# em "Feedback colhido" na PRIMEIRA resposta e FICA lá; as seguintes só somam ao
# contador.
ESTADOS_QUE_PROMOVEM = (
    EstadoPedido.AGUARDANDO_PRAZO,
    EstadoPedido.AGUARDANDO_RESPOSTA,
)

# O ÚNICO estado em que o link público se recusa a abrir. Fica como constante (e
# não como um `== EstadoPedido.ENCERRADO` espalhado) porque a pergunta "este link
# ainda funciona?" é feita na view pública e nos testes, e uma resposta só evita
# que os dois lugares discordem no dia em que houver um segundo estado fechado.
#
# ENCERRAR NÃO APAGA NADA: as `RespostaFeedback` já gravadas continuam no banco,
# continuam contando em `total_respostas` e continuam legíveis no diálogo do
# card. O que muda é EXCLUSIVAMENTE a porta de entrada anônima — por isso o
# encerramento é um valor de `estado`, e não uma coluna `encerrado_em` nem um
# delete.
ESTADOS_SEM_LINK = (EstadoPedido.ENCERRADO,)


def link_ativo(estado: str) -> bool:
    """True quando a rota pública deve abrir para este estado.

    Voltar de "Feedback Finalizado" para qualquer outra etapa do fluxo reabre o
    link SEM nenhum passo extra: o token nunca foi trocado nem revogado, então a
    reabertura é a própria mudança de estado. É por isso que encerrar não gera
    token novo — gerar um invalidaria o link que o cliente já tem na mão, e o
    usuário pediu justamente que ele volte a funcionar.
    """
    return estado not in ESTADOS_SEM_LINK

# Teto ABSOLUTO de respostas por pedido. Ele é o substituto direto do índice
# único que o OneToOne dava: sem nenhum limite estrutural, um link público,
# perene e sem login vira storage grátis para quem o tiver — o rate limit
# sozinho não fecha esse buraco, porque quem fica DENTRO da taxa cresce
# indefinidamente e o balde do cache zera a cada restart do Redis.
#
# 100 × ~12 KB (o teto medido de uma resposta cheia) = ~1,2 MB por pedido no
# PIOR caso, e cada pedido continua exigindo um card. É ~duas ordens de
# grandeza acima de qualquer entrega real (o formulário vai para os
# stakeholders de UMA entrega) e ainda assim é um número FINITO, que é a
# propriedade que se perdeu ao remover a unicidade.
MAX_RESPOSTAS_POR_PEDIDO = 100


class FeedbackFormulario(models.Model):
    """A definição do formulário, guardada como DADO.

    O pedido do usuário nesta fase é UM campo de texto, só para validar — e o
    formulário "será trocado depois". Modelar os campos como JSON (e não como
    colunas) é o que faz essa troca ser uma data migration nova, sem mexer em
    schema e sem quebrar respostas antigas.

    Trocar os campos cria uma LINHA NOVA (`versao` + 1) e desativa a anterior;
    nunca edita a antiga. Assim uma resposta gravada há seis meses continua
    legível contra a definição que a pessoa de fato viu na tela.
    """

    slug = models.CharField(
        max_length=50,
        default='padrao',
        help_text='Família do formulário. É o que a função de entrada da fase 2 recebe, '
                  'para que trocar o formulário não mude a assinatura.',
    )
    versao = models.PositiveSmallIntegerField(default=1)
    titulo = models.CharField(
        max_length=120,
        help_text='Cabeçalho da página pública. Texto fixo nosso — nunca dado do projeto.',
    )
    # A intro da página é conteúdo do FORMULÁRIO, não do frontend: ela muda
    # junto com as perguntas e precisa ficar congelada com a versão. Guardar o
    # título aqui e o subtítulo num arquivo .tsx é o tipo de incoerência que
    # vira bug previsível — quem executar o procedimento de 2 passos daqui a
    # seis meses vai trocar o título e não vai abrir o frontend.
    #
    # Este AddField NÃO fere a promessa da fase 1: ela é "trocar os CAMPOS não
    # exige migration de schema", e trocar os campos continua sendo só a data
    # migration.
    subtitulo = models.CharField(
        max_length=300,
        blank=True,
        default='',
        help_text='Intro da página pública. Texto fixo nosso — nunca dado do projeto.',
    )
    campos = models.JSONField(
        default=list,
        help_text='Schema dos campos: [{"key": "comentario", "label": "...", '
                  '"tipo": "texto_longo", "obrigatorio": true, "max_length": 2000}]. '
                  'A ORDEM é a da lista. Tipos aceitos: "texto", "texto_longo", '
                  '"escala" (com "minimo"/"maximo" e "rotulos" opcionais) e '
                  '"escolha_unica" (com "opcoes"). Chave opcional "secao" agrupa '
                  'campos CONSECUTIVOS sob um cabeçalho na página pública.',
    )
    # Qual versão nasce nos pedidos novos. A constraint parcial abaixo garante
    # que exista no máximo UMA ativa por slug — sem isso, a criação do pedido
    # teria de escolher entre duas e a escolha seria arbitrária.
    ativo = models.BooleanField(default=True, db_index=True)
    criado_em = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'Formulário de feedback'
        verbose_name_plural = 'Formulários de feedback'
        ordering = ['slug', '-versao']
        constraints = [
            models.UniqueConstraint(
                fields=['slug', 'versao'],
                name='uniq_formulario_slug_versao',
            ),
            models.UniqueConstraint(
                fields=['slug'],
                condition=Q(ativo=True),
                name='uniq_formulario_ativo_por_slug',
            ),
        ]

    def __str__(self) -> str:
        return f'{self.slug} v{self.versao}'


class PedidoFeedback(models.Model):
    """Um pedido de feedback — UM POR CARD MARCADO.

    Cinco cards marcados no mesmo projeto = cinco pedidos e cinco links
    distintos. A deduplicação é por CARD, jamais por projeto, e quem garante
    isso é o índice único do OneToOne — não um `if`.
    """

    # A credencial INTEIRA da rota anônima. `secrets.token_urlsafe(32)` = 256
    # bits (43 chars); 64 dá folga para uma troca futura de tamanho.
    #
    # unique=True não é só integridade: a busca vira lookup em índice único, e
    # com isso o tempo de resposta é o mesmo para token existente e inexistente.
    # Não há comparação em Python para vazar timing.
    #
    # editable=False porque não existe caso legítimo de alguém digitar um token:
    # ele nasce em services.criar_pedido_feedback e nunca muda.
    token = models.CharField(max_length=64, unique=True, editable=False)

    # O card MARCADO (o do checkbox `gerar_formulario_feedback`, fase 2) — o
    # assunto do feedback. Referência por STRING de propósito: zero import de
    # apps.projects aqui dentro, logo zero risco de ciclo com projects/apps.ready.
    #
    # OneToOne porque a regra é UM formulário POR CARD: o índice único É a
    # idempotência da criação. CASCADE porque, sem o card, a resposta não tem
    # sujeito — e guardar dado pessoal órfão contraria a minimização da LGPD.
    card = models.OneToOneField(
        'projects.Card',
        on_delete=models.CASCADE,
        related_name='pedido_feedback',
    )

    # O card do kanban de monitoramento onde o link será COPIADO (fase 2).
    # Nulo enquanto a fase 2 não existir. SET_NULL e não CASCADE: apagar o card
    # de EXIBIÇÃO não pode destruir a resposta.
    card_kanban = models.OneToOneField(
        'projects.Card',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='pedido_exibido',
    )

    # PROTECT: apagar a definição tornaria as respostas gravadas ilegíveis.
    formulario = models.ForeignKey(
        FeedbackFormulario,
        on_delete=models.PROTECT,
        related_name='pedidos',
    )

    # A data de entrega, JÁ convertida para data LOCAL pela fase 2.
    # DateField de propósito: a granularidade é DIA e o motor não faz nenhuma
    # conta de fuso. Com isso o bug UTC-vs-local das 21h à meia-noite que este
    # projeto já teve fica impossível por CONSTRUÇÃO, não por disciplina.
    data_referencia = models.DateField(db_index=True)

    estado = models.CharField(
        max_length=20,
        choices=EstadoPedido.choices,
        default=EstadoPedido.AGUARDANDO_PRAZO,
        db_index=True,
    )

    # O rótulo seguro que a página pública exibe. É uma CÓPIA, não um join:
    # mantém a view anônima sem tocar em Card/Project/Sprint, congela o que o
    # respondente viu e deixa a fase 2 dona de decidir o que é seguro mostrar.
    #
    # 200 e não 120: é EXATAMENTE o `max_length` de `Card.nome` (a origem real
    # do valor — `estrutura.py` passa `card.nome`) e, por coincidência, também o
    # de `Project.nome`. Com 120, `services.criar_pedido_feedback` cortava em
    # silêncio — e o campo 1.1 do formulário ("Nome do projeto:") é justamente o
    # que o cliente precisa reconhecer para saber QUAL entrega está avaliando.
    # Ver esse nome cortado no meio é pior do que uma coluna 80 bytes maior.
    referencia_publica = models.CharField(max_length=200)

    criado_em = models.DateTimeField(auto_now_add=True)
    # Serve de "há quanto tempo está nesta coluna", o que dispensa um
    # `liberado_em` derivável. ATENÇÃO: auto_now NÃO dispara em queryset
    # .update() — as transições atualizam este campo explicitamente.
    atualizado_em = models.DateTimeField(auto_now=True)
    # Separado de `atualizado_em` porque é o CORTE DA RETENÇÃO: não pode ser
    # reiniciado por um save qualquer.
    respondido_em = models.DateTimeField(null=True, blank=True, db_index=True)

    class Meta:
        verbose_name = 'Pedido de feedback'
        verbose_name_plural = 'Pedidos de feedback'
        ordering = ['-criado_em']
        indexes = [
            # Exatamente o WHERE da varredura diária dos 30 dias.
            models.Index(fields=['estado', 'data_referencia']),
        ]

    def __str__(self) -> str:
        return f'Pedido #{self.pk} ({self.estado})'

    @property
    def url_publica(self) -> str:
        """Link para copiar e enviar à mão.

        Guardamos só o TOKEN, nunca a URL: uma troca de domínio não invalida
        nada já gravado. A base sai de FEEDBACK_PUBLIC_BASE_URL (com fallback
        `https://{PUBLIC_HOST}` resolvido no settings) e é SEMPRE https em
        produção — `SECURE_SSL_REDIRECT=True` faz um POST em http virar 301, e
        alguns clientes perdem o corpo no redirect. Como este link vai ser
        colado à mão no WhatsApp, isso aconteceria de verdade.
        """
        base = (getattr(settings, 'FEEDBACK_PUBLIC_BASE_URL', '') or '').rstrip('/')
        return f'{base}/feedback/{self.token}'


class RespostaFeedback(models.Model):
    """UMA resposta. Três campos, e nenhum deles identifica quem respondeu.

    Sem IP, sem user agent, sem nome, sem e-mail: guardamos o MÍNIMO. O que
    torna esta tabela sensível é `valores`, e é por isso que ela é uma tabela
    separada — a retenção apaga a linha inteira sem tocar no pedido.

    VÁRIAS pessoas podem responder o mesmo link, e cada uma gera uma LINHA
    PRÓPRIA: nenhuma sobrescreve a anterior, porque o valor da feature é ter
    várias opiniões sobre a mesma entrega. Guardar o MÍNIMO continua valendo com
    força ainda maior agora — é justamente quando várias pessoas usam o mesmo
    link que aparece a tentação de acrescentar "só um campo" para saber quem
    respondeu.
    """

    # ForeignKey e NÃO OneToOne: a unicidade foi REMOVIDA DE PROPÓSITO (o pedido
    # do usuário é "mais de um usuário deve poder responder"). Com isso some a
    # garantia que o índice único dava sob concorrência — dois POSTs simultâneos
    # agora inserem os dois, que é exatamente o comportamento desejado.
    #
    # O que substitui o índice único como freio não é um `if`, é o teto
    # MAX_RESPOSTAS_POR_PEDIDO conferido no POST. Ele é de política, não de
    # banco: na 100ª resposta dois POSTs simultâneos podem gravar 101 linhas, e
    # isso é irrelevante nessa escala.
    #
    # CASCADE porque, sem o pedido, a resposta não tem sujeito — e guardar dado
    # pessoal órfão contraria a minimização da LGPD.
    pedido = models.ForeignKey(
        PedidoFeedback,
        on_delete=models.CASCADE,
        related_name='respostas',
    )
    valores = models.JSONField(
        default=dict,
        help_text='{"<key do campo>": <valor>} — validado ESTRITAMENTE contra '
                  'pedido.formulario.campos. Texto e escolha única gravam STRING; '
                  'escala grava INTEIRO (7, não "7"), para a leitura render média '
                  'e distribuição sem parsing. Chave desconhecida, valor fora do '
                  'intervalo, opção inexistente e valor acima do max_length são '
                  'REJEITADOS (não truncados, não coagidos). Campo OPCIONAL não '
                  'respondido fica AUSENTE do dicionário.',
    )
    enviado_em = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'Resposta de feedback'
        verbose_name_plural = 'Respostas de feedback'
        # `-id` é DESEMPATE, não enfeite: `enviado_em` é auto_now_add e duas
        # respostas gravadas no mesmo instante empatariam, deixando "a mais
        # recente" não-determinística entre execuções. Com várias respostas por
        # pedido essa ordem virou load-bearing — é ela que define a ordem em que
        # as opiniões aparecem na tela.
        ordering = ['-enviado_em', '-id']

    def __str__(self) -> str:
        return f'Resposta do pedido #{self.pedido_id}'
