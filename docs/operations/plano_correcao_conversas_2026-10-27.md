# Plano de correção — conversas de 24 a 27/10/2026 (Gênesis e Núbia) — v3

Base: análise de `channel_events`, `conversation_turn_queue` e `follow_up_jobs` (Supabase `gfwwawazivmuqyctjsxj`) de 24/10 03:00 UTC a 27/10, e leitura do código local em `dev`. Versões em produção na análise: Motor `39795829`, EXT Gênesis `c09ca46c`, Entrada `e95f9020`, EXT Núbia `5d545c63`.

**v2** incorpora a revisão do Codex (27/10) e acrescenta os itens da Núbia (N-1 a N-3). Mudanças em relação à v1 estão marcadas com **[v2]**.
**v3** aplica os ajustes finais da segunda revisão do Codex (N-1, P1-6, P1-7, critérios de amostra e ordem), marcados com **[v3]**.

Este documento é para revisão; nada aqui está implementado. **Homologação com Gemini pago e publicação continuam dependendo de autorização explícita** para cada item.

---

## 1. Princípios

1. Regras do `AGENTS.md`: CORE genérico, regra comercial no EXT, nada de `if (tenantSlug === ...)`, sem resposta comercial pronta, regex só para parsing técnico.
2. **Prove-It**: todo item começa reproduzindo o caso real (dados anonimizados) com teste que falha.
3. **A auditoria nunca afrouxa.** Contrato de fallback, explícito em todos os itens **[v2]**:
   - original reprovada + reparação reprovada → revisão humana;
   - original aprovada + melhoria de estilo reprovada → vai a original aprovada;
   - no máximo **uma** reparação por candidata/turno; nenhum item adiciona uma segunda.
4. Nada de liberar fila em massa, reenviar mensagem a cliente ou mudar schema sem aprovação.
5. **Um item por publicação [v2]**: quando dois itens forem publicados juntos, o plano justifica por que são indivisíveis.
6. O workflow de **Entrada** (`3N5oN6sxtir9lFrA`) só é publicado quando necessário, fora do pico (histórico de travamento do n8n em VPS de 1 vCPU).
7. **Diagnóstico antes de corrigir [v2]**: itens com hipótese começam pela observabilidade e pela reprodução; nenhuma correção se apoia só em heurística.

---

## 2. Situação encontrada

| | Conversas | Respostas da IA | Erros | Revisões sem resposta posterior |
|---|---|---|---|---|
| Núbia | ~140 | 80 | 3 (sábado de manhã, antes das correções) | 0 |
| Gênesis | ~185 | 219 | 19 (11 depois de 25/10 01:36 UTC) | 4 |

Fila: Gênesis com 65 conversas em `review` (16 dos últimos 3 dias) e 5 em `uncertain`; Núbia com 38 em `review` antigas.

---

## 3. Itens

### P0-1. Clientes sem resposta após revisão

**Comprovado [v2]**: 4 conversas da Gênesis sem nenhuma resposta posterior à revisão (…3451 em 26/10 18:00, …2928 em 26/10 18:52 com fila `uncertain`, …8933 em 27/10 08:22 e uma de 25/10).
**Hipótese [v2]**: a equipe não percebe a pendência a tempo. Não comprovado.

**Imediato (sem código)**: entregar a lista das 4 conversas à equipe da Gênesis.

**Código (sem schema)**: aviso no centro de notificações do operador (`docs/operator-notification-center.md`) para "revisão aberta sem resposta humana posterior".
- **[v2]** Só conta como resolvido um outbound humano efetivamente enviado; outbound técnico ou com falha não resolve.
- **[v2]** Aparecimento: imediato ao entrar em revisão, com destaque após 15 min sem resposta.
- **[v2]** O aceite de tempo vale com o painel aberto; com o app fechado vale a limitação já documentada na central de notificações.
- Somente leitura: não libera nada.

**Teste**: unitário da consulta (revisão com/sem resposta humana, outbound técnico não resolve, isolamento por tenant).

---

### P0-2. Erro 400 sem diagnóstico (27/10 08:22, …8933)

**Evidência**: `ai_error = "Request failed with status code 400"`, `failure_retryable=false`, fila em `review`. Mensagens: "Só tem 1 foto ?" / "Vcs são de onde ?".
**Hipótese**: PostgREST (RPC com `RAISE`) ou Gemini (pedido inválido). Não comprovado.

