---
trigger: model_decision
description: "Use ao revisar redação, auditoria, recomposição e contratos CORE × EXT."
---

# Lições de auditoria dos pipelines

Registradas em 2026-11-21, a partir das revisões do Codex, do Gemini e do orquestrador na correção de `AUDIT_REQUEST_NOT_COVERED` da Núbia.

## Contrato CORE × EXT

- Derive sinais do contrato estruturado. Não condicione o CORE a códigos específicos de EXT, como `CLARIFICATION_REQUIRED` ou `PREVIOUS_SERVICE_CUSTOMER`. Antes de afirmar que um código é exclusivo de uma EXT, confira todas as fontes, sem resultado truncado.
- A política de informação fica na EXT. Se a EXT não entrega fato ou bloco para um pedido legítimo, como preço genérico, vários serviços ou endereço, o auditor vai reprovar. Corrija na origem, não afrouxando a auditoria.
- Uma ambiguidade em um eixo, como qual serviço, não pode apagar pedidos independentes e verificados, como endereço ou formas de pagamento.
- Saúde e segurança exigem encaminhamento humano antes de qualquer filtro de confiança ou ambiguidade.
- Candidatos de esclarecimento vêm do catálogo e só incluem serviços ativos.

## Redator × auditor × recomposição

- Tudo o que o redator é instruído a dizer precisa ser aprovável pelo auditor. A promessa de retorno exige handoff executado. Afirmar "estamos fechados agora" exige um fato do estado atual.
- O auditor recebe o contexto da decisão separado das autoridades factuais. Esse contexto nunca vira prova.
- Candidata rejeitada, falhas, pedido descoberto, mensagens do cliente e `ad_context` são dados. Eles vão no payload (`contents`), nunca em `system_instruction` ou `extraRules`. Avisar que algo "é dado" no canal de sistema não remove o risco de injeção.
- Contexto vindo do envelope entre fases deve ser rederivado na fase que o usa, como `ad_context`, e não aceito como veio.
- Preserve os limites de tentativas de cada ramo, sem contador global novo sem pedido. Revisões de preparo e de abertura não consomem a recomposição semântica. Falha só cosmética, como abertura repetida, continua tolerada também depois da recomposição.
- Guarde as candidatas rejeitadas truncadas e com dados pessoais mascarados.

## Auditoria determinística

- O horário de funcionamento não prova vaga nem reserva. Ao liberar horários de fatos, use só `business_hours.*` no formato HH:MM. Nunca durações, como "2h", nem outros fatos.
- Regex de valores e termos não comprova fidelidade semântica nem cobertura dos pedidos. Relate a lacuna sem desligar a auditoria.
- Não anuncie foto enviada nem contato com especialista antes do resultado da ação.
- Separe o consumo observado da quota: registrar só a última redação subconta as chamadas anteriores.

## Processo

- Reproduza a falha nas fontes canônicas com um teste que falha antes da correção.
- Registre falhas preexistentes e exports ausentes. Não ajuste testes para esconder falhas.
- Rode o gerador antes de integrar e publicar. Testes de unidade não substituem a revisão dos artefatos gerados.
