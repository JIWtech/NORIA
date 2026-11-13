-- Salon v15 (sobre v14). Teste real de 13/11/2026: ao mandar a lista de serviços, a IA escrevia "basta pedir a lista oficial"
-- com a lista já anexada logo abaixo. A regra do v14 ("peça a lista oficial conforme as regras do sistema") foi lida como
-- instrução para a cliente. Agora a abertura apresenta a lista que vem logo abaixo, sem pedir que a pessoa a solicite.
-- Guarda: só aplica sobre a revisão v14 exata e com o trecho intacto. Rollback: 23_..._rollback.sql
begin;

update public.tenant_settings s
set settings = s.settings || jsonb_build_object(
    'system_prompt', replace(s.settings->>'system_prompt',
      'escreva só uma frase curta de abertura e peça a lista oficial conforme as regras do sistema; nunca escreva a lista você mesma e nunca escolha só alguns exemplos.',
      'escreva só uma frase curta que apresente a lista, porque o sistema a anexa logo abaixo, na mesma mensagem, conforme as regras do sistema. Nunca diga para a pessoa pedir a lista, nunca escreva a lista você mesma e nunca escolha só alguns exemplos.'),
    'prompt_revision', 'ic_salon_recepcao_v15_abertura_lista',
    -- Cópia literal da v14 para o rollback restaurar sem depender de replace inverso.
    'system_prompt_v14_backup', s.settings->>'system_prompt'
  ), updated_at = now()
where s.tenant_id = '76aff8a0-0466-42b9-a80d-db186ff3d8bd'::uuid
  and exists (select 1 from public.tenants t where t.id = s.tenant_id and t.slug = 'ic_salon')
  and s.settings->>'prompt_revision' = 'ic_salon_recepcao_v14_primeira_mensagem'
  and strpos(s.settings->>'system_prompt', 'escreva só uma frase curta de abertura e peça a lista oficial conforme as regras do sistema; nunca escreva a lista você mesma e nunca escolha só alguns exemplos.') > 0;

commit;
