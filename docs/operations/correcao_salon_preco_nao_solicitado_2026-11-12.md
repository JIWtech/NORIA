# Salon: preço sem pedido — correção local (12/11/2026)

## Evidência

- Após a publicação do prompt v10 e do workflow do Salon às 21:39 UTC, a pessoa escreveu às 21:41 UTC: “queru loiro e fazer as unhas da mão, bem divonica, amooo”. A resposta das 21:42 UTC informou R$ 580,00 para mechas, sem pedido de valor. O evento registrou `adapter_outcome=passed`.
- O valor era oficial no catálogo. A falha era de intenção: `price_guard.cjs` conferia fonte e valor, mas não exigia que a mensagem atual pedisse preço. O revisor podia marcar `price_unrequested=false`, e o reparo também podia devolver preço.
- Outra rota montava o catálogo completo com preços ao receber `[CATALOGO_COMPLETO]`, mesmo quando a pessoa pedia apenas a lista de serviços.

## Mudanças

| Onde | Correção | Alcance |
| --- | --- | --- |
| `clients/ic_saloon/conversation_adapter.cjs`, `price_guard.cjs` | Auditor independente exige pedido semântico de preço e trecho literal da mensagem atual; resposta inicial e reparos são revalidados. | Somente `ic_salon`; preço oficial pedido continua autorizado. |
| `clients/ic_saloon/salon_engine.js` | Remove instrução contraditória que mandava usar preço do catálogo; interesse no serviço conduz ao próximo dado ou à avaliação. Catálogo completo só inclui valores quando a mensagem atual pede preços. | Somente `ic_salon`; lista simples mantém nomes e categorias. |
| `clients/ic_saloon/conversation_adapter.test.cjs`, `scripts/test_no_conversational_regex_nubia_salon.cjs` | Regressões para falso negativo do revisor, reparo com preço, evidência de pedido antigo e catálogo com/sem valores. | Sem alteração nos outros tenants. |

## Validação e limite

- Testes focados do adaptador: 28/28. Fluxos sem regex conversacional: 18/18. Gate de liberação: 485/485. Auditoria anti-hardcode: passou. Gerador rodado duas vezes; hash do export do Salon idêntico.
- `price_relay.test.cjs`: 16/16. `price_relay_queue.test.cjs` não iniciou porque a fixture aponta para `@electric-sql/pglite` ausente em `C:\Users\jvsbj\AppData\Local\Temp\magia-diag-tools\node_modules`.
- Publicado somente o workflow do Salon: `eac03a36-350a-48d2-a33e-024af1ef3264` → `9a72c935-08b5-4185-be7f-cb9f0d7a4bf3`. Leitura posterior confirmou `activeVersionId === versionId`, dois nós, nova guarda presente e instrução contraditória removida. Ainda falta observar uma conversa real posterior a esta publicação para validar o comportamento do Gemini.

## Publicação e rollback

O publicador conferiu a versão ativa, preservou nós, conexões e settings e gravou backup/recibo em `.local/deploy_backups/2026-11-12T21-59-18-746Z/`. Para desfazer localmente, reverter os cinco arquivos de fonte/teste deste incremento e regenerar o export; para desfazer no n8n, republicar o backup preservado.