**Passo 0 — observabilidade [v2]**: capturar na fronteira HTTP (`httpJson`/`supabaseGet`/`supabasePost`) e gravar no evento `raw_payload.http_failure = { provider, operation, route, status, code }`:
- `provider`: `supabase_rest`, `supabase_rpc`, `gemini`, `evolution`;
- `operation`: o rótulo já usado nas chamadas (ex.: `media_notice`, nome da RPC);
- `route`: rota **normalizada** por modelo fixo (ex.: `/rest/v1/rpc/{fn}`, `/v1beta/models/{model}:generateContent`), nunca o caminho real, que pode conter identificadores ou credenciais;
- `code`: token sanitizado (`^[A-Z][A-Z0-9_:]{5,80}$`) ou código do provedor; nunca corpo, PII ou chave.

**Teste**: classificação com erros simulados de cada provedor; assert de que nenhum campo contém telefone, chave, URL real ou corpo.

**Aceite**: o próximo 400 identifica provedor, operação e código. A correção da causa vira item próprio.

---

### P0-3. Regra do anúncio não funciona e respostas expõem detalhes internos

**Evidência** (desde 25/10 01:36 UTC):
- ~15 leads do anúncio "PXC 2023 / Crosser 2021 / Tornado 2025" com "Olá! Posso ter mais informações sobre isso?"; 1 resposta citou um veículo (só a Tornado); as demais genéricas.
- Frases que expõem o funcionamento interno: "Esse modelo de entrada automática é o Gênesis Automóveis", "não temos detalhes específicos dele carregados aqui", "Esse modelo não está identificado no anúncio de origem".
- Zero `dialogue_repair` com `AD_VEHICLE_NOT_ADDRESSED`.
- A parte "frase automática conta como pedido" funcionou (`request_topics` preenchido).

**Comprovado por leitura de código**: a reidratação do `raw_payload` roda em todas as fases; o estoque chega à finalização em `intermediate.inventory`.

**[v2] Por que zero reparações NÃO prova que `ad_vehicles` estava vazio**: a checagem de estilo só roda com `audit.status === 'accepted' && !dialogueRepair` (`noria_core.js`, bloco `styleIssuesFor`). Uma reparação factual anterior no mesmo turno impede a checagem.

**Hipóteses a confirmar**:
- H1: `ad_vehicles` vazio na finalização por formato do estoque da planilha (`model`/`year`) diferente do snapshot usado nos testes.
- H2 **[v2]**: anúncio presente só no **histórico** (turno seguinte ao clique): a finalização usa `salesReferralForTurn([], turn.messages, context)` (só o turno atual), enquanto a preparação usa o histórico.
- H3 **[v2]**: resposta aceita **depois de uma reparação factual**, e a checagem de estilo não roda.
- H4: o modelo recebe `official_facts.referral.ad_vehicles` vazio e escreve "não identificado".

**Passo 0 (confirmar antes de corrigir)**:
1. Gravar no evento, só como contagem/motivo **[v2]**: `ad_vehicles_prepare_count`, `ad_vehicles_finalize_count` e `style_check = { evaluated: bool, skipped_reason: 'audit_not_accepted' | 'prior_repair' | null }`.
2. Teste de integração com o executor de homologação (`scripts/homolog/genesis_executor.cjs`, modo `fixtures`) com as fases reais e estes cenários **[v2]**:
   - clique de anúncio no turno atual;
   - anúncio só no histórico (segunda mensagem do cliente);
   - resposta aceita após reparação factual;
   - estoque no formato da planilha.
   Assert das contagens nas duas fases e do motivo de a checagem não ter rodado.

**Correção (depois de confirmar)**:
- Corrigir a origem comprovada.
- **[v2]** Não remover `!dialogueRepair` simplesmente: manter o limite de uma reparação por candidata/turno. Se H3 se confirmar, a solução é incluir `AD_VEHICLE_NOT_ADDRESSED` na **mesma** reparação factual (uma só chamada), não abrir outra.
- Reescrever a regra "ANÚNCIO DE ORIGEM" do EXT sem jargão interno que o modelo possa ecoar, e instruir na redação: nunca comentar como a mensagem chegou nem o que o sistema tem ou não carregado.
- **[v2]** Exposição de detalhes internos é avaliada **no contexto** (auditor/homologação), não por bloqueio de palavras isoladas como "identificado".

