import api from './api';
import type { CardTodo } from './cardTodoService';

export type ProjectDetail = {
  id: string;
  nome: string;
  descricao?: string;
  sprint?: string; // UUID
  sprint_detail?: {
    id: string;
    nome: string;
    data_inicio: string;
    fechamento_em: string;
    data_fim?: string;
    duracao_dias: number;
    supervisor: string;
    supervisor_name?: string;
    finalizada?: boolean;
  };
  gerente_atribuido?: string | null;
  gerente_name?: string;
  desenvolvedor?: string | null;
  desenvolvedor_name?: string;
  status: string;
  status_display?: string;
};

export type Card = {
  id: string; // UUID
  nome: string;
  descricao: string;
  script_url?: string | null;
  projeto: string; // UUID
  projeto_detail?: ProjectDetail;
  area: string;
  area_display?: string;
  tipo: string;
  tipo_display?: string;
  responsavel?: string | null; // UUID
  responsavel_name?: string;
  responsavel_profile_picture_url?: string | null;
  criado_por?: string | null; // UUID
  criado_por_name?: string;
  criado_por_profile_picture_url?: string | null;
  status: string;
  status_display?: string;
  prioridade: string;
  prioridade_display?: string;
  data_inicio?: string | null;
  data_fim?: string | null;
  /** Instant em que o card passou a finalizado pela última vez (API). */
  finalizado_em?: string | null;
  complexidade_selected_items?: string[];
  complexidade_selected_development?: string | null;
  complexidade_custom_items?: Array<{ id: string; label: string; hours: number }>;
  card_comment?: string | null;
  todos?: CardTodo[];
  events_count?: number;
  created_at?: string;
  updated_at?: string;
};

export type CardCreate = {
  nome: string;
  descricao?: string;
  script_url?: string | null;
  projeto: string; // UUID
  area?: string;
  tipo?: string;
  responsavel?: string | null; // UUID
  status?: string;
  prioridade?: string;
  data_inicio?: string | null;
  data_fim?: string | null;
  complexidade_selected_items?: string[];
  complexidade_selected_development?: string | null;
  complexidade_custom_items?: Array<{ id: string; label: string; hours: number }>;
  card_comment?: string | null;
};

// Opções para os campos
export const CARD_AREAS = [
  { value: 'rpa', label: 'RPA' },
  { value: 'automacao', label: 'Automação' },
  { value: 'frontend', label: 'Frontend' },
  { value: 'backend', label: 'Backend' },
  { value: 'script', label: 'Script' },
  { value: 'sistema', label: 'Sistema' },
];

export const CARD_TYPES = [
  { value: 'nova_robotizacao', label: 'Nova Robotização' },
  { value: 'nova_automacao', label: 'Nova Automação' },
  { value: 'feature', label: 'Feature' },
  { value: 'bug', label: 'Bug' },
  { value: 'refact_completo', label: 'Refact Completo' },
  { value: 'refact_pontual', label: 'Refact Pontual' },
  { value: 'otimizacao_processo', label: 'Otimização de Processo' },
  { value: 'melhoria_fluxo', label: 'Melhoria de Fluxo' },
  { value: 'novo_script', label: 'Novo Script' },
  { value: 'ferramenta', label: 'Ferramenta' },
  { value: 'qualidade', label: 'Qualidade' },
  { value: 'teste_software', label: 'Teste de Software' },
  { value: 'raspagem_dados', label: 'Raspagem de Dados' },
  { value: 'novo_painel', label: 'Novo Painel' },
  { value: 'ia', label: 'IA' },
  { value: 'auditoria', label: 'Auditoria' },
  { value: 'manutencao', label: 'Manutenção' },
];

export const CARD_PRIORITIES = [
  { value: 'baixa', label: 'Baixa' },
  { value: 'media', label: 'Média' },
  { value: 'alta', label: 'Alta' },
  { value: 'absoluta', label: 'Absoluta' },
];

