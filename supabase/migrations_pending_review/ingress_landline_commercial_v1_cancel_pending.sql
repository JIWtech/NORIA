-- Uma vez, junto com ingress_landline_commercial_v1.sql: cancela follow-ups ainda pendentes para telefones fixos
-- (avisos automáticos de banco/fintech). Em 27/10/2026 eram 4 jobs "15d" da Gênesis (5511…8976, …8977, …8975, …9102).
-- Não envia nada, não apaga linhas: só muda status para cancelled com o motivo registrado.
update public.follow_up_jobs j
set status = 'cancelled', updated_at = now(), error = 'commercial_number'
from public.tenants t
where t.id = j.tenant_id and t.slug = 'wesley_automoveis'
  and j.status = 'pending'
  and j.external_conversation_id like '%@s.whatsapp.net'
  and split_part(j.external_conversation_id, '@', 1) ~ '^55[1-9][1-9][2-5][0-9]{7}$'
returning j.id, j.step_key, j.due_at;
