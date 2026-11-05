import { createClient } from '@supabase/supabase-js';
import { clearMediaUrlCache } from '../media/mediaUrlService.js';

const runtimeEnv = (typeof import.meta !== 'undefined' && import.meta.env) || {};
const supabaseUrl = runtimeEnv.VITE_SUPABASE_URL || '';
const supabaseAnonKey = runtimeEnv.VITE_SUPABASE_ANON_KEY || '';
const configuredRequireAuth = runtimeEnv.VITE_REQUIRE_AUTH;
const requireAuth = configuredRequireAuth === undefined
  ? runtimeEnv.MODE === 'production'
  : String(configuredRequireAuth).toLowerCase() === 'true';

let client = null;
let mediaSessionUserId;

function synchronizeMediaSession(session, event) {
  const userId = session?.user?.id || null;
  if (event === 'SIGNED_OUT' || userId !== mediaSessionUserId) clearMediaUrlCache();
  mediaSessionUserId = userId;
}

export function isAuthRequired() {
  return requireAuth;
}

export function hasAuthConfig() {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

export function getAuthClient() {
  if (!hasAuthConfig()) return null;
  if (!client) {
    client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}

export async function getCurrentSession() {
  const supabase = getAuthClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  synchronizeMediaSession(data.session);
  return data.session || null;
}

// getSession() trusts the locally cached token. When the server-side session was
// revoked or removed (Auth reports session_not_found), that token still looks
// valid locally but is rejected by every protected endpoint. Validate against
// Auth, try one refresh, and only then report the session as gone.
export async function getValidatedSession({ forceRefresh = false } = {}) {
  const supabase = getAuthClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  let session = data.session || null;
  synchronizeMediaSession(session);
  if (!session) return null;
  if (!forceRefresh) {
    const { error } = await supabase.auth.getUser(session.access_token);
    if (!error) return session;
  }
  const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
  if (!refreshError && refreshed?.session?.access_token) {
    const { error } = await supabase.auth.getUser(refreshed.session.access_token);
    if (!error) return refreshed.session;
  }
  // The server no longer knows this session: clear local state so the UI
  // returns to sign-in instead of repeating a rejected request.
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
  synchronizeMediaSession(null, 'SIGNED_OUT');
  return null;
}

export function subscribeToAuthState(callback) {
  const supabase = getAuthClient();
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    synchronizeMediaSession(session, event);
    callback(session, event);
  });
  return () => data.subscription.unsubscribe();
}

export async function signInWithPassword(email, password) {
  const supabase = getAuthClient();
  if (!supabase) throw new Error('Supabase Auth nao configurado');
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  synchronizeMediaSession(data.session);
  return data.session;
}

export async function signUpWithPassword(email, password) {
  const supabase = getAuthClient();
  if (!supabase) throw new Error('Supabase Auth nao configurado');
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

export async function createTenantOnboarding({
  companyName,
  segment = 'general_services',
  tone = 'consultative',
  businessFacts = '',
  catalogHighlights = '',
  customRules = '',
  systemPrompt = null,
}) {
  const supabase = getAuthClient();
  if (!supabase) throw new Error('Supabase Auth nao configurado');
  const { data, error } = await supabase.rpc('magia_create_tenant_onboarding', {
    p_company_name: companyName,
    p_segment: segment,
    p_tone: tone,
    p_business_facts: businessFacts,
    p_catalog_highlights: catalogHighlights,
    p_custom_rules: customRules,
    p_system_prompt: systemPrompt,
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  synchronizeMediaSession(null, 'SIGNED_OUT');
  const supabase = getAuthClient();
  if (!supabase) return;
  await supabase.auth.signOut();
}
