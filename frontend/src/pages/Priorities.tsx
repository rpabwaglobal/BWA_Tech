import { useEffect, useState, useCallback, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { DateTimePicker } from '@/components/ui/datetime-picker';
import { UserSelect } from '@/components/ui/user-select';
import { Loader2, Check, Settings, Plus, Pencil, Trash2, X, ChevronDown, ChevronUp, AlertTriangle, AlertCircle, ExternalLink } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/context/AuthContext';
import api from '@/services/api';
import { cardService, type Card as CardType, CARD_AREAS, CARD_TYPES, CARD_PRIORITIES, CARD_STATUSES } from '@/services/cardService';
import { userService, type User as UserType } from '@/services/userService';
import { weeklyPriorityService } from '@/services/weeklyPriorityService';
import { cn, normalizeExternalUrl } from '@/lib/utils';
// Formatação de data sem dependência externa

type CardData = {
  id: string;
  nome: string;
  prioridade: string;
  prioridade_display: string;
  data_fim: string | null;
  status: string;
  status_display: string;
  projeto?: number;
  projeto_detail?: {
    id: number;
    nome: string;
  };
  weekly_priority?: {
    id: string;
    is_concluido: boolean;
    is_atrasado: boolean;
    semana_inicio: string;
    semana_fim: string;
  };
};

const isCompleted = (status: string) => {
  return status === 'finalizado';
};

type UserWithCards = {
  usuario: {
    id: string;
    username: string;
    first_name: string | null;
    last_name: string | null;
    email: string;
    role: string;
    role_display: string;
    profile_picture_url?: string | null;
  };
  cards: CardData[];
};


export default function Priorities() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isSupervisor = user?.role === 'supervisor' || user?.role === 'admin';
  const [usersWithCards, setUsersWithCards] = useState<UserWithCards[]>([]);
  const [loading, setLoading] = useState(true);
  const [periodo, setPeriodo] = useState<'dia' | 'semana'>('dia');
  const [viewCardDialogOpen, setViewCardDialogOpen] = useState(false);
  const [selectedCard, setSelectedCard] = useState<CardType | null>(null);
  const [cardLoading, setCardLoading] = useState(false);
  const [users, setUsers] = useState<UserType[]>([]);
  const [cardFormData, setCardFormData] = useState({
    nome: '',
    descricao: '',
    script_url: '',
    area: 'backend',
    tipo: 'feature',
    prioridade: 'media',
    status: 'a_desenvolver',
    responsavel: '',
    data_inicio: '',
    data_fim: '',
  });
  
  // Estados para modais de prioridades da semana
  const [definePriorityDialogOpen, setDefinePriorityDialogOpen] = useState(false);
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [selectedUserForPriority, setSelectedUserForPriority] = useState<UserType | null>(null);
  const [selectedCardsForPriority, setSelectedCardsForPriority] = useState<CardType[]>([]);
  const [availableCards, setAvailableCards] = useState<CardType[]>([]);
  const [loadingCards, setLoadingCards] = useState(false);
  const [savingPriority, setSavingPriority] = useState(false);
  const [config, setConfig] = useState<{ horario_limite: string; fechamento_automatico: boolean }>({ 
    horario_limite: '09:00:00',
    fechamento_automatico: true
  });
  const [savingConfig, setSavingConfig] = useState(false);
  const [deletePriorityDialogOpen, setDeletePriorityDialogOpen] = useState(false);
  const [priorityToDelete, setPriorityToDelete] = useState<{ userId: string; userName: string } | null>(null);
  const [deletePriorityLoading, setDeletePriorityLoading] = useState(false);
  const [semanaFechada, setSemanaFechada] = useState(false);
  const [closingWeek, setClosingWeek] = useState(false);
  const [clearingPriorities, setClearingPriorities] = useState(false);
  const [selectedUserForExpansion, setSelectedUserForExpansion] = useState<UserWithCards['usuario'] | null>(null);
  
  // Estados para modais de sucesso/erro/confirmação
  const [successModalOpen, setSuccessModalOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorModalOpen, setErrorModalOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [confirmCloseWeekOpen, setConfirmCloseWeekOpen] = useState(false);
  const [confirmClearPrioritiesOpen, setConfirmClearPrioritiesOpen] = useState(false);

  // Função para carregar dados
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      
      if (periodo === 'semana') {
        // Carregar prioridades da semana
        const response = await weeklyPriorityService.getPrioritiesView();
        console.log('[Priorities] Dados da semana recebidos:', response);
        setSemanaFechada(response.semana_fechada || false);
        setUsersWithCards(response.data || []);
      } else {
        // Carregar prioridades do dia
        const response = await api.get('/cards/priorities_view/', {
          params: { periodo }
        });
        console.log('[Priorities] Dados recebidos:', response.data);
        console.log('[Priorities] Total de usuários:', response.data?.length || 0);
        setUsersWithCards(response.data || []);
      }
    } catch (error: any) {
      console.error('Erro ao carregar prioridades:', error);
      console.error('Erro detalhado:', error.response?.data);
      setUsersWithCards([]);
    } finally {
      setLoading(false);
    }
  }, [periodo]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Escutar eventos de notificação para atualização em tempo real
  useEffect(() => {
    const handleNotificationReceived = (event: CustomEvent) => {
      const notification = event.detail as any;
      
      // Tipos de notificação que devem atualizar as prioridades
      const relevantTypes = [
        'card_created',
        'card_updated',
        'card_moved',
        'card_deleted',
        'sprint_created',
        'project_created',
      ];
      
      if (relevantTypes.includes(notification.tipo)) {
        console.log('[Priorities] Notificação relevante recebida, recarregando dados:', notification.tipo);
        loadData();
      }
    };

    const handleWeeklyPriorityUpdated = (event: CustomEvent) => {
      console.log('[Priorities] Prioridade semanal atualizada, recarregando dados:', event.detail);
      // Recarregar dados quando uma prioridade semanal for atualizada
      if (periodo === 'semana') {
        loadData();
      }
    };

    window.addEventListener('notificationReceived', handleNotificationReceived as EventListener);
    window.addEventListener('weeklyPriorityUpdated', handleWeeklyPriorityUpdated as EventListener);

    return () => {
      window.removeEventListener('notificationReceived', handleNotificationReceived as EventListener);
      window.removeEventListener('weeklyPriorityUpdated', handleWeeklyPriorityUpdated as EventListener);
    };
  }, [loadData]);

  // Carregar usuários quando necessário
  useEffect(() => {
    const loadUsers = async () => {
      try {
        const usersData = await userService.getAll();
        setUsers(usersData);
      } catch (error) {
        console.error('Erro ao carregar usuários:', error);
      }
    };
    loadUsers();
  }, []);

  // Carregar configuração quando necessário
  useEffect(() => {
    const loadConfig = async () => {
      if (isSupervisor && periodo === 'semana') {
        try {
          const configData = await weeklyPriorityService.getConfig();
          setConfig({ 
            horario_limite: configData.horario_limite,
            fechamento_automatico: configData.fechamento_automatico !== undefined ? configData.fechamento_automatico : true
          });
        } catch (error) {
          console.error('Erro ao carregar configuração:', error);
        }
      }
    };
    loadConfig();
  }, [isSupervisor, periodo]);

  const getUserDisplayName = (user: UserWithCards['usuario']) => {
    if (user.first_name && user.last_name) {
      return `${user.first_name} ${user.last_name}`;
    }
    return user.username;
  };

  const getInitials = (user: UserWithCards['usuario']) => {
    if (user.first_name && user.last_name) {
      return `${user.first_name.charAt(0)}${user.last_name.charAt(0)}`.toUpperCase();
    }
    return user.username.substring(0, 2).toUpperCase();
  };

  // Função para abrir modal de definir prioridade
  const handleDefinePriority = async (user: UserWithCards['usuario']) => {
    try {
      setLoadingCards(true);
      const userObj = users.find(u => u.id === user.id);
      setSelectedUserForPriority(userObj || null);
      
      // Carregar cards do usuário
      const allCards = await cardService.getAll();
      const userCards = allCards.filter(card => 
        card.responsavel === user.id && 
        card.status !== 'finalizado' && 
        card.status !== 'inviabilizado'
      );
      setAvailableCards(userCards);
      
      // Pre-selecionar os cards que já têm prioridade semanal definida
      const hoje = new Date();
      const diasAteSegunda = hoje.getDay() === 0 ? 6 : hoje.getDay() - 1;
      const segundaFeira = new Date(hoje);
      segundaFeira.setDate(hoje.getDate() - diasAteSegunda);
      const semanaInicio = segundaFeira.toISOString().split('T')[0];
      
      const currentWeekPriorities = await weeklyPriorityService.getAll({ semana: semanaInicio });
      const existingPriorities = currentWeekPriorities.filter(p => String(p.usuario) === String(user.id));
      
      if (existingPriorities.length > 0) {
        const existingCards = existingPriorities
          .map(p => userCards.find(c => String(c.id) === String(p.card)))
          .filter((c): c is CardType => c !== undefined);
        console.log('[Priorities] Pré-selecionando cards:', existingCards.map(c => c.id));
        setSelectedCardsForPriority(existingCards);
      } else {
        setSelectedCardsForPriority([]);
      }
      
      setDefinePriorityDialogOpen(true);
    } catch (error) {
      console.error('Erro ao carregar cards:', error);
    } finally {
      setLoadingCards(false);
    }
  };

  // Função para salvar prioridade da semana
  const handleSavePriority = async () => {
    if (!selectedUserForPriority) return;
    
    // Permitir salvar mesmo sem seleção (para remover todas as prioridades)
    if (selectedCardsForPriority.length === 0) {
      // Se não há seleção, apenas deletar todas as prioridades existentes
      const hoje = new Date();
      const diasAteSegunda = hoje.getDay() === 0 ? 6 : hoje.getDay() - 1;
      const segundaFeira = new Date(hoje);
      segundaFeira.setDate(hoje.getDate() - diasAteSegunda);
      const semanaInicio = segundaFeira.toISOString().split('T')[0];
      
      const existingPriorities = await weeklyPriorityService.getAll({ semana: semanaInicio });
      const existingForUser = existingPriorities.filter(p => p.usuario === selectedUserForPriority.id);
      
      // Deletar todas as prioridades
      for (const priority of existingForUser) {
        await weeklyPriorityService.delete(priority.id);
      }
      
      await loadData();
      
      // Disparar evento customizado para atualização em tempo real
      window.dispatchEvent(
        new CustomEvent('weeklyPriorityUpdated', {
          detail: {
            usuario: selectedUserForPriority.id,
            action: 'deleted_all'
          }
        })
      );
      
      setDefinePriorityDialogOpen(false);
      setSelectedUserForPriority(null);
      setSelectedCardsForPriority([]);
      return;
    }
    
    try {
      setSavingPriority(true);
      
      // Calcular segunda-feira e sexta-feira da semana atual
      const hoje = new Date();
      const diasAteSegunda = hoje.getDay() === 0 ? 6 : hoje.getDay() - 1; // 0 = domingo, 1 = segunda, etc.
      const segundaFeira = new Date(hoje);
      segundaFeira.setDate(hoje.getDate() - diasAteSegunda);
      segundaFeira.setHours(0, 0, 0, 0);
      
      const sextaFeira = new Date(segundaFeira);
      sextaFeira.setDate(segundaFeira.getDate() + 4);
      
      const semanaInicio = segundaFeira.toISOString().split('T')[0];
      const semanaFim = sextaFeira.toISOString().split('T')[0];
      
      // Buscar prioridades existentes para este usuário nesta semana
      const existingPriorities = await weeklyPriorityService.getAll({ semana: semanaInicio });
      const existingForUser = existingPriorities.filter(p => String(p.usuario) === String(selectedUserForPriority.id));
      
      // IDs dos cards selecionados (normalizar para string)
      const selectedCardIds = selectedCardsForPriority.map(c => String(c.id));
      
      // IDs dos cards que já têm prioridade (normalizar para string)
      const existingCardIds = existingForUser.map(p => String(p.card));
      
      console.log('[Priorities] IDs selecionados:', selectedCardIds);
      console.log('[Priorities] IDs existentes:', existingCardIds);
      
      // Cards para criar (selecionados mas não existentes)
      const cardsToCreate = selectedCardIds.filter(id => !existingCardIds.includes(id));
      
      // Cards para deletar (existentes mas não selecionados)
      const cardsToDelete = existingForUser.filter(p => !selectedCardIds.includes(String(p.card)));
      
      console.log('[Priorities] Cards para criar:', cardsToCreate);
      console.log('[Priorities] Cards para deletar:', cardsToDelete.map(p => p.card));
      
      // Criar novas prioridades
      const createPromises = cardsToCreate.map(async (cardId) => {
        try {
          await weeklyPriorityService.create({
            usuario: selectedUserForPriority.id,
            card: cardId,
            semana_inicio: semanaInicio,
            semana_fim: semanaFim,
          });
        } catch (error: any) {
          console.error('Erro ao criar prioridade:', error);
          console.error('Dados enviados:', {
            usuario: selectedUserForPriority.id,
            card: cardId,
            semana_inicio: semanaInicio,
            semana_fim: semanaFim,
          });
          console.error('Resposta do servidor:', error.response?.data);
          // Se for erro de duplicata, ignorar (já existe)
          if (error.response?.status === 400 && error.response?.data?.non_field_errors) {
            console.warn('Prioridade já existe, ignorando...');
            return;
          }
          throw error;
        }
      });
      
      await Promise.all(createPromises);
      
      // Deletar prioridades removidas
      for (const priority of cardsToDelete) {
        await weeklyPriorityService.delete(priority.id);
      }
      
      // Recarregar dados
      await loadData();
      
      // Disparar evento customizado para atualização em tempo real
      window.dispatchEvent(
        new CustomEvent('weeklyPriorityUpdated', {
          detail: {
            usuario: selectedUserForPriority.id,
            action: 'saved'
          }
        })
      );
      
      setDefinePriorityDialogOpen(false);
      setSelectedUserForPriority(null);
      setSelectedCardsForPriority([]);
    } catch (error) {
      console.error('Erro ao salvar prioridade:', error);
      setErrorMessage('Erro ao salvar prioridade. Tente novamente.');
      setErrorModalOpen(true);
    } finally {
      setSavingPriority(false);
    }
  };

  // Função para salvar configuração
  const handleSaveConfig = async () => {
    try {
      setSavingConfig(true);
      await weeklyPriorityService.updateConfig(config);
      setConfigDialogOpen(false);
      setSuccessMessage('Configuração salva com sucesso!');
      setSuccessModalOpen(true);
    } catch (error) {
      console.error('Erro ao salvar configuração:', error);
      setErrorMessage('Erro ao salvar configuração. Tente novamente.');
      setErrorModalOpen(true);
    } finally {
      setSavingConfig(false);
    }
  };

  // Função para abrir modal de confirmação de fechar semana
  const handleOpenConfirmCloseWeek = () => {
    setConfirmCloseWeekOpen(true);
  };

  // Função para fechar a semana (após confirmação)
  const handleCloseWeek = async () => {
    setConfirmCloseWeekOpen(false);
    
    try {
      setClosingWeek(true);
      const result = await weeklyPriorityService.closeWeek();
      setSemanaFechada(result.semana_fechada);
      await loadData();
      setSuccessMessage('Semana fechada com sucesso!');
      setSuccessModalOpen(true);
    } catch (error: any) {
      console.error('Erro ao fechar semana:', error);
      setErrorMessage(error.response?.data?.detail || 'Erro ao fechar semana. Tente novamente.');
      setErrorModalOpen(true);
    } finally {
      setClosingWeek(false);
    }
  };

  // Função para abrir modal de confirmação de redefinir prioridades
  const handleOpenConfirmClearPriorities = () => {
    setConfirmClearPrioritiesOpen(true);
  };

  // Função para redefinir prioridades (após confirmação)
  const handleClearPriorities = async () => {
    setConfirmClearPrioritiesOpen(false);
    
    try {
      setClearingPriorities(true);
      const result = await weeklyPriorityService.clearPriorities();
      setSemanaFechada(false);
      await loadData();
      setSuccessMessage(`${result.count} prioridade(s) removida(s) com sucesso!`);
      setSuccessModalOpen(true);
    } catch (error: any) {
      console.error('Erro ao redefinir prioridades:', error);
      setErrorMessage(error.response?.data?.detail || 'Erro ao redefinir prioridades. Tente novamente.');
      setErrorModalOpen(true);
    } finally {
      setClearingPriorities(false);
    }
  };

  // Função para confirmar exclusão de prioridade
  const confirmDeletePriority = async () => {
    if (!priorityToDelete) return;
    
    setDeletePriorityLoading(true);
    try {
      const hoje = new Date();
      const diasAteSegunda = hoje.getDay() === 0 ? 6 : hoje.getDay() - 1;
      const segundaFeira = new Date(hoje);
      segundaFeira.setDate(hoje.getDate() - diasAteSegunda);
      const semanaInicio = segundaFeira.toISOString().split('T')[0];
      
      // Buscar todas as prioridades do usuário para a semana atual
      const existingPriorities = await weeklyPriorityService.getAll({ semana: semanaInicio });
      const userPriorities = existingPriorities.filter(p => String(p.usuario) === String(priorityToDelete.userId));
      
      // Deletar todas as prioridades do usuário
      if (userPriorities.length > 0) {
        await Promise.all(userPriorities.map(p => weeklyPriorityService.delete(p.id)));
        await loadData();
        
        // Disparar evento customizado para atualização em tempo real
        window.dispatchEvent(
          new CustomEvent('weeklyPriorityUpdated', {
            detail: {
              usuario: priorityToDelete.userId,
              action: 'deleted'
            }
          })
        );
      }
      
      setDeletePriorityDialogOpen(false);
      setPriorityToDelete(null);
    } catch (error) {
      console.error('Erro ao deletar prioridades:', error);
      setErrorMessage('Erro ao deletar prioridades. Tente novamente.');
      setErrorModalOpen(true);
    } finally {
      setDeletePriorityLoading(false);
    }
  };

  const handleCardClick = async (cardId: string) => {
    try {
      setCardLoading(true);
      const card = await cardService.getById(cardId);
      setSelectedCard(card);
      
      // Preencher formData com os dados do card
      setCardFormData({
        nome: card.nome || '',
        descricao: card.descricao || '',
        script_url: card.script_url || '',
        area: card.area || 'backend',
        tipo: card.tipo || 'feature',
        prioridade: card.prioridade || 'media',
        status: card.status || 'a_desenvolver',
        responsavel: card.responsavel || '',
        data_inicio: card.data_inicio || '',
        data_fim: card.data_fim || '',
      });
      
      setViewCardDialogOpen(true);
    } catch (error) {
      console.error('Erro ao carregar card:', error);
    } finally {
      setCardLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--color-primary)]" />
      </div>
    );
  }

  return (
    <div className="space-y-[24px]">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Prioridades</h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
          Visualize os cards em desenvolvimento de cada pessoa da equipe
        </p>
      </div>

      {/* Tabs para alternar entre Dia e Semana */}
      <div className="flex gap-[8px] border-b border-[var(--color-border)]">
        <Button
          variant="ghost"
          onClick={() => setPeriodo('dia')}
          className={cn(
            "rounded-none border-b-2 border-transparent px-[16px] py-[8px] h-auto",
            periodo === 'dia'
              ? "border-[var(--color-primary)] text-[var(--color-primary)] font-semibold"
              : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          )}
        >
          Prioridades do Dia
        </Button>
        <Button
          variant="ghost"
          onClick={() => setPeriodo('semana')}
          className={cn(
            "rounded-none border-b-2 border-transparent px-[16px] py-[8px] h-auto",
            periodo === 'semana'
              ? "border-[var(--color-primary)] text-[var(--color-primary)] font-semibold"
              : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          )}
        >
          Prioridades da Semana
        </Button>
        {isSupervisor && periodo === 'semana' && (
          <div className="ml-auto flex items-center gap-[8px]">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfigDialogOpen(true)}
              className="h-auto p-[4px] text-xs"
            >
              <Settings className="h-[12px] w-[12px] mr-[4px]" />
              Configurar Horário
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenConfirmCloseWeek}
              disabled={closingWeek || semanaFechada}
              className="h-auto px-[12px] py-[4px] text-xs"
            >
              {closingWeek ? (
                <>
                  <Loader2 className="h-[12px] w-[12px] mr-[4px] animate-spin" />
                  Fechando...
                </>
              ) : (
                'Fechar Semana'
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenConfirmClearPriorities}
              disabled={clearingPriorities || !semanaFechada}
              className="h-auto px-[12px] py-[4px] text-xs"
            >
              {clearingPriorities ? (
                <>
                  <Loader2 className="h-[12px] w-[12px] mr-[4px] animate-spin" />
                  Redefinindo...
                </>
              ) : (
                'Redefinir Prioridades'
              )}
            </Button>
          </div>
        )}
      </div>

      {usersWithCards.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-[var(--color-muted-foreground)]">
            Nenhum usuário encontrado
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-[16px]">
          {usersWithCards.map((userData) => {
            // Separar cards em desenvolvimento dos concluídos
            const cardsEmDesenvolvimento = userData.cards.filter(card => !isCompleted(card.status));
            const cardsConcluidos = userData.cards.filter(card => isCompleted(card.status));
            const temCardsEmDesenvolvimento = cardsEmDesenvolvimento.length > 0;
            const temCards = userData.cards.length > 0;
            
            // Verificar se há prioridade semanal definida (mesmo que concluída)
            const temPrioridadeSemanal = periodo === 'semana' && userData.cards.some(card => card.weekly_priority);
            
            return (
              <Card key={userData.usuario.id} className="p-[16px] relative">
                {/* Botões de editar/excluir no canto superior direito do card - apenas quando há prioridades definidas e semana não está fechada */}
                {isSupervisor && periodo === 'semana' && temPrioridadeSemanal && !semanaFechada && (
                  <div className="absolute top-[8px] right-[8px] flex items-center gap-[2px] z-10">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDefinePriority(userData.usuario)}
                      className="h-[24px] w-[24px]"
                      title="Editar prioridades"
                    >
                      <Pencil className="h-[12px] w-[12px] text-[var(--color-muted-foreground)]" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPriorityToDelete({
                          userId: userData.usuario.id,
                          userName: getUserDisplayName(userData.usuario)
                        });
                        setDeletePriorityDialogOpen(true);
                      }}
                      className="h-[24px] w-[24px]"
                      title="Remover todas as prioridades"
                    >
                      <Trash2 className="h-[12px] w-[12px] text-red-500" />
                    </Button>
                  </div>
                )}
                {!temCards ? (
                  <div className="flex items-center gap-[12px]">
                    <Avatar className="h-[48px] w-[48px] shrink-0">
                      {userData.usuario.profile_picture_url ? (
                        <AvatarImage src={userData.usuario.profile_picture_url} alt={getUserDisplayName(userData.usuario)} />
                      ) : null}
                      <AvatarFallback className="text-sm bg-[var(--color-muted)]">
                        {getInitials(userData.usuario)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[var(--color-muted-foreground)] italic">
                        Nenhum card em desenvolvimento
                      </p>
                      {isSupervisor && periodo === 'semana' && !temPrioridadeSemanal && !semanaFechada && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDefinePriority(userData.usuario)}
                          className="mt-[8px] h-auto px-[12px] py-[6px] text-xs"
                        >
                          <Plus className="h-[12px] w-[12px] mr-[4px]" />
                          Definir Prioridade
                        </Button>
                      )}
                      {isSupervisor && periodo === 'semana' && temPrioridadeSemanal && !semanaFechada && (
                        <div className="flex items-center gap-[4px] mt-[8px]">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDefinePriority(userData.usuario)}
                            className="h-[24px] w-[24px]"
                            title="Editar prioridade"
                          >
                            <Pencil className="h-[12px] w-[12px] text-[var(--color-muted-foreground)]" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPriorityToDelete({
                                userId: userData.usuario.id,
                                userName: getUserDisplayName(userData.usuario)
                              });
                              setDeletePriorityDialogOpen(true);
                            }}
                            className="h-[24px] w-[24px]"
                            title="Remover prioridade"
                          >
                            <Trash2 className="h-[12px] w-[12px] text-red-500" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col">
                    <div className="flex items-center gap-[12px]">
                      {/* Foto do usuário - centralizada no card */}
                      <div>
                        <Avatar className="h-[48px] w-[48px] shrink-0">
                          {userData.usuario.profile_picture_url ? (
                            <AvatarImage src={userData.usuario.profile_picture_url} alt={getUserDisplayName(userData.usuario)} />
                          ) : null}
                          <AvatarFallback className="text-sm font-medium bg-[var(--color-muted)]">
                            {getInitials(userData.usuario)}
                          </AvatarFallback>
                        </Avatar>
                      </div>
                      
                      {/* Lista de texto com nomes dos cards e projetos */}
                      <div className="flex-1 space-y-[4px]">
                        {(() => {
                          // Quando a semana está fechada, mostrar todos os cards de prioridade (concluídos e não concluídos)
                          if (periodo === 'semana' && semanaFechada) {
                            // Filtrar apenas cards que são prioridades da semana
                            const cardsPrioridades = userData.cards.filter(card => card.weekly_priority);
                            
                            if (cardsPrioridades.length === 0) {
                              return (
                                <div className="min-h-[24px]">
                                  <p className="text-sm text-[var(--color-muted-foreground)] italic">
                                    Nenhuma prioridade definida
                                  </p>
                                </div>
                              );
                            }
                            
                            return cardsPrioridades.map((card) => {
                              const isConcluido = isCompleted(card.status);
                              const isNaoConcluido = !isConcluido;
                              
                              return (
                                <div
                                  key={card.id}
                                  className="min-h-[24px] flex items-start gap-[8px]"
                                >
                                  {isConcluido ? (
                                    <Check className="h-[16px] w-[16px] text-green-500 shrink-0 mt-[2px]" strokeWidth={3} />
                                  ) : (
                                    <X className="h-[16px] w-[16px] text-red-500 shrink-0 mt-[2px]" strokeWidth={3} />
                                  )}
                                  <div className="flex-1 min-w-0">
                                    <p 
                                      className={cn(
                                        "text-sm font-medium cursor-pointer hover:underline",
                                        isConcluido ? "text-green-500" : "text-red-500"
                                      )}
                                      onClick={() => handleCardClick(card.id)}
                                    >
                                      {card.nome}
                                    </p>
                                    {card.projeto_detail?.nome && (
                                      <p 
                                        className="text-xs text-[var(--color-muted-foreground)] cursor-pointer hover:underline"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (card.projeto) {
                                            navigate(`/projects/${card.projeto}`);
                                          }
                                        }}
                                      >
                                        {card.projeto_detail.nome}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              );
                            });
                          }
                          
                          // Comportamento normal (semana não fechada ou prioridades do dia)
                          if (!temCardsEmDesenvolvimento && !temPrioridadeSemanal) {
                            return (
                              <div className="min-h-[24px]">
                                <p className="text-sm text-[var(--color-muted-foreground)] italic">
                                  Nenhum card em desenvolvimento
                                </p>
                                {isSupervisor && periodo === 'semana' && !semanaFechada && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleDefinePriority(userData.usuario)}
                                    className="mt-[8px] h-auto px-[12px] py-[6px] text-xs"
                                  >
                                    <Plus className="h-[12px] w-[12px] mr-[4px]" />
                                    Definir Prioridade
                                  </Button>
                                )}
                              </div>
                            );
                          }
                          
                          // Ordenar e estilizar cards em desenvolvimento:
                          // 1) normais, 2) parados por pendências, 3) atrasados
                          const hoje = new Date();
                          hoje.setHours(0, 0, 0, 0);

                          const cardsNormais: CardData[] = [];
                          const cardsPendencias: CardData[] = [];
                          const cardsAtrasados: CardData[] = [];

                          cardsEmDesenvolvimento.forEach((card) => {
                            const statusNormalized = (card.status || '').toLowerCase();
                            const isPendencias = statusNormalized === 'parado_pendencias';

                            let isAtrasado = false;
                            if (periodo === 'semana') {
                              isAtrasado = !!card.weekly_priority?.is_atrasado;
                            } else {
                              if (card.data_fim && !isCompleted(card.status)) {
                                const dataFim = new Date(card.data_fim);
                                dataFim.setHours(0, 0, 0, 0);
                                isAtrasado = dataFim < hoje;
                              }
                            }

                            // Ordem de grupos:
                            // - normais
                            // - parados por pendências (mesmo que atrasados)
                            // - atrasados (sem pendências)
                            if (isPendencias) {
                              cardsPendencias.push(card);
                            } else if (isAtrasado) {
                              cardsAtrasados.push(card);
                            } else {
                              cardsNormais.push(card);
                            }
                          });

                          const orderedCards = [...cardsNormais, ...cardsPendencias, ...cardsAtrasados];

                          return orderedCards.map((card) => {
                            const statusNormalized = (card.status || '').toLowerCase();
                            const isPendencias = statusNormalized === 'parado_pendencias';

                            let isAtrasado = false;
                            if (periodo === 'semana') {
                              isAtrasado = !!card.weekly_priority?.is_atrasado;
                            } else {
                              if (card.data_fim && !isCompleted(card.status)) {
                                const dataFim = new Date(card.data_fim);
                                dataFim.setHours(0, 0, 0, 0);
                                isAtrasado = dataFim < hoje;
                              }
                            }

                            const icons: ReactElement[] = [];
                            if (isAtrasado) {
                              icons.push(
                                <AlertCircle
                                  key="atrasado"
                                  className="h-[16px] w-[16px] text-red-500 shrink-0 mt-[2px]"
                                  strokeWidth={2.5}
                                />
                              );
                            }
                            if (isPendencias) {
                              icons.push(
                                <AlertTriangle
                                  key="pendencias"
                                  className="h-[16px] w-[16px] text-amber-500 shrink-0 mt-[2px]"
                                  strokeWidth={2.5}
                                />
                              );
                            }

                            let textColorClass = "text-[var(--color-foreground)]";
                            if (isPendencias) {
                              // Quando está parado por pendências e atrasado, a cor de pendências prevalece
                              textColorClass = "text-amber-600";
                            } else if (isAtrasado) {
                              textColorClass = "text-red-500";
                            }

                            return (
                              <div
                                key={card.id}
                                className="min-h-[24px] flex items-start gap-[8px]"
                              >
                                {icons.length > 0 && (
                                  <div className="flex items-start gap-[2px]">
                                    {icons}
                                  </div>
                                )}
                                <div className="flex-1 min-w-0">
                                  <p
                                    className={cn(
                                      "text-sm font-medium cursor-pointer hover:underline",
                                      textColorClass
                                    )}
                                    onClick={() => handleCardClick(card.id)}
                                  >
                                    {card.nome}
                                  </p>
                                  {card.projeto_detail?.nome && (
                                    <p
                                      className="text-xs text-[var(--color-muted-foreground)] cursor-pointer hover:underline"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (card.projeto) {
                                          navigate(`/projects/${card.projeto}`);
                                        }
                                      }}
                                    >
                                      {card.projeto_detail.nome}
                                    </p>
                                  )}
                                </div>
                              </div>
                            );
                          });
                        })()}
                      </div>
                    </div>
                  </div>
                )}
                
                {/* Cards concluídos abaixo - seção separada que expande independentemente - sempre no final */}
                {periodo === 'dia' && (
                  <div className="mt-[8px] border-t border-[var(--color-border)] pt-[8px]">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (cardsConcluidos.length > 0) {
                          setSelectedUserForExpansion(userData.usuario);
                        }
                      }}
                      disabled={cardsConcluidos.length === 0}
                      className={cn(
                        "w-full flex items-center gap-[8px] text-sm transition-colors text-left",
                        cardsConcluidos.length > 0
                          ? "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] cursor-pointer"
                          : "text-[var(--color-muted-foreground)] opacity-50 cursor-not-allowed"
                      )}
                    >
                      <ChevronDown className="h-[16px] w-[16px] shrink-0" />
                      <span className="flex-1">
                        {cardsConcluidos.length} card{cardsConcluidos.length !== 1 ? 's' : ''} concluído{cardsConcluidos.length !== 1 ? 's' : ''} hoje{cardsConcluidos.length > 0 ? ', expanda para detalhes' : ''}
                      </span>
                    </button>
                  </div>
                )}
                
                {/* Cards concluídos da semana - seção separada que expande independentemente - sempre no final */}
                {/* Só mostrar se a semana NÃO estiver fechada */}
                {periodo === 'semana' && !semanaFechada && (() => {
                  // Filtrar apenas cards concluídos que são prioridades da semana
                  const cardsConcluidosPrioridades = cardsConcluidos.filter(card => card.weekly_priority);
                  return (
                    <div className="mt-[8px] border-t border-[var(--color-border)] pt-[8px]">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (cardsConcluidosPrioridades.length > 0) {
                            setSelectedUserForExpansion(userData.usuario);
                          }
                        }}
                        disabled={cardsConcluidosPrioridades.length === 0}
                        className={cn(
                          "w-full flex items-center gap-[8px] text-sm transition-colors text-left",
                          cardsConcluidosPrioridades.length > 0
                            ? "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] cursor-pointer"
                            : "text-[var(--color-muted-foreground)] opacity-50 cursor-not-allowed"
                        )}
                      >
                        <ChevronDown className="h-[16px] w-[16px] shrink-0" />
                        <span className="flex-1">
                          {cardsConcluidosPrioridades.length} card{cardsConcluidosPrioridades.length !== 1 ? 's' : ''} concluído{cardsConcluidosPrioridades.length !== 1 ? 's' : ''} da prioridade{cardsConcluidosPrioridades.length > 0 ? ', expanda para detalhes' : ''}
                        </span>
                      </button>
                    </div>
                  );
                })()}
              </Card>
            );
          })}
        </div>
      )}

      {/* Modal de Visualização do Card */}
      <Dialog open={viewCardDialogOpen} onOpenChange={(open) => {
        setViewCardDialogOpen(open);
        if (!open) {
          setSelectedCard(null);
        }
      }}>
        <DialogContent onClose={() => {
          setViewCardDialogOpen(false);
          setSelectedCard(null);
        }} className="max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Ver Card</DialogTitle>
            <DialogDescription>
              Visualize as informações do card (somente visualização)
            </DialogDescription>
          </DialogHeader>

          {cardLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-[var(--color-primary)]" />
            </div>
          ) : (
            <form className="space-y-[16px] mt-[16px] max-h-[70vh] overflow-y-auto pr-[8px]">
              <div className="space-y-[8px]">
                <Label htmlFor="card-nome">Nome do Card *</Label>
                <Input
                  id="card-nome"
                  placeholder="Ex: Certidões PE"
                  value={cardFormData.nome}
                  onChange={() => {}}
                  required
                  disabled={true}
                />
              </div>

              <div className="space-y-[8px]">
                <Label htmlFor="card-descricao">Descrição / Instruções</Label>
                <Textarea
                  id="card-descricao"
                  placeholder="Descreva o card, instruções detalhadas, requisitos, etc..."
                  value={cardFormData.descricao}
                  onChange={() => {}}
                  rows={4}
                  disabled={true}
                />
              </div>

              <div className="space-y-[8px] rounded-lg border border-[var(--color-border)] p-[12px]">
                <div className="space-y-[6px]">
                  <Label>Link do Script</Label>
                  {cardFormData.script_url ? (
                    <a
                      href={normalizeExternalUrl(cardFormData.script_url)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-[6px] rounded-md bg-[var(--color-accent)] px-[10px] py-[6px] text-sm text-[var(--color-primary)] underline underline-offset-2 hover:opacity-75 break-all"
                    >
                      <ExternalLink className="h-[13px] w-[13px] shrink-0" />
                      {cardFormData.script_url}
                    </a>
                  ) : (
                    <p className="text-xs text-[var(--color-muted-foreground)]">Sem script.</p>
                  )}
                </div>

                {selectedCard?.links && selectedCard.links.length > 0 && (
                  <>
                    <div className="border-t border-[var(--color-border)]" />
                    <div className="space-y-[6px]">
                      <Label>Links adicionais</Label>
                      <div className="space-y-[4px]">
                        {selectedCard.links.map((link, idx) => (
                          <a
                            key={idx}
                            href={normalizeExternalUrl(link.url)}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={link.url}
                            className="flex items-center gap-[6px] rounded-md bg-[var(--color-accent)] px-[10px] py-[6px] text-sm text-[var(--color-primary)] underline underline-offset-2 hover:opacity-75"
                          >
                            <ExternalLink className="h-[13px] w-[13px] shrink-0" />
                            <span className="flex-1 truncate">{link.label.trim() ? link.label : link.url}</span>
                          </a>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="grid grid-cols-2 gap-[16px]">
                <div className="space-y-[8px]">
                  <Label htmlFor="card-area">Área *</Label>
                  <select
                    id="card-area"
                    className="flex h-[40px] w-full rounded-[8px] border border-[var(--color-input)] bg-[var(--color-background)] px-[12px] py-[8px] text-sm ring-offset-[var(--color-background)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    value={cardFormData.area}
                    onChange={() => {}}
                    required
                    disabled={true}
                  >
                    {CARD_AREAS.map((area) => (
                      <option key={area.value} value={area.value}>{area.label}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-[8px]">
                  <Label htmlFor="card-tipo">Tipo *</Label>
                  <select
                    id="card-tipo"
                    className="flex h-[40px] w-full rounded-[8px] border border-[var(--color-input)] bg-[var(--color-background)] px-[12px] py-[8px] text-sm ring-offset-[var(--color-background)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    value={cardFormData.tipo}
                    onChange={() => {}}
                    required
                    disabled={true}
                  >
                    {CARD_TYPES.map((tipo) => (
                      <option key={tipo.value} value={tipo.value}>{tipo.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-[16px]">
                <div className="space-y-[8px]">
                  <Label htmlFor="card-prioridade">Prioridade *</Label>
                  <select
                    id="card-prioridade"
                    className="flex h-[40px] w-full rounded-[8px] border border-[var(--color-input)] bg-[var(--color-background)] px-[12px] py-[8px] text-sm ring-offset-[var(--color-background)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    value={cardFormData.prioridade}
                    onChange={() => {}}
                    required
                    disabled={true}
                  >
                    {CARD_PRIORITIES.map((prioridade) => (
                      <option key={prioridade.value} value={prioridade.value}>{prioridade.label}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-[8px]">
                  <Label htmlFor="card-status">Status *</Label>
                  <select
                    id="card-status"
                    className="flex h-[40px] w-full rounded-[8px] border border-[var(--color-input)] bg-[var(--color-background)] px-[12px] py-[8px] text-sm ring-offset-[var(--color-background)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    value={cardFormData.status}
                    onChange={() => {}}
                    required
                    disabled={true}
                  >
                    {CARD_STATUSES.map((status) => (
                      <option key={status.value} value={status.value}>{status.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-[8px]">
                <Label htmlFor="card-responsavel">Responsável</Label>
                <UserSelect
                  users={users}
                  value={cardFormData.responsavel || ''}
                  onChange={() => {}}
                  disabled={true}
                  placeholder="Selecione um responsável"
                />
              </div>

              <div className="grid grid-cols-2 gap-[16px]">
                <div className="space-y-[8px]">
                  <Label htmlFor="card-data_inicio">Data e Hora de Início</Label>
                  <DateTimePicker
                    id="card-data_inicio"
                    value={cardFormData.data_inicio}
                    onChange={() => {}}
                    disabled={true}
                  />
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    Preenchida automaticamente com a data e hora atual
                  </p>
                </div>

                <div className="space-y-[8px]">
                  <Label htmlFor="card-data_fim">Data e Hora de Entrega</Label>
                  <DateTimePicker
                    id="card-data_fim"
                    value={cardFormData.data_fim}
                    onChange={() => {}}
                    disabled={true}
                  />
                </div>
              </div>

              <DialogFooter>
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => {
                    setViewCardDialogOpen(false);
                    setSelectedCard(null);
                  }}
                >
                  Fechar
                </Button>
                {selectedCard?.projeto && (
                  <Button 
                    type="button"
                    onClick={() => {
                      setViewCardDialogOpen(false);
                      navigate(`/projects/${selectedCard.projeto}`);
                    }}
                  >
                    Ir para Projeto
                  </Button>
                )}
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal para definir prioridade da semana */}
      {isSupervisor && periodo === 'semana' && (
        <Dialog open={definePriorityDialogOpen} onOpenChange={setDefinePriorityDialogOpen}>
          <DialogContent className="max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Definir Prioridade da Semana</DialogTitle>
              <DialogDescription>
                Selecione quantos cards quiser como prioridades da semana para {selectedUserForPriority?.username || 'o usuário'}. Você pode selecionar múltiplos cards clicando em cada um deles.
              </DialogDescription>
            </DialogHeader>

            {loadingCards ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-[var(--color-primary)]" />
              </div>
            ) : (
              <div className="space-y-[16px] mt-[16px] max-h-[60vh] overflow-y-auto">
                {availableCards.length === 0 ? (
                  <p className="text-sm text-[var(--color-muted-foreground)] text-center py-4">
                    Nenhum card disponível para este usuário
                  </p>
                ) : (
                  <>
                    {selectedCardsForPriority.length > 0 && (
                      <p className="text-sm text-[var(--color-muted-foreground)] mb-[8px]">
                        {selectedCardsForPriority.length} card(s) selecionado(s)
                      </p>
                    )}
                    <div className="space-y-[8px] max-h-[50vh] overflow-y-auto">
                      {availableCards.map((card) => {
                      const isSelected = selectedCardsForPriority.some(c => c.id === card.id);
                      return (
                        <div
                          key={card.id}
                          className={cn(
                            "p-[12px] rounded-[8px] border cursor-pointer transition-colors",
                            isSelected
                              ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10"
                              : "border-[var(--color-border)] hover:bg-[var(--color-accent)]"
                          )}
                          onClick={() => {
                            if (isSelected) {
                              // Remover da seleção
                              setSelectedCardsForPriority(prev => prev.filter(c => c.id !== card.id));
                            } else {
                              // Adicionar à seleção
                              setSelectedCardsForPriority(prev => [...prev, card]);
                            }
                          }}
                        >
                          <div className="flex items-center gap-[8px]">
                            <div className={cn(
                              "h-[16px] w-[16px] rounded border-2 flex items-center justify-center transition-colors",
                              isSelected
                                ? "border-[var(--color-primary)] bg-[var(--color-primary)]"
                                : "border-[var(--color-border)]"
                            )}>
                              {isSelected && (
                                <Check className="h-[12px] w-[12px] text-white" strokeWidth={3} />
                              )}
                            </div>
                            <div className="flex-1">
                              <p className="text-sm font-medium text-[var(--color-foreground)]">
                                {card.nome}
                              </p>
                              {card.projeto && (
                                <p className="text-xs text-[var(--color-muted-foreground)] mt-[4px]">
                                  Projeto: {card.projeto_detail?.nome || card.projeto}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    </div>
                  </>
                )}
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setDefinePriorityDialogOpen(false);
                  setSelectedUserForPriority(null);
                  setSelectedCardsForPriority([]);
                }}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={handleSavePriority}
                disabled={savingPriority}
              >
                {savingPriority ? (
                  <>
                    <Loader2 className="mr-[8px] h-[16px] w-[16px] animate-spin" />
                    Salvando...
                  </>
                ) : (
                  'Salvar'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Modal para configurar horário limite */}
      {isSupervisor && periodo === 'semana' && (
        <Dialog open={configDialogOpen} onOpenChange={setConfigDialogOpen}>
          <DialogContent className="max-w-[400px]">
            <DialogHeader>
              <DialogTitle>Configurar Horário Limite</DialogTitle>
              <DialogDescription>
                Esta hora é usada nas prioridades da semana (incluindo marcar atrasos na sexta). O{' '}
                <strong>fechamento automático de cada sprint</strong> usa a data e hora definidas na própria sprint (
                <code className="text-xs">fechamento_em</code>), não este horário.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-[16px] mt-[16px]">
              <div className="space-y-[8px]">
                <Label htmlFor="horario-limite">Horário limite (prioridades da semana)</Label>
                <Input
                  id="horario-limite"
                  type="time"
                  value={config.horario_limite.substring(0, 5)} // HH:MM
                  onChange={(e) => {
                    const time = e.target.value + ':00'; // Adicionar segundos
                    setConfig({ ...config, horario_limite: time });
                  }}
                />
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  Cards não concluídos até este horário na sexta-feira podem ser marcados como atrasados no fluxo semanal.
                </p>
              </div>
              
              <div className="space-y-[8px]">
                <div className="flex items-center gap-[8px]">
                  <input
                    type="checkbox"
                    id="fechamento-automatico"
                    checked={config.fechamento_automatico}
                    onChange={(e) => {
                      setConfig({ ...config, fechamento_automatico: e.target.checked });
                    }}
                    className="h-[16px] w-[16px] rounded border-[var(--color-input)]"
                  />
                  <Label htmlFor="fechamento-automatico" className="cursor-pointer">
                    Fechamento Automático
                  </Label>
                </div>
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  Se habilitado, a semana de prioridades é encerrada automaticamente ao chegar no horário limite na sexta-feira.
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfigDialogOpen(false)}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={handleSaveConfig}
                disabled={savingConfig}
              >
                {savingConfig ? (
                  <>
                    <Loader2 className="mr-[8px] h-[16px] w-[16px] animate-spin" />
                    Salvando...
                  </>
                ) : (
                  'Salvar'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Modal de confirmação de exclusão de prioridade */}
      {isSupervisor && periodo === 'semana' && (
        <Dialog open={deletePriorityDialogOpen} onOpenChange={setDeletePriorityDialogOpen}>
          <DialogContent onClose={() => {
            setDeletePriorityDialogOpen(false);
            setPriorityToDelete(null);
          }}>
            <DialogHeader>
              <DialogTitle>Confirmar Exclusão</DialogTitle>
              <DialogDescription>
                {priorityToDelete
                  ? `Tem certeza que deseja remover todas as prioridades da semana para ${priorityToDelete.userName}? Esta ação não pode ser desfeita.`
                  : 'Tem certeza que deseja remover todas as prioridades da semana? Esta ação não pode ser desfeita.'}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setDeletePriorityDialogOpen(false);
                  setPriorityToDelete(null);
                }}
                disabled={deletePriorityLoading}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={confirmDeletePriority}
                disabled={deletePriorityLoading}
              >
                {deletePriorityLoading ? (
                  <>
                    <Loader2 className="mr-[8px] h-[16px] w-[16px] animate-spin" />
                    Excluindo...
                  </>
                ) : (
                  'Excluir'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Modal de Sucesso */}
      <Dialog open={successModalOpen} onOpenChange={setSuccessModalOpen}>
        <DialogContent onClose={() => setSuccessModalOpen(false)}>
          <DialogHeader>
            <DialogTitle>Sucesso</DialogTitle>
            <DialogDescription>
              {successMessage}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSuccessModalOpen(false)}
            >
              OK
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de Erro */}
      <Dialog open={errorModalOpen} onOpenChange={setErrorModalOpen}>
        <DialogContent onClose={() => setErrorModalOpen(false)}>
          <DialogHeader>
            <DialogTitle>Erro</DialogTitle>
            <DialogDescription>
              {errorMessage}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setErrorModalOpen(false)}
            >
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de Confirmação - Fechar Semana */}
      <Dialog open={confirmCloseWeekOpen} onOpenChange={setConfirmCloseWeekOpen}>
        <DialogContent onClose={() => setConfirmCloseWeekOpen(false)}>
          <DialogHeader>
            <DialogTitle>Confirmar Fechamento da Semana</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja fechar a semana? Todos os cards não concluídos aparecerão em vermelho.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmCloseWeekOpen(false)}
              disabled={closingWeek}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleCloseWeek}
              disabled={closingWeek}
            >
              {closingWeek ? (
                <>
                  <Loader2 className="mr-[8px] h-[16px] w-[16px] animate-spin" />
                  Fechando...
                </>
              ) : (
                'Confirmar'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de Confirmação - Redefinir Prioridades */}
      <Dialog open={confirmClearPrioritiesOpen} onOpenChange={setConfirmClearPrioritiesOpen}>
        <DialogContent onClose={() => setConfirmClearPrioritiesOpen(false)}>
          <DialogHeader>
            <DialogTitle>Confirmar Redefinição de Prioridades</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja redefinir todas as prioridades da semana? Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmClearPrioritiesOpen(false)}
              disabled={clearingPriorities}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleClearPriorities}
              disabled={clearingPriorities}
            >
              {clearingPriorities ? (
                <>
                  <Loader2 className="mr-[8px] h-[16px] w-[16px] animate-spin" />
                  Redefinindo...
                </>
              ) : (
                'Confirmar'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal para expandir cards concluídos */}
      {selectedUserForExpansion && (
        <Dialog open={!!selectedUserForExpansion} onOpenChange={(open) => {
          if (!open) {
            setSelectedUserForExpansion(null);
          }
        }}>
          <DialogContent className="max-w-[600px] max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                Cards Concluídos - {getUserDisplayName(selectedUserForExpansion)}
              </DialogTitle>
              <DialogDescription>
                {(() => {
                  const userCards = usersWithCards.find(u => u.usuario.id === selectedUserForExpansion.id);
                  if (!userCards) return '';
                  
                  if (periodo === 'dia') {
                    const concluidos = userCards.cards.filter(card => isCompleted(card.status)) || [];
                    return `${concluidos.length} card${concluidos.length !== 1 ? 's' : ''} concluído${concluidos.length !== 1 ? 's' : ''} hoje`;
                  } else {
                    // Para semana, filtrar apenas os que são prioridades da semana
                    const concluidos = userCards.cards.filter(card => isCompleted(card.status) && card.weekly_priority) || [];
                    return `${concluidos.length} card${concluidos.length !== 1 ? 's' : ''} concluído${concluidos.length !== 1 ? 's' : ''} da prioridade`;
                  }
                })()}
              </DialogDescription>
            </DialogHeader>
            <div className="mt-[16px] space-y-[12px]">
              {(() => {
                const userCards = usersWithCards.find(u => u.usuario.id === selectedUserForExpansion.id);
                if (!userCards) return null;
                
                let concluidos: CardData[];
                if (periodo === 'dia') {
                  concluidos = userCards.cards.filter(card => isCompleted(card.status)) || [];
                } else {
                  // Para semana, filtrar apenas os que são prioridades da semana
                  concluidos = userCards.cards.filter(card => isCompleted(card.status) && card.weekly_priority) || [];
                }
                
                if (concluidos.length === 0) {
                  return (
                    <p className="text-sm text-[var(--color-muted-foreground)] text-center py-4">
                      Nenhum card concluído encontrado
                    </p>
                  );
                }
                
                return concluidos.map((card) => (
                  <div
                    key={card.id}
                    className="p-[12px] rounded-[8px] border border-[var(--color-border)] bg-[var(--color-card)] hover:bg-[var(--color-accent)] transition-colors cursor-pointer"
                    onClick={() => handleCardClick(card.id)}
                  >
                    <div className="flex items-start gap-[8px]">
                      <Check className="h-[16px] w-[16px] text-green-500 shrink-0 mt-[2px]" strokeWidth={3} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-green-500">
                          {card.nome}
                        </p>
                        {card.projeto_detail?.nome && (
                          <p className="text-xs text-[var(--color-muted-foreground)] mt-[4px]">
                            {card.projeto_detail.nome}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ));
              })()}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setSelectedUserForExpansion(null)}
              >
                Fechar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
