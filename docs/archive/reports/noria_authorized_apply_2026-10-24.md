# Aplicação autorizada — 24/10/2026

Autorização do usuário: “ok, pode aplicar todas as correçoes.”

## Aplicado em produção

- Supabase: migração `20261024025505`, `channel_media_exact_tenant_scope`. Hash da política lido após aplicação: `d31b073c9fb579edc31df2082a3013f8`; role authenticated e SELECT preservados.
- CORE motor `mlKNPv862H2g3Gap`: versão ativa `9d9455db-33b0-40c0-be38-24ee44115706`.
- Gênesis EXT `fXGorIlPbyf9Qtsp`: versão ativa `201abb2b-e872-461e-924d-e0544bf20b8e`.
- CORE entrada `3N5oN6sxtir9lFrA`: versão ativa `2772a573-24cb-480f-ba81-9e06c0d02158`.
- Prompt Gênesis: `wesley-sales-v14.25-contract-alignment-2026-10-23`, MD5 `27c031b5858c0c141588d4205b63143b`.
- Prompt Núbia: `nubia-2026-10-23-contract-alignment-v5`, MD5 `d7601f67881365a8ba2bd463d99a6321`.

As versões anteriores foram conferidas novamente antes da alteração. Os prompts ainda correspondiam aos baselines esperados; o patch transacional preservou as demais configurações. A política passou pelo guard de hash/roles. A atualização dos workflows preservou seus IDs, nomes, credenciais e configurações operacionais. Não havia diferença estrutural fora dos códigos dos nós; as conexões permaneceram iguais.

Nesta instância, o PUT dos workflows atualizou também a versão ativa. Foi feita nova leitura, exigindo `activeVersionId = versionId` e comparação dos nós e conexões de `activeVersion` com os candidatos locais. Portanto a confirmação é de conteúdo ativo, não apenas de rascunho salvo. Não foi necessário desativar ou republicar os webhooks.

O motor ativo contém CORE hash `99289e1a319da66569ffdea413bac3e84dc102d8fca5bea951d39ea4667324f9` e EXT hash `3fffdf4d39074c3857d0269fd1c4ce5d011ff32f619007c7e995eaa3059de663`.

## Conferência após aplicação

- Nós e conexões ativos coincidem com os candidatos; settings publicados foram preservados.
- Os dois prompts do banco têm exatamente os MD5s dos rascunhos revisados.
- `magia_turn_lifecycle_status`: ready=true, missing=[]. As RPCs de orçamento Gemini existem e service_role possui EXECUTE; as RPCs literais de fila/contratos também foram conferidas.
- A consulta de turnos processing/sending retornou zero no preflight e no postflight. Isso é um retrato desses momentos, não garantia de ausência de tráfego durante toda a janela.
- A EXT legado da Núbia permaneceu na mesma versão e ativa; Royal continuou inativa. Não foi ativado o pipeline Núbia v2.
- Advisors de segurança reexecutados após a migração: continuam os avisos já triados de 29 tabelas internas sem política, 21 funções privileged autenticadas, extensão em public e proteção de senha vazada. O patch de prefixo não pretende resolver esses alertas distintos.
- Testes antes da aplicação: 182 casos direcionados aprovados, build do painel aprovado e npm audit sem alertas. Regressões dos patches sensíveis reexecutadas antes da publicação: 26/26. Continuam documentadas 11 falhas anteriores no app e 72 nas suítes antigas; nenhuma asserção foi reduzida.

Não foi enviada mensagem WhatsApp para validação nem realizada chamada paga de teste ao Gemini. Não foram reprocessadas filas antigas. Paridade de publicação e disponibilidade das dependências não comprovam, sozinhas, uma nova conversa entregue pelo provedor ou a qualidade do julgamento semântico real.

## Painel React

As correções de cache/sessão e as atualizações Vite 6.4.5/source-map-js 1.2.2 estão aplicadas ao workspace e ao build local. O npm audit foi repetido após a aplicação e permaneceu zerado. Não foi identificado destino configurado de hospedagem do painel nem processo Vite em execução no projeto. Foi solicitada ao usuário a URL/hospedagem, caso exista uma instalação online. Não foi criado outro site nem enviado o código a um destino presumido.

## Rollback e rastreabilidade

Snapshots anteriores dos quatro workflows em `C:/Users/jvsbj/AppData/Local/Temp/noria_authorized_apply_20261023/`, arquivos `<workflow-id>.before.json`. A Núbia foi incluída por segurança, embora não tenha sido alterada. Contêm exportações e referências de credenciais, devem permanecer fora do Git.

Para reversão dos workflows, usar os nós/conexões/settings dos snapshots e conferir a versão ativa resultante. Reverter motor, EXT e entrada de forma coordenada; nunca promover snapshot por mero número de nós. Rollback de prompts: `supabase/migrations_pending_review/prompt_contract_alignment_20261023_rollback.sql`, com guards que recusam apagar edições posteriores. RLS: se necessário, restringir temporariamente o acesso e revisar; não restaurar o LIKE vulnerável automaticamente.

Registro estruturado: `noria_authorized_apply_2026-10-24.json`. O `production_approved:false` do manifesto de build é um default de geração e não foi convertido em aprovação permanente para builds futuros. A autorização desta aplicação corresponde somente aos hashes e versões registrados aqui.

Nenhum commit, push ou promoção de branch foi realizado. Os três arquivos de frontend já alterados pelo usuário e o trabalho local anterior foram preservados.

