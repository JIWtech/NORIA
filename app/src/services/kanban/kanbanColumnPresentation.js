import {
  Bot, CalendarCheck, CalendarDays, CalendarX2, CarFront, CheckCircle2, CircleDollarSign, Clock3, Flame, Inbox,
  MessageCircle, Sparkles, UserRound, Wrench,
} from 'lucide-react';
import { STAGE_TONES } from './stageTone.js';

// Nome do símbolo guardado em kanban_columns.icon -> componente que o desenha. É só tradução técnica:
// quem decide o símbolo de cada coluna é o banco (migração 032). A lista é a mesma do check da coluna.
export const COLUMN_ICONS = Object.freeze({
  bot: Bot,
  'user-round': UserRound,
  'message-circle': MessageCircle,
  clock: Clock3,
  'calendar-days': CalendarDays,
  'calendar-check': CalendarCheck,
  'calendar-x': CalendarX2,
  'circle-dollar': CircleDollarSign,
  'check-circle': CheckCircle2,
  sparkles: Sparkles,
  flame: Flame,
  'car-front': CarFront,
  wrench: Wrench,
  inbox: Inbox,
});

const OWNER_ROLES = new Set(['ai', 'human', 'neutral']);

// Aparência de uma coluna, lida só dos dados dela (kanban_columns). Sem dado, o padrão é neutro.
// Usado pelo Kanban, pela lista de conversas e pelo cabeçalho da conversa.
export function kanbanColumnPresentation(column = {}) {
  const title = column.title || column.name || 'Etapa';
  return {
    title,
    Icon: COLUMN_ICONS[column.icon] || Inbox,
    tone: Object.prototype.hasOwnProperty.call(STAGE_TONES, column.tone) ? column.tone : 'slate',
    ownerRole: OWNER_ROLES.has(column.ownerRole) ? column.ownerRole : 'neutral',
    shortLabel: column.shortLabel || title,
    description: column.description || 'Conversas nesta etapa.',
  };
}
