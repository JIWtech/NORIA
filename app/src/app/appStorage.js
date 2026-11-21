import { isAuthRequired } from '../services/auth/authService.js';
import { emptyFunnel, emptyKanban, hasSupabaseConfig } from '../dataService.js';
import { conversations, funnelStages, kanbanColumns } from '../services/clientData/mockData.js';

export const activePageStorageKey = 'magia:active-page';
export const appDataCachePrefix = 'magia:app-data:';
export const sessionBootstrappedKey = 'noria:session-bootstrapped';
const APP_DATA_CACHE_TTL_MS = 15 * 60 * 1000;

export const DEFAULT_ACTIVE_PAGES = [
  'dashboard',
  'conversas',
  'kanban',
  'disparos',
  'agendamentos',
  'configuracoes',
];

export function isSessionBootstrapped() {
  try {
    return typeof window !== 'undefined' && window.sessionStorage?.getItem(sessionBootstrappedKey) === '1';
  } catch (e) {
    return false;
  }
}

export function setSessionBootstrapped() {
  try {
    if (typeof window !== 'undefined') {
      window.sessionStorage?.setItem(sessionBootstrappedKey, '1');
    }
  } catch (e) {}
}

export function clearSessionBootstrapped() {
  try {
    if (typeof window !== 'undefined') {
      window.sessionStorage?.removeItem(sessionBootstrappedKey);
    }
  } catch (e) {}
}

export function getInitialActivePage(menuList = null) {
  try {
    const stored = typeof window !== 'undefined' ? localStorage.getItem(activePageStorageKey) : null;
    if (Array.isArray(menuList)) {
      return menuList.some((item) => item?.id === stored) ? stored : 'dashboard';
    }
    return DEFAULT_ACTIVE_PAGES.includes(stored) ? stored : 'dashboard';
  } catch {
    return 'dashboard';
  }
}

export function appDataSignature(value) {
  return JSON.stringify(value, (key, entry) => (
    key === 'url' || key === 'thumbnailUrl' ? undefined : entry
  ));
}

export function loadCachedAppData(tenantSlug, userId = null) {
  if (isAuthRequired() && !userId) return null;
  const userPrefix = userId ? `${userId}:` : '';
  const key = `${appDataCachePrefix}${userPrefix}${tenantSlug}`;
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(key) : null;
    const cached = raw ? JSON.parse(raw) : null;
    const age = Date.now() - cached?.cached_at;
    return Array.isArray(cached?.conversations) && Number.isFinite(age) && age >= 0 && age <= APP_DATA_CACHE_TTL_MS
      ? { ...cached, source: 'cache' } : null;
  } catch {
    return null;
  }
}

export function cacheAppData(tenantSlug, data, userId = null) {
  if (isAuthRequired() && !userId) return;
  const userPrefix = userId ? `${userId}:` : '';
  const key = `${appDataCachePrefix}${userPrefix}${tenantSlug}`;
  try {
    const serialized = JSON.stringify({ ...data, cached_at: Date.now() }, (key, value) => {
      if (['url', 'thumbnailUrl', 'raw_payload', 'payload'].includes(key)) return undefined;
      if (key === 'text' && typeof value === 'string') return value.slice(0, 500);
      return value;
    });
    if (serialized.length <= 2_000_000 && typeof window !== 'undefined') {
      localStorage.setItem(key, serialized);
    }
  } catch {
    // Cache local é opcional: quota cheia nunca deve afetar o painel.
  }
}

export function clearAppDataCache() {
  try {
    if (typeof window === 'undefined') return;
    const keys = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(appDataCachePrefix)) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  } catch {
    // O armazenamento local pode estar indisponível.
  }
}

export function createEmptyAppData() {
  return {
    conversations: [],
    kanbanColumns: emptyKanban(),
    funnelStages: emptyFunnel(),
    source: 'supabase',
    status: {
      source: 'supabase',
      botUsername: '',
      channel: '',
      supabase: true,
      ai: 'Regras e automações',
      latestAt: 'Sincronizando...',
      humanQueue: 0,
    },
    appointments: [],
    broadcastContacts: [],
    broadcastCampaigns: [],
    conversationReads: [],
    enabledChannels: [],
    resourceErrors: [],
    tenantId: null,
  };
}

export function getInitialAppData(tenantSlug) {
  const cached = loadCachedAppData(tenantSlug);
  if (cached) return { data: cached, ready: true };
  if (hasSupabaseConfig()) {
    return {
      data: createEmptyAppData(),
      ready: false,
    };
  }
  return {
    data: {
      conversations,
      kanbanColumns,
      funnelStages,
      source: 'mock',
      status: null,
      appointments: [],
      broadcastContacts: [],
      broadcastCampaigns: [],
      conversationReads: [],
      enabledChannels: [],
      resourceErrors: [],
      tenantId: null,
    },
    ready: true,
  };
}
