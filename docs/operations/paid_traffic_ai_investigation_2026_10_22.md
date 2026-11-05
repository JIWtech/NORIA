# Investigação de respostas a contatos de anúncios — 22/10/2026

Consulta de leitura em produção concluída em 22/10/2026 às 07:15 BRT. Janela: sete dias anteriores à consulta. Projeto Supabase: `NORIA-prod` / `gfwwawazivmuqyctjsxj`.

## Conclusão

Existem contatos de anúncios que ficam sem resposta por falhas no processamento/auditoria do diálogo. A entrada de anúncios funciona: os eventos chegam ao Supabase com `raw_payload.referral.source = external_ad_reply`, identificação da campanha e conteúdo do anúncio. Não foi encontrado bloqueio geral de mensagens por serem provenientes de anúncios.

O caso recente da Montana reproduz exatamente o comportamento do motor publicado: resposta rejeitada pela auditoria, recuperação vazia, evento técnico interno e turno retido em `review`. Não existe confirmação de resposta ao cliente ou de transferência executada nesse caso. Há ticket de revisão aberto, ainda sem reconhecimento do operador.

## Contagem observada

Critério de anúncio: campo normalizado `raw_payload.referral.source = external_ad_reply`. Não inclui contatos sem metadados de origem nem referências exclusivas ao catálogo.

| Tenant | Mensagens de anúncio | Conversas distintas | IA com envio registrado em até 10 min | IA após 10 min, até 24 h | Somente humano, até 24 h | Sem envio de IA/humano na janela observada |
|---|---:|---:|---:|---:|---:|---:|
| Gênesis | 204 | 195 | 159 | 1 | 38 | 6 |
| NB Bronze | 75 | 73 | 66 | 0 | 7 | 2 |

As seis mensagens da Gênesis sem envio posterior se dividem em três com erro técnico e três que já ingressaram em atendimento humano (`handoff=true`). As duas da NB Bronze já estavam em atendimento humano.

A associação usa o mesmo tenant e chat, após a mensagem, limitada a 24 horas e ao momento da consulta. Não é uma correlação causal por `request_id` — esse campo estava nulo nas amostras. Uma resposta posterior pode pertencer à continuação do atendimento. Follow-ups foram excluídos da contagem de resposta de IA. `sent` é o status persistido; não comprova leitura nem recebimento pelo aparelho do cliente.

## Casos comprovados na Gênesis

Horários abaixo em BRT. Identificação de telefone reduzida aos últimos quatro dígitos.

| Caso | Entrada / continuidade | Evidência | Situação consultada |
|---|---|---|---|
| Montana, final 3206 | 21/10 23:17:58 — “Gostaria de saber mais sobre a Montana” | `SEMANTIC_RESPONSE_COVERAGE_MISMATCH`; `customer_reply_sent=false` | Fila `review`, `explicit_technical_hold`, uma mensagem claimed. Lead `sales_qualifying`, `ai_locked=false`. Nenhum envio de resposta posterior registrado até a consulta. |
| Montana, final 3294 | 21/10 17:57:27 — mesma pergunta | `UNDECLARED_OR_UNLINKED_SEMANTIC_FACT` | Fila `review`, `explicit_technical_hold`; lead ainda em qualificação e sem lock humano. Nenhum envio de resposta posterior registrado até a consulta. |
| Marketplace, final 4808 | 21/10 10:25:24 — interesse em item; lote posterior incluiu áudio | `audio_transcription_failed` | Fila `review`. Não atribuir o erro à origem anúncio: o erro observado é de transcrição. |
| Compra de carro, final 4798 | 21/10 22:43:52 — “Olá! Vocês compram carro?” | IA respondeu em cerca de 22 s. Depois de “Grande Siena”, “1.4”, “2016”, ocorreu `DIALOGUE_GENERATION_FAILED`, código `EMPTY_SALES_REPLY` | A resposta inicial do anúncio funcionou; a continuação ficou em `review`, com três mensagens claimed e sem resposta ao lote. |
| Montana, final 4210 | 21/10 20:21:21 — pergunta de localização | Recibo terminal `lead_locked`, autoridade `sales_leads+tenant_settings`, estágio `sales_human` | Silêncio da IA compatível com controle humano. Operador enviou “Vendida” e “Boa noite” às 20:58. |
| Montana, final 1804 | 21/10 14:58:39 — pergunta do anúncio | Resposta da IA registrada às 15:09:07; recibo `confirmed_delivery` | Atraso de cerca de 10 min 29 s. Não classificar como ausência permanente de resposta. |

### Identificadores para reprodução da consulta

- Montana 3206: inbound `ac91b9fe-fbd3-4e12-90af-54fecd79a418`; erro `545e8b36-51c0-4fa0-add9-09462531e740`; execução informada no evento `437369`.
- Montana 3294: inbound `d801991f-36ba-47ce-aa2c-4e41b86162f6`.
- Compra/Siena 4798: inbound `c8b3dc6e-f48d-44da-9878-83f05248634e`; erro da continuação `bca7772d-206d-4856-9ef4-432be573519a`; execução informada no evento `437188`.
- Recibo de controle humano do caso 4210: evento inbound `a4c20281-673f-43d9-9e58-843691b3ccd4`, lead `bdf37cba-3bdf-4fcc-bc9a-324748435272`, revisão 7.

