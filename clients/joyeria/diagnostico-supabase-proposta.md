# JOYERÍA — diagnóstico SQL e proposta para revisão

**Consulta:** 20/11/2026, leitura de metadados do Supabase `NORIA-prod`, PostgreSQL 17, e fontes locais. Nenhum DDL, migração, insert, upload, publicação ou envio foi executado. Schema e dados podem mudar; rever antes de implementar. Esta proposta é para análise do Claude e responsável técnico; não é migração aprovada.

## 1. Estado observado no banco

| Estrutura | Evidência do Supabase | Avaliação para JOYERÍA |
| --- | --- | --- |
| `tenants`, `tenant_settings`, `channels` | Existentes com RLS. `channels` possui `tenant_id`, tipo, `external_id`, `status`, `credentials_ref`, `config`; unicidade `(tenant_id, type, external_id)`. Consulta por slug contendo `joy` retornou zero linhas. | Reutilizar após confirmar identificador e regras operacionais. Unicidade é por tenant, não prova que uma instância não esteja vinculada a outro tenant; validar roteamento. Nenhum tenant JOYERÍA foi encontrado por esse filtro, que não identifica nomes alternativos. |
| `tenant_service_catalog` | Existe com `tenant_id`, `external_source`, `external_id`, `category`, `name`, `description`, `billing_unit`, `price numeric`, `notes`, `metadata jsonb`, `active` e timestamps. Restrição única `(tenant_id, external_source, external_id)` e FK para `tenants`. RLS habilitada. | Candidato para itens aprovados; uma linha por variante pode representar par, descrição e um preço. Não há coluna de imagem, múltiplos preços, composição tipada ou vigência. `metadata` comporta dados adicionais, mas persistir ali não significa que CORE ou painel os utilizem. |
| `search_tenant_service_catalog` | RPC em produção retorna categoria, nome, descrição, unidade, preço, horas, notas e ranking; limite máximo 10, sem ID nem `metadata`. | A consulta existente não entrega IDs, imagens ou composição. Não supor que inserir imagens em JSON permite recuperação ou envio. |
| `whatsapp_catalog_products` e `whatsapp_catalog_sync_state` | Existem. Produtos incluem tenant, instância, ID externo, preços em centavos, disponibilidade, visibilidade, `image_url`, `image_urls`, sincronização e payload; únicos `(tenant_id, instance_name, product_id)`. Na consulta, tabela de produtos estava vazia. | O CORE local usa essas estruturas como **cache de catálogo WhatsApp por instância**, com regras de sincronização e frescor. Não inserir dados do PDF ali como se fossem produto sincronizado da Evolution; isso poderia interferir com estado e desativação do cache. Ver `n8n/sources/noria_core.js` em `salesLoadWhatsappCatalogCache` e rotinas de sync. |
| `genesis_inventory_vehicle_images` | Existe em produção, FK composta para inventário Gênesis, caminho/bucket específicos e MIME JPEG. Embora a migration esteja em `migrations_pending_review`, a tabela está aplicada no ambiente consultado. | Serve ao inventário de veículos da Gênesis; não reutilizar diretamente para joias. O contrato de fotos no CORE é específico do fluxo automotivo e exige revisão para suporte genérico. |
| Conversas e fila | `channel_events`, `conversation_turn_queue`, `conversation_turn_delivery_attempts` e recibos existem com RLS. | Consultar contratos existentes para IA, handoff e rastreio; o fluxo de entrega do turno ao cliente não comprova envio de resumo para número externo independente. Não usar `chat_id` de cliente como se fosse destino Joyce. |

### Limite do CORE para catálogo

Em `n8n/sources/noria_core.js`, `loadCatalogContext` consulta até 101 registros de `tenant_service_catalog` e utiliza no máximo **100**. O inventário da loja contém 191 produtos públicos. Uma carga de 191 registros, isoladamente, **não assegura que todos estarão no contexto da IA**; projetar busca contextual/paginada e prova por produto, sem inchar prompt ou introduzir hardcode. A RPC atual limita a 10 e não retorna imagens ou `metadata`.

