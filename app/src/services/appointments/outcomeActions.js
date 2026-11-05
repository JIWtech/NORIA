import { createClient } from '@supabase/supabase-js';
import { getAuthClient } from '../auth/authService.js';
import { hasSupabaseConfig } from '../tenants/tenantStorage.js';
import { findTenantBySlug } from '../tenants/tenantDataReads.js';
import { createLoadDepositRequired, createMarkAppointmentOutcome } from './appointmentOutcome.js';

// Ações de desfecho de agendamento ligadas ao Supabase. Ficam fora de dataService.js de propósito:
// os testes de arquitetura fixam a lista de exports daquela fachada, e este recurso é opcional por tenant.
const runtimeEnv = (typeof import.meta !== 'undefined' && import.meta.env) || {};
const supabaseUrl = runtimeEnv.VITE_SUPABASE_URL || '';
const supabaseAnonKey = runtimeEnv.VITE_SUPABASE_ANON_KEY || '';

function getClient() {
  if (!hasSupabaseConfig(supabaseUrl, supabaseAnonKey)) return null;
  return getAuthClient() || createClient(supabaseUrl, supabaseAnonKey);
}

async function loadTenant(activeTenantSlug) {
  return findTenantBySlug(getClient(), activeTenantSlug);
}

export const markAppointmentOutcome = createMarkAppointmentOutcome({ getClient });
export const loadDepositRequired = createLoadDepositRequired({ getClient, loadTenant });
