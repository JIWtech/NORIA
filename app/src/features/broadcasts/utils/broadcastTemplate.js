// Mesma regra do worker do servidor (n8n/code/broadcast_campaign_worker.js, bloco broadcast_template);
// scripts/test_broadcast_message_features.cjs garante que as duas implementações dão o mesmo texto.
// Renderização técnica do modelo: {nome} ou {{nome}} vira o primeiro nome do contato. Sem nome
// utilizável (vazio, telefone, JID ou o rótulo genérico), a variável sai junto com a pontuação colada.
const BROADCAST_NAME_TOKEN = /\{\{\s*nome\s*\}\}|\{\s*nome\s*\}/.source;
const BROADCAST_NAME_ANY = new RegExp('(?:' + BROADCAST_NAME_TOKEN + ')', 'giu');
const BROADCAST_NAME_SENTENCE_START = new RegExp(/(^|[.!?]\s+)/.source + '(?:' + BROADCAST_NAME_TOKEN + ')' + /\s*[,;:]?\s*(\S)/.source, 'giu');
const BROADCAST_NAME_INLINE = new RegExp(/\s*/.source + '(?:' + BROADCAST_NAME_TOKEN + ')', 'giu');
export function broadcastFirstName(value) {
  const name = String(value || '').trim();
  if (!name || name.includes('@') || /^\+?[\d\s().-]+$/.test(name) || name.toLowerCase() === 'contato') return '';
  const first = name.split(/\s+/)[0];
  return first.charAt(0).toLocaleUpperCase('pt-BR') + first.slice(1);
}
export function renderBroadcastMessage(template, contactName) {
  const text = String(template || '');
  const name = broadcastFirstName(contactName);
  if (name) return text.replace(BROADCAST_NAME_ANY, name).trim();
  return text
    .replace(BROADCAST_NAME_SENTENCE_START, (_, start, next) => start + next.toLocaleUpperCase('pt-BR'))
    .replace(BROADCAST_NAME_INLINE, '')
    .trim();
}
