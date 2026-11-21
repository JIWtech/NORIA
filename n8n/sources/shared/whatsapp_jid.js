function phoneFromJid(jid, minimumLength = 10, missing = null) {
  const match = /^(\d{8,15})(?::\d+)?@s\.whatsapp\.net$/.exec(String(jid || ''));
  return match && match[1].length >= minimumLength ? match[1] : missing;
}

function normalizeWhatsappHandle(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  const bare = raw.replace(/:(\d+)(?=@)/, '');
  if (/@lid$/i.test(bare)) return bare;
  const digits = bare.replace(/@(s\.whatsapp\.net|c\.us)$/i, '').replace(/\D/g, '');
  return digits.length >= 8 ? `${digits}@s.whatsapp.net` : bare;
}
