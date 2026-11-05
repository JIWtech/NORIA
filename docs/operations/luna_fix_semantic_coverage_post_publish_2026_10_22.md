# Plano para o Luna: corrigir cobertura semântica após a publicação

## Objetivo

Corrigir na fonte canônica o erro `SEMANTIC_RESPONSE_COVERAGE_MISMATCH` comprovado no atendimento de Ivan Andrade, sem enfraquecer a auditoria de fatos, sem hardcode de cliente/anúncio/veículo e sem sobrescrever alterações locais legítimas. Implementar e validar em incrementos; produzir um artefato revisável para publicação posterior.

## 1. Evidência e corte temporal obrigatório

Todos os horários abaixo são de **21/10/2026 em America/Sao_Paulo (UTC−03)**.

| Evidência | BRT | UTC |
|---|---|---|
| Build registrado no erro | 22:49:51.109 | 22/10 01:49:51.109Z |
| Criação da versão hoje ativa da EXT Gênesis | 22:50:59.464 | 22/10 01:50:59.464Z |
| Criação da versão hoje ativa do motor | 22:51:01.643 | 22/10 01:51:01.643Z |
| Mensagem de Ivan, origem `external_ad_reply` | 23:17:58.317 | 22/10 02:17:58.317Z |
| Bloqueio por cobertura semântica | 23:18:21.267 | 22/10 02:18:21.267Z |

A API fornece `activeVersion.createdAt`; esse campo é criação da versão, não um campo explícito `publishedAt`. Usar o histórico de publicação se disponível para registrar o instante exato de ativação. A associação de código está comprovada independentemente dessa distinção: o hash de build do erro é igual ao hash embutido no código de `activeVersion.nodes` consultado agora.

- Motor efetivo: `mlKNPv862H2g3Gap` — `NORIA CORE | Motor conversacional`.
- Versão ativa: `a2b2d99e-01ae-458c-80b0-7a1229bc51f0`.
- `core_sha256` do evento e do código ativo: `fd6dba9cc20cf93e27b60072144e3886e63a5a5771495bf83753fc6726041589`.
- EXT: `fXGorIlPbyf9Qtsp`; versão ativa `29e1b312-3c67-4361-9dee-3598858f0507`.
- Evento inbound: `ac91b9fe-fbd3-4e12-90af-54fecd79a418`.
- Evento técnico: `545e8b36-51c0-4fa0-add9-09462531e740`.
- Execução informada pelo evento: `437369`; a API de execuções retornou 404 na investigação.
- `customer_reply_sent=false`; recuperação `safe_reply_without_dispatch`; transferência `not_attempted`; fila `review` / `explicit_technical_hold`.

**Tratar Ivan como defeito comprovado da versão ativa.** Não atribuir esse episódio a uma versão antiga. O caso do Siena às 22:45, os episódios de `dialogueNeedsReview` do dia 17 e outros erros anteriores ao corte ficam fora da comprovação desta versão. Podem ser fixtures históricas separadas.

Consulta de leitura após `2026-10-22T01:51:01.643Z` encontrou um evento técnico com erro e hash de build: o episódio de Ivan. Não usar totais de sete dias como taxa de falha do release atual.

## 2. Identificar a base real antes de editar

1. Ler `AGENTS.md`, regras anti-hardcode pertinentes e examinar `git status`/diff. Há alterações locais preexistentes em fontes, gerados, frontend e scripts.
2. Usar os MCPs disponíveis; se necessário, consultar n8n por GET com `N8N_BASE_URL` e `N8N_API_KEY` do `.env`, sem imprimir segredos.
3. Ler `activeVersion.nodes` do motor, sua versão e hash. Se a versão mudou desde a evidência acima, registrar o novo corte e comparar o trecho alterado.
4. Não confundir o workflow de entrada `3N5oN6sxtir9lFrA` com o motor separado `mlKNPv862H2g3Gap`. A cópia anterior dos JSONs de entrada e EXT não sincronizou o motor.
5. Comparar o trecho publicado com `n8n/sources/noria_core.js` e `n8n/code/whatsapp_conversation_core.generated.js`. O arquivo gerado local não estava idêntico ao código ativo. Portar a correção para a fonte canônica preservando mudanças legítimas; documentar qualquer outra diferença que entraria no artefato.

Referências atuais de código, sujeitas a deslocamento de linhas:

