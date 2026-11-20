# Pipeline de venda consultiva `retail_v1`

Especificação técnica da capability de venda consultiva de produtos no pipeline em fases do CORE (`noria_turn_pipeline_v1`). Primeiro tenant: JOYERÍA. Estado: **em implementação**, nada publicado.

## Princípios

- Reaproveita o pipeline em fases do `services_v1`: claim único pelo despachante, identidade do turno rederivada pelo CORE, decisão da EXT verificada antes de qualquer efeito, redação auditada e entrega com begin → provedor → confirm.
- O Gemini só **interpreta** o que o cliente disse, com evidências. A EXT do tenant **decide** a política comercial. O CORE **valida e executa** contratos genéricos, sem regra, produto, número ou nome de tenant.
- Nenhum perfil existente muda de comportamento: `retail_v1` entra como capability nova em `TURN_PIPELINE_CAPABILITIES`, selecionada apenas por declaração explícita em `tenant_settings.settings.noria_turn_pipeline` e pela política da EXT.

## Fases

| Fase | Quem | Faz | Não faz |
| --- | --- | --- | --- |
| `prepare` | CORE | Lê histórico da sessão, consulta o catálogo do tenant (`product_catalog_*`) com filtro e paginação, chama o Gemini com o vocabulário declarado pela EXT e devolve interpretação + candidatos | Decidir encaminhamento, preço ou envio |
| decisão | EXT do tenant | Aplica a política comercial sobre a interpretação e os fatos do catálogo; devolve ações autorizadas | Enviar, gravar ou chamar provedor |
| `finalize` | CORE | Verifica a decisão, executa as ações autorizadas, redige e audita a resposta, entrega texto e mídia, emite o aviso ao especialista | Inventar ação não autorizada ou repetir efeito já registrado |

## Interpretação semântica (Gemini, fase `prepare`)

Vocabulário declarado pela EXT em `modules.turn_pipeline.semantic_vocabulary`. Saída mínima:

- `primary_intent`, `secondary_intents`, `confidence`, `evidence_ids` (mensagens da sessão atual).
- `products`: itens do catálogo citados ou reconhecidos (`item_id` restrito aos candidatos carregados) com papel (`mencionado`, `escolhido`, `comparando`).
- `material_requested`: material pedido pelo cliente (ex.: ouro maciço), com evidência, mesmo sem item cadastrado.
- `customer_decision`: `decidido` | `explorando` | `indefinido`, com evidência. Cobre quem chega decidido e quem se decide durante a conversa.
- `commercial_interest`: compra, preço, medida, prazo, modelo; distingue de dúvida informativa (cuidados, garantia).
- `human`: pedido explícito de pessoa; `exchange`: pedido de troca; `home_visit`: visita domiciliar com localidade.
- `conversation`: mudança de assunto, correção de intenção, necessidade de esclarecimento.

## Decisão da EXT (contrato)

Campos de identidade iguais aos do `services_v1` (`tenant_id`, `tenant_slug`, `instance`, `remote_jid`, `session_id`, `request_id`, `turn_token`, `contract`, `provenance`, `noria_contract_version`, `status`). Ações:

| Ação | Parâmetros | Execução no CORE |
| --- | --- | --- |
| `present_information` | `item_ids` | Fatos dos itens entram nos blocos aprovados para a redação |
| `send_product_media` | `item_id`, `asset_ids` (máx. 3) | Recarrega item e vínculos do mesmo tenant; só imagens `aprovada`, item `offerable`; confere hash, MIME e URL do Storage do projeto; reserva antes do envio; resultado desconhecido não é reenviado |
| `send_site_link` | `item_id` | Só com `site_url` cadastrado e item ofertável |
| `notify_specialist` | `reason` (`blend`, `alto_padrao`, `cliente_decidido`), `facts` | Aviso ao destino configurado no tenant (ver abaixo); **não pausa a IA** |
| `handoff` | `reason` | Handoff genérico já existente: pausa a IA, sem nome de atendente |

Uma decisão `refused` ou malformada não autoriza nada e leva à contingência neutra já usada no `services_v1`.

## Aviso ao especialista (`notify_specialist`)

- Destino somente em `tenant_settings.settings.specialist_notification.recipient` (número E.164 do tenant). Nunca vem do modelo nem da decisão.
- Recusa se o destino for igual ao `remote_jid` do lead ou não for um número válido.
- Chave de idempotência: `tenant_id + session_id + reason`. Uma reserva persistida por chave (inserção única, nunca upsert) antes da chamada ao provedor.
- Estados: `reserved` → `sent` | `failed` | `unknown`. `unknown` (timeout, resposta sem ID) exige reconciliação e nunca dispara reenvio automático.
- Conteúdo: resumo fiel dos fatos da sessão e o contato do lead derivado do `remote_jid`; campos ausentes aparecem como "não informado".
- Registro em `channel_events` da conversa do lead (sem pausar a IA), para o painel mostrar "Especialista avisado".

## Assumir e retomar

Sem mudança: "Assumir" grava `conversation_assigned` com `handoff: true` (pausa a IA e cancela envios em andamento); retomar grava `resume_ai`. A confirmação no painel exige o evento persistido (commit `5b11e55`).

## Catálogo

Fonte: migration pendente `20261120200000_product_catalog` e carga gerada por `scripts/product_catalog_load.cjs`. A fase `prepare` carrega candidatos por tenant, ativos e ofertáveis, com limite e ordenação determinísticos; nunca o catálogo inteiro no prompt.

## Ordem de implementação

1. Capability `retail_v1` aceita na declaração do pipeline e no perfil, sem alterar `services_v1` (testes de regressão do salão e da Núbia).
2. Envio genérico de mídia a partir de `product_catalog_*` (MIME real, sem nomes de arquivo de veículo).
3. `notify_specialist` com reserva idempotente e reconciliação.
4. Fases `prepare` e `finalize` do `retail_v1`.
5. EXT da JOYERÍA (política) e prompt; gerador de workflows; homologação com número de teste.
