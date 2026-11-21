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

**Recorte do catálogo** (`retailCatalogShortlist`): o Gemini não recebe o catálogo inteiro. O motor escolhe os itens que a
conversa cita (nome, modelo, linha, categoria e largura, com tolerância a erro de digitação), soma os já apresentados na
sessão e envia cada item com um código curto (`c1`, `c2`…) no lugar do id; `retailResolveProducts` traduz de volta e
descarta código desconhecido. Sem nenhum acerto discriminante, vai o catálogo inteiro. Tamanho em
`settings.retail_policy.prefilter_limit` (padrão 30, máximo 40; `0` desliga). O resultado fica em `semantic_catalog`
(`mode`, `sent`, `total`). Plano e motivação: [retail_catalog_prefilter_plan.md](retail_catalog_prefilter_plan.md).

## Decisão da EXT (contrato)

Campos de identidade iguais aos do `services_v1` (`tenant_id`, `tenant_slug`, `instance`, `remote_jid`, `session_id`, `request_id`, `turn_token`, `contract`, `provenance`, `noria_contract_version`, `status`). Ações:

| Ação | Parâmetros | Execução no CORE |
| --- | --- | --- |
| `present_information` | `item_ids` | Fatos dos itens entram nos blocos aprovados para a redação |
| `send_product_media` | `item_id`, `asset_ids` (máx. 3) | Recarrega item e vínculos do mesmo tenant; só imagens `aprovada`, item `offerable`; confere hash, MIME e URL do Storage do projeto; reserva antes do envio; resultado desconhecido não é reenviado |
| `send_site_link` | `item_id` | Só com `site_url` cadastrado e item ofertável |
| `notify_specialist` | `reason` e `reasons` (`material_regra_propria`, `alto_padrao`, `cliente_decidido`), `materials` (ex.: `blend`, vindo do catálogo e da política) | Aviso ao destino configurado no tenant (ver abaixo); **não pausa a IA** |
| `handoff` | `reason` | Handoff genérico já existente: pausa a IA, sem nome de atendente |

Uma decisão `refused` não autoriza nada e leva à contingência neutra (mensagem de encaminhamento à equipe, com handoff). Uma decisão malformada, de outra proveniência ou com identidade divergente também não autoriza nada: como no `services_v1`, o turno falha antes de qualquer efeito e o ciclo de vida da fila decide entre nova tentativa e revisão humana, sem resposta ao cliente.

Regras da EXT JOYERÍA revisadas em 20/11/2026:

- Interpretação incerta (confiança baixa, ambiguidade ou pedido de esclarecimento) não autoriza aviso, fotos nem link: a IA esclarece primeiro.
- Pedido explícito de pessoa num caso de especialista gera aviso **e** handoff; troca e reclamação geram só handoff.
- Fotos automáticas só na primeira apresentação do item na sessão (`retail_context.media_sent_item_ids`, informado pela fase `prepare`); pedido explícito do cliente sempre vale.

## Aviso ao especialista (`notify_specialist`)

- Destino somente em `tenant_settings.settings.specialist_notification.recipient` (número E.164 do tenant). Nunca vem do modelo nem da decisão.
- Recusa se o destino for igual ao `remote_jid` do lead ou não for um número válido.
- Chave de idempotência: conversa + sessão, dentro do tenant (`specialist_notice_<conversa>_<sessão>`): um aviso por sessão, qualquer que seja o motivo (o motivo vai no conteúdo). A continuidade do turno é conferida antes da reserva, para uma reserva abandonada não travar a sessão. A conversa entra na chave porque toda conversa começa na sessão `initial` e o índice único da migration 003 não inclui a conversa (o de produção, `_v2`, inclui, mas não está nas migrations do repositório). Uma reserva persistida por chave (inserção única, nunca upsert) antes da chamada ao provedor; falha de banco na reserva vira evento "Falha ao avisar".
- Fotos com reserva sem resultado ou com resultado desconhecido na sessão nunca são reenviadas automaticamente (exigem reconciliação) e contam como já apresentadas para a EXT; o plano real das fotos é montado antes da redação, para o texto só anunciar o que será enviado.
- Estados: `reserved` → `sent` | `failed` | `unknown`. `unknown` (timeout, resposta sem ID) exige reconciliação e nunca dispara reenvio automático.
- Conteúdo: resumo fiel dos fatos da sessão e o contato do lead derivado do `remote_jid`; campos ausentes aparecem como "não informado".
- Registro em `channel_events` da conversa do lead (sem pausar a IA), para o painel mostrar "Especialista avisado".

## Assumir e retomar

Sem mudança: "Assumir" grava `conversation_assigned` com `handoff: true` (pausa a IA e cancela envios em andamento); retomar grava `resume_ai`. A confirmação no painel exige o evento persistido (commit `5b11e55`).

## Catálogo