## Aplicação complementar — Gênesis: catálogo e busca fora do estoque (24/10, 00:41 BRT)

Autorização do usuário: “Sim, pode aplicar a migração genesis_catalog_presentation_and_sourcing no Supabase de produção, trocando 'esse carro' por 'esse veículo' na confirmação.”

Motivo: na conversa de 24/10 às 00:34, "vcs vendem Camaro?" recebeu "Não trabalhamos com o Camaro no momento...". O prompt v14.25 removeu a regra fixa `missing_product` (parceiros) e delegou ao serviço declarado `human_services` com `requires=no_inventory_product`, mas esse serviço não estava cadastrado para `wesley_automoveis`.

- Migração de dados (sem schema): `supabase/migrations_pending_review/genesis_catalog_presentation_and_sourcing.sql`, com a confirmação ajustada para “Conseguimos buscar esse veículo pra você!”.
- Guard: `md5(settings)` antes = `c18f379caa109697f879950fb0fbda02` (antes: `sales.catalog_presentation` ausente; `human_services` = [`despachante`]). Depois = `fcc457ec8d5e8e2f022ee1d691e62f1a`.
- Resultado: `sales.catalog_presentation = {list_requires_criteria: true, max_items: 3}`; `human_services` = [`despachante`, `busca_veiculo`]. Apenas 1 linha alterada; `clinica_nubia_oficial` e `royal_4x4` inalterados.
- O CORE ativo já contém `salesCatalogPresentationPolicy` e `salesTenantHumanService` (`requires`); `scripts/test_catalog_presentation_policy.cjs` passou 5/5. As configurações são lidas por turno, sem cache.
- Rollback: bloco comentado ao final da migração.
- Não foi enviado WhatsApp real de teste.

## Aplicação complementar — pós-venda, textos dos serviços e janela de follow-up (24/10, 01:15 BRT)

Autorização do usuário: “pode publicar, mas antes quero que implemente que a mensagem de follow up nao deva ser enviada entre 21 e 6 da manhã. ai pode publicar, depois de validar”.

### Problemas de produção corrigidos
- 00:43/00:50: “Conseguimos buscar…” e “Fazemos sim! … despachante.” seguidos de “Entendi!”. A confirmação do serviço era colada antes do aviso de transferência, que reage como se o cliente tivesse pedido um atendente.
- 00:56: “Fazem documentação ? Regularizar” foi atribuído ao atendente sem mensagem. O turno foi marcado como pós-venda (`intent: after_sales`), que na Gênesis é silencioso (regra do PASSO_A_PASSO), apesar de ser pedido do serviço declarado.

### CORE (motor `mlKNPv862H2g3Gap`)
- Pedido que corresponde a um serviço declarado (`human_services`) não é tratado como pós-venda; o cliente recebe a confirmação. Pós-venda sem serviço declarado continua silencioso.
- Schema do modelo: `after_sales` só para problema/pendência de veículo já comprado; pedir um serviço não é pós-venda.
- `salesHandoffMessage(..., { reaction: false })`: sem “Entendi!”/“Sem problema” depois da confirmação de um serviço.
- Versão `9d9455db-33b0-40c0-be38-24ee44115706` → `eebbab87-35c5-456c-9327-0e2d6cc0265a` (ativa).

### Follow-up (entrada `3N5oN6sxtir9lFrA`, nó “Processar Follow-ups”)
- Nenhum follow-up entre 21:00 e 06:00 no fuso do tenant (`settings.timezone`, padrão America/Sao_Paulo). Ajustável por tenant em `settings.follow_up_quiet_hours = { start, end }`; valor inválido usa o padrão.
- Job reivindicado na janela volta a `pending` com `due_at` no fim dela (`error = 'quiet_hours_deferred'`), protegido pelo `lease_token`; nada é gerado nem enviado. Checado ao reivindicar e de novo antes do envio. Falha ao adiar = `failed`, sem envio.
- A fonte `n8n/code/whatsapp_follow_up_dispatch.js` estava defasada do nó publicado (o publicado exige credenciais Evolution do tenant, sem fallback global). A fonte foi igualada ao publicado antes da mudança, e o build passou a projetar o nó a partir dela.
- Versão `2772a573-24cb-480f-ba81-9e06c0d02158` → `e95f9020-a88f-4603-b1e4-8ce225293c4a` (ativa).

### Supabase (Gênesis)
- `supabase/migrations_pending_review/genesis_human_services_copy_20261024.sql`: confirmações de `busca_veiculo` (“…a nossa equipe pode verificar com lojas parceiras se consegue ele pra você!”) e `despachante` (“Sim! A loja cuida da documentação do seu veículo…”), sem prometer o veículo. Guard pelo texto anterior; md5 depois = `a5dd0f98e7efbd2f09a8b0d472f344c0`. Rollback no arquivo.

### Validação
- Antes de publicar: produção (rascunho e ativa) idêntica ao HEAD `2cece25` nos dois workflows; só o nó alvo foi trocado; demais nós, conexões e settings preservados; código ativo conferido após o PUT.
- Testes: `test_catalog_presentation_policy` 9/9 e `test_sales_follow_up` 13/13. Em todas as `scripts/test_*.cjs`: nenhuma falha nova (169 legadas, eram 173).
- n8n: zero execuções `error`/`crashed` após a publicação. Sem WhatsApp real de teste.
- Rollback: republicar o nó a partir do HEAD `2cece25` (versões anteriores acima).