- Fonte local: `salesValidateSemanticEvidence`, próxima da linha 9841.
- Motor ativo: comparação de cobertura próxima da linha 9927.
- Motor ativo: `salesRecoverSafeDialogue`, próxima da linha 10460, retorna `''`.
- Motor ativo: tratamento de recuperação vazia, próximo das linhas 13068–13073.
- Fonte local: `salesScopeMediaAnswer` também verifica a concatenação exata dos segmentos; preservar sua consistência.

## 3. Reproduzir antes da correção

Investigar as três representações: texto original da resposta, entrada entregue à auditoria e textos retornados em `report.segments`. Verificar se geração, auditoria e validador aplicam `trim`, CRLF/LF ou outras transformações em momentos distintos.

O relatório de Ivan tem dois segmentos: o primeiro termina em `rodados.` e o seguinte começa em `Quer saber...`. O código compara `segments.map(s => s.text).join('') === reply`. Falta de espaço ou quebra de linha entre segmentos é uma hipótese forte; o texto original rejeitado não foi recuperado. Não declarar que esse foi o único motivo sem prova.

Criar fixture sanitizada do incidente com suas evidências e escopo. Se o texto original não puder ser obtido, identificar a fixture como reprodução do mecanismo provável, não como replay exato da execução 437369. Não colocar nome, telefone nem identificação de anúncio em regra de produção.

Prove-It obrigatório: teste deve falhar antes do patch para segmentação com separador omitido. Criar também controles negativos que já devem permanecer bloqueados.

## 4. Corrigir a cobertura sem alterar o julgamento semântico

Implementar um único caminho técnico para alinhar segmentos auditados ao texto original, usado antes da validação de cobertura e pelos consumidores que dependem desses intervalos.

Contrato mínimo:

- O texto original escolhido para auditoria é imutável durante essa validação.
- Localizar os segmentos como substrings exatas, em ordem, com cursor monotônico e sem sobreposição.
- Se houver lacunas apenas de espaços/quebras de linha entre segmentos, preservar esses caracteres do original na representação canônica dos segmentos. Isso é alinhamento de texto, não classificação de intenção ou de fatos.
- A concatenação final precisa reconstruir exatamente o texto original. Não liberar resposta que deixe conteúdo significativo sem cobertura.
- Alteração de palavra, preço, número, negação, pontuação significativa, produto, ordem ou evidência não pode ser “corrigida” por normalização ampla.
- Não usar similaridade, remoção geral de espaços, minúsculas ou remoção de acentos para aprovar uma resposta modificada. CRLF/LF, se suportado, exige correspondência documentada com o original preservado.
- Ambiguidade, segmento ausente, duplicado, sobreposto ou texto não alinhável mantém o bloqueio.
- Preservar `kind`, evidências, `fact_id`, produto, fonte, escopo de tenant/sessão/turno e demais verificações factuais. Cobertura corrigida não implica auditoria factual aprovada.

Inspecionar o prompt/schema existente da auditoria para exigir segmentos literais que preservem separadores. Um ajuste de prompt sozinho não substitui a validação determinística. Não adicionar um segundo classificador semântico nem chamadas de IA para contornar o erro.

Se a reprodução provar uma causa diferente de separadores, corrigir essa causa e manter os mesmos invariantes. Não aplicar o reparo de separadores indiscriminadamente para fazer a fixture passar.

## 5. Validar o resultado operacional e registrar falhas corretamente

1. No caso em que cobertura e fatos passam, a resposta segue para o envio autorizado pelo EXT. As demais regras comerciais continuam valendo, inclusive eventual divergência de preço entre anúncio e inventário.
2. Em rejeição factual verdadeira, o cliente não recebe a afirmação rejeitada. O turno mantém revisão técnica explícita, com evento/ticket deduplicado e sem declarar sucesso.
3. Não registrar espera pelo cliente como resultado de um turno que nunca respondeu. Verificar o uso de `followUpDisposition='awaiting_customer'` nos caminhos de recuperação vazia e corrigir o estado técnico com o contrato já existente, sem alterar schema.
4. Não marcar `customer_reply_sent`, `done`, entrega ou transferência antes da evidência correspondente. Confirmar que o erro anterior ao envio não entra em estado de tentativa de entrega incerta.
5. Para rejeições remanescentes, acrescentar diagnóstico compacto: hashes e tamanhos de original/concatenação, posição da primeira divergência e categoria de desalinhamento. Não despejar prompts, credenciais ou texto integral de clientes em logs.
6. O ticket de Ivan estava aberto e sem reconhecimento. Verificar a integração existente do ticket com a interface; não presumir notificação confirmada a partir da mera existência de um evento interno. Não ampliar este patch para uma reformulação de atendimento/alertas.