**Testes**: integração do passo 0 (falha antes); unitários de `salesAdInventoryCandidates` com os anúncios reais; homologação com Gemini real (autorizada) com 5 anúncios.

**Aceite em produção [v2]**:
- denominador: leads com clique de anúncio cujo texto cita ≥ 1 veículo do estoque;
- amostra mínima: 20 leads; **[v3]** se aos 7 dias houver menos de 20 casos, reportar resultado **preliminar**, sem declarar a meta validada, e seguir coletando;
- meta inicial: ≥ 80% das primeiras respostas citam veículo do anúncio, com revisão manual da pertinência (vendido não oferecido, pergunta adequada quando há vários);
- 0 respostas com exposição de funcionamento interno na amostra revisada.

---

### P1-4. Fatos inventados e "disponível" sem prova; reparação repete o erro

**Evidência**: …4918 ("outros modelos disponíveis"), …9789 ("Crosser 2023 disponível"), …4503 (política inventada), …4636.

**Comprovado**: o auditor barrou corretamente. A reparação recebe códigos e o texto rejeitado inteiro, **sem os segmentos** que falharam.

**Correção**:
- Passar à reparação os segmentos `unsupported`, `contradicted` e `uncertain` **[v2]**, com o texto e a evidência relevante, para retirar ou reformular sem afirmar.
- **[v2]** "Anunciado" também é afirmação factual: só pode ser usado com prova de anúncio/publicação no ledger. Não haverá troca automática de "disponível" por "anunciado".
- **[v2]** `UNVERIFIED_PRODUCT_AVAILABILITY` **não** está em `SALES_REPAIRABLE_ISSUES`. Primeiro o teste mostra se ele aparece na auditoria original ou só na reparação. Só se for acrescentado à lista reparável, com teste específico e mantendo a auditoria da nova candidata.
- Fallback explícito: original reprovada + reparação reprovada → revisão.

**Testes**: replay dos rascunhos reais no validador; reparação simulada que repete o erro → turno continua retido; homologação real dos 4 casos (autorizada).

**Aceite**: queda de revisões por esses códigos **sem** aumento de fato sem prova enviado (amostra manual de 20 respostas).

---

### P1-5. Auditor aceitou atributo trocado ("freio flex")

**Evidência**: …3451, 26/10 18:00 — "e freio flex" classificado como `supported_fact` usando o fato de combustível `FLEX`.

**Correção [v2]**: só instrução do auditor + matriz de homologação. A instrução explicita que um trecho só é `supported_fact` quando **produto, atributo, valor e qualificadores** correspondem ao fato citado; copiar o valor não comprova outro atributo.

**Matriz de homologação (Gemini real, autorizada)**:
| Trecho | Fato | Esperado |
|---|---|---|
| "combustível flex" | combustível `FLEX` | aceitar |
| "freio flex" | combustível `FLEX` | rejeitar |
| atributo correto de outro veículo | fato do veículo em foco | rejeitar |
| paráfrase correta ("roda com álcool e gasolina") | combustível `FLEX` | aceitar |

**[v2]** Não há regex para interpretar "freio". Comparação de campos estruturados de atributo fica como possível proteção futura, se o contrato passar a fornecê-los; não é apresentada como garantia determinística.

---

### P1-6. Follow-up em loop com robô de outra empresa (Núbia)

**Evidência**: …0455 ("Photoliliaaraujo"): todo dia o follow-up dispara, o robô responde, a IA responde e novos follow-ups 3h/24h são agendados (jobs de 24, 25 e 26/10 com âncoras novas).

**Comprovado**: a detecção de atendimento automático só existe no caminho de vendas e, mesmo lá, a supressão exige `turn.suppression_evidence.non_customer` (`noria_core.js`, bloco `autoContactReason`).

