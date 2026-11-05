# Publicação autorizada — conversas Gênesis/Núbia — 27/10/2026

Aplicação autorizada explicitamente pelo usuário nesta conversa: RPC, prompt da Núbia e correções n8n, com backup e validação, sem reenviar mensagens antigas.

## Estado aplicado e verificado

| Componente | Antes | Depois |
| --- | --- | --- |
| Motor n8n `mlKNPv862H2g3Gap` | `5e456a7c-6275-40f2-910a-575c043f53ec` | **`73422e9d-3c1a-4478-97b5-4e238fc15f39`**, ativo |
| SHA-256 do nó do Motor | `c58921da0302bc923d100ffdebdd3976a22689961554bdebe09f2a45862475e2` | `0939c0ddff3cf4a72f9efdbdd098be417cbc2316dcc500308efa6fb007abc64a` |
| RPC `magia_ignore_automated_turn(uuid,text,uuid,text,jsonb)` | Ausente | Criada pela migração **`20261027144322 semantic_automated_contact_ignore_v1`** |
| Prompt da Núbia | `nubia-2026-10-23-contract-alignment-v5` | **`nubia-2026-10-27-session-context-v6`** |
| MD5 do prompt | `d7601f67881365a8ba2bd463d99a6321` | `8011da436d771e6e006b6e8299943e9c` |

Ordem executada: backup e preflight → RPC e validação de acesso → publicação do Motor compatível → atualização guardada do prompt → conferência final. O Motor foi ativado às **11:43:05 de Brasília**; a conferência final do banco ocorreu às **11:45:44**.

## Escopo

Entraram as correções locais de CRLV/documento veicular, contexto e abertura da Núbia, descarte silencioso de contato automático por turno e diagnóstico de saída malformada do Gemini. Detalhes técnicos e testes em [correcoes_pendentes_conversas_2026-10-27.md](correcoes_pendentes_conversas_2026-10-27.md).

Somente o `jsCode` do nó **CORE | Motor conversacional** foi alterado no n8n. O publicador conferiu a versão esperada, igualdade com a base anterior, configurações, conexões, demais nós e código efetivamente ativo. O workflow de Entrada e os EXTs não foram publicados. Nenhuma publicação de frontend foi feita.

## Backups

- `.local/deploy_backups/2026-10-27T14-39-52-854Z/`: Motor antes/depois, prompt anterior, ausência anterior da RPC, contagens de fila, SQLs de aplicação e rollback, conferência e recibo consolidado.
- `.local/deploy_backups/2026-10-27T14-43-03-344Z/`: backup integral do workflow pelo publicador e `receipts.json` com versões/hashes.
- `.local/pending-four-fixes/publication.log`: publicação e recibo do n8n.
- `.local/pending-four-fixes/deployment-release.log`: barreira antes da gravação.

## Validação

- **277/277** testes da barreira aprovados antes da alteração e novamente pelo publicador.
- Permissões verificadas no banco: `service_role` pode executar a nova RPC; `anon` e `authenticated` não podem. `security definer` com `search_path=public, pg_temp`.
- Chamada REST com a credencial real de serviço e parâmetros sem turno/contato válido foi recusada com `STALE_SEMANTIC_IGNORE_TURN`, sem modificar dados de atendimento.
- MD5 da definição da RPC instalada: `08ba2e28beac805599f0fff7e882591f`.
- Atualização do prompt exigiu o hash anterior e exatamente uma linha. Hash das demais configurações da Núbia permaneceu **`1aafb0a3100b93080ff232cf117c03c6`**.
- Motor confirmado ativo com a nova versão e SHA-256 esperado após a atualização do prompt.
- Contagens de fila antes/depois idênticas: Núbia 38 em `review` e 600 em `ready`; Gênesis 67 em `review`, 5 em `uncertain` e 905 em `ready`.
- Não foram executados reprocessamentos, liberação de fila, envio manual de WhatsApp ou testes pagos de Gemini. A instalação da função não a executa para turnos antigos.

Limite da evidência: foi validada a configuração publicada e sua correspondência com o código testado. Não foi fabricada uma conversa real para confirmar a redação/modelo após a publicação. A suíte ampla local continua com 150 falhas anteriores e 10 skips, sem falhas novas na comparação registrada; não está integralmente verde.

## Rollback

Se necessário, reverter o prompt com `nubia_context_prompt_v6_rollback.sql` (guardado pelo hash novo); restaurar o código do Motor a partir do backup, usando a versão ativa esperada e preservando configurações; somente depois remover a RPC com o rollback correspondente. Não remover eventos/recibos históricos nem liberar filas como parte do rollback. Uma reversão futura precisa de nova conferência de drift e autorização.