## 2. Storage, imagens e segurança

O banco consultado apresenta buckets `channel-media` **privado** e `product-catalog` **público**. `product-catalog` aceita JPEG, PNG e WebP, limite de 10 MiB; seus objetos são públicos pelo próprio bucket, independentemente de uma política SELECT RLS. Portanto, usar esse bucket para imagens de produtos só é adequado se a divulgação pública for deliberadamente autorizada; nunca guardar documentos privados ou conteúdo de conversa nele.

A política atual de leitura de `channel-media` confere o primeiro segmento do caminho por igualdade ao slug do tenant e exige membro ativo; a migration local antiga usa `LIKE`, portanto os arquivos locais não descrevem necessariamente o estado real. Não concluir que esse bucket deve ser usado para fotos públicas do catálogo sem estudar seu contrato e os consumidores.

No banco há políticas permissivas múltiplas em `channels` e no catálogo. Elas se combinam por **OR**; não basta ler uma política isolada como se fosse a única. As funções observadas `is_active_member` e `is_active_tenant_member` usam tabelas/semânticas diferentes. Não foi realizado teste de acesso autenticado nem auditoria completa dos grants; verificar identidade real, papéis, inserts/updates e isolamento cruzado antes de qualquer adoção. Não remover ou alterar políticas neste levantamento.

As 32 imagens locais do PDF estão ligadas por página no [manifesto](catalogo_pdf/manifesto-produtos.json). Definir para cada imagem identidade de produto/variante, armazenamento, MIME, hash, ordem, origem, titularidade/autorização e URL ou acesso adequado. Os arquivos devem ser enviados na conversa pela Evolution quando o item correto for escolhido; não inventar URL, nem confundir vínculo de imagem com prova de entrega. O bucket `product-catalog` é público e a tabela Gênesis aceita apenas JPEG; o PDF forneceu JPEG e PNG — reprocessar somente se o contrato aprovado exigir, preservando originais.

## 3. Proposta de mapeamento, sujeita a revisão

**Sem nova tabela aprovada neste documento.**

1. Identidade e operação: `tenants`, `tenant_settings` e `channels` existentes, configurados conforme o contrato real do roteador; números e destino apenas no escopo do tenant. Configurações de canal não são prova de conexão.
2. Produtos: avaliar `tenant_service_catalog` como catálogo canônico de itens/variantes, com ID de origem estável (`pdf-2026-pNN` na prévia), nome, descrição, preço por par e fonte. Definir onde residem material verificável, largura, vigência, status de revisão e ligação ao produto do site; o identificador da página é rastreável nesta edição do PDF, mas não garante identidade entre edições. Não criar um segundo produto ao correlacionar com o site sem correspondência validada.
3. Fotos: definir com o responsável se extensão de estrutura existente ou novo vínculo genérico é necessário, com integridade de tenant/produto, permissões, hash e ordenação. `whatsapp_catalog_products` é cache da instância, não catálogo canônico do PDF. Definir como o adaptador e o CORE buscarão e provarão que a imagem corresponde ao produto antes de enviar.
4. Venda e encaminhamento: EXT interpreta política JOYERÍA com auxílio semântico; CORE valida contrato e controla sessão. Aviso para Joyce é mensagem independente com resumo e telefone do lead; a IA permanece ativa até **Assumir** no painel. Precisamos definir/revisar mecanismo persistente para notificação e deduplicação, sem presumir necessidade de nova tabela. Falha, timeout e envio incerto devem ser reconciliados.
5. Integração de dados: não guardar credenciais em SQL ou arquivos. Ao alterar schema, respeitar decisão arquitetural do responsável, migration versionada, RLS/grants e plano de rollback. Carga somente após validação e autorização para o ambiente correspondente.

