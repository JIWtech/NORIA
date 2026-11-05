-- Onboarding cria um workspace configurável. A automação só é habilitada após configurar a EXT/canal.
-- Versão confirmada no histórico remoto: 20261024143855.
-- Substitui a proposta 029, que copiava perfil e funil de um cliente e habilitava IA sem canal validado.
begin;
create or replace function public.magia_create_tenant_onboarding(
  p_company_name text, p_segment text default 'general_services',
  p_tone text default 'consultative', p_business_facts text default '',
  p_catalog_highlights text default '', p_custom_rules text default '', p_system_prompt text default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  actor uuid:=auth.uid(); actor_email text; tenant uuid; board uuid; channel uuid;
  company text:=btrim(coalesce(p_company_name,'')); slug_base text; slug_value text; prompt text;
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if length(company)<2 or length(company)>160 then raise exception 'INVALID_COMPANY_NAME'; end if;
  if length(coalesce(p_business_facts,''))>20000 or length(coalesce(p_catalog_highlights,''))>20000
    or length(coalesce(p_custom_rules,''))>20000 or length(coalesce(p_system_prompt,''))>40000
    or length(coalesce(p_segment,''))>80 or length(coalesce(p_tone,''))>80 then
    raise exception 'ONBOARDING_INPUT_TOO_LARGE';
  end if;
  select email into actor_email from auth.users where id=actor;
  if not found then raise exception 'AUTH_USER_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
  -- Duplo clique/retry do mesmo proprietário não cria empresas duplicadas.
  select t.id,t.slug into tenant,slug_value from public.tenants t
    join public.tenant_members tm on tm.tenant_id=t.id
    where tm.user_id=actor and tm.role='owner' and tm.status='active'
      and t.deleted_at is null and lower(t.name)=lower(company)
    order by t.created_at limit 1;
  if tenant is null then
    slug_base:=btrim(lower(regexp_replace(company,'[^a-zA-Z0-9]+','_','g')),'_');
    if slug_base='' then slug_base:='empresa'; end if;
    slug_value:=slug_base||'_'||substr(replace(gen_random_uuid()::text,'-',''),1,10);
    insert into public.tenants(name,slug,industry,plan,status)
      values(company,slug_value,coalesce(nullif(p_segment,''),'general_services'),'mvp','active') returning id into tenant;
    insert into public.tenant_members(tenant_id,user_id,email,role,status)
      values(tenant,actor,actor_email,'owner','active');
    insert into public.kanban_boards(tenant_id,name,is_default)
      values(tenant,'Atendimento',true) returning id into board;
    insert into public.kanban_columns(tenant_id,board_id,name,position,automation_key) values
      (tenant,board,'Conversas IA',0,'conversas_ia'),
      (tenant,board,'Aguardando humano',1,'aguardando_humano'),
      (tenant,board,'Atendimento humano',2,'com_humano'),
      (tenant,board,'Finalizadas',3,'finalizadas');
    insert into public.channels(tenant_id,type,name,status,config)
      values(tenant,'whatsapp','WhatsApp','pending',jsonb_build_object('auto_created',true)) returning id into channel;
    prompt:=coalesce(nullif(btrim(p_system_prompt),''),'');
    insert into public.tenant_settings(tenant_id,timezone,settings) values(tenant,'America/Sao_Paulo',jsonb_build_object(
      'ai_enabled',false,'whatsapp_processing_mode','disabled','conversation_capability','standard',
      'system_prompt',prompt,'tone',p_tone,'onboarding_status','pending_configuration',
      'business_facts',jsonb_build_object('summary',coalesce(p_business_facts,''),'catalog',coalesce(p_catalog_highlights,'')),
      'custom_rules',coalesce(p_custom_rules,''),'onboarding_created_at',now()));
  else
    select id into board from public.kanban_boards where tenant_id=tenant order by is_default desc,created_at limit 1;
    select id into channel from public.channels where tenant_id=tenant and type='whatsapp' order by created_at limit 1;
  end if;
  return jsonb_build_object('ok',true,'tenant',jsonb_build_object('id',tenant,'slug',slug_value,'name',company),
    'board_id',board,'channel_id',channel,'prompt_chars',length(coalesce(prompt,'')),'onboarding_status','pending_configuration');
end $$;
revoke all on function public.magia_create_tenant_onboarding(text,text,text,text,text,text,text) from public,anon;
grant execute on function public.magia_create_tenant_onboarding(text,text,text,text,text,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
-- Rollback: drop function public.magia_create_tenant_onboarding(text,text,text,text,text,text,text).
-- Não remover workspaces reais já criados após a aplicação.
