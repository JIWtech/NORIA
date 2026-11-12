import test from 'node:test';
import assert from 'node:assert/strict';
import { isInternalOperationalEvent } from '../../src/services/timeline/eventClassification.js';
import { isHiddenTimelineSystemEvent } from '../../src/features/conversations/utils/chatTimelineHelpers.js';

test('fixação interna do pipeline não aparece na conversa nem vira outbound', () => {
  assert.equal(isInternalOperationalEvent({ service: 'noria_pipeline_pin', ai_provider: 'noria_pipeline_pin', delivery_status: 'internal', sender_type: 'system', message_text: '' }), true);
  assert.equal(isInternalOperationalEvent({ service: 'sales_qualification', sender_type: 'system', message_text: '' }), false);
  assert.equal(isHiddenTimelineSystemEvent({ service: 'noria_pipeline_pin', from: 'system', text: '' }), true);
});