export const CARD_STATUSES = [
  { value: 'a_desenvolver', label: 'A Desenvolver' },
  { value: 'em_desenvolvimento', label: 'Em Desenvolvimento' },
  { value: 'parado_pendencias', label: 'Parado por Pendências' },
  { value: 'em_homologacao', label: 'Em Homologação' },
  { value: 'finalizado', label: 'Finalizado' },
  { value: 'inviabilizado', label: 'Inviabilizado' },
];

// Tipo para resposta paginada
type PaginatedResponse<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

const isSuggestionCard = (card: Card): boolean => {
  return card?.projeto_detail?.nome === 'Sugestões';
};

const filterSuggestionCards = (cards: Card[], includeSuggestions: boolean): Card[] => {
  if (includeSuggestions) return cards;
  return cards.filter((c) => !isSuggestionCard(c));
};

export const cardService = {
  async getAll(): Promise<Card[]> {
    return cardService.getAllWithOptions({ includeSuggestions: false });
  },

  async getAllWithSuggestions(): Promise<Card[]> {
    return cardService.getAllWithOptions({ includeSuggestions: true });
  },

  async getAllWithOptions(options?: { includeSuggestions?: boolean }): Promise<Card[]> {
    const includeSuggestions = !!options?.includeSuggestions;
    const allCards: Card[] = [];
    let nextUrl: string | null = '/cards/';
    
    // Fazer requisições paginadas até obter todos os cards
    while (nextUrl) {
      const response = await api.get<PaginatedResponse<Card> | Card[]>(nextUrl);
      
      if (Array.isArray(response.data)) {
        // Se não for paginado, retornar diretamente
        return filterSuggestionCards(response.data, includeSuggestions);
      }
      
      // Se for paginado, adicionar os resultados e verificar se há próxima página
      const paginatedData = response.data as PaginatedResponse<Card>;
      allCards.push(...filterSuggestionCards((paginatedData.results || []), includeSuggestions));
      
      // Se houver próxima página, extrair o caminho da URL
      if (paginatedData.next) {
        try {
          const url = new URL(paginatedData.next);
          let path = url.pathname + url.search;
          // Remover /api/ do início se estiver presente (já está no baseURL)
          if (path.startsWith('/api/')) {
            path = path.substring(4); // Remove '/api'
          }
          nextUrl = path;
        } catch {
          // Se não for uma URL válida, tentar usar diretamente
          let path = paginatedData.next.startsWith('/') 
            ? paginatedData.next 
            : paginatedData.next.replace(/^https?:\/\/[^/]+/, '');
          // Remover /api/ do início se estiver presente
          if (path.startsWith('/api/')) {
            path = path.substring(4); // Remove '/api'
          }
          nextUrl = path;
        }
      } else {
        nextUrl = null;
      }
    }
    
    return allCards;
  },

  async getByProject(projectId: string, options?: { includeSuggestions?: boolean }): Promise<Card[]> {
    const includeSuggestions = !!options?.includeSuggestions;
    const allCards: Card[] = [];
    let nextUrl: string | null = `/cards/?projeto=${projectId}`;
    
    // Fazer requisições paginadas até obter todos os cards do projeto
    while (nextUrl) {
      const response = await api.get<PaginatedResponse<Card> | Card[]>(nextUrl);
      
      if (Array.isArray(response.data)) {
        // Se não for paginado, retornar diretamente (respeitando filtro de sugestões)
        return filterSuggestionCards(response.data, includeSuggestions);
      }
      
      // Se for paginado, adicionar os resultados e verificar se há próxima página
      const paginatedData = response.data as PaginatedResponse<Card>;
      allCards.push(...(paginatedData.results || []));
      
      // Se houver próxima página, extrair o caminho da URL
      if (paginatedData.next) {
        try {
          const url = new URL(paginatedData.next);
          let path = url.pathname + url.search;
          // Remover /api/ do início se estiver presente (já está no baseURL)
          if (path.startsWith('/api/')) {
            path = path.substring(4); // Remove '/api'
          }
          nextUrl = path;
        } catch {
          // Se não for uma URL válida, tentar usar diretamente
          let path = paginatedData.next.startsWith('/') 
            ? paginatedData.next 
            : paginatedData.next.replace(/^https?:\/\/[^/]+/, '');
          // Remover /api/ do início se estiver presente
          if (path.startsWith('/api/')) {
            path = path.substring(4); // Remove '/api'
          }
          nextUrl = path;
        }
      } else {
        nextUrl = null;
      }
    }
    
    return filterSuggestionCards(allCards, includeSuggestions);
  },

  async getByProjectAndStatus(
    projectId: string,
    status: string,
    options?: { includeSuggestions?: boolean }
  ): Promise<Card[]> {
    const includeSuggestions = !!options?.includeSuggestions;
    const allCards: Card[] = [];
    let nextUrl: string | null = `/cards/?projeto=${projectId}&status=${encodeURIComponent(status)}`;

    while (nextUrl) {
      const response = await api.get<PaginatedResponse<Card> | Card[]>(nextUrl);

      if (Array.isArray(response.data)) {
        // Se não for paginado, retornar diretamente (respeitando filtro de sugestões)
        return filterSuggestionCards(response.data, includeSuggestions);
      }

      const paginatedData = response.data as PaginatedResponse<Card>;
      allCards.push(...(paginatedData.results || []));

      if (paginatedData.next) {
        try {
          const url = new URL(paginatedData.next);
          let path = url.pathname + url.search;
          if (path.startsWith('/api/')) {
            path = path.substring(4); // Remove '/api'
          }
          nextUrl = path;
        } catch {
          let path = paginatedData.next.startsWith('/')
            ? paginatedData.next
            : paginatedData.next.replace(/^https?:\/\/[^/]+/, '');
          if (path.startsWith('/api/')) {
            path = path.substring(4); // Remove '/api'
          }
          nextUrl = path;
        }
      } else {
        nextUrl = null;
      }
    }

    return filterSuggestionCards(allCards, includeSuggestions);
  },

  async getByResponsavel(userId: string): Promise<Card[]> {
    const allCards: Card[] = [];
    let nextUrl: string | null = `/cards/?responsavel=${userId}`;
    
    // Fazer requisições paginadas até obter todos os cards do responsável
    while (nextUrl) {
      const response = await api.get<PaginatedResponse<Card> | Card[]>(nextUrl);
      
      if (Array.isArray(response.data)) {
        // Se não for paginado, retornar diretamente
        return response.data;
      }
      
      // Se for paginado, adicionar os resultados e verificar se há próxima página
      const paginatedData = response.data as PaginatedResponse<Card>;
      allCards.push(...(paginatedData.results || []));
      
      // Se houver próxima página, extrair o caminho da URL
      if (paginatedData.next) {
        try {
          const url = new URL(paginatedData.next);
          let path = url.pathname + url.search;
          // Remover /api/ do início se estiver presente (já está no baseURL)
          if (path.startsWith('/api/')) {
            path = path.substring(4); // Remove '/api'
          }
          nextUrl = path;
        } catch {
          // Se não for uma URL válida, tentar usar diretamente
          let path = paginatedData.next.startsWith('/') 
            ? paginatedData.next 
            : paginatedData.next.replace(/^https?:\/\/[^/]+/, '');
          // Remover /api/ do início se estiver presente
          if (path.startsWith('/api/')) {
            path = path.substring(4); // Remove '/api'
          }
          nextUrl = path;
        }
      } else {
        nextUrl = null;
      }
    }
    
    return allCards;
  },

  async getById(id: string): Promise<Card> {
    console.log('[cardService] Fazendo GET para /cards/' + id + '/');
    const response = await api.get(`/cards/${id}/`);
    console.log('[cardService] Resposta GET recebida:', JSON.stringify(response.data, null, 2));
    return response.data;
  },

  async create(data: CardCreate): Promise<Card> {
    const response = await api.post('/cards/', data);
    return response.data;
  },

  async update(id: string, data: Partial<CardCreate>): Promise<Card> {
    console.log('[cardService] Enviando PATCH para /cards/' + id + '/', JSON.stringify(data, null, 2));
    const response = await api.patch(`/cards/${id}/`, data);
    console.log('[cardService] Resposta recebida:', JSON.stringify(response.data, null, 2));
    return response.data;
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/cards/${id}/`);
  },
};