Fonte: migration pendente `20261120200000_product_catalog` e carga gerada por `scripts/product_catalog_load.cjs`. A fase `prepare` carrega candidatos por tenant, ativos e ofertáveis, com limite e ordenação determinísticos; nunca o catálogo inteiro no prompt.

## Estado (20/11/2026)

| Peça | Arquivo | Estado |
| --- | --- | --- |
| Catálogo (schema) | `supabase/migrations_pending_review/20261120200000_product_catalog.sql` | Pronto, testado em PGlite, **não aplicado** |
| Carga do catálogo | `scripts/product_catalog_load.cjs` + `clients/joyeria/catalogo_pdf/carga/` | Pronto, testado em PGlite, **não executado** |
| EXT JOYERÍA | `n8n/sources/joyeria_extension.js` | Pronta e testada; gerada como workflow próprio para importação (`NORIA-EXT-JOYERIA-Decisao-Comercial.json`) |
| Funções puras do CORE | `n8n/sources/noria_retail.js` | Projetadas na região `retail_v1` do motor pelo gerador |
| Fases do CORE (prepare, finalize, fotos, aviso) | `n8n/sources/noria_core.js` | Implementadas e testadas com funções reais do motor (etapas 1–6) |
| Roteador e gerador | `n8n/sources/noria_router.js`, `scripts/build_noria_workflows.cjs` | Implementados (etapas 7–8); cadeia `CORE \| Retail \| …` gerada |
| Painel | `app/src/…` | Eventos do aviso e das fotos reconhecidos (etapa 9) |
| Configuração da JOYERÍA | `clients/joyeria/configuracao/tenant_settings_proposta.json` | Proposta testada, **não aplicada** (etapa 10) |
| Publicação | — | **Não feita**: exige autorização (exports regenerados, workflow da EXT criado no n8n, migration, carga, variáveis de ambiente) |

## Plano de integração ao CORE (sem quebrar os tenants atuais)

### Como o CORE funciona hoje (pontos de contato)

- **Roteador** (`noria_router.js`): tenants mapeados (`clinica_nubia_oficial`, `wesley_automoveis`, `noria`) têm ramo próprio; qualquer outro vai para `saas_dynamic`, que valida tenant, canal e instância e entrega `noria_client_policy`. Só a Núbia é marcada com `noria_pipeline = 'services_v1'`.
- **Gerador** (`build_noria_workflows.cjs`): a cadeia do pipeline em fases é criada por `configureServicesChain`, presa à EXT v2 da Núbia e ao seletor `noria_pipeline === 'services_v1'`.
- **Motor** (`noria_core.js`): `allowedBusinessProfiles` aceita três perfis; `turnPipelineFor` aceita só a capability `services_v1` e exige o vocabulário de serviços; o despacho principal chama `runServicesTurnPrepare/Finalize`; fotos só saem pelo módulo de vendas de veículos.
- **Painel**: eventos `specialist_notice*` e `retail_product_photo` não são reconhecidos e apareceriam como mensagens enviadas ao cliente.

### Regra de não regressão

Toda mudança entra atrás de duas travas que hoje nenhum tenant satisfaz: perfil `retail_consultative_v1` na política da EXT **e** `settings.noria_turn_pipeline` habilitado com capability `retail_v1`. Fora disso, cada função alterada devolve exatamente o mesmo resultado de antes. A cada etapa:

1. Bateria completa de `scripts/test_*.cjs` sem credenciais: o conjunto que passa hoje (114) continua passando e as 25 falhas pré-existentes continuam as mesmas (lista em `test_results_base.json` da auditoria).
2. Testes específicos: `test_noria_services_pipeline`, `test_nubia_extension_v2`, `test_export_fixes_salon_nubia`, `test_salon_holiday_hours`, `test_nb_bronze_prompt_v12_proposal`, adaptador do Salon e `npm test` do painel.
3. Gerador em `NORIA_BUILD_OUT_DIR` temporário: o diff dos workflows de Núbia, Salon, Gênesis e NORIA deve conter só os nós novos do ramo `retail_v1` e a revisão do motor.
4. Auditoria anti-hardcode.

### Etapas