## 6. Testes e regeneração por incremento

Usar fixtures locais e mocks, sem Gemini pago nem WhatsApp real.

| Cenário | Resultado exigido |
|---|---|
| Segmentos já idênticos à resposta | Mesmo comportamento anterior |
| Segmentos literais com espaço ou quebra de linha omitido entre eles | Reconstrução exata do original; demais auditorias ainda obrigatórias |
| Alteração de preço, produto, número ou negação | Bloqueio preservado |
| Palavra omitida, ordem invertida, sobreposição ou duplicação | Bloqueio preservado |
| Texto repetido/emoji/acentos e limites de segmento | Alinhamento correto ou falha fechada demonstrada |
| Cobertura corrigida com evidência factual inválida | Bloqueio factual preservado |
| Tenant/sessão/turno/produto diferentes | Rejeição de identidade preservada |
| Entrada `external_ad_reply` e entrada orgânica equivalentes | Mesmo contrato de auditoria; nenhuma exceção por origem |
| Caminho de mídia/foto autorizada | Nenhuma regressão na interpretação dos intervalos e do escopo auditado |
| Auditoria ainda rejeita | Sem envio da afirmação, revisão técnica explícita, sem falso estado de espera/entrega |
| Auditoria e EXT permitem responder | Um único despacho; sucesso somente após confirmação exigida pelo contrato existente |

Examinar e ampliar apenas os testes pertinentes, principalmente `scripts/test_noria_primary_dialogue.cjs` e `scripts/test_genesis_dialogue_recovery.cjs`. Não executar harness que consulte provedores reais sem autorização. Não modificar expectativas para esconder uma falha.

Corrigir a fonte e regenerar com `node scripts/build_noria_workflows.cjs`. Executar o builder duas vezes e comparar hashes para demonstrar idempotência. Validar sintaxe, conexões, fonte → JS gerado → nó do motor e `git diff --check`. Identificar exatamente como o builder/empacotador produz o motor separado; não assumir que atualizar só o JSON de entrada publica seu código.

Revisar se o artefato inclui outras mudanças locais. Entregar diff isolado e apontar qualquer divergência não pertencente ao reparo, antes de propor publicação.

## 7. Publicação e verificação posteriores

O escopo proposto ao Luna é o trabalho local descrito. Publicação, escrita em Supabase de produção, liberação de fila, envio real e chamadas pagas de Gemini dependem de autorização explícita. Preparar o artefato e o rollback antes de solicitar autorização para publicar.

Após publicação expressamente autorizada:

1. Guardar a versão ativa anterior do motor para rollback e publicar o artefato validado no workflow correto.
2. Registrar instante UTC/BRT da publicação, `activeVersionId`, hash bruto do código e `core_sha256` embutido. Conferir o conteúdo ativo retornado pelo n8n.
3. Definir a nova coorte por horário posterior à publicação **e** hash novo. Um evento gravado depois pode pertencer a execução antiga; por isso usar ambos.
4. Confirmar em entrada nova autorizada a sequência anúncio → fila → EXT → auditoria → despacho → confirmação. Ausência de erro, sozinha, não prova atendimento; exigir evento de envio e evidência do provedor conforme contrato.
5. Manter Ivan como evidência do release anterior. Não reenviar o turno histórico nem destravar sua fila automaticamente: exige autorização e verificação atual de contexto, controle humano e idempotência.
6. Se a falha persistir na nova coorte, preservar diagnósticos e aplicar rollback do motor sem reverter configurações de tenant ou dados comerciais.

## Entrega exigida do Luna

- Correção local em fonte canônica e artefatos correspondentes.
- Teste que reproduzia a falha e passou; controles negativos continuam bloqueando fatos inválidos.
- Hashes de regeneração e paridade; diff revisado sem mudanças alheias ao escopo.
- Explicação comprovada da causa, distinguindo o que foi reproduzido do que permaneceu hipótese.
- Artefato de publicação e rollback preparados; produção separada da validação local.
- Relato final centrado no caso pós-publicação de Ivan, sem reutilizar falhas anteriores como se fossem da mesma versão.
