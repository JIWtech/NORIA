# Correção dos incidentes após a publicação — 27/10/2026

Publicação autorizada pelo usuário nesta conversa. Aplicada às 17h07min49s–17h07min51s de Brasília, conforme os recibos do publicador. Somente código n8n; nenhuma alteração de schema, RPC, dados ou prompt da Núbia no Supabase. Nenhum reenvio, liberação de fila antiga, teste pago Gemini ou WhatsApp de teste.

## Investigação e causa comprovada

### Resolução do canal

Execução `478899`: `Normalizar Entrada WhatsApp` entregou `instance=wesley-carros`, `tenant_slug=jiw`, `tenant_resolution.source=env_fallback`. A seleção posterior recusou esse fallback por ser uma instância registrada. O normalizador envolvia a leitura do registro em `try/catch {}`, ocultando falhas de consulta. Não foi preservado o erro original dessa execução, portanto o tipo exato dessa falha de leitura não está comprovado.

Correção: uma nova tentativa somente para falha transitória de GET; falha persistente, resposta inválida/truncada, associação ambígua, tenant inativo ou canal pendente interrompem o fluxo **antes do sync do contato**. Fallback legado só permanece quando a leitura válida do registro comprova ausência da instância. A trava posterior também permanece. O normalizador agora tem fonte canônica em `n8n/sources/whatsapp_normalize_entry.js`, projetada pelos builders existentes.

### Timeout da EXT Gênesis

Execução `478895`: `Validar identidade e capacidade do tenant` falhou com `timeout of 7000ms exceeded`. A identidade e o tenant recebidos estavam corretos. A causa externa do atraso não está comprovada; a correção trata a falha transitória com segurança, sem prometer eliminar indisponibilidade do provedor.

Correção: no máximo uma nova tentativa de leitura por execução do nó de identidade, somente para timeout/rede, HTTP 408/429/5xx. Erros 400/401/403, identidade inválida e tenant inativo não ganham autorização por retry. Nenhuma escrita é repetida e falha não preenche cache.

### Jean, contato …5916

O produto **não havia sido selecionado**. Às 12h05 a resposta citou a Crosser via fatos de estoque, mas `execution_product_id` e o produto do `assistant_offer` permaneceram nulos. Não há prova de que um produto selecionado tenha sido apagado. Às 12h07–12h08 a coleta ainda tinha `next_field=purchase_product`, mas a resposta avançou para nascimento e pressupôs a Crosser 2023 sem declarar fatos. A auditoria rejeitou corretamente esse pressuposto; a reformulação não conseguiu recuperar a resposta. O humano assumiu depois.

Correção: preservar a distinção entre menção e escolha. O validador rejeita avanço da coleta pessoal sem esclarecer o produto exigido pela EXT, mesmo quando o modelo mantém `financing` como tópico. O reparador recebe explicitamente `execution.pending_requirement` e instrução para respeitar a coleta final. A instrução da EXT separa entrega de dados, consulta de financiamento, aceite de explicação e pedido efetivo de simulação. Nenhum produto é escolhido por regex ou pela presença de seu nome.

### Exposição da limitação interna do anúncio

A frase enviada às 12h05, “não temos a identificação exata do veículo na nossa referência”, expõe mecanismo interno. A instrução comercial agora orienta esclarecimento natural sem revelar vínculo técnico entre anúncio e estoque. A auditoria semântica pode classificar `technical_internal_disclosure` também fora de pedidos de fotos. O código rejeita essa classificação e permite uma única reformulação, sujeita à mesma auditoria. Se a exposição persistir, o bloqueio é mantido; não há frase comercial pronta nem flexibilização factual.

Isso melhora a instrução e o tratamento verificável do veredito; não garante infalibilidade do classificador semântico em mensagens futuras.

## Validação