## Comparação com o n8n publicado

Leitura direta por GET com `N8N_BASE_URL` e `N8N_API_KEY` do `.env`, sem expor seus valores.

- Workflow de entrada: `3N5oN6sxtir9lFrA`, `NORIA CORE | WhatsApp + Comandos + Follow-ups | Motor compartilhado v2`.
- Motor efetivo chamado pelo workflow de entrada: `mlKNPv862H2g3Gap`, `NORIA CORE | Motor conversacional`, ativo, atualizado em `2026-10-22T01:51:01.621Z`.
- EXT Gênesis: `fXGorIlPbyf9Qtsp`, ativa, atualizada em `2026-10-22T01:50:59.460Z`.

O nó `Registrar Mensagem na Fila` extrai `externalAdReply` e persiste o referral. A existência do referral nas linhas de entrada confirma que essa etapa funcionou nos casos analisados.

No código do nó `CORE | Motor conversacional`, lido diretamente da API:

1. Linha 9927: a cobertura da auditoria exige igualdade exata entre `report.segments.map(s => s.text).join('')` e `reply`.
2. Linhas 10460–10463: `salesRecoverSafeDialogue()` retorna `''`; o comentário informa que o turno fica silencioso para o operador.
3. Linhas 13068–13073: se a recuperação fica vazia, registra revisão, limpa `handoffReason` e grava `dialogue_recovery.status = safe_reply_without_dispatch`, `assignment_confirmed=false`.
4. Linhas 12476–12481: falha técnica da geração produz `DIALOGUE_GENERATION_FAILED`, esvazia a resposta e marca falha técnica.
5. `salesAlertOperator` persiste evento interno `sender_type=system`, `service=technical_error`, `delivery_status=internal`, sem mudar controle humano automaticamente.

O Supabase confirmou a mesma sequência no caso Montana 3206: auditoria `needs_human_review`, `handoff_execution.status=not_attempted`, `decided=false`, `executed=false`, `customer_reply_sent=false` e fila em revisão.

O relatório semântico desse caso possui dois segmentos de texto, sem separador entre o final do primeiro e o início do segundo. Como o validador concatena os segmentos sem inserir separadores, diferenças de espaço/quebra de linha são uma hipótese concreta para o erro de cobertura. O texto original rejeitado não foi recuperado; portanto ainda não está comprovado que foi apenas formatação. Não se deve remover a auditoria ou liberar a resposta sem essa prova.

Os tickets dos casos Montana 3206 e Siena 4798 estavam com `notification_pending=true`, `notified_revision=0`, `acknowledged_at=null` e `resolved_at=null`. Ambos tinham `inbox_revision=1`: existe registro para a interface, mas não há confirmação de reconhecimento ou atendimento. Não inferir ausência de toda notificação visual a partir do campo `notification_pending`.

### Versões e hashes

SHA-256 dos bytes do código do motor publicado: `7b9f9fe2420fb73b5947ba32cb425c321e0f988714ab2ec8d56aa3927f774264`.

SHA-256 do arquivo local `n8n/code/whatsapp_conversation_core.generated.js`: `c66f84c56ebcdba8a90b91418e62272dafcc90cfcaa7c101bc7efc7892e124d2`.

Eles diferem. A sincronização anterior dos dois JSONs de entrada/EXT não sincronizou esse workflow separado do motor nem as fontes locais. As conclusões desta investigação usam o motor publicado, não presumem paridade com o arquivo gerado local.

O evento Montana 3206 informa `core_revision=conversation_core_v2_1_34_core_ext_decision_identity_2026_10_22`, build `2026-10-22T01:49:51.109Z`, `core_sha256=fd6dba9cc20cf93e27b60072144e3886e63a5a5771495bf83753fc6726041589`. Esse hash de build tem escopo diferente do hash bruto do arquivo/código. A API de execuções retornou 404 para os IDs históricos 437369 e 437188; os IDs foram obtidos dos eventos persistidos, não de uma execução reaberta.

## Prioridades indicadas pela evidência

1. Corrigir e validar o contrato de cobertura textual da auditoria preservando o texto original e seus separadores. Confirmar o motivo exato do caso antes de classificá-lo como falso positivo.
2. Garantir que uma revisão técnica tenha recuperação ou atendimento operacional confirmado, em vez de depender apenas do evento interno e de um ticket ainda não reconhecido. Preservar os guardrails e a autoridade comercial do EXT.
3. Investigar `EMPTY_SALES_REPLY` no lote de informações do Siena e a falha de transcrição do caso Marketplace separadamente.
4. Sincronizar o motor publicado com fontes e gerados antes de implementar correções locais; os JSONs de entrada/EXT sozinhos não representam todo o código em execução.

## Escopo e limites

Foram realizadas apenas consultas SELECT no Supabase e GET no n8n. Nenhum workflow foi publicado, nenhuma fila foi liberada, nenhuma mensagem real foi enviada e nenhum registro de produção foi alterado. Este documento é o único artefato adicionado por esta investigação. Não foram executados testes funcionais nem chamadas pagas ao Gemini.

Os oito episódios históricos de `dialogueNeedsReview is not defined` encontrados entre mensagens sem resposta rápida ocorreram em versões anteriores, no dia 17/10. Não foram atribuídos automaticamente ao motor atual.
