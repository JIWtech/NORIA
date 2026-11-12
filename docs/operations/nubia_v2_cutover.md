# Núbia v2 — publicação controlada, piloto e reversão

> **Atenção (21/10/2026):** a cadeia v2 e o roteador com seletor de pipeline **não estão no CORE publicado** (removidos em `bcbabe3`; ver `estado_producao_core_2026-10-21.md`). Enquanto não voltarem, `noria_turn_pipeline.enabled` precisa ficar `false`. Ligado, todo turno da Núbia falha com `NORIA_TURN_PIPELINE_CONFIG_INVALID` e fica sem resposta (aconteceu das 11:25 às 18:06 de 21/10).

Estado: **preparado, nada publicado nem ativado.** Núbia v1 (contrato `1.0`, fase `single`) é o padrão; o contrato `2.0` só é escolhido por `tenant_settings.settings.noria_turn_pipeline`.

## Como a versão é escolhida (nó `CORE - Resolver extensão do tenant`, fonte `n8n/sources/noria_router.js`)
Por mensagem e por tenant. Para o tenant legado de contrato `1.0` (Núbia):
1. **Lote em andamento** (`conversation_turn_queue.claimed` não vazio): fica na versão que o reivindicou. O despachante da v2 grava um marcador interno `noria_pin_2.0_<event_id>` (evento `service='noria_pipeline_pin'`, `delivery_status='internal'`, sem texto). Com marcador → v2; sem marcador → v1, mesmo que a configuração esteja ligada.
2. Sem lote em andamento: só a declaração **válida, `enabled:true` e no escopo** leva à v2 (`rollout:'pilot'` + `pilot.allowed_contacts`, ou `rollout:'all'`). Ausente ou `enabled:false` → v1.
3. Declaração habilitada e inválida, ou leitura indisponível → erro (`NORIA_ROTEAMENTO_*`), sem fallback entre versões; a mensagem fica na fila e o recuperador tenta de novo. Gênesis e tenants SaaS dinâmicos não participam.
A defesa em profundidade está no CORE: o legado recusa lote fixado (`NORIA_TURN_PINNED_TO_OTHER_PIPELINE`) e um turno despachado nunca cai no legado (`NORIA_TURN_PIPELINE_DISABLED_FOR_PINNED_TURN` → falha não retentável → `review` para humano).

## Configuração (preparada, NÃO aplicada) — `docs/operations/nubia_v2_pipeline_config.example.json`
`contract`, `capability`, `contract_version`, `semantic_contract`, `decision_contract`, `decision_provenance` precisam coincidir exatamente com o que a EXT v2 declara no bootstrap; `rollout` e `pilot` são do roteador.

## Publicação (sem ativar) — ordem exata
0. **Preflight no n8n real** (nesta etapa bloqueado: sem `N8N_API_URL`/`N8N_API_KEY`): `N8N_API_URL=<…/api/v1> N8N_API_KEY=… node scripts/publish_nubia_v2.cjs --out=<pasta>`. Resolve os workflows por nome (CORE, EXT Gênesis, EXT Núbia v1, EXT v2), compara a estrutura viva com o repositório (nós, parâmetros, conexões; diferenças esperadas: só o código gerado dos nós do CORE e a conexão do roteador), grava e **verifica por sha256** os backups (`<pasta>/backups/`: CORE vivo, nó do roteador, EXT Gênesis, EXT Núbia v1) e o artefato. Qualquer divergência inesperada → código 3 e `--apply` recusado.
1. Escolher o contato piloto: o chat **não** pode ter linha em `conversation_turn_queue` com `claimed` não vazio, `review` ou `uncertain` (na leitura de 21/10 havia 23 linhas Núbia em `review`; elas ficam sempre no v1 e nunca são liberadas). Conferir também `magia_turn_lifecycle_status` (`ready:true` em 21/10) e as variáveis Evolution/ingresso do tenant.
2. Importar/ativar a EXT v2 (`NORIA EXT _ NB Bronze.json`) ou deixar o `--apply` criá-la. Aplicar: `NORIA_PUBLISH_AUTHORIZED=1 N8N_API_URL=… N8N_API_KEY=… node scripts/publish_nubia_v2.cjs --apply`. Conferir no editor: 9 nós `CORE | Serviços | …` ligados, seletor `Núbia v2?` com ramo falso → `CORE - É Núbia?`. O `--apply` só foi exercitado contra um n8n simulado.
3. Com `noria_turn_pipeline` ausente nada muda: o seletor cai sempre no ramo falso (v1). Verificar uma conversa Núbia normal.

## Piloto (contato interno autorizado)
1. Aplicar o JSON do exemplo com `enabled:false` e `rollout:'pilot'` (revisar `allowed_contacts`: número interno em dígitos). Nada muda.
2. Trocar para `enabled:true`. Só o contato listado vai à v2; todos os outros seguem no v1. Observar `channel_events` (`ai_provider` `services_pipeline` / `services_contingency` / `payment_signal`) e `appointments.metadata.reservation_request`.
3. Estados `uncertain` e `review` nunca são liberados ou reenviados automaticamente; o comando `SINAL PAGO` segue determinístico (mensagem configurada, uma única atualização para `payment_reported`; confirmar pagamento continua humano).

## Reversão
1. `enabled:false` (ou remover a chave): a próxima mensagem de qualquer contato vai ao v1. Instantâneo, sem republicar.
2. Desligar não muda o lote em andamento: o marcador (evento interno gravado na base) mantém o turno na v2 até terminar, sem execução dupla; só os próximos lotes vão ao v1. O piloto casa apenas JID de telefone (`<dígitos>@s.whatsapp.net`) do ingresso autenticado; LID e grupos nunca casam.
3. Reverter o workflow (opcional): `PUT` do backup verificado `<pasta>/backups/CORE_<id>.json` (conferir o sha256 em `backups/MANIFEST.json`) ou restaurá-lo pelo editor. Reservas já criadas permanecem válidas.

## Limites conhecidos
- O marcador de versão é um evento interno de `channel_events`; `magia_merge_channel_event_raw` só aceita chaves fixas e não houve alteração de SQL.
- Falha da EXT v2 antes do claim deixa a mensagem na fila e o recuperador repete a cada ciclo até corrigir ou reverter (sem perda).
- Cobertura do auditor semântico ainda não medida com o Gemini real (`services_executor.cjs --mode=real`).