**[v2] Duas decisões separadas**:
1. **Silenciar o atendimento**: só com evidência validada de `non_customer`, dentro do contrato de supressão existente (ciclo de validação e auditoria). **Não** haverá supressão baseada só em saudação + ausência de histórico humano (risco de falso positivo: mensagem colada, encaminhada ou cliente com WhatsApp Business).
2. **Interromper a renovação de follow-ups**: regra explícita de agendamento, por evidência, sem reconhecer frases.
   - **[v3]** "Resposta a um follow-up" só é considerada comprovada quando a mensagem recebida **cita** o follow-up (referência explícita da mensagem citada do WhatsApp apontando para o `external_message_id` do follow-up). Sequência temporal sozinha não prova que é resposta.
   - **[v3]** Sem prova, vale um limite de renovação por conversa e janela (ex.: no máximo N sequências automáticas em 7 dias), definido com o usuário.
   - **[v3]** O limite **não** pode bloquear o cliente que volta interessado: qualquer mensagem do contato tratada como cliente (sem evidência `non_customer`) continua recebendo resposta normal; o limite só afeta a criação de novos follow-ups automáticos.

**Testes [v2]**:
- replay anonimizado de …0455;
- mensagem humana posterior do mesmo contato não fica bloqueada para sempre;
- o despachante confere a elegibilidade **antes** de enviar jobs já pendentes.

**Aceite**: nenhuma sequência renovada indefinidamente com o mesmo contato em 7 dias, sem cliente real silenciado.

**[v4] Medição de 24 a 27/10 (só leitura)**:
- Robôs de empresa recebendo resposta e follow-up na Núbia: Photoliliaaraujo (…0455, 3 follow-ups) e um "Espaço …" (follow-up "Será sempre bem-vinda! Como posso te chamar?" duas vezes). Nenhuma supressão `non_customer` registrada. Na Gênesis não apareceu robô de empresa no período.
- Follow-up depois de o cliente encerrar ("Não, obrigada", "Obrigada", "no momento não posso"): Núbia 16 de 86, Gênesis 6 de 52. Exemplo: …67228 recebeu 3 follow-ups depois de "Não, obrigada".
- Núbia: 14 follow-ups são despedidas atrasadas ("Por nada! Tenha um ótimo dia.", "Obrigada pela preferência."), enviadas horas depois como se fossem retomada. Indica que o gerador de follow-up responde à última mensagem em vez de retomar.
- Conversas com 3 ou mais follow-ups em 3 dias: Núbia 5, Gênesis 2.
- Correção prevista junto com P1-6/P1-7: o encerramento pelo cliente (`customer_disposition` validado) cancela os follow-ups pendentes e impede novos. Follow-up que não é retomada (despedida) não é enviado.

---

### P1-7. Follow-up com o mesmo texto repetido

**Evidência**:
- Núbia (`gemini_follow_up`): textos 3h e 24h quase idênticos em 4 conversas (…0455, …1906, …3337, …9946); em …1906 o follow-up foi uma saudação ("Será sempre bem-vinda! Como posso te chamar?").
- Gênesis (`configured_follow_up`): "Oi! Podemos continuar seu atendimento na Genesis Automóveis?" duas vezes no mesmo chat em poucas horas (…6511, …3436): cada nova resposta da IA reinicia a sequência.

**[v2] O gerador já recebe as últimas 16 mensagens** (`whatsapp_follow_up_dispatch.js`). A correção é:
- marcar explicitamente quais mensagens do contexto são follow-ups;
- consultar a janela temporal necessária (16 mensagens não garantem 7 dias);
- deduplicação por tenant, canal e conversa; job duplicado encerrado com motivo rastreável;
- **exclusão mútua**: a checagem antes de enviar não basta com jobs concorrentes. **[v3]** O lease de um job não comprova exclusão por conversa; a deduplicação precisa de uma trava por (tenant, canal, conversa) — de preferência a trava da fila já existente (`conversation_turn_queue`), sem schema novo; se não for possível, levar ao usuário antes. **Teste obrigatório: dois jobs diferentes da mesma conversa executando em concorrência → no máximo um envio, o outro encerrado com motivo.**
- igualdade normalizada é a primeira barreira; texto quase igual e a causa do reinício diário da sequência (P1-6) também precisam ser tratados.

**Risco**: workflow de Entrada → publicar fora do pico.

---

### N-1. **[v2] Núbia repete "sou parte da equipe" e pede o nome várias vezes**

**Evidência (14 dias)**: 70 de 858 mensagens da IA da Núbia com "parte da equipe", 95 com "bem-vinda", 68 pedindo o nome.
- …1038: apresentação e pedido de nome às 22:25; na manhã seguinte, depois de um follow-up que já chamou a cliente pelo nome, a IA repetiu "Sou parte da equipe da NB Bronze. Como posso te chamar?" e respondeu "Tudo ótimo por aqui!" duas vezes seguidas.
- …9775: depois de "Entendi amor obrigado" e de uma reação, a IA voltou a dar boas-vindas e pedir o nome (já conhecido: Cristiane).

