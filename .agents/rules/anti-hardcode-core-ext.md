---
trigger: model_decision
description: "Use ao alterar ou revisar o CORE, as EXT, os prompts do Gemini, os fallbacks ou as políticas comerciais."
---

# Regras de diálogo e contratos CORE × EXT

Use este guia ao alterar fontes do n8n, prompts do Gemini, fallbacks ou políticas de um tenant. As regras de execução e validação estão no [AGENTS.md](../../AGENTS.md).

## Responsabilidades por camada

| Camada | Responsabilidade |
| --- | --- |
| Gemini | Interpretar o turno e seu contexto, reconhecer correções e mudanças de assunto, planejar a interação e redigir a resposta com os fatos autorizados. |
| EXT | Aplicar a política comercial do tenant com dados do Supabase. Exemplos incluem elegibilidade de catálogo, regras de financiamento e documentação, condições de troca, pagamento e agenda. |
| CORE | Orquestrar o turno, validar os contratos e os fatos, controlar sessão, concorrência, idempotência, persistência e envio. |

Quando a decisão comercial depender de interpretação, entregue a intenção validada à EXT antes de finalizar a resposta. Confira a versão e o escopo do contrato estruturado e preserve a decisão comercial durante a finalização. Quando aplicável, audite os fatos de `response_contract` com o `fact_ledger`.

## Regras de implementação

- Mantenha a política comercial na EXT ou na configuração do tenant no Supabase. Evite ramificações de negócio no CORE condicionadas a tenant, contato ou nome de cliente.
- Deixe a interpretação comercial a cargo do Gemini. Use regex e constantes para parsing técnico, validação, estados e limites operacionais.
- Preserve contexto e evidências do turno. Use dados oficiais para estoque, preço e disponibilidade. Nunca deduza disponibilidade a partir da ausência de bloqueio.
- Quando a resposta falhar na validação, siga o protocolo operacional de contingência ou handoff. Preserve o assunto atual e os dados já coletados. Evite frases comerciais prontas, ofertas sem evidência ou perguntas já respondidas.
- Preserve os contratos existentes de catálogo, documentos privados e OCR, handoff humano e isolamento entre tenants.

## Modelo Gemini

O [CORE](../../n8n/sources/noria_core.js) usa `gemini-2.5-flash-lite` como fallback. O modelo efetivo depende da configuração do tenant ou agente e de `GEMINI_MODEL`, conforme a chamada. O código usa `thinkingLevel: 'low'` para `gemini-3.*` e `thinkingBudget` para os demais. Preserve a saída estruturada e confira a configuração efetiva ao investigar uma execução.

## Validação de mudanças conversacionais

1. Reproduza o turno com fixture local. Confira entrada, histórico, tenant e estado anterior.
2. Corrija a camada responsável. Valide o contrato CORE × EXT, o estado persistido e os fatos que chegam à resposta.
3. Regere os exports afetados com o [build canônico](../../scripts/build_noria_workflows.cjs). Confira o diff e rode as regressões pertinentes em [scripts/](../../scripts/).
4. Rode `node scripts/audit_anti_hardcode.cjs` para mudanças de diálogo ou política comercial. Revise os achados junto com o diff.
5. Registre as evidências e os limites da validação.
