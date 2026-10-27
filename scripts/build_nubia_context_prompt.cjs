// Gera propostas de atualização/rollback de DADO. Nunca conecta ao banco.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const before = fs.readFileSync(path.join(root, 'clients/clinica_nubia_oficial/prompts/system_prompt_contract_alignment_v5.txt'), 'utf8');
const after = fs.readFileSync(path.join(root, 'clients/clinica_nubia_oficial/prompts/system_prompt_context_v6.txt'), 'utf8');
const digest = text => crypto.createHash('md5').update(text).digest('hex');
function sql(text, expected, revision) {
  if (text.includes('$context_prompt$')) throw Error('DELIMITER_COLLISION');
  return `-- PROPOSTA LOCAL: não executar sem autorização. Somente dado de prompt, sem schema.
begin;
do $update_prompt$
declare affected integer;
begin
  update public.tenant_settings s set settings=jsonb_set(jsonb_set(s.settings,'{system_prompt}',to_jsonb($context_prompt$${text}$context_prompt$::text)),'{prompt_revision}',to_jsonb('${revision}'::text))
  from public.tenants t where t.id=s.tenant_id and t.slug='clinica_nubia_oficial' and md5(s.settings->>'system_prompt')='${expected}';
  get diagnostics affected = row_count;
  if affected<>1 then raise exception 'NUBIA_PROMPT_DRIFT_OR_SCOPE_MISMATCH'; end if;
end $update_prompt$;
commit;
`;
}
const out = path.join(root, 'supabase/migrations_pending_review');
fs.writeFileSync(path.join(out, 'nubia_context_prompt_v6.sql'), sql(after, digest(before), 'nubia-2026-10-27-session-context-v6'));
fs.writeFileSync(path.join(out, 'nubia_context_prompt_v6_rollback.sql'), sql(before, digest(after), 'nubia-2026-10-23-contract-alignment-v5'));
console.log('Propostas de prompt geradas; nenhuma conexão ou alteração de banco.');
