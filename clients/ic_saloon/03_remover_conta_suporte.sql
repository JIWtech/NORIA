-- I&C Salon: tira a conta de suporte (JIW) do tenant. O dono passa a ser só ic_saloon@gmail.com.
-- Apaga APENAS o vínculo desta conta com ESTE tenant; a conta e os outros tenants não são tocados.
delete from public.tenant_members
where tenant_id = (select id from public.tenants where slug = 'ic_salon')
  and user_id = 'abd79a59-1d75-447d-a983-0d332cb6f3dc'
returning email, role;