**Origem da instrução**: prompt da Núbia no Supabase: "Na abertura, apresente-se como parte da equipe e pergunte o nome".

**Comprovado por leitura de código**: no caminho fundamentado (`callGroundedGemini`), o modelo só recebe respostas anteriores com `raw_payload.grounding.revision === 'canonical_v2'` **e** `prompt_revision` igual à atual. Ficam de fora follow-ups, mensagens do atendente, respostas diretas de fatos sem `prompt_revision` e tudo anterior a uma troca de prompt. (Mesma classe de falha corrigida na Gênesis em 24/10, commit `9221ae6`.)

**[v3] Causa plausível, não comprovada por completo**: o modelo também recebe as mensagens do cliente e `previous_validated_state`, que pode conter o nome. O histórico incompleto é um defeito concreto, mas só o replay dos casos dirá se ele explica todas as repetições.

**Passo 0 [v3]**: replay de …1038 e …9775 registrando exatamente o que o modelo recebeu (contexto, `previous_validated_state`, nome) e comparando com a resposta.

**Correção (após o replay)**:
- **Contexto [v3]**: histórico **recente e limitado** da sessão (ex.: últimas 12 mensagens), em ordem, com IDs, identificado por autor (cliente, IA, follow-up, atendente). Excluir eventos técnicos e envios que falharam. Separação explícita entre **contexto da conversa** e **fatos oficiais**: mensagens antigas da IA (de qualquer revisão de prompt) entram como contexto, **nunca** como fonte de fato — a regra `old_assistant_facts_excluded` continua.
- **Nome [v3]**: só vale nome com origem validada — declaração do próprio cliente com evidência ou o estado validado existente. Um nome dito por follow-up ou por resposta anterior da IA ajuda a entender a conversa, mas **não** vira nome comprovado.
- **`opening` [v3]**: calculado pela sessão real (fronteira de atendimento), considerando mensagens **efetivamente enviadas** pela IA, follow-ups e atendimento humano anteriores na sessão. Falha técnica e troca de prompt **não** reiniciam a abertura.
- **Prompt [v3]** (dado no Supabase, com md5 e texto anterior guardados): instruções separadas — (a) apresentar-se só quando a abertura for pertinente (`opening=true`); (b) pedir o nome só quando desconhecido **e** necessário, podendo coletá-lo depois da abertura; variar a forma; não repetir saudação já feita.
- A trava de estilo de repetição (das vendas) **não** é estendida à Núbia neste item sem reprodução própria.

**Testes**:
- replay de …1038 e …9775 (anonimizados): o contexto contém a apresentação anterior; `opening=false`; nome só de origem validada;
- **[v3]** falha técnica e troca de prompt no meio da sessão não reiniciam `opening`;
- **[v3]** mensagem antiga da IA com preço ou política **incorreta** aparece no contexto, mas não autoriza repetir o erro (o fato continua vindo só das fontes oficiais);
- **[v3]** nome citado só por follow-up não é tratado como comprovado;
- homologação real (autorizada) com os dois casos.

**Aceite**: na amostra de 7 dias, nenhuma conversa com "parte da equipe" ou pedido de nome repetido depois da primeira resposta.

### N-2. **[v2] Núbia: respostas em sequência repetidas ("Tudo ótimo por aqui!")**

Mesma causa provável do N-1 (contexto incompleto). Validar com o mesmo replay; se persistir após N-1, abrir item próprio.

### N-3. **[v2] Núbia: robô de outra empresa e follow-up** — ver P1-6 e P1-7 (mesma correção, aplicada ao caminho fundamentado).

---

### P2-8. Tempo limite do Gemini (45 s) e fila em `uncertain`

**Evidência**: …9009 (26/10 10:23) e …2928 (26/10 18:52, `uncertain`, cliente sem resposta).

**[v2]** O tratamento de falha do CORE já alerta que um timeout pode ocorrer depois de o banco avançar o estado; a decisão passa por `magia_fail_turn`.