## 4. Material local preparado

- [Prévia SQL do catálogo](catalogo_pdf/preview-catalogo.sql): **SELECT com VALUES**, sem DDL ou escrita, 16 registros do PDF e caminhos locais das imagens. Útil para Claude revisar mapeamento; caminhos não são URLs nem objetos do Storage. O SQL não carrega dados nem configura tenant.
- [Manifesto JSON](catalogo_pdf/manifesto-produtos.json): nomes, descrições, largura, preço por par, página e SHA-256 das 32 imagens extraídas; decisões de preço confirmadas identificadas. A correspondência da Elegance 6 mm com o site foi confirmada por João; preço do site requer alinhamento posterior.
- [Inventário do site](inventario-produtos-site.md) e JSON em `fontes/`: 191 produtos públicos na coleta, sem garantia de estoque real ou abrangência de produtos não publicados.
- Plano completo em [plano-implementacao.md](plano-implementacao.md). No estado atual, a JOYERÍA não foi implementada ou cadastrada nesta tarefa.

## 5. Pontos para o Claude revisar

- Catálogo canônico: aproveitar `tenant_service_catalog`, cobertura superior a 100 itens, consulta por intenção, enriquecimento e prova do produto, sem adulterar cache WhatsApp.
- Modelo de fotos e política Storage: associação item/tenant sem vazamento, escolha pública ou privada, entrega Evolution, seleção da variante certa, MIME, autorização e proteção contra URL externa inadequada.
- Normalização e atualização de preços/imagens: origem, vigência, conflitos de site, preço em centavos versus `numeric`, par versus unidade, versões e sincronização idempotente sem excluir itens de outros tenants.
- Acesso real: políticas permissivas em conjunto, grants, permissões de escrita, `security definer`, `search_path`, RLS, funções de membro distintas e testes de tenant A versus B. Não presumir segurança só pelo indicador RLS.
- Assunção/aviso: estados distintos notificado e assumido; destino por tenant, contato válido, histórico do cliente e resumo mínimo, corrida com IA, deduplicação, timeout, reconciliação, sucesso/erro e controles do painel.
- Migração e rollback: quais mudanças são indispensáveis; autorização explícita antes de schema/dependências, reprodução local, SQL idempotente, índices, testes e plano de reversão que preserve dados e outras operações.

## 5a. Conferência adicional — 20/11/2026 (auditoria)

Nova leitura somente de metadados no `NORIA-prod`:

- Nenhum tenant com "joy" no slug ou nome.
- Privilégios padrão do schema `public`: `anon` e `authenticated` recebem ALL em tabelas novas. `channels`, `tenant_settings` e `tenant_service_catalog` já têm grants completos para `anon`, inclusive TRUNCATE, que não é coberto por RLS. É uma situação anterior à JOYERÍA; as tabelas novas devem revogar explicitamente.
- `channels` e `tenant_service_catalog` têm SELECT permissivos com helpers diferentes, somados por OR. `channel_events` tem política RESTRICTIVE.
- Buckets: `product-catalog` público (JPEG, PNG, WebP, até 10 MiB, 23 objetos, 11 deles da Gênesis), `channel-media` privado e `Noria Disparos` público sem limite de tipo ou tamanho.
- `search_tenant_service_catalog` é `SECURITY INVOKER`, com `search_path` fixo e limite padrão de 5 resultados.
- Evolution Manager: a instância `joyeria` existe, mas estava desconectada e sem número pareado.

## 6. Validação e limites

Consultas de inventário foram **SELECTs de metadados**, sem leitura de mensagens ou dados de clientes; slug foi pesquisado pelo padrão `joy`. As evidências em produção refletem o momento da consulta. Não se executou a prévia SQL em banco, nem testes de isolamento autenticado, APIs de mídia ou delivery. Nenhuma alteração no Supabase de produção foi feita.
