// Regressão dos contratos afetados pela publicação CORE/EXT, sem Gemini pago ou envio WhatsApp.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const names = ['turn_transient_failures', 'genesis_service_authority', 'catalog_presentation_policy',
  'genesis_dialogue_recovery', 'sales_follow_up', 'genesis_sale_year_semantics', 'genesis_purchase_brand_authority',
  'genesis_commercial_policy_contract', 'genesis_deposit_ext_core', 'noria_build_idempotency', 'service_price_evidence',
  'telegram_error_privacy', 'genesis_identity_cache', 'human_services_handoff', 'handoff_three_scenarios',
  'noria_extension_semantics', 'noria_engine_subworkflow', 'booking_authorization', 'noria_primary_dialogue',
  'core_commercial_boundary', 'primary_response_boundary', 'core_unavailable_media', 'noria_document_identity',
  'sales_followup_database_policy', 'core_ext_contract_guards', 'semantic_courtesy', 'ad_vehicle_and_repeated_question', 'audio_batch_limit', 'media_notice', 'ad_inventory_candidates', 'observability_diagnostics', 'genesis_sale_mileage', 'follow_up_closure', 'ingress_landline_commercial', 'technical_hold_handoff', 'pending_conversation_fixes', 'semantic_contact_ignore_rpc', 'post_release_incidents', 'select_core_burst', 'ad_referral_multiline'];
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=3', ...names.map(name => 'scripts/test_' + name + '.cjs')], {
  cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 60000, maxBuffer: 4e6,
});
const output = (result.stdout || '') + (result.stderr || '');
console.log(output.split('\n').filter(line => /^(?:ℹ |# )(?:tests|pass|fail|skipped|duration_ms)|^✖ /.test(line)).join('\n'));
if (result.error) console.error(result.error.code || 'RELEASE_TEST_ERROR');
process.exitCode = result.status === 0 && !result.error ? 0 : 1;