**Correção [v2]**: retry **somente** quando o estado durável, verificado sob o controle da fila, comprovar que é seguro (nenhum efeito executado, tentativas e backoff respeitados). Não basta `sendAttempted === false` nem a ausência local de retorno de `begin_turn_delivery`.

**Prioridade [v2]**: diagnóstico antecipado (há cliente sem resposta): ler a máquina de estados e reproduzir o caminho de …2928 antes de propor mudança.

**Resultado do diagnóstico (27/10, só leitura)**:
- …2928: o cliente mandou "Blz" e "Obrigado" (18:51). O motor criou a tentativa de entrega às 18:51:48 (`sending`) e a chamada estourou o limite de 45 s das chamadas não-Gemini (envio pela Evolution ou gravação durante o envio). Como o envio já tinha começado, `magia_fail_turn` marcou `uncertain` com `hold_reason = delivery_reconciliation_required`, tentativa de entrega `uncertain` sem `provider_message_id`.
- O `uncertain` está **correto pelo desenho de segurança**: não se sabe se a mensagem saiu. O problema é que **nada faz a reconciliação** depois.
- Evidência na Evolution (consulta de leitura em `findMessages`): as respostas das 18:49 e 18:50 aparecem enviadas; **nenhuma mensagem da loja depois das 18:51**. Forte indício de que a mensagem não saiu; não é prova completa, porque a Evolution não guarda todas as mensagens.
- As outras 4 filas em `uncertain` são de 05–06/10, sem entrega atual nem mensagens posteriores (legado).
- O tempo limite de …9009 (26/10 10:23) foi antes do envio e a fila voltou a `ready` (retry funcionou).

**Proposta de item (a revisar)**: reconciliação explícita de entregas `uncertain`, por tentativa: consulta de leitura ao provedor com o identificador da tentativa; só marcar "não entregue" com prova positiva de ausência dentro de uma janela segura; sem prova, manter `uncertain` e avisar o operador (junto do P0-1). Nunca reenviar automaticamente sem essa prova.

### P2-9. Resposta mal formada do Gemini duas vezes (…4021)

Passo 0: registrar `finishReason`, tamanho da saída e motivo da invalidação (sem conteúdo). Correção só depois.

### P2-10. `UNEXECUTED_SALES_CLAIM` em turno com 3 vídeos e 2 áudios (…2575)

Passo 0: reproduzir no executor de homologação e identificar a afirmação.

### P1-11. **[v4]** Documento do veículo (CRLV) lido como documento pessoal trava o turno (…0563128, Rodolfo)

**Comprovado (27/10, horário de Brasília)**: 09:44 o cliente perguntou se a loja compra carro e a IA pediu marca, modelo e ano. 09:46 ele enviou 1 CRLV (Fiat Siena Attractive 1.4, 2013/2014) e 4 fotos do carro. 09:47 o turno foi para revisão com `technical_error_code = DOCUMENT_REQUIRES_REVIEW` (erro externo `DIALOGUE_GENERATION_FAILED`), sem nenhuma resposta ao cliente. A equipe respondeu às 09:58. O lead continua sem marca, modelo e ano.

**Causa no código (conferida)**:
- `salesClassifyImages` só conhece as categorias `vehicle_photo | document | other | uncertain`. Um CRLV cai em `document`.
- Todo `document` vai para o leitor de documento pessoal (prompt "CNH/documento: nome, CPF, número da CNH e nascimento"). Esse leitor lança `DOCUMENT_REQUIRES_REVIEW` quando o CPF não valida, a CNH não tem 11 dígitos, a data não é válida ou não há nome, CPF nem CNH.
- O erro é lançado dentro do laço e interrompe o lote inteiro. As 4 fotos já classificadas se perdem e o turno vai para revisão.
- **Não comprovado**: qual campo disparou o erro (a execução 475126 não está mais disponível). Hipóteses: CPF/CNPJ do proprietário que não valida como CPF, ou o RENAVAM (11 dígitos) lido como CNH.