- **Prove-It:** os oito testes iniciais falharam antes da correção e passaram depois. A cobertura foi ampliada para **14 testes**, incluindo execução do motor gerado com provedor simulado: uma reformulação auditada, envio apenas após aceite e silêncio quando a exposição persiste.
- Barreira de publicação ampliada: **291/291 aprovados**, inclusive imediatamente antes da publicação.
- Suíte geral: **694 testes; 534 aprovados, 150 falhas anteriores, 10 ignorados**. Comparação por identidade com a referência anterior (`680; 520/150/10`) não encontrou falhas novas nem removidas. A suíte geral não está integralmente verde; não houve promoção de branch.
- Auditoria anti-hardcode aprovada; `git diff --check` aprovado após ajuste de whitespace.
- Leituras reais, sem persistência, executaram o normalizador canônico para Gênesis e Núbia e o nó de identidade da Gênesis contra o Supabase: resolução pelo registro e capacidade `sales_v1` corretas.
- O publicador conferiu versões anteriores e ausência de divergência com HEAD, gravou backups integrais, alterou somente `jsCode` de quatro nós e confirmou configurações/conexões e hashes dos nós ativos. Houve uma segunda leitura independente das três versões e hashes após publicar.

## Produção aplicada

| Componente | Versão anterior | Versão ativa verificada |
| --- | --- | --- |
| Motor `mlKNPv862H2g3Gap` | `73422e9d-3c1a-4478-97b5-4e238fc15f39` | `d5582d3b-c38e-4f30-aaac-09207e8599d0` |
| EXT Gênesis `fXGorIlPbyf9Qtsp` | `d477e621-f7ea-4443-a058-11e0656f59ef` | `2338fefd-6fe3-4ec3-bc43-9b7410133aac` |
| Entrada `3N5oN6sxtir9lFrA` | `87eca5b2-61a3-4783-a6fd-6671471a4605` | `9f659c7c-2590-46c9-ba20-088bc4618298` |

Backup integral e recibos com hashes por nó: `.local/deploy_backups/2026-10-27T20-07-47-967Z/`. Log: `.local/post-release-publication.log`. Plano de publicação: `.local/post-release-deploy-spec.json`.

Consulta imediata dos erros retidos no n8n não retornou execução iniciada após o término da publicação. No Supabase, até 17h09min39s, houve uma resposta natural da IA da Núbia e nenhum evento novo com `ai_error`/`error_code` preenchido nos dois tenants. Amostra e janela curtas: não comprovam resolução definitiva dos incidentes nem testam todas as condições comerciais.

## Rollback

1. Consultar novamente versões ativas e confirmar que ainda são as desta publicação. Se divergirem, comparar as alterações posteriores antes de restaurar.
2. Usar os três JSONs integrais do backup acima. Para esta correção basta restaurar os `parameters.jsCode` dos quatro nós listados em `receipts.json`, preservando as demais configurações e conexões atuais quando idênticas ao backup.
3. Reverter primeiro a entrada, depois a EXT e por último o Motor; as versões anteriores compartilham o mesmo contrato de integração. Não remover RPCs ou alterar prompt da Núbia, que não foram modificados nesta publicação.
4. Ativar cada versão restaurada e confirmar os hashes `oldSha256` registrados nos recibos e a integridade dos demais nós/conexões/configurações.
5. Não executar reprocessamento, liberar filas ou reenviar mensagens como parte do rollback.

## Limites e pendências preservadas

- HTTP 400 e lease expirado identificados na verificação anterior são bloqueios históricos; continuam exigindo investigação própria, não recuperação automática.
- A causa detalhada da execução `478877` não foi recuperada: consultas do payload completo excederam o tempo. Não se declara esse incidente individualmente resolvido.
- A nova tentativa é limitada e somente de leitura; indisponibilidade persistente continua interrompendo o fluxo com segurança.
- A primeira verificação tinha interpretado `updated_at` como possível ocorrência nova; o cruzamento com `review_required_at` comprovou que os bloqueios HTTP/lease eram anteriores. Consulte também `verificacao_pos_publicacao_2026-10-27.md`.