| # | Etapa | Mudança | Risco para os atuais | Verificação específica |
| --- | --- | --- | --- | --- |
| 1 | Embutir `noria_retail.js` no motor | Gerador concatena as funções puras no código do CORE (sem `module.exports`) | Nenhum: só declara funções | Motor gerado carrega; hash novo; testes do motor iguais |
| 2 | Perfil e capability | `allowedBusinessProfiles` ganha `retail_consultative_v1`; `turnPipelineFor` aceita `retail_v1` com o vocabulário próprio (`retailVocabulary`), mantendo o caminho de `services_v1` intacto | Baixo: ramo novo só por declaração | Teste: services_v1 com a mesma configuração dá o mesmo resultado; retail_v1 sem vocabulário completo falha fechado |
| 3 | Fase `prepare` do retail | `runRetailTurnPrepare`: mesmas guardas do serviço (reset, IA desligada, trava humana, limite de uso), candidatos do catálogo (`retailCandidatePath`), interpretação Gemini com `retailSemanticSchema`, `retail_context.media_sent_item_ids` | Nenhum fora do retail | Fixtures: candidatos de outro tenant descartados; mais de 100 itens; falha do Gemini vira `semantic_failure` |
| 4 | Fase `finalize` do retail | `runRetailTurnFinalize`: verifica decisão (`retailVerifiedDecision`), redige com fatos autorizados, auditoria determinística (só preços, links e itens autorizados; sem telefone nem nome de atendente), entrega pelo ciclo existente (begin → provedor → confirm) | Nenhum fora do retail | Resposta com preço não autorizado é bloqueada; decisão recusada leva à contingência neutra |
| 5 | Fotos | `sendRetailProductMedia` depois da entrega do texto: relê item, vínculos e arquivos do tenant, `retailMediaPlan`, reserva por foto em `channel_events` (inserção única), `sendMedia` com MIME real e nome neutro; resultado desconhecido não é reenviado | Nenhum: função nova, sem tocar no caminho de veículos | Foto de outro tenant, não aprovada ou URL externa nunca sai; reserva duplicada interrompe |
| 6 | Aviso ao especialista | `sendSpecialistNotice` depois da entrega ao lead (se a entrega foi cancelada por Assumir, não avisa): destino só do cadastro, reserva `specialist_notice_<conversa>_<sessão>`, `sendText` ao número do especialista pela instância do tenant, evento de resultado | Nenhum fora do retail | Repetição e concorrência geram um aviso; timeout vira `unknown` sem reenvio; destino igual ao lead é recusado |
| 7 | Roteador | Ramo `saas_dynamic` marca `noria_pipeline = 'retail_v1'` só com declaração válida (contrato, capability, versão, piloto por contato); pino de lote como no serviço | Baixo: tenants atuais não declaram retail | Testes do roteador: Núbia, Gênesis, NORIA e Salon com o mesmo resultado |
| 8 | Gerador | Cadeia `CORE \| Retail \| …` (seletor, despacho, prepare, EXT decisão, finalize) ligada ao ramo falso do seletor atual; EXT JOYERÍA gerada como workflow próprio | Médio (gerador compartilhado): conferido pelo diff do item 3 da regra | Diff de workflows restrito aos nós novos |
| 9 | Painel | `specialist_notice` vira evento de sistema ("Especialista avisado", "Falha no aviso", "Aviso incerto"); reservas (`*_attempt`) ficam internas; `retail_product_photo` exibido como foto enviada | Baixo | `npm test` + testes novos de classificação |
| 10 | Configuração e homologação | Aplicar migration, criar tenant/canal/settings da JOYERÍA, carga do catálogo, upload das fotos, variáveis `EVOLUTION_*_JOYERIA` e `NORIA_INGRESS_FORWARD_TOKEN_JOYERIA`, rollout `pilot` só com o número de teste | **Exige autorização explícita** (produção) | Roteiro de homologação com o número de teste; rollback por `enabled: false` |

### Rollback

- Etapas 1–9 são código: reverter o commit e regenerar. Sem a declaração `retail_v1`, nada novo executa.
- Em produção: `settings.noria_turn_pipeline.enabled = false` (ou rollout `pilot` vazio) desliga o retail sem afetar outros tenants; mensagens em andamento ficam presas ao pino e vão para revisão humana, como no serviço.
- Catálogo: desativar itens; o rollback da migration recusa apagar tabelas com dados.

### Decisões

- **Frase ao cliente quando o especialista é avisado** (decidido em 20/11/2026): "Uma especialista irá entrar em contato". Fica em `settings.retail_policy.specialist.customer_message` (texto do tenant, nunca no código). A EXT repassa a frase; o CORE a acrescenta literalmente à resposta **só no turno em que o aviso é reservado pela primeira vez** (`retailSpecialistCustomerLine`), e a IA continua atendendo até Assumir. Sem frase configurada, o aviso segue e a decisão registra `SPECIALIST_CUSTOMER_MESSAGE_NOT_CONFIGURED`.
- **Comportamento da IA:** a persona do Google Docs é a base do atendimento e vira `settings.system_prompt` (etapa 10). A cópia `clients/joyeria/fontes/persona-google-docs.txt` foi conferida linha a linha com o documento publicado em 20/11/2026: mesmo conteúdo (diferenças só de marcadores de lista). Onde a persona diverge de decisões posteriores de João (endereço, preço da abaulada 2 mm, parcelamento, link do site para o cliente orientado pela IA), valem as decisões registradas em `clients/joyeria/plano-implementacao.md`.
- Conteúdo comercial de pagamento, prazo, frete, horário e endereço fica na persona e em `business_facts`; a carga dessas configurações é parte da etapa 10.