**Correção (Motor, sem schema)**:
1. O classificador ganha a categoria `vehicle_document`, separada de `document` (pessoal). A legenda técnica continua mandando `cnh|cpf|rg` para o caminho pessoal, sem mudança.
2. `vehicle_document` não passa pelo leitor de identidade. Vira evidência de que o cliente enviou o documento do veículo, e marca/modelo/ano só entram como dado se o leitor próprio extrair texto legível. Nada é completado nem inventado, e esses dados nunca preenchem campos de identidade (nome, CPF, CNH).
3. As validações de identidade continuam iguais para documento pessoal: CPF inválido, CNH malformada ou data inválida seguem indo para revisão.
4. Uma falha de leitura num documento não descarta as outras evidências do lote: as fotos do veículo continuam disponíveis e o EXT decide a próxima pergunta. Documento pessoal ilegível continua indo para revisão, como hoje.
5. O passo 4 só pode valer para `vehicle_document`. Para documento pessoal, decidir com o EXT se a revisão continua obrigatória.

**Teste**: reproduzir CRLV + 4 fotos em uma venda independente (compra do carro do cliente) e verificar que:
- o turno não vai para revisão por causa do CRLV;
- as 4 fotos continuam como evidência;
- nenhum campo de identidade é preenchido com dado do CRLV;
- marca/modelo/ano só aparecem se foram lidos, nunca deduzidos.

Testes de regressão: documento pessoal com CPF inválido continua indo para revisão, e CNH legítima continua extraída.

**Antes de implementar**: comparar com a versão ativa do Motor (`eace2a40`, publicada em 27/10 09:52), que é posterior à execução do caso.

---

## 4. Ordem de execução **[v2]**

| Ordem | Item | Workflows | Observação |
|---|---|---|---|
| 1 | P0-1 lista manual | nenhum | hoje |
| 2 | P0-2 observabilidade HTTP | Motor | só diagnóstico |
| 3 | P0-3 passo 0 (contagens + `style_check`) | Motor | só diagnóstico |
| 4 | P2-8 diagnóstico de `uncertain` | nenhum (leitura + reprodução) | antecipado |
| 5 | **[v3]** P0-1 aviso no painel do operador | app (frontend) | antes das melhorias de estilo: atende quem está aguardando |
| 6 | **[v3]** N-1 passo 0 (replay …1038 e …9775) | nenhum | confirma a causa |
| 6b | **[v4]** P1-11 CRLV separado de documento pessoal | Motor | cliente fica sem resposta; vem antes dos ajustes de estilo |
| 7 | N-1 contexto limitado + `opening` + nome validado | Motor | |
| 8 | N-1 ajuste de prompt da Núbia | dado no Supabase | depois do 7 |
| 9 | P0-3 correção | Motor + EXT Gênesis | indivisível se a regra do EXT depender do dado novo |
| 10 | P1-4 | Motor | |
| 11 | P1-5 | Motor | |
| 12 | P1-6 | Motor (+ despachante, se necessário) | |
| 13 | P1-7 | Entrada | fora do pico |
| 14 | P2-9, P2-10 | a definir | |

Itens 2 e 3 podem ir na mesma publicação **só** se ambos forem apenas observabilidade (sem mudança de comportamento).

## 5. Portões de qualidade em cada publicação **[v2]**

1. Teste novo falha antes e passa depois.
2. `node scripts/validate_noria_release.cjs` 100% verde.
3. Suíte ampla: baseline gravado **por identidade** (arquivo + nome do teste) antes do item; depois, nenhuma falha nova e nenhuma falha trocada de causa.
4. Build idempotente; diff conferido; só os workflows do item mudam (rótulos de data no workflow de Entrada não são publicados sem necessidade).
5. Publicação só com autorização explícita; `scripts/publish_noria_scoped.cjs apply` com `expectedVersion` lida do n8n, backup e conferência da versão ativa.
6. Commit por item na `dev` com o caso de produção na mensagem.
7. Observação com a métrica de aceite do item e o denominador definido.

## 6. Rollback **[v2]**

- n8n: restaurar o código dos nós a partir de `.local/deploy_backups/<data>/` com o publicador. A ordem depende da **compatibilidade** entre as versões de Motor e EXT do item (verificar contrato antes): reverter primeiro o lado que depende do outro.
- Supabase: nenhum item altera schema. Alterações de dado (prompt da Núbia) guardam texto anterior e md5 para reverter.

## 7. Fora do escopo

- Leitura de preço/disponibilidade do catálogo do WhatsApp (Evolution 2.3.7 devolve catálogo vazio).
- Padrões fixos de nome de tenant no nó "Sincronizar Contato WhatsApp".
- As falhas antigas da suíte ampla (exceto a gravação do baseline por identidade).
