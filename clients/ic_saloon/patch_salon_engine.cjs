// Transformação restrita ao artefato isolado do I&C Salon. Falha fechada em mudanças na fonte.
const assert = require('node:assert/strict');

function patchSalonEngine(source) {
  let code = source;
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  function replaceOnce(before, after) {
    const expected = before.replace(/\n/g, eol);
    assert.equal(code.split(expected).length, 2, 'Trecho esperado ausente ou ambíguo: ' + before.slice(0, 100));
    code = code.replace(expected, () => after.replace(/\n/g, eol));
  }

  replaceOnce(`function recordTeamReviewWithoutTransfer(context, event) {
  if (!event.handoff || !keepsAiOnTeamReview(context)) return;
  event.handoff = false;
  event.stage = 'Conversas IA';
  event.service = 'atendimento_humano';
  event.raw_payload.team_review_requested = true;
}

`, '');
  replaceOnce('    recordTeamReviewWithoutTransfer(context, event);\n', '');
  replaceOnce('  recordTeamReviewWithoutTransfer(context, event);\n', '');
  replaceOnce('    needsTeamReview = generated.needsTeamReview === true;',
    '    needsTeamReview = !event.handoff && generated.needsTeamReview === true;');
  // Mensagens de recuperação por cenário: o texto do tenant prevalece e o código só garante um padrão visível.
  replaceOnce('function sessionHandoffMessage() {\n', `const SALON_REQUEST_TEMPLATE_DEFAULTS = {
  full_name_template: 'Para eu anotar certinho, qual é o seu nome completo?',
  missing_details_template: 'Para eu registrar seu pedido, me confirma o serviço, o dia e o horário exato que você prefere?',
  processing_error_template: 'Não consegui concluir isso por aqui agora. Vou pedir para a equipe conferir e continuar seu atendimento.',
};

function salonLiteralTemplate(context, key) {
  const configured = settingsFor(context)?.appointment_request?.[key];
  const text = typeof configured === 'string' ? configured.trim() : '';
  return text && !/[{}]/.test(text) ? text : SALON_REQUEST_TEMPLATE_DEFAULTS[key];
}

function sessionHandoffMessage() {
`);
  // Sinal após falta: o adaptador é o único que acrescenta sinal_exigido=sim; o pedido grava deposit_required no metadata.
  replaceOnce("    firstVisit: details.primeira_vez || '', status: normalizeText(details.status || ''), requestId: details.pedido || '',\n",
    "    firstVisit: details.primeira_vez || '', status: normalizeText(details.status || ''), requestId: details.pedido || '',\n"
    + "    depositRequired: normalizeText(details.sinal_exigido || '') === 'sim',\n");
  replaceOnce('    duration_minutes: durationMinutes, conversation_session_id: turn?.boundary_id || null };\n',
    '    duration_minutes: durationMinutes, conversation_session_id: turn?.boundary_id || null,\n'
    + '    ...(action.depositRequired === true ? { deposit_required: true } : {}) };\n');
  // Diagnóstico do adaptador (códigos fixos, sem texto da conversa) no evento de saída.
  replaceOnce('  // Quais marcações a IA devolveu (sem o texto), para diagnosticar o turno depois.\n',
    "  const salonAdapter = typeof helpers.salonAdapterDiagnostics === 'function' ? helpers.salonAdapterDiagnostics() : null;\n"
    + '  if (salonAdapter) Object.assign(event.raw_payload, salonAdapter);\n'
    + '  // Quais marcações a IA devolveu (sem o texto), para diagnosticar o turno depois.\n');
  // Agradecimento com pedido pendente: uma terceira geração sem a regra de não repetir antes de transferir.
  replaceOnce("    if (!validRepair(generated.text)) throw new Error('APPOINTMENT_CONTEXTUAL_REPLY_INVALID');",
    "    if (!validRepair(generated.text)) {\n"
    + "      generated = await generate(maxOutputTokens, '\\n\\nCORREÇÃO OPERACIONAL: nenhum pedido foi alterado neste turno. Responda somente à mensagem atual, de forma breve e natural, sem tag de agendamento. Se for um agradecimento, agradeça de volta.');\n"
    + "    }\n"
    + "    if (!comparable(generated.text) || parseAppointmentRequestAction(generated.text)) {\n"
    + "      return { text: salonLiteralTemplate(context, 'processing_error_template') + ' [HUMANO_SOLICITADO]', model, usage: {} };\n"
    + '    }');
  replaceOnce('    const missingReviewReply = detectActions(generated.text).humanRequested && !cleanReplyText(generated.text).trim();',
    "    const missingReviewReply = generated.text.trim() !== '[HUMANO_SOLICITADO]'\n"
    + '      && detectActions(generated.text).humanRequested && !cleanReplyText(generated.text).trim();');
  // invalid_request_template ("perdi a mensagem") deixa de ser curinga: cada erro tem seu texto.
  replaceOnce(`      const retryKey = /APPOINTMENT_FULL_NAME_REQUIRED/.test(code) ? 'full_name_template'
        : /Invalid appointment details|APPOINTMENT_REQUEST_(?:PAST|STATUS_INVALID|NOT_OPEN)/.test(code) ? 'invalid_request_template' : '';
      const retryText = retryKey && typeof requestConfig[retryKey] === 'string' ? requestConfig[retryKey].trim() : '';`,
  `      const retryKey = /APPOINTMENT_FULL_NAME_REQUIRED/.test(code) ? 'full_name_template'
        : /Invalid appointment details|APPOINTMENT_REQUEST_PAST/.test(code) ? 'missing_details_template' : '';
      const retryText = retryKey ? salonLiteralTemplate(context, retryKey) : '';`);
  replaceOnce(`        // Pedido em envio, configuração inválida ou falha técnica: decide uma pessoa.
        responseText = sessionHandoffMessage(); preserveLiteralReply = true;`,
  `        // Pedido em envio, configuração inválida ou falha técnica: decide uma pessoa, com texto visível do tenant.
        responseText = salonLiteralTemplate(context, 'processing_error_template'); preserveLiteralReply = true;`);
  replaceOnce("  if (requestAction && !actions.humanRequested && !(actions.complaint && !isBotFrustrationText())) {",
    "  if (!event.handoff && requestAction?.kind === 'create' && !actions.humanRequested && !(actions.complaint && !isBotFrustrationText())) {");
  const savedRequest = '        event.raw_payload.appointment_request = { kind: requestAction.kind, appointment_id: request.id, request_version: request.metadata?.request_version || null };';
  replaceOnce(savedRequest, savedRequest + '\n        appointments.openRequest = request;');

  const decision = `  } else if (actions.humanRequested || (actions.complaint && !isBotFrustrationText())
    || ['update', 'cancel'].includes(requestAction?.kind)) {
    event.handoff = true;
    event.stage = 'Atendimento humano';
    event.service = 'atendimento_humano';
    event.raw_payload.explicit_handoff = true;
  } else if (needsTeamReview) {
    if (keepsAiOnTeamReview(context)) {
      event.handoff = false;
      event.stage = 'Aguardando confirmação';
      event.service = 'agendamento_pendente';
      event.raw_payload.team_review_requested = true;
    } else {
      event.handoff = true;
      event.stage = 'Atendimento humano';
      event.service = 'atendimento_humano';
    }
  }`;
  replaceOnce(`  } else if (needsTeamReview || actions.humanRequested || (actions.complaint && !isBotFrustrationText())) {
    event.handoff = true; event.stage = 'Atendimento humano'; event.service = 'atendimento_humano';
  }`, decision);

  const stage = `  // Mantém o estágio alinhado ao estado persistido do agendamento em cada turno.
  if (!event.handoff && requestConfig?.valid) {
    if (appointments.openRequest) {
      event.stage = 'Aguardando confirmação';
      event.service = 'agendamento_pendente';
    } else if (appointments.futureConfirmed) {
      event.stage = 'Agendamento confirmado';
    }
  }`;
  const safeReply = `  if (event.raw_payload.explicit_handoff && ['update', 'cancel'].includes(requestAction?.kind)) {
    responseText = sessionHandoffMessage();
    preserveLiteralReply = true;
    literalReplySuffix = '';
  }`;
  replaceOnce('  const proseForCleanup =', safeReply + '\n' + stage + '\n  const proseForCleanup =');
  assert.ok(!code.includes('recordTeamReviewWithoutTransfer'), 'O motor do Salon ainda contém a supressão global de handoff');
  return code;
}

module.exports = { patchSalonEngine };
