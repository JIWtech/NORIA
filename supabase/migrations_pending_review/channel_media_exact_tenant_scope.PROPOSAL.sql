-- PROPOSTA LOCAL. NAO EXECUTADA EM PRODUCAO.
-- Alteracao de politica RLS: requer revisao e autorizacao especifica antes de aplicar.
-- Nao gerar historico de migracao nem aplicar este arquivo automaticamente.
-- A politica existente conserva bucket, membros ativos, roles e operacao SELECT.
-- LIKE transforma '_' e '%' do slug em curingas; compare o primeiro segmento exato.
-- Rollback de contencao: restringir temporariamente USING (false), nunca restaurar
-- automaticamente a comparacao vulneravel. Rever o acesso antes de reabri-lo.
BEGIN;
LOCK TABLE storage.objects IN SHARE ROW EXCLUSIVE MODE;
DO $scope_preflight$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
    AND policyname='channel_media_read_member' AND cmd='SELECT' AND roles=ARRAY['authenticated']::name[]
    -- Hash antigo conferido no Supabase; hash novo conferido com a mesma
    -- expressao em Postgres/PGlite. Divergencia exige revisao, nao sobrescrita.
    AND md5(regexp_replace(coalesce(qual,''),'\s+','','g')) IN
      ('507b7182bf6e68dff101effcd3a5d0bd','d31b073c9fb579edc31df2082a3013f8')) THEN
    RAISE EXCEPTION 'STORAGE_POLICY_BASELINE_MISMATCH';
  END IF;
END;
$scope_preflight$;
ALTER POLICY "channel_media_read_member" ON storage.objects
USING (
  bucket_id = 'channel-media'
  AND position('/' in storage.objects.name) > 0
  AND EXISTS (
    SELECT 1 FROM public.tenant_members tm
    JOIN public.tenants t ON t.id = tm.tenant_id
    WHERE tm.user_id = (SELECT auth.uid())
      AND tm.status = 'active'
      AND split_part(storage.objects.name, '/', 1) = t.slug
  )
);
COMMIT;
