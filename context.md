Já está tudo commitado e enviado. O trabalho entrou nos commits bc0c8d9 e 24d75ea em origin/dev, e não há nada local pendente. Para os testes você precisa importar 2 workflows agora e mais 1 quando for testar a Núbia v2. O Render não precisa de deploy.

1. Workflows a importar
Todos os arquivos estão em n8n/workflows/.

Arquivo	Onde entra	Quando
NORIA EXT _ Gênesis _ Política comercial v2 (1).json	Por cima do workflow NORIA EXT | Gênesis | Política comercial v2 (ID fXGorIlPbyf9Qtsp)	Fase 1
NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json	Por cima do NORIA CORE | WhatsApp + Comandos + Follow-ups | Motor compartilhado v2 (ID 3N5oN6sxtir9lFrA)	Fase 1, depois da EXT Gênesis
NORIA EXT _ NB Bronze _ Serviços v2.json	Workflow novo, que ainda não existe no n8n	Fase 2
NB Bronze _ Política de negócio v2 e Royal 4x4	Não mexer, não mudaram desde 16/10 e 20/10	—
Como importar por cima: abra o workflow existente, baixe um backup em ⋯ → Download, depois use ⋯ → Import from File… e salve. Não crie um workflow novo para o CORE nem para a Gênesis. O CORE chama a EXT Gênesis pelo ID em 3 nós, e um ID novo quebraria essas chamadas e os webhooks.

Com a Fase 1, a Gênesis passa a usar todo o código novo. A Núbia continua na v1, porque a cadeia v2 vem desligada. Mas o CORE é compartilhado, então a Núbia também precisa de um teste rápido de regressão.

Fase 2 (piloto da Núbia v2):

Importe NORIA EXT _ NB Bronze _ Serviços v2.json como workflow novo e copie o ID que aparece na URL. Não é preciso ativá-lo.
No CORE, nos 3 nós CORE | Serviços | Executar EXT bootstrap, … decisão e … reavaliação, troque PREENCHER_ID_EXT_NUBIA_V2 por esse ID.
Ainda no CORE, habilite os 9 nós CORE | Serviços | … que estão desabilitados (tecla D). Não mexa no Núbia v2?, que já vem habilitado. Salve.
Depois disso, ligue o piloto no Supabase com o SQL abaixo.
⚠️ Só ligue enabled:true depois do passo 3. O n8n deixa os dados passarem por nós desabilitados, e a mensagem do piloto atravessaria uma cadeia vazia.

2. Render: não precisa de deploy
O Render só hospeda o frontend estático (app/), e os dois commits desta rodada não mexem em app/. A tela do atendente com cnh_status também não foi feita, então não há nada de frontend para testar.

Há outro ponto, fora desta rodada. Três commits de frontend de 20/10 estão só em dev (1105522, e4e6157 e 2c30cba, este com a correção das imagens na tela de conversas). As branches prod e main param em 15/10. Se o seu Render publica a partir de prod ou main, essas mudanças não estão no ar. Não consigo confirmar qual branch ele usa: o rootDir: magia/app de render.yaml não bate com a estrutura do repositório, então ele deve estar configurado direto no painel do Render.

3. SQL de apoio (Supabase)
Antes de importar: confira se as funções que o CORE novo chama existem. Algumas migrações ainda estão em migrations_pending_review. O esperado são 9 linhas:


select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and proname in ('magia_gemini_reserve','magia_turn_lifecycle_status','magia_claim_turn',
 'magia_begin_turn_delivery','magia_confirm_turn_delivery','magia_fail_turn','magia_finish_turn',
 'magia_appointment_availability','magia_reserve_session_appointment');
Ligar o piloto da Núbia v2. Use um número interno que nunca falou com a Núbia, em dígitos e com DDI, por exemplo 5524…:


update public.tenant_settings ts set settings = jsonb_set(ts.settings, '{noria_turn_pipeline}', '{
  "enabled": true, "contract": "noria_turn_pipeline_v1", "capability": "services_v1", "contract_version": "2.0",
  "semantic_contract": "noria_services_semantic_intent_v1", "decision_contract": "noria_services_decision_v2",
  "decision_provenance": "nubia_extension_commercial_decide_v1", "rollout": "pilot",
  "pilot": {"allowed_contacts": ["SEU_NUMERO"]}}'::jsonb, true)
from public.tenants t where t.id = ts.tenant_id and t.slug = 'clinica_nubia_oficial';
Reverter na hora, sem republicar nada: troque '{noria_turn_pipeline}', '{...}' por '{noria_turn_pipeline,enabled}', 'false'.

⚠️ O prompt v14.20 da Gênesis já está ativo no Supabase, mas o n8n ainda roda o CORE antigo. Vale fazer a Fase 1 logo. Se precisar voltar o prompt, o snapshot está em settings.prompt_snapshot_before_v14_20.

4. Checklist de testes
Gênesis Automóveis (após a Fase 1)
 Entrada com pergunta: "Tenho 20 mil de entrada, dá pra financiar o resto?" A IA usa a entrada informada e não inventa parcela nem aprovação.
 Nome próprio: "Me chamo João Pereira". O nome é salvo.
 Nome de terceiro: "O carro é pro meu pai, o Carlos". Carlos não vira o nome do cliente.
 Sem CNH: "Ainda não tenho CNH". A IA responde informando e o atendimento segue.
 À vista × troca: "Quero comprar à vista, sem troca". Depois, em outra conversa: "Tenho um Gol 2015 pra dar na troca". Os dois fluxos ficam distintos.
 Marcas recusadas: "Vocês pegam Ford na troca?". Recusa coerente com rejected_purchase_brands (Ford e Renault).
 Foto: pedir foto de um carro do estoque. A foto chega. Mande também uma figurinha, que não pode quebrar o atendimento.
 Handoff: "Quero falar com um vendedor". A conversa vai para humano no painel e a IA para de responder. Ela não pode prometer "vou chamar" sem atribuir de fato.
NB Bronze, regressão v1 (após a Fase 1, de qualquer número)
 "Quanto custa o Bronze Premium?" A resposta é R$ 149,99, como hoje.
 Um agendamento normal até SINAL PAGO. O status vira payment_reported, nunca confirmed.
NB Bronze, piloto v2 (após a Fase 2, só do número piloto)
 "Qual a diferença entre o Bronze Clássico e o Premium?" Compara os dois com os preços oficiais e não pede horário nem unidade.
 "Qual é aquele que a gente fica deitada?" Identifica o Comfort (R$ 179,99) e não cria reserva.
 "Quero o Comfort sexta, que horários tem?" Só aparecem horários reais da agenda.
 Escolher um horário e dizer o nome completo. A reserva é criada como pending_payment com a orientação do sinal de 50%. No Supabase, a linha em appointments tem metadata.reservation_request.
 "Na verdade queria o Banho de Lua Premium". Não cria uma segunda reserva por cima da primeira.
 SINAL PAGO. Uma única atualização para payment_reported.
 "Quero Bronze a Jato em casa". Handoff, sem o preço antigo e sem reserva automática.
 "Tenho pele muito sensível, qual é seguro pra mim?" Nenhuma promessa de segurança e handoff.
 "Quero falar com uma atendente". O handoff acontece de fato e a IA para.
 De outro número fora do piloto, mande uma mensagem qualquer. Ele continua no comportamento v1.
Para cada erro, me mande: cliente, número, horário aproximado, a mensagem enviada, a resposta recebida (print ou texto) e o que você esperava. Com isso eu acho o channel_events correspondente e corrijo.

Rodei os testes locais: 59 passam. A única falha (test_noria_services_pipeline.cjs, teste 9) é só de fim de linha do checkout no Windows (CRLF): o código do roteador no workflow é idêntico à fonte, então não afeta o import.



update public.tenant_settings ts set settings = jsonb_set(ts.settings, '{noria_turn_pipeline}', '{
  "enabled": true, "contract": "noria_turn_pipeline_v1", "capability": "services_v1", "contract_version": "2.0",
  "semantic_contract": "noria_services_semantic_intent_v1", "decision_contract": "noria_services_decision_v2",
  "decision_provenance": "nubia_extension_commercial_decide_v1", "rollout": "pilot",
  "pilot": {"allowed_contacts": ["SEU_NUMERO"]}}'::jsonb, true)
from public.tenants t where t.id = ts.tenant_id and t.slug = 'clinica_nubia_oficial';
pq fariamos isso? não entendi
Show more
10:50 AM
Esse SQL é o interruptor que liga a Núbia nova (v2). Importar os workflows não muda o atendimento dela: sem esse SQL, a Núbia continua respondendo do jeito de hoje (v1) para todo mundo.

Como funciona:

A cada mensagem que chega na Núbia, o nó CORE - Resolver extensão do tenant lê noria_turn_pipeline em tenant_settings.
Se a chave não existe ou está com enabled: false, a mensagem vai para a v1. É o que acontece hoje.
Se está com enabled: true e o número de quem escreveu está em allowed_contacts, a mensagem vai para a v2.
Os outros campos (contract, capability etc.) precisam ser idênticos aos que a EXT v2 declara. É uma trava contra ligar com a configuração errada. Se estiverem diferentes, a mensagem não é processada e fica na fila.
Por que fazer assim:

Só o seu número cai na v2 (rollout: "pilot"). As clientes reais da NB Bronze continuam na v1 enquanto você testa.
Dá para desligar na hora. Mudar enabled para false faz a próxima mensagem voltar para a v1, sem reimportar workflow no n8n.
A troca fica no banco, não no código do CORE. Assim, depois, liberar para todo mundo é só trocar "rollout": "pilot" por "rollout": "all".
Quando usar:

Fase 1 (testar a Gênesis e ver se a Núbia v1 segue funcionando com o CORE novo): não rode esse SQL.
Fase 2 (testar a Núbia nova): rode só depois de importar a EXT v2 e habilitar os 9 nós no CORE. Troque SEU_NUMERO pelo seu número em dígitos com DDI, por exemplo 5524999999999.
Se ainda não quiser testar a Núbia v2, pode ignorar esse SQL por enquanto.



NORIA EXT _ Gênesis _ Política comercial v2 (1).json#1-88
Resumo técnico — Erro 503 no n8n / NORIA
Data: 21/10/2026
Ambiente: EasyPanel, n8n com PostgreSQL 17.11
Status: problema persiste; causa raiz ainda não confirmada.
1. Problema atual
O n8n apresenta o erro:
{
  "code": 503,
  "message": "Database is not ready!"
}


O problema continua mesmo depois de adicionar a variável EXECUTIONS_DATA_MAX_AGE=168.

O usuário informou que CPU e memória estão no limite no EasyPanel, o que levanta a hipótese de sobrecarga ou esgotamento de recursos. Ainda não identificamos qual serviço está consumindo os recursos nem se essa saturação é a causa direta do erro.
2. Configuração atual relevante
O n8n utiliza um PostgreSQL separado, hospedado no mesmo ambiente EasyPanel.
DB_TYPE=postgresdb
DB_POSTGRESDB_HOST=$(PROJECT_NAME)_n8n-db
DB_POSTGRESDB_PORT=5432
DB_POSTGRESDB_DATABASE=$(PROJECT_NAME)
DB_POSTGRESDB_USER=postgres
DB_POSTGRESDB_POOL_SIZE=20

EXECUTIONS_DATA_PRUNE=true
EXECUTIONS_DATA_MAX_AGE=168


Interpretação:
- DB_POSTGRESDB_POOL_SIZE=20: já estava configurado antes da investigação. Não há evidência de que aumentar o pool resolverá o problema.
- EXECUTIONS_DATA_PRUNE=true: limpeza automática de execuções já estava habilitada.
- EXECUTIONS_DATA_MAX_AGE=168: foi adicionada durante a investigação, definindo retenção de 168 horas (7 dias).
A limpeza de execuções pode ajudar a controlar o crescimento do banco, mas não corrige diretamente falhas de conexão nem falta de memória.

Atenção: a configuração foi compartilhada com barras invertidas ao final de várias linhas. Ainda precisamos confirmar se elas existem no ambiente real do EasyPanel ou se apareceram apenas durante a cópia da configuração.
3. O que os logs do PostgreSQL mostraram
O usuário enviou logs do PostgreSQL 17.11 com os seguintes eventos:
Horário UTC	Evento	Interpretação
12:07:56	PostgreSQL iniciou e ficou pronto para aceitar conexões	Banco operacional naquele momento
12:12–12:27	Checkpoints recorrentes, com gravações de grandes volumes de buffers	Indício de atividade significativa de escrita; não comprova, isoladamente, sobrecarga
12:28:52	Connection reset by peer	Uma conexão foi interrompida pelo outro lado
12:30:11	received fast shutdown request	PostgreSQL recebeu uma ordem de desligamento
12:30:13	Banco concluiu o desligamento	Encerramento controlado
12:30:54	PostgreSQL iniciou novamente e ficou pronto	Banco voltou a aceitar conexões
O horário corresponde a aproximadamente 09:30 no horário de Brasília.

O usuário esclareceu que o desligamento ocorreu porque a equipe adicionou EXECUTIONS_DATA_MAX_AGE=168 e fez o Deploy. Portanto, esse reinício específico é explicado pela intervenção realizada e não deve ser tratado como evidência de uma falha espontânea do PostgreSQL.

Entretanto, o padrão de checkpoints e as mensagens anteriores ao Deploy justificam investigar a carga de escrita no banco.
4. Hipóteses ainda em aberto
1. Limite de recursos do servidor: CPU e memória estão no limite, segundo o usuário.
2. Consumo elevado de recursos pelo n8n: muitas execuções, concorrência elevada ou workflows pesados.
3. Pressão sobre o PostgreSQL: volume de gravações, tabelas grandes, conexões ou operações de limpeza.
4. Problema de conexão ou inicialização: host, credenciais, resolução de rede ou falha na inicialização do n8n.
5. Limites de recursos individuais dos contêineres: o servidor pode ter recursos disponíveis insuficientes ou distribuídos inadequadamente entre os serviços.
Nenhuma dessas hipóteses foi confirmada como causa raiz.


precisamos descobrir se tem alguma coisa nos novos workflows que está sobrecarregando nosso servidor.
Show more
11:45 AM
Vou olhar o que nos workflows gera carga recorrente: gatilhos agendados, frequência, laços e o tamanho dos dados que cada execução grava no Postgres do n8n.



Bash List triggers, schedules and loops in workflows
IN
cd "/c/Users/wever/OneDrive/Documentos/Shtorache/JIW/NORIA/Mag.IA/n8n/workflows" && for f in *.json; do node -e "
const w=require('./'+process.argv[1]);
console.log('==',w.name,'| active',w.active,'| settings',JSON.stringify(w.settings));
for(const n of w.nodes){ if(/trigger|webhook|schedule|cron|interval|wait|splitInBatches|loop/i.test(n.type)) console.log('  ',n.type,'|',n.name,'|',JSON.stringify(n.parameters).slice(0,300), n.disabled?'[DISABLED]':'');}
" "$f"; done

OUT
== NORIA CORE | WhatsApp + Comandos + Follow-ups | Motor compartilhado v2 | active true | settings {"executionOrder":"v1","binaryMode":"separate","availableInMCP":true}
   n8n-nodes-base.respondToWebhook | CORE | Responder ACK Royal | {"respondWith":"json","responseBody":"={{ $json }}","options":{}} 
   n8n-nodes-base.respondToWebhook | Responder Interface1 | {"respondWith":"json","responseBody":"={{ $json }}","options":{"responseHeaders":{"entries":[{"name":"Access-Control-Allow-Origin","value":"*"},{"name":"Access-Control-Allow-Headers","value":"content-type, authorization"}]}}} 
   n8n-nodes-base.webhook | Webhook MagIA Command1 | {"httpMethod":"POST","path":"magia-command","responseMode":"responseNode","options":{}} 
   n8n-nodes-base.scheduleTrigger | Verificar Follow-ups Vencidos | {"rule":{"interval":[{"field":"minutes","minutesInterval":1}]}} 
   n8n-nodes-base.scheduleTrigger | Recuperar Fila WhatsApp | {"rule":{"interval":[{"field":"seconds","secondsInterval":10}]}} 
   n8n-nodes-base.wait | Aguardar Janela de Mensagens | {"amount":"={{ Math.max(0, Number($json.core_wait_seconds ?? 13)) }}"} 
   n8n-nodes-base.respondToWebhook | Confirmar Recebimento Core | {"respondWith":"json","responseBody":"={{ { ok: true, queued: true } }}","options":{}} 
   n8n-nodes-base.respondToWebhook | Responder Resposta Cancelada | {"respondWith":"json","responseBody":"={{ { ok: true, ignored: true, reason: $json.response_discard_reason, external_message_id: $json.messageId } }}","options":{}} 
   n8n-nodes-base.respondToWebhook | Responder Evolution API | {"respondWith":"json","responseBody":"={{ { ok: true, channel: 'whatsapp', external_message_id: $('Preparar Evento Enviado').item.json.messageId, response: $('Preparar Evento Enviado').item.json.messageText, delivery_status: 'sent' } }}","options":{}} 
   n8n-nodes-base.respondToWebhook | Responder Duplicidade | {"respondWith":"json","responseBody":"={{ { ok: true, duplicate: true, external_message_id: $json.messageId } }}","options":{}} 
   n8n-nodes-base.respondToWebhook | Responder Evento Ignorado | {"respondWith":"json","responseBody":"={{ { ok: true, ignored: true, reason: $json.ignoredReason || 'ignored' } }}","options":{}} 
   n8n-nodes-base.webhook | Webhook WhatsApp Evolution | {"httpMethod":"POST","path":"magia-whatsapp","responseMode":"responseNode","options":{}} 
== NORIA EXT Royal 4x4 | Catalogo Supabase 24h + IA sob demanda v2 | active true | settings {"executionOrder":"v1","binaryMode":"separate","availableInMCP":true}
   n8n-nodes-base.executeWorkflowTrigger | Entrada do NORIA CORE | Royal 4x4 | {"inputSource":"passthrough"} 
   n8n-nodes-base.scheduleTrigger | AGENDA | Worker Royal 10s | {"rule":{"interval":[{"field":"seconds","secondsInterval":10}]}} 
   n8n-nodes-base.manualTrigger | TESTE MANUAL | Diagnostico Royal | {} 
   n8n-nodes-base.scheduleTrigger | AGENDA | Sincronizacao estoque Royal 24h | {"rule":{"interval":[{"field":"hours","hoursInterval":24}]}} 
== NORIA EXT | Gênesis | Política comercial v2 | active true | settings {"executionOrder":"v1","binaryMode":"separate","availableInMCP":true,"timeSavedMode":"fixed","timezone":"America/Sao_Paulo","callerPolicy":"workflowsFromSameOwner"}
   n8n-nodes-base.executeWorkflowTrigger | Entrada do NORIA CORE | {"inputSource":"passthrough"} 
== NORIA EXT | NB Bronze | Política de negócio v2 | active true | settings {"executionOrder":"v1","binaryMode":"separate","availableInMCP":true,"timeSavedMode":"fixed","timezone":"America/Sao_Paulo","callerPolicy":"workflowsFromSameOwner"}
   n8n-nodes-base.executeWorkflowTrigger | Entrada do NORIA CORE | {"inputSource":"passthrough"} 
== NORIA EXT | NB Bronze | Serviços v2 | active false | settings {"executionOrder":"v1","timezone":"America/Sao_Paulo","callerPolicy":"workflowsFromSameOwner"}
   n8n-nodes-base.executeWorkflowTrigger | Entrada do NORIA CORE | Núbia serviços v2 | {"inputSource":"passthrough"}
11:46 AM
Há três gatilhos agendados disparando sozinhos: 2 a cada 10 s e 1 a cada minuto. Vou ver se isso mudou nos commits recentes e o que cada disparo faz.



Bash Compare CORE schedules and code size across commits
IN
cd "/c/Users/wever/OneDrive/Documentos/Shtorache/JIW/NORIA/Mag.IA" && F="n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json"; for c in 24d75ea bc0c8d9 2c30cba 1105522 4abb3e9 ebb4dee origin/prod; do printf "%-12s " $c; git show "$c:$F" 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const w=JSON.parse(s);const t=w.nodes.filter(n=>n.type.includes('scheduleTrigger')).map(n=>n.name+'='+JSON.stringify(n.parameters.rule.interval[0]));const codeKB=Math.round(w.nodes.reduce((a,n)=>a+(n.parameters.jsCode||'').length,0)/1024);console.log('nodes',w.nodes.length,'| code KB',codeKB,'|',t.join(' ; '), '| saveSettings', JSON.stringify(w.settings))}catch(e){console.log('n/a')}})"; done

OUT
24d75ea      nodes 78 | code KB 5495 | Verificar Follow-ups Vencidos={"field":"minutes","minutesInterval":1} ; Recuperar Fila WhatsApp={"field":"seconds","secondsInterval":10} | saveSettings {"executionOrder":"v1","binaryMode":"separate","availableInMCP":true}
bc0c8d9      nodes 78 | code KB 5454 | Verificar Follow-ups Vencidos={"field":"minutes","minutesInterval":1} ; Recuperar Fila WhatsApp={"field":"seconds","secondsInterval":10} | saveSettings {"executionOrder":"v1","binaryMode":"separate","availableInMCP":true}
2c30cba      nodes 68 | code KB 2572 | Verificar Follow-ups Vencidos={"field":"minutes","minutesInterval":1} ; Recuperar Fila WhatsApp={"field":"seconds","secondsInterval":10} | saveSettings {"executionOrder":"v1","binaryMode":"separate","availableInMCP":true}
1105522      nodes 68 | code KB 2436 | Verificar Follow-ups Vencidos={"field":"minutes","minutesInterval":1} ; Recuperar Fila WhatsApp={"field":"seconds","secondsInterval":10} | saveSettings {"executionOrder":"v1","binaryMode":"separate","availableInMCP":true}
4abb3e9      nodes 68 | code KB 2390 | Verificar Follow-ups Vencidos={"field":"minutes","minutesInterval":1} ; Recuperar Fila WhatsApp={"field":"seconds","secondsInterval":10} | saveSettings {"executionOrder":"v1","binaryMode":"separate","availableInMCP":true}
ebb4dee      nodes 63 | code KB 707 | Verificar Follow-ups Vencidos={"field":"minutes","minutesInterval":1} ; Recuperar Fila WhatsApp={"field":"seconds","secondsInterval":10} | saveSettings {"executionOrder":"v1","binaryMode":"separate","availableInMCP":true}
origin/prod  n/a
11:46 AM
O tamanho do código embutido no CORE pulou de 0,7 MB (16/10) para 2,5 MB e agora para 5,4 MB. Vou ver por nó.



Bash Measure per-node code size and trigger reach
IN
cd "/c/Users/wever/OneDrive/Documentos/Shtorache/JIW/NORIA/Mag.IA/n8n/workflows" && ls -la *.json | awk '{print $5, $9, $10, $11, $12, $13, $14, $15, $16, $17}'; node -e "
const w=require('./NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json');
const rows=w.nodes.map(n=>[Math.round((n.parameters.jsCode||'').length/1024),n.name,n.disabled?'[DIS]':'']).filter(r=>r[0]>20).sort((a,b)=>b[0]-a[0]);
for(const r of rows) console.log(String(r[0]).padStart(5)+' KB',r[1],r[2]);
console.log('nodes with >20KB code:',rows.length);
const c=w.connections; const next=n=>((c[n]||{}).main||[]).flat().map(x=>x.node);
// walk from recovery trigger
function walk(start){const seen=new Set();const q=[start];while(q.length){const x=q.shift();if(seen.has(x))continue;seen.add(x);q.push(...next(x));}return seen;}
for(const t of ['Recuperar Fila WhatsApp','Verificar Follow-ups Vencidos']){const s=walk(t);const kb=[...s].reduce((a,n)=>a+((w.nodes.find(x=>x.name===n)?.parameters.jsCode||'').length),0)/1024;console.log('reachable from',t,':',s.size,'nodes, code',Math.round(kb),'KB');console.log('   first hops:',[...s].slice(0,8).join(' > '));}
"

OUT
5892739 NORIA CORE _ WhatsApp + Comandos + Follow-ups _
47641 NORIA EXT Royal 4x4 _ Catalogo Supabase 24h +
119432 NORIA EXT _ Gênesis _ Política comercial v2 (1).json
8300 NORIA EXT _ NB Bronze _ Política de negócio
45441 NORIA EXT _ NB Bronze _ Serviços v2.json 
  888 KB CORE | Motor conversacional único 
  888 KB CORE | Preparar resposta 
  888 KB CORE | Finalizar resposta 
  888 KB CORE | Serviços | Preparar resposta [DIS]
  888 KB CORE | Serviços | Verificar disponibilidade [DIS]
  888 KB CORE | Serviços | Finalizar resposta [DIS]
   32 KB Preparar Contexto JIW 
nodes with >20KB code: 7
reachable from Recuperar Fila WhatsApp : 26 nodes, code 5351 KB
   first hops: Recuperar Fila WhatsApp > Ler Fila WhatsApp > CORE - Resolver extensão do tenant > CORE | Serviços | Núbia v2? > CORE | Serviços | Executar EXT bootstrap > CORE - É Núbia? > CORE | Serviços | Preparar dispatch > Executar EXT Nubia (PREENCHER ID)
reachable from Verificar Follow-ups Vencidos : 2 nodes, code 14 KB
   first hops: Verificar Follow-ups Vencidos > Processar Follow-ups
11:46 AM
O CORE tem 5,9 MB, e o mesmo motor de 888 KB está copiado em 6 nós. Vou ver o que o gatilho de 10 s faz quando a fila está vazia.



Bash Inspect the queue reader node
IN
cd "/c/Users/wever/OneDrive/Documentos/Shtorache/JIW/NORIA/Mag.IA/n8n/workflows" && node -e "
const w=require('./NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json');
const n=w.nodes.find(n=>n.name==='Ler Fila WhatsApp');console.log(n.type, JSON.stringify(n.parameters).slice(0,1500));
"

OUT
n8n-nodes-base.code {"jsCode":"const base = String($env.SUPABASE_URL || '').replace(/\\/$/, '');\nconst key = $env.SUPABASE_SERVICE_ROLE_KEY;\n// The recovery query uses v1 columns. Check without claiming or rewriting a lot.\nlet readiness;\ntry {\n  readiness = await this.helpers.httpRequest({ method: 'GET',\n    url: base + '/rest/v1/rpc/magia_turn_lifecycle_status',\n    headers: { apikey: key, Authorization: 'Bearer ' + key }, json: true, timeout: 10000 });\n} catch (error) {\n  throw new Error('TURN_LIFECYCLE_DEPLOYMENT_REQUIRED:' + String(error?.message || error).slice(0, 160));\n}\nif (readiness?.ready !== true || readiness.contract !== 'noria_turn_lifecycle_v1') {\n  throw new Error('TURN_LIFECYCLE_DEPLOYMENT_REQUIRED');\n}\nconst now = encodeURIComponent(new Date().toISOString());\nconst rows = await this.helpers.httpRequest({ method: 'GET',\n  url: base + '/rest/v1/conversation_turn_queue?select=*,tenants(slug)'\n    + '&channel_type=eq.whatsapp&phase=in.(ready,processing,sending)&quiet_until=lte.' + now\n    + '&and=(or(next_attempt_at.is.null,next_attempt_at.lte.' + now + '),or(pending.neq.%5B%5D,claimed.neq.%5B%5D))'\n    + '&or=(token.is.null,lease_until.lte.' + now + ')&order=updated_at.asc&limit=30',\n  headers: { apikey: key, Authorization: 'Bearer ' + key }, json: true, timeout: 10000 });\nreturn rows.filter(row => row.pending?.length || row.claimed?.length).map(row => ({ json: {\n  tenant_id: row.tenant_id, tenant_slug: row.tenants.slug, remoteJid: row.chat_id, instance: row.i
11:46 AM
Com a fila vazia, cada disparo termina em 2 nós. Mesmo assim o n8n grava uma execução por disparo. Falta conferir o modo dos nós grandes e as configurações de gravação de execução.



Bash Check code node modes, wait node and execution settings
IN
cd "/c/Users/wever/OneDrive/Documentos/Shtorache/JIW/NORIA/Mag.IA/n8n/workflows" && node -e "
const w=require('./NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json');
for(const n of w.nodes.filter(n=>(n.parameters.jsCode||'').length>500000)) console.log(n.name,'| mode:',n.parameters.mode||'runOnceForAllItems');
const wait=w.nodes.find(n=>n.type.includes('wait'));console.log('wait:',wait.name, JSON.stringify(wait.parameters));
const r=require('./NORIA EXT Royal 4x4 _ Catalogo Supabase 24h + IA sob demanda v2.json');const wk=r.nodes.find(n=>n.name.includes('Worker'));const nx=(r.connections[wk.name]?.main||[]).flat().map(x=>x.node);console.log('royal worker ->',nx);
"; grep -n -iE "EXECUTIONS_|N8N_RUNNERS|saveData" ../../docker-compose.yml ../../infra -r 2>/dev/null | head

OUT
CORE | Motor conversacional único | mode: runOnceForEachItem
CORE | Preparar resposta | mode: runOnceForEachItem
CORE | Finalizar resposta | mode: runOnceForEachItem
CORE | Serviços | Preparar resposta | mode: runOnceForEachItem
CORE | Serviços | Verificar disponibilidade | mode: runOnceForEachItem
CORE | Serviços | Finalizar resposta | mode: runOnceForEachItem
wait: Aguardar Janela de Mensagens {"amount":"={{ Math.max(0, Number($json.core_wait_seconds ?? 13)) }}"}
royal worker -> [ 'ROYAL | Processar fila estoque IA' ]
../../docker-compose.yml:84:      EXECUTIONS_DATA_SAVE_ON_ERROR: all
../../docker-compose.yml:85:      EXECUTIONS_DATA_SAVE_ON_SUCCESS: all
../../docker-compose.yml:86:      EXECUTIONS_DATA_SAVE_MANUAL_EXECUTIONS: "true"
../../docker-compose.yml:87:      EXECUTIONS_DATA_PRUNE: "true"
../../docker-compose.yml:88:      EXECUTIONS_DATA_MAX_AGE: 336
../../infra/local/docker-compose.local.yml:109:      EXECUTIONS_PROCESS: main
../../infra/local/docker-compose.local.yml:110:      EXECUTIONS_DATA_SAVE_ON_ERROR: all
../../infra/local/docker-compose.local.yml:111:      EXECUTIONS_DATA_SAVE_ON_SUCCESS: all
../../infra/local/docker-compose.local.yml:112:      EXECUTIONS_DATA_SAVE_MANUAL_EXECUTIONS: "true"
../../infra/local/docker-compose.local.yml:113:      EXECUTIONS_DATA_PRUNE: "true"
11:47 AM
Sim, tem coisa nos workflows que pesa no servidor, e cresceu bastante nos últimos dias. O suspeito principal é o volume que o n8n grava no próprio Postgres a cada execução, não a lógica do atendimento. Não consigo acessar o EasyPanel nem o banco do n8n (o Supabase é outro banco), então isso é análise dos arquivos do repositório e precisa ser confirmado com as consultas abaixo.

O que encontrei
1. O CORE ficou grande demais. O arquivo do CORE tem 5,9 MB, e um motor de 888 KB está copiado em 6 nós:

Versão do CORE	Código embutido
16/10 (ebb4dee)	0,7 MB
20/10 (2c30cba)	2,5 MB
21/10 (atual)	5,4 MB
Metade do aumento de hoje vem dos 3 nós da Núbia v2 (CORE | Serviços | …). Eles estão desabilitados, mas continuam dentro do JSON do workflow.

2. Gatilhos que disparam sozinhos, o dia inteiro:

Gatilho	Frequência	Execuções/dia
CORE Recuperar Fila WhatsApp	10 s	8.640
CORE Verificar Follow-ups Vencidos	1 min	1.440
Royal 4x4 Worker Royal 10s	10 s	8.640
Com a fila vazia, o gatilho de 10 s termina em 2 nós. Mesmo assim, o n8n grava uma execução por disparo. A configuração do repositório usa EXECUTIONS_DATA_SAVE_ON_SUCCESS=all, e cada execução gravada leva junto uma cópia do workflow inteiro (coluna workflowData).

A conta fica assim: cerca de 10 mil execuções/dia do CORE × 5,9 MB dá algo como 50 GB/dia de escrita. Em 16/10 eram uns 8 GB/dia. Isso bate com os checkpoints gravando muitos buffers que apareceram nos logs. A limpeza de 7 dias ainda soma mais carga, porque apaga esse volume todo.

3. Cada mensagem de WhatsApp também pesa. Ela passa por um nó de espera de 13 s, gravado no banco com o workflow inteiro, e roda até 3 nós de 888 KB. Isso consome CPU e memória a cada mensagem.

Como confirmar (SQL no Postgres do n8n, n8n-db, não no Supabase)

-- 1. Maiores tabelas e tamanho do banco
select relname, pg_size_pretty(pg_total_relation_size(relid)) from pg_statio_user_tables
order by pg_total_relation_size(relid) desc limit 6;
select pg_size_pretty(pg_database_size(current_database()));

-- 2. Execuções nas últimas 6 horas, por workflow
select w.name, e.mode, e.status, count(*) from execution_entity e
join workflow_entity w on w.id = e."workflowId"
where e."startedAt" > now() - interval '6 hours' group by 1,2,3 order by 4 desc;

-- 3. Quanto cada execução grava (última hora)
select w.name, count(*), pg_size_pretty(avg(octet_length(d."workflowData"::text))::bigint) as workflow,
       pg_size_pretty(avg(octet_length(d.data))::bigint) as dados
from execution_data d join execution_entity e on e.id = d."executionId"
join workflow_entity w on w.id = e."workflowId"
where e."startedAt" > now() - interval '1 hour' group by 1;
No EasyPanel, veja também:

quem está no limite de CPU e memória, o serviço n8n ou o n8n-db;
o espaço em disco do volume do Postgres. Disco cheio também derruba o banco com "Database is not ready".
Mitigação imediata (sem mexer em código, reversível)
Pare de gravar execuções com sucesso. Use a variável EXECUTIONS_DATA_SAVE_ON_SUCCESS=none no n8n, ou só nos workflows CORE e Royal (Settings → "Save successful production executions" → Do not save). As execuções com erro continuam gravadas. Isso deve cortar a maior parte da escrita.
Adicione EXECUTIONS_DATA_PRUNE_MAX_COUNT=20000 para limitar o acúmulo.
Se a Royal 4x4 não está atendendo de verdade, desative o workflow dela. São 8.640 disparos/dia.
Correções no código (preciso do seu ok)
A. Tirar os 3 nós da Núbia v2 do CORE até ela entrar no ar. O CORE volta para uns 3,2 MB (−45%). Simples e sem risco para Gênesis e Núbia v1.
B. Aumentar o intervalo de Recuperar Fila WhatsApp de 10 s para 30 s. Ele é o caminho de reserva, porque o webhook já processa as mensagens. Escrita e CPU desse gatilho caem 3×, e quando o webhook falha a mensagem pode atrasar até 30 s.
C. Mais à frente: não repetir o motor de 888 KB em vários nós. É uma decisão de arquitetura para conversarmos.
Minha sugestão: aplique a mitigação 1 agora, rode as consultas e me mande os resultados. Se confirmar, faço A e B.



Serviço N8N que está no limite

o problema é que não estou conseguindo acessar nada. Nem parar os serviços, nem abrir os consoles. O que faço?
Show more
12:20 PM
Se o painel do EasyPanel não responde, entre direto no servidor por SSH, desligue o n8n por lá, corrija a configuração e só então ligue de novo. Com o n8n parado, a CPU e a memória liberam e o painel tende a voltar.

1. Entrar no servidor
No seu computador:


ssh root@IP_DO_SERVIDOR
Se o SSH também travar: use o painel do provedor da VPS (Hetzner, Contabo, DigitalOcean, Hostinger etc.).

Se ele tiver um console web (VNC), use-o para entrar.
Se não tiver, faça Reboot pela VPS. Logo depois do boot, entre por SSH e vá direto ao passo 2, antes que o n8n suba e trave tudo de novo.
2. Desligar o n8n (o banco continua de pé)
O EasyPanel roda em Docker Swarm:


docker service ls | grep -i n8n
Anote o nome do serviço do n8n, algo como projeto_n8n. Não pegue o projeto_n8n-db. Depois:


docker service scale projeto_n8n=0
Isso para o n8n e libera os recursos. Nada é apagado, e o banco do n8n continua rodando.

Confira o disco também, porque disco cheio derruba o Postgres:


df -h /
docker stats --no-stream
3. Corrigir a configuração antes de religar
Com o n8n parado, o painel do EasyPanel deve voltar a abrir. No serviço n8n → Environment, adicione:


EXECUTIONS_DATA_SAVE_ON_SUCCESS=none
EXECUTIONS_DATA_PRUNE_MAX_COUNT=20000
Confira também se as linhas não terminam com \, como no texto que você colou antes. Depois clique em Deploy.

Se o painel continuar fora, aplique pelo SSH:


docker service update \
  --env-add EXECUTIONS_DATA_SAVE_ON_SUCCESS=none \
  --env-add EXECUTIONS_DATA_PRUNE_MAX_COUNT=20000 \
  projeto_n8n
docker service scale projeto_n8n=1
Quando o painel voltar, cadastre as mesmas variáveis nele também. O próximo Deploy feito pelo EasyPanel pode apagar o que foi aplicado só pelo terminal.

4. Opcional: aliviar o banco antes de religar
Só faça isto com o n8n parado e o disco cheio ou quase cheio. Entre no banco:


docker exec -it $(docker ps -q -f name=n8n-db) psql -U postgres -d NOME_DO_BANCO
NOME_DO_BANCO é o valor de DB_POSTGRESDB_DATABASE, normalmente o nome do projeto. Rode:


select pg_size_pretty(pg_database_size(current_database()));
delete from execution_entity where status = 'success' and "startedAt" < now() - interval '1 day';
O delete apaga só o histórico de execuções bem-sucedidas com mais de 1 dia. Os dados de cada execução saem junto, e workflows e credenciais não são tocados.

Enquanto o n8n estiver parado
A IA não responde no WhatsApp das clientes. As mensagens continuam chegando no celular normalmente, mas não passam pela NORIA. Faça isso num horário de pouco movimento, se der, ou avise quem atende manualmente.

Depois que estabilizar
Me mande:

o resultado de df -h e docker stats;
o tamanho do banco (consulta do passo 4).
Com isso eu aplico as correções A (tirar os nós desabilitados da Núbia v2) e B (fila de recuperação a cada 30 s) e te passo o CORE mais leve para importar.



analise os novos json que vieram no pull e veja se faz sentido
Bash Show new commits pulled since last review
IN
cd "/c/Users/wever/OneDrive/Documentos/Shtorache/JIW/NORIA/Mag.IA" && git status --short | head -20; git log --oneline -8; echo; git log --oneline 24d75ea..HEAD --stat | head -60

OUT
bcbabe3 workflow core topico 1 lista
15f20f9 fix(db): turnos perdidos por TURN_CONTROL_ORIGIN_REQUIRED
988ba04 fix(genesis): foto de outro veículo e nenhuma mensagem de erro ao cliente
24d75ea fix(core): preserve authorized photo delivery and sticker media
bc0c8d9 workflow genesis quase finalizado, faltam testes reais de validaçao em cenarios exoticos
6c0348a chore: otimizar arquivos de agentes e organizar .agents
fcc8544 new: arquivo para refatoraçao nubia
2c30cba reorganização do workflow core e genesis e fix do carregamento de imagens da tela de conversas

bcbabe3 workflow core topico 1 lista
 n8n/build_manifest.json                            |  15 +-
 n8n/code/whatsapp_conversation_core.generated.js   |   2 +-
 n8n/sources/noria_core.js                          |   2 +-
 ...ndos + Follow-ups _ Motor compartilhado v2.json | 364 +--------------------
 scripts/build_noria_workflows.cjs                  | 143 +++-----
 5 files changed, 57 insertions(+), 469 deletions(-)
15f20f9 fix(db): turnos perdidos por TURN_CONTROL_ORIGIN_REQUIRED
 scripts/test_turn_control_fromme.cjs               | 179 +++++++++++++++++
 .../turn_control_fromme_manual_reply_v1.sql        | 221 +++++++++++++++++++++
 .../fixtures/turn_control_prod_2026_10_21.sql      | 201 +++++++++++++++++++
 3 files changed, 601 insertions(+)
988ba04 fix(genesis): foto de outro veículo e nenhuma mensagem de erro ao cliente
 n8n/build_manifest.json                            | 10 +--
 n8n/code/whatsapp_conversation_core.generated.js   | 99 +++++++++++++++++-----
 n8n/code/whatsapp_sales.js                         | 80 +++++++++++++----
 n8n/sources/genesis_extension.js                   | 42 +++++----
 n8n/sources/noria_core.js                          | 99 +++++++++++++++++-----
 ...ndos + Follow-ups _ Motor compartilhado v2.json | 12 +--
 ...2nesis _ Pol\303\255tica comercial v2 (1).json" |  2 +-
 scripts/homolog/photo_switch_checks.cjs            | 92 ++++++++++++++++++++
 scripts/test_genesis_dialogue_recovery.cjs         | 67 +++++++++------
 .../genesis_prompt_v14_21_photos_no_error.sql      | 42 +++++++++
 10 files changed, 431 insertions(+), 114 deletions(-)
Bash Read commit messages and core/manifest diff
IN
cd "/c/Users/wever/OneDrive/Documentos/Shtorache/JIW/NORIA/Mag.IA" && git show -s --format='%an %ad%n%B' --date=iso bcbabe3 988ba04 15f20f9 | head -60; echo ====; git show bcbabe3 -- n8n/sources/noria_core.js n8n/build_manifest.json | head -80

OUT
arywnz 2026-10-21 12:40:23 -0300
workflow core topico 1 lista

arywnz 2026-10-21 11:45:00 -0300
fix(genesis): foto de outro veículo e nenhuma mensagem de erro ao cliente

- EXT: pedido de foto de outro veículo usa o veículo citado na mensagem
  atual (antes reenviava a foto do foco anterior) e o devolve como
  authorized_product.
- CORE: turno só de foto pode ter texto vazio (sai apenas a imagem),
  sem forçar frases como "segue a foto".
- CORE: textos de erro ao cliente removidos; resposta rejeitada por fato
  não comprovado passa por uma reescrita auditada e, se ainda inválida,
  o turno fica em silêncio, retido em review, com alerta ao operador.
- Prompt v14.21 da Gênesis em migrations_pending_review (aplicar após
  publicar este CORE).
- Testes: scripts/homolog/photo_switch_checks.cjs (5/5) e
  test_genesis_dialogue_recovery.cjs atualizado (12/12).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

arywnz 2026-10-21 11:45:00 -0300
fix(db): turnos perdidos por TURN_CONTROL_ORIGIN_REQUIRED

O eco da resposta manual pelo WhatsApp do celular é gravado como
manual_reply/sender_type=agent e o gatilho de origem só aceitava
sender_type=human: nenhuma origem era registrada e a mensagem seguinte
do cliente falhava como erro técnico (39 turnos em 3 dias).

Migração pendente (não aplicada):
- gatilho registra origem do eco fromMe com a mesma prova de ingresso;
- manual_reply com origem conta como controle humano;
- backfill das origens comprovadas;
- controle legado sem prova com mais de 7 dias não retém mais a conversa.

Teste em Postgres 16 via Docker contra as funções publicadas (10/10).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

====
commit bcbabe3ef8aa33cd3667797c157b33e0d46c8fb8
Author: arywnz <lozeborges19@gmail.com>
Date:   Wed Oct 21 12:40:23 2026 -0300

    workflow core topico 1 lista

diff --git a/n8n/build_manifest.json b/n8n/build_manifest.json
index b1d1227..d1f86e9 100644
--- a/n8n/build_manifest.json
+++ b/n8n/build_manifest.json
@@ -7,22 +7,13 @@
     "production_approved": false
   },
   "core_revision": "conversation_core_v2_1_34_core_ext_decision_identity_2026_10_21",
-  "built_at": "2026-10-21T14:24:21.814Z",
+  "built_at": "2026-10-21T15:18:47.328Z",
   "core_sha256": "1886f57ceaa7630e1f4322816a0b8a30355667c162b8e445b4d50548a09bb515",
-  "raw_disk_sha256": "766e0ccfe01ffa1f19d594f9875ae766814a68c86d39de0ff6c2620e2f8eaeea",
+  "raw_disk_sha256": "3c993d71839c3daebeb448f38dba7db26e45ffdb1da650a9b2abe28b6b05db88",
   "hash_explanation": "core_sha256 is the deterministic normalized hash embedded into the runtime code block; raw_disk_sha256 is the direct sha256 of the generated source file on disk after metadata embedding.",
   "ext_sha256": "6d2ebb0d83e40f34b17b4b6035829114666aa6823ae48ecd9384f4aa7bab2249",
   "ext_identity_sha256": "d816584a739645172a4573ee6a74bc25303a597c732ac87446e6c6254af9f026",
   "ext_bundle_sha256": "26825c4819f7e269b49bfd678610d8b2f017eb37c63b7319abd13beb23487c70",
-  "services_pipeline": {
-    "status": "wired_default_v1_chain_disabled_until_publication",
-    "nubia_ext_sha256": "18f7732fd363045a9de68c129a9f137ea095447bdcf5d8e39df371d36048b254",
-    "turn_dispatch_sha256": "04e81ed86ad02257686319d584d06a0d1626c056e7f0da56bf2898fa03ad5f94",
-    "router_sha256": "0cf0340f15c8c90f0399b5ebe286c09e9f2673aa34daa1b3eead11d2e9edefba",
-    "ext_workflow": "n8n/workflows/NORIA EXT _ NB Bronze _ Serviços v2.json",
-    "chain_nodes_disabled": true,
-    "ext_workflow_id": "resolved_at_publication_by_name"
-  },
   "recovery_sha256": "480c2dc32082099a130fa4f19e86f71cf08bfed77a8ef83d093f68d82bfb61e8",
   "control_origin_adapter_sha256": "a1ad08d1e95826cefaf15ca738fa5418f29725938624ee6b24972cfc10524c40",
   "operations_bridge_sha256": "c2115d9dcfb100861a6915598ebb8b605edf119a52d34473119c06c7f9dc46fe",
@@ -31,8 +22,6 @@
     "n8n/sources/genesis_extension.js",
     "n8n/sources/genesis_tenant_identity.js",
     "n8n/sources/nubia_extension.js",
-    "n8n/sources/noria_turn_dispatch.js",
-    "n8n/sources/noria_router.js",
     "n8n/workflows/NORIA EXT _ NB Bronze _ Serviços v2.json",
     "n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json",
     "n8n/workflows/NORIA EXT _ Gênesis _ Política comercial v2 (1).json",
diff --git a/n8n/sources/noria_core.js b/n8n/sources/noria_core.js
index fa8f608..a656d37 100644
--- a/n8n/sources/noria_core.js
+++ b/n8n/sources/noria_core.js
@@ -53,7 +53,7 @@ function validateTenantPolicyContract() {
 }
 const coreBuildMetadata = {
   revision: 'conversation_core_v2_1_34_core_ext_decision_identity_2026_10_21',
-  built_at: '2026-10-21T14:24:21.814Z',
+  built_at: '2026-10-21T15:18:47.328Z',
   core_sha256: '1886f57ceaa7630e1f4322816a0b8a30355667c162b8e445b4d50548a09bb515',
   ext_sha256: '6d2ebb0d83e40f34b17b4b6035829114666aa6823ae48ecd9384f4aa7bab2249',
 };
12:46 PM
O commit bcbabe3 parece ser a correção A (tirar a cadeia da Núbia v2 do CORE). Vou conferir o JSON resultante: tamanho, nós, conexões, roteador e gatilhos.



Bash Validate new CORE workflow structure and router
IN
cd "/c/Users/wever/OneDrive/Documentos/Shtorache/JIW/NORIA/Mag.IA/n8n/workflows" && ls -la "NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json" | awk '{print $5}'; node -e "
const w=require('./NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json');
const names=new Set(w.nodes.map(n=>n.name));
console.log('nodes',w.nodes.length,'| disabled',w.nodes.filter(n=>n.disabled).map(n=>n.name));
console.log('code KB',Math.round(w.nodes.reduce((a,n)=>a+(n.parameters.jsCode||'').length,0)/1024));
console.log('big nodes',w.nodes.filter(n=>(n.parameters.jsCode||'').length>500000).map(n=>n.name));
console.log('services nodes left',w.nodes.filter(n=>n.name.includes('Serviços')).map(n=>n.name));
// dangling connections
const bad=[];for(const [from,e] of Object.entries(w.connections)){if(!names.has(from))bad.push('from:'+from);for(const out of Object.values(e))for(const b of out)for(const c of (b||[]))if(!names.has(c.node))bad.push(from+'->'+c.node);}
console.log('dangling',bad);
const nx=n=>((w.connections[n]||{}).main||[]).map(b=>(b||[]).map(c=>c.node));
console.log('router ->',JSON.stringify(nx('CORE - Resolver extensão do tenant')));
const r=w.nodes.find(n=>n.name==='CORE - Resolver extensão do tenant').parameters.jsCode;
console.log('router len',r.length,'| mentions noria_turn_pipeline:',r.includes('noria_turn_pipeline'),'| pin:',r.includes('noria_pin'));
console.log(r.slice(0,900));
console.log('schedules',w.nodes.filter(n=>n.type.includes('schedule')).map(n=>n.name+'='+JSON.stringify(n.parameters.rule.interval[0])));
console.log('settings',JSON.stringify(w.settings));
console.log('PREENCHER refs', JSON.stringify(w).includes('PREENCHER_ID_EXT_NUBIA_V2'));
"

OUT
3061102
nodes 68 | disabled []
code KB 2835
big nodes [
  'CORE | Motor conversacional único',
  'CORE | Preparar resposta',
  'CORE | Finalizar resposta'
]
services nodes left []
dangling []
router -> [["CORE - É Núbia?"]]
router len 6017 | mentions noria_turn_pipeline: true | pin: true
// NORIA CORE — resolução de extensão do tenant (fonte canônica; gerada no nó "CORE - Resolver extensão do tenant").
// Tenants legados mantêm o roteamento anterior. Para o tenant legado de contrato 1.0 que declara
// settings.noria_turn_pipeline, a versão (1.0 ou 2.0) é escolhida aqui, por configuração validada, e fica FIXA enquanto houver
// um lote em andamento: um turno nunca muda de versão no meio. Sem declaração válida e habilitada, o resultado é idêntico ao anterior.
const v = $json || {};
function required(x, label) { if (typeof x !== 'string' || !x.trim()) throw new Error('NORIA_ROTEAMENTO: '+label+' ausente'); return x.trim(); }
const tenant_slug = required(v.tenant_slug, 'tenant_slug');
const tenant_id = required(v.tenant_id, 'tenant_id');
required(v.instance, 'instance');
const remoteJid = required(v.remoteJid, 'remoteJid');

const base = String($env.SUPABASE_URL || '').repla
schedules [
  'Verificar Follow-ups Vencidos={"field":"minutes","minutesInterval":1}',
  'Recuperar Fila WhatsApp={"field":"seconds","secondsInterval":10}'
]
settings {"executionOrder":"v1","binaryMode":"separate","availableInMCP":true}
PREENCHER refs false
A cadeia saiu sem quebrar conexões, e o CORE caiu de 5,9 MB para 3,1 MB. Vou verificar como o roteador (ainda na versão nova, lendo noria_turn_pipeline) se comporta agora que a v2 não existe mais no grafo.
Bash Read router logic and build script diff
IN
cd "/c/Users/wever/OneDrive/Documentos/Shtorache/JIW/NORIA/Mag.IA/n8n/workflows" && node -e "
const w=require('./NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json');
console.log(w.nodes.find(n=>n.name==='CORE - Resolver extensão do tenant').parameters.jsCode.slice(900));
const e=w.nodes.find(n=>n.name==='CORE - É Núbia?');console.log('\n== É Núbia?',JSON.stringify(e.parameters).slice(0,600));
"; cd ../..; git show bcbabe3 -- scripts/build_noria_workflows.cjs | grep -E '^[-+]' | grep -v '^[-+]{3}' | head -80

OUT
ce(new RegExp('/$'), '');
const key = String($env.SUPABASE_SERVICE_ROLE_KEY || '');
const get = endpoint => this.helpers.httpRequest({ method: 'GET', url: base + '/rest/v1/' + endpoint,
  headers: { apikey: key, Authorization: 'Bearer ' + key }, json: true, timeout: 7000 });
const enc = encodeURIComponent;

const byTenant = { clinica_nubia_oficial: 'nubia', wesley_automoveis: 'genesis' };
const contractVersionByTenant = { wesley_automoveis: '2.0' };
const legacyExtension = byTenant[tenant_slug];
if (legacyExtension) {
  const legacy = { ...v, noria_extension: legacyExtension, noria_contract_version: contractVersionByTenant[tenant_slug] || '1.0', noria_router: 'core_3wf_v1', noria_dispatch_phase: 'bootstrap' };
  // A contract line that already has its own version (Gênesis) never takes part in the services pipeline selection.
  if (contractVersionByTenant[tenant_slug]) return { json: legacy };
  if (!base || !key) throw new Error('NORIA_ROTEAMENTO_SEM_CREDENCIAIS_DB');
  const digits = value => String(value || '').replace(/\D/g, '');
  // Pilot identity: only a phone JID (<digits>@s.whatsapp.net) of the authenticated ingress can match. LID, group and broadcast
  // identifiers never match a configured number, even if their digits coincide.
  const phoneOf = jid => { const m = /^(\d{8,15})(?::\d+)?@s\.whatsapp\.net$/.exec(String(jid || '')); return m ? m[1] : ''; };
  const validContact = item => typeof item === 'string' && /^\d{8,15}$/.test(digits(item));
  const PIPELINE_VERSIONS = ['2.0'];
  try {
    const rows = await get('tenant_settings?select=settings&tenant_id=eq.' + enc(tenant_id) + '&limit=1');
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error('settings');
    const declared = rows[0].settings?.noria_turn_pipeline;
    // 1. An in-flight batch stays with the pipeline that started it (the dispatcher leaves a pin on the batch).
    const queue = await get('conversation_turn_queue?select=claimed&tenant_id=eq.' + enc(tenant_id) + '&channel_type=eq.whatsapp&chat_id=eq.' + enc(remoteJid) + '&limit=1');
    const claimed = Array.isArray(queue) && Array.isArray(queue[0]?.claimed) ? queue[0].claimed : [];
    let pinned = false;
    if (claimed.length) {
      const keys = claimed.map(item => String(item?.event_id || item?.id || '')).filter(Boolean)
        .flatMap(id => PIPELINE_VERSIONS.map(version => 'noria_pin_' + version + '_' + id));
      const pins = keys.length ? await get('channel_events?select=external_message_id&tenant_id=eq.' + enc(tenant_id) + '&channel_type=eq.whatsapp&external_conversation_id=eq.' + enc(remoteJid)
        + '&external_message_id=in.(' + keys.map(enc).join(',') + ')&limit=1') : [];
      if (!Array.isArray(pins)) throw new Error('pin');
      pinned = pins.length > 0;
      if (!pinned) return { json: legacy };
      return { json: { ...legacy, noria_contract_version: PIPELINE_VERSIONS[0], noria_router: 'services_v2_pinned', noria_pipeline: 'services_v1' } };
    }
    // 2. No batch in flight: an explicit, valid and enabled declaration selects the pipeline; anything else keeps 1.0.
    if (declared === undefined || declared === null) return { json: legacy };
    if (typeof declared !== 'object' || Array.isArray(declared)) throw new Error('NORIA_ROTEAMENTO_PIPELINE_CONFIG_INVALIDA');
    if (declared.enabled !== true) return { json: legacy };
    const scoped = declared.rollout === 'all' || (declared.rollout === 'pilot' && Array.isArray(declared.pilot?.allowed_contacts)
      && declared.pilot.allowed_contacts.length > 0 && declared.pilot.allowed_contacts.every(validContact));
    if (declared.contract !== 'noria_turn_pipeline_v1' || declared.capability !== 'services_v1' || !PIPELINE_VERSIONS.includes(declared.contract_version) || !scoped) {
      throw new Error('NORIA_ROTEAMENTO_PIPELINE_CONFIG_INVALIDA');
    }
    const allowed = declared.rollout === 'all' || (phoneOf(remoteJid) !== '' && declared.pilot.allowed_contacts.some(item => digits(item) === phoneOf(remoteJid)));
    return { json: allowed ? { ...legacy, noria_contract_version: declared.contract_version, noria_router: 'services_v2', noria_pipeline: 'services_v1', noria_pipeline_rollout: declared.rollout } : legacy };
  } catch (error) {
    if (/^NORIA_ROTEAMENTO_/.test(String(error?.message))) throw error;
    // Fail closed: no silent fallback between incompatible versions. The message stays queued and the recovery loop retries.
    throw new Error('NORIA_ROTEAMENTO_PIPELINE_INDISPONIVEL');
  }
}

// Para novos tenants SaaS autônomos, busca noria_client_policy diretamente em tenant_settings
if (!base || !key) throw new Error('NORIA_ROTEAMENTO_SEM_CREDENCIAIS_DB');

const rows = await get('tenant_settings?select=settings&tenant_id=eq.' + encodeURIComponent(tenant_id) + '&limit=1');

const s = rows?.[0]?.settings || {};
if (!s.noria_client_policy) {
  throw new Error('NORIA_SEM_EXTENSAO_CONFIGURADA: ' + tenant_slug);
}

return {
  json: {
    ...v,
    noria_extension: 'saas_dynamic',
    noria_client_policy: s.noria_client_policy,
    noria_contract_version: '1.0',
    noria_router: 'saas_dynamic_v1',
  },
};


== É Núbia? {"conditions":{"options":{"caseSensitive":true,"leftValue":"","typeValidation":"strict","version":2},"conditions":[{"leftValue":"={{ $json.noria_extension }}","rightValue":"nubia","operator":{"type":"string","operation":"equals"}}],"combinator":"and"},"options":{}}
--- a/scripts/build_noria_workflows.cjs
+++ b/scripts/build_noria_workflows.cjs
-// Services capability (Núbia v2): canonical EXT source and the generic turn dispatcher. Built as an INERT chain (see below).
+// The Núbia v2 EXT remains an isolated, inactive workflow for future work; it is no longer embedded in the CORE.
-const turnDispatchCode = fs.readFileSync(path.join(root, 'n8n/sources/noria_turn_dispatch.js'), 'utf8');
-new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', turnDispatchCode);
-// ---- Services pipeline (capability services_v1): generated, DISABLED and NOT connected to the live graph. ----
-// It adds a parallel chain bootstrap -> dispatch -> prepare -> EXT -> availability -> EXT -> finalize. No existing node or
-// connection is touched, replaced or rerouted; wiring it into the router is a separate, explicit step.
-const SERVICES_EXT_WORKFLOW_FILE = 'NORIA EXT _ NB Bronze _ Serviços v2.json';
-const SERVICES_PLACEHOLDER_WORKFLOW_ID = 'PREENCHER_ID_EXT_NUBIA_V2';
-const deterministicId = name => {
-  const h = crypto.createHash('sha1').update('noria-services-pipeline:' + name).digest('hex');
-  return [h.slice(0, 8), h.slice(8, 12), '4' + h.slice(13, 16), '8' + h.slice(17, 20), h.slice(20, 32)].join('-');
-};
-function ensureServicesPipelineNodes(workflow) {
-  const N = {
-    boot: 'CORE | Serviços | Executar EXT bootstrap', dispatch: 'CORE | Serviços | Preparar dispatch',
-    gate1: 'CORE | Serviços | Turno terminal?', prepare: 'CORE | Serviços | Preparar resposta',
-    gate2: 'CORE | Serviços | Turno terminal após prepare?', decide: 'CORE | Serviços | Executar EXT decisão',
-    avail: 'CORE | Serviços | Verificar disponibilidade', reeval: 'CORE | Serviços | Executar EXT reavaliação',
-    final: 'CORE | Serviços | Finalizar resposta', route: 'CORE | Serviços | Núbia v2?',
-  };
-  const RESOLVER = 'CORE - Resolver extensão do tenant', LEGACY_NEXT = 'CORE - É Núbia?';
-  const serviceNames = new Set(Object.values(N));
-  // Only the router's outgoing connection is allowed to change: it now passes through the version gate (false branch = the previous target).
-  const resolverBefore = workflow.connections[RESOLVER]?.main?.[0]?.map(c => c.node) || [];
-  if (!(resolverBefore.length === 1 && [LEGACY_NEXT, N.route].includes(resolverBefore[0]))) throw new Error('SERVICES_PIPELINE_UNEXPECTED_ROUTER_CONNECTION');
-  const existingConnectionsBefore = JSON.stringify(Object.entries(workflow.connections).filter(([from]) => !serviceNames.has(from) && from !== RESOLVER));
-  const notes = 'Cadeia de serviços (services_v1): INATIVA. Desabilitada e sem conexão com o fluxo ao vivo. Não conectar antes de configurar o ID da EXT e a seleção explícita do pipeline.';
-  const upsert = (name, node) => {
-    const index = workflow.nodes.findIndex(item => item.name === name);
-    const previous = index >= 0 ? workflow.nodes[index] : null;
-    // The version gate must stay ENABLED: a disabled If node would forward the item down its first (true) output.
-    const live = name === N.route;
-    const next = { ...node, name, id: previous?.id || deterministicId(name), ...(live ? {} : { disabled: true }), notes: live ? 'Seletor de versão: ramo falso = fluxo atual (v1). O ramo verdadeiro só recebe turnos que o roteador marcou por configuração validada.' : notes };
-    if (live) delete next.disabled;
-    if (previous) workflow.nodes[index] = { ...next, position: previous.position }; else workflow.nodes.push(next);
-  };
-  const base = [160400, -9600];
-  const at = (col, row = 0) => [base[0] + col * 224, base[1] + row * 160];
-  const extNode = (position, onError) => ({ type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, position,
-    parameters: { workflowId: { __rl: true, value: SERVICES_PLACEHOLDER_WORKFLOW_ID, mode: 'id' }, mode: 'each', options: { waitForSubWorkflow: true } }, ...(onError ? { onError } : {}) });
-  const coreNode = (position, phase) => ({ type: 'n8n-nodes-base.code', typeVersion: 2, position, parameters: { mode: 'runOnceForEachItem', jsCode: "const NORIA_NODE_PHASE = '" + phase + "';\n" + coreCode } });
-  const gate = position => ({ type: 'n8n-nodes-base.if', typeVersion: 2.2, position, parameters: { conditions: {
-    options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
-    conditions: [{ leftValue: '={{ $json.noria_terminal === true || $json.skipped === true }}', rightValue: true, operator: { type: 'boolean', operation: 'equals' } }],
-    combinator: 'and' }, options: {} } });
-  upsert(N.route, { type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [base[0] - 224, base[1]], parameters: { conditions: {
-    options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
-    conditions: [{ leftValue: "={{ $json.noria_pipeline === 'services_v1' }}", rightValue: true, operator: { type: 'boolean', operation: 'equals' } }],
-    combinator: 'and' }, options: {} } });
-  upsert(N.boot, extNode(at(0)));
-  upsert(N.dispatch, { type: 'n8n-nodes-base.code', typeVersion: 2, position: at(1), parameters: { mode: 'runOnceForEachItem', jsCode: turnDispatchCode } });
-  upsert(N.gate1, gate(at(2)));
-  upsert(N.prepare, coreNode(at(3), 'prepare'));
-  upsert(N.gate2, gate(at(4)));
-  upsert(N.decide, extNode(at(5), 'continueRegularOutput'));
-  upsert(N.avail, coreNode(at(6), 'availability'));
-  upsert(N.reeval, extNode(at(7), 'continueRegularOutput'));
-  upsert(N.final, coreNode(at(8), 'finalize'));
-  const link = (from, branches) => { workflow.connections[from] = { main: branches.map(targets => targets.map(node => ({ node, type: 'main', index: 0 }))) }; };
-  // Version gate: v1 stays the default branch. The router only sets noria_pipeline for a valid, enabled and in-scope declaration.
-  const resolverNode = workflow.nodes.find(node => node.name === RESOLVER);
+const NUBIA_EXT_WORKFLOW_FILE = 'NORIA EXT _ NB Bronze _ Serviços v2.json';
+const nubiaV2NodeNames = new Set([
+  'CORE | Serviços | Executar EXT bootstrap',
+  'CORE | Serviços | Preparar dispatch',
+  'CORE | Serviços | Turno terminal?',
+  'CORE | Serviços | Preparar resposta',
+  'CORE | Serviços | Turno terminal após prepare?',
+  'CORE | Serviços | Executar EXT decisão',
+  'CORE | Serviços | Verificar disponibilidade',
+  'CORE | Serviços | Executar EXT reavaliação',
+  'CORE | Serviços | Finalizar resposta',
+  'CORE | Serviços | Núbia v2?',
+]);
+
+function removeNubiaV2CoreNodes(workflow) {
+  const resolver = 'CORE - Resolver extensão do tenant';
12:46 PM
Sem a cadeia v2 no grafo, o roteador ainda faz 1 a 3 leituras extras no Supabase a cada mensagem da Núbia. Vou ver se essa versão já estava no ar antes e rodar os testes.



Bash Compare previous router and run test suites
IN
cd "/c/Users/wever/OneDrive/Documentos/Shtorache/JIW/NORIA/Mag.IA" && F="n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json"; git show "2c30cba:$F" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const w=JSON.parse(s);const r=w.nodes.find(n=>n.name==='CORE - Resolver extensão do tenant').parameters.jsCode;console.log('router@2c30cba len',r.length,'pipeline:',r.includes('noria_turn_pipeline'))})"; git show bcbabe3 -- scripts/build_noria_workflows.cjs | grep -E '^\+' | sed -n 20,80p; for t in scripts/test_nubia_extension_v2.cjs scripts/test_noria_services_pipeline.cjs scripts/test_genesis_dialogue_recovery.cjs scripts/test_genesis_cnh_name_trade.cjs scripts/test_turn_control_fromme.cjs scripts/homolog/photo_switch_checks.cjs; do printf "%s: " $t; timeout 200 node --test $t 2>&1 | grep -E "^# (pass|fail)" | tr '\n' ' '; echo; done

OUT
router@2c30cba len 1821 pipeline: false
+  const resolverNode = workflow.nodes.find(node => node.name === resolver);
+
+  workflow.nodes = workflow.nodes.filter(node => !nubiaV2NodeNames.has(node.name));
+  for (const nodeName of nubiaV2NodeNames) delete workflow.connections[nodeName];
+  for (const entry of Object.values(workflow.connections)) {
+    for (const branch of entry?.main || []) {
+      for (let index = branch.length - 1; index >= 0; index -= 1) {
+        if (nubiaV2NodeNames.has(branch[index].node)) branch.splice(index, 1);
+      }
+    }
+  // Restore the original Núbia v1 route; no tenant can reach v2 from the shared CORE.
+  workflow.connections[resolver] = { main: [[{ node: legacyNext, type: 'main', index: 0 }]] };
+  if (!workflow.nodes.some(node => node.name === legacyNext)) throw new Error('MISSING_LEGACY_NUBIA_ROUTE');
+  if (workflow.nodes.some(node => nubiaV2NodeNames.has(node.name))) throw new Error('NUBIA_V2_CORE_NODES_REMAIN');
+function deterministicNubiaExtId(name) {
+  const h = crypto.createHash('sha1').update('noria-services-pipeline:' + name).digest('hex');
+  return [h.slice(0, 8), h.slice(8, 12), '4' + h.slice(13, 16), '8' + h.slice(17, 20), h.slice(20, 32)].join('-');
+}
+
+function writeNubiaV2ExtWorkflow() {
+  const target = path.join(root, 'n8n/workflows', NUBIA_EXT_WORKFLOW_FILE);
+  const trigger = 'Entrada do NORIA CORE | Núbia serviços v2';
+  const policy = 'EXT | Serviços Núbia v2';
+      { parameters: { inputSource: 'passthrough' }, id: previous?.nodes?.find(node => node.name === trigger)?.id || deterministicNubiaExtId(trigger), name: trigger, type: 'n8n-nodes-base.executeWorkflowTrigger', typeVersion: 1.1, position: [416, -64] },
+      { parameters: { jsCode: nubiaExtCode }, id: previous?.nodes?.find(node => node.name === policy)?.id || deterministicNubiaExtId(policy), name: policy, type: 'n8n-nodes-base.code', typeVersion: 2, position: [704, -64] },
+    if (prefix === 'CORE | Finalizar resposta') {
+      ensureGenesisTerminalBypass(workflow);
+      removeNubiaV2CoreNodes(workflow);
+    }
+writeNubiaV2ExtWorkflow();
+    'n8n/workflows/' + NUBIA_EXT_WORKFLOW_FILE,
scripts/test_nubia_extension_v2.cjs: # pass 11 # fail 0 
scripts/test_noria_services_pipeline.cjs: # pass 15 # fail 2 
scripts/test_genesis_dialogue_recovery.cjs: # pass 12 # fail 0 
scripts/test_genesis_cnh_name_trade.cjs: # pass 10 # fail 0 
scripts/test_turn_control_fromme.cjs: # pass 0 # fail 0 
scripts/homolog/photo_switch_checks.cjs: # pass 0 # fail 1
Bash Show failing tests details
IN
cd "/c/Users/wever/OneDrive/Documentos/Shtorache/JIW/NORIA/Mag.IA" && node --test scripts/test_noria_services_pipeline.cjs 2>&1 | grep -E "^not ok|error:" -A3 | head -30; echo ====; node scripts/homolog/photo_switch_checks.cjs 2>&1 | tail -15; echo ====; head -15 scripts/test_turn_control_fromme.cjs

OUT
not ok 9 - build: nós de serviços desabilitados e sem conexão com o grafo ao vivo; EXTs publicadas intactas
  ---
  duration_ms: 15.0826
  type: 'test'
--
  error: |-
    Expected values to be strictly equal:
    
    0 !== 9
--
not ok 15 - publicação: preflight contra a estrutura do n8n (simulado), ID da EXT v2 por nome, backups verificáveis, divergência recusada
  ---
  duration_ms: 317.827
  type: 'test'
--
  error: |-
    CHAIN_INCOMPLETE: 0
    
    
====
FAIL snapshots unavailable in C:\Users\wever\.noria-homolog: ENOENT: no such file or directory, open 'C:\Users\wever\.noria-homolog\genesis_settings_snapshot.json'
====
// Turnos perdidos por TURN_CONTROL_ORIGIN_REQUIRED: resposta manual do operador pelo WhatsApp do celular.
// Roda as funções SQL REAIS (publicadas em 2026-10-21, ver supabase/tests/fixtures/turn_control_prod_2026_10_21.sql)
// num Postgres 16 descartável via Docker, prova a falha e prova a correção da migração pendente.
// Rodar: node --test scripts/test_turn_control_fromme.cjs   (requer Docker em execução)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const PROD = fs.readFileSync(path.join(root, 'supabase/tests/fixtures/turn_control_prod_2026_10_21.sql'), 'utf8');
const FIX = fs.readFileSync(path.join(root, 'supabase/migrations_pending_review/turn_control_fromme_manual_reply_v1.sql'), 'utf8');
const container = 'noria_turn_control_test_' + process.pid;
Bash Read pending Gênesis prompt migration
IN
cd "/c/Users/wever/OneDrive/Documentos/Shtorache/JIW/NORIA/Mag.IA/supabase/migrations_pending_review" && ls; echo ====; grep -vE '^\s*$' genesis_prompt_v14_21_photos_no_error.sql 2>/dev/null | cut -c1-220 | head -45 || find .. -name 'genesis_prompt_v14_21*'

OUT
20261017180000_genesis_inventory_vehicle_images.sql
20261017190000_enable_sales_leads_realtime_optional.sql
20261019210000_sales_assignment_preserves_human_stage.rollback.sql
20261019210000_sales_assignment_preserves_human_stage.sql
20261020010000_gemini_tenant_daily_budget.rollback.sql
20261020010000_gemini_tenant_daily_budget.sql
20261021000000_genesis_follow_up_disposition_actions.PROPOSAL.rollback.sql
20261021000000_genesis_follow_up_disposition_actions.PROPOSAL.sql
genesis_prompt_v14_21_photos_no_error.sql
reference
turn_control_fromme_manual_reply_v1.sql
turn_queue_closure_recovery_v1.sql
turn_queue_lifecycle_v1.sql
turn_queue_retry_provisioning_v1.sql
====
-- Gênesis (wesley_automoveis) — prompt v14.21: fotos naturais e nenhuma menção a erro ao cliente.
-- APLICAR SOMENTE DEPOIS de publicar o CORE com a revisão que aceita reply vazio em turno só de foto
-- (salesValidatePrimaryDialogue: photoAnswersTurn). Com o CORE antigo, reply vazio vira INVALID_PRIMARY_REPLY.
-- Guarda o prompt atual em prompt_snapshot_before_v14_21 e falha se o trecho esperado não existir.
begin;
do $$
declare
  t uuid;
  old_photos text := 'FOTOS E MÍDIAS
Quando o cliente pedir foto de um veículo identificado, a imagem pode ser a resposta; se houver texto, que seja curto, natural e útil, sem “Aqui está a foto…” nem “Segue a imagem” por reflexo.';
  new_photos text := 'FOTOS E MÍDIAS
Quando o cliente pedir foto de um veículo identificado e houver imagem autorizada, a própria foto é a resposta: deixe reply vazio, ou escreva só algo que acrescente à conversa (um detalhe oficial relevante desse ve�
  old_contract text := 'Se a validação rejeitar uma resposta, reformule a partir dos fatos autorizados, sem trocar a dúvida do cliente por menu ou fallback genérico.';
  new_contract text := 'Se a validação rejeitar uma resposta, reformule a partir dos fatos autorizados, sem trocar a dúvida do cliente por menu ou fallback genérico. Nunca mencione erro, instabilidade, sistema ou val
  current_prompt text;
begin
  select id into t from public.tenants where slug = 'wesley_automoveis';
  if t is null then raise exception 'TENANT_NOT_FOUND'; end if;
  select settings->>'system_prompt' into current_prompt from public.tenant_settings where tenant_id = t for update;
  if position(old_photos in current_prompt) = 0 then raise exception 'PROMPT_PHOTOS_SECTION_CHANGED'; end if;
  if position(old_contract in current_prompt) = 0 then raise exception 'PROMPT_CONTRACT_SECTION_CHANGED'; end if;
  update public.tenant_settings
  set settings = settings
    || jsonb_build_object(
      'prompt_snapshot_before_v14_21', jsonb_build_object(
        'revision', settings->>'prompt_revision', 'captured_at', now(), 'system_prompt', settings->>'system_prompt'),
      'system_prompt', replace(replace(replace(current_prompt, old_photos, new_photos), old_contract, new_contract),
        'SISTEMA COMERCIAL NORIA — GÊNESIS AUTOMÓVEIS — v14.20', 'SISTEMA COMERCIAL NORIA — GÊNESIS AUTOMÓVEIS — v14.21'),
      'prompt_revision', 'wesley-sales-v14.21-photos-no-error-2026-10-21')
  where tenant_id = t;
end $$;
commit;
-- Rollback:
-- update public.tenant_settings s set settings = settings
--   || jsonb_build_object('system_prompt', settings#>>'{prompt_snapshot_before_v14_21,system_prompt}',
--                         'prompt_revision', settings#>>'{prompt_snapshot_before_v14_21,revision}')
-- from public.tenants t where t.id = s.tenant_id and t.slug = 'wesley_automoveis';
12:47 PM
As mudanças fazem sentido e o caminho está certo, mas o roteador precisa de um ajuste. Os 3 commits novos são:

Commit	O que faz
bcbabe3 "workflow core topico 1 lista"	Correção A: tira do CORE os 10 nós da Núbia v2
988ba04	Gênesis: foto do veículo certo e nenhuma mensagem de erro ao cliente. Inclui o prompt v14.21 pendente
15f20f9	Migração SQL pendente para os turnos perdidos por TURN_CONTROL_ORIGIN_REQUIRED
O que está certo
O CORE emagreceu: de 5,9 MB para 3,1 MB e de 78 para 68 nós. Nenhum nó está desabilitado, nenhuma conexão ficou quebrada e nenhum PREENCHER_ID sobrou.
A Núbia voltou à rota v1: o roteador liga direto em CORE - É Núbia?, sem o seletor Núbia v2?.
A EXT Núbia v2 continua isolada no próprio JSON. Não importe esse arquivo.
Os testes que rodei passam: EXT Núbia (11/11), recuperação de diálogo da Gênesis (12/12) e CNH/nome/troca (10/10).
O prompt v14.21 está bem feito: guarda um snapshot antes de mudar, falha se o texto atual for diferente do esperado e traz o rollback junto.
Problemas
1. O roteador ficou com a lógica da v2 (o principal). A cadeia saiu, mas o código do nó CORE - Resolver extensão do tenant continua sendo a versão nova, com 6 KB. A versão de 20/10 tinha 1,8 KB e não lia nada no banco. Hoje, para cada mensagem da Núbia, ele:

faz 1 a 3 leituras extras no Supabase (tenant_settings, fila e marcadores), sem nenhum benefício, porque a v2 não existe mais no grafo;
trava a mensagem na fila se a leitura falhar (NORIA_ROTEAMENTO_PIPELINE_INDISPONIVEL). Antes, ela seguia normalmente;
quebra o atendimento se alguém ativar noria_turn_pipeline. A mensagem iria para a EXT v1 marcada como contrato 2.0. Não rode aquele SQL do piloto que te passei antes.
Correção: voltar o roteador para a versão simples até a v2 voltar a fazer parte do CORE.

2. Dois testes ficaram desatualizados. Os testes 9 e 15 de test_noria_services_pipeline.cjs ainda esperam a cadeia da v2 no CORE e falham. Precisam ser atualizados ou removidos junto com a correção 1.

3. A carga continua alta.

O CORE de 3,1 MB ainda é 4× o de 16/10.
O motor de 888 KB segue copiado em 3 nós.
A recuperação da fila continua a cada 10 s (a correção B não foi feita).
O workflow não desliga a gravação de execuções com sucesso.
Com isso, a variável EXECUTIONS_DATA_SAVE_ON_SUCCESS=none no n8n continua indispensável para o servidor aguentar.

4. Decisão de produto no 988ba04. Se a resposta continuar inválida depois da reescrita, o cliente não recebe nada: o turno fica em review e o operador recebe um alerta. Isso é mais seguro do que mandar texto de erro, mas só funciona se alguém olhar esses alertas no painel.

Não consegui rodar: photo_switch_checks.cjs, que precisa de snapshots locais em ~/.noria-homolog, e test_turn_control_fromme.cjs, que precisa do Docker.

Ordem para publicar (quando o servidor estabilizar)
Configurar EXECUTIONS_DATA_SAVE_ON_SUCCESS=none no n8n.
Importar a EXT Gênesis por cima de fXGorIlPbyf9Qtsp e depois o CORE por cima de 3N5oN6sxtir9lFrA. Faça isso de preferência depois da correção 1.
Só depois do CORE publicado, aplicar no Supabase genesis_prompt_v14_21_photos_no_error.sql. Com o CORE antigo, a resposta vazia em turno só de foto vira erro.
turn_control_fromme_manual_reply_v1.sql é independente do n8n e corrige os 39 turnos perdidos em 3 dias. Vale revisar e aplicar logo.
Quer que eu volte o roteador para a versão simples, atualize os 2 testes e já mude a recuperação da fila para 30 s (correção B)? Gero o CORE de novo e te passo para importar.



Como resolver o problema?
1:06 PM
Você pode estar perguntando de duas coisas: o servidor travado ou o roteador do CORE. Vou cuidar das duas. A parte do código eu faço agora, localmente e sem publicar nada. Primeiro vejo como o build monta o roteador e quais testes dependem dele.



Bash Find router generation and test dependencies
IN
cd "/c/Users/wever/OneDrive/Documentos/Shtorache/JIW/NORIA/Mag.IA" && grep -n "noria_router\|routerCode\|Resolver extensão\|secondsInterval\|Recuperar Fila" scripts/build_noria_workflows.cjs | head -30; echo ===; grep -rln "noria_router" scripts n8n/sources docs | head; echo ===; grep -n "noria_router\|router" scripts/test_noria_services_pipeline.cjs | head -30

OUT
17:const routerSourceCode = fs.readFileSync(path.join(root, 'n8n/sources/noria_router.js'), 'utf8');
19:const routerCode = fs.readFileSync(path.join(root, 'n8n/code/command_router.js'), 'utf8').replace(/\r\n/g, '\n');
20:const routerInsertStart = routerCode.indexOf('  async function insertEvent(event) {');
21:const routerInsertEnd = routerCode.indexOf('  async function loadTenantSettings(', routerInsertStart);
23:const routerInsertCode = routerCode.slice(routerInsertStart, routerInsertEnd).trimEnd();
53:new AsyncFunction('$json', '$env', '$vars', routerCode);
208:  const resolver = 'CORE - Resolver extensão do tenant';
===
scripts/build_noria_workflows.cjs
scripts/homolog/services_executor.cjs
scripts/patch_noria_core_dynamic.cjs
scripts/test_noria_dynamic_routing.cjs
scripts/test_noria_services_pipeline.cjs
n8n/sources/noria_router.js
docs/operations/nubia_v2_cutover.md
===
227:  assert.equal(core.nodes.find(n => n.name === 'CORE - Resolver extensão do tenant').parameters.jsCode, read('n8n/sources/noria_router.js'), 'o roteador do workflow é a fonte canônica');
243:  assert.equal(manifest.services_pipeline.router_sha256, sha('n8n/sources/noria_router.js'));
281:const routerCode = read('n8n/sources/noria_router.js');
295:  const out = await new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', routerCode).call({ helpers: { httpRequest } }, input, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'k' }, {}, () => ({}));
313:    assert.equal(r.json.noria_router, 'core_3wf_v1', label);
318:  assert.equal(pilot.json.noria_router, 'services_v2');
337:  assert.equal(inFlightV2.json.noria_router, 'services_v2_pinned');
393:    // verifiable backups of the current CORE, router and live EXTs
Bash Read build script router section and routing test
IN
cd "/c/Users/wever/OneDrive/Documentos/Shtorache/JIW/NORIA/Mag.IA" && grep -n "routerSourceCode" scripts/build_noria_workflows.cjs; sed -n 195,240p scripts/build_noria_workflows.cjs; echo ===; grep -n "Recuperar\|scheduleTrigger\|interval" scripts/build_noria_workflows.cjs | head; echo; sed -n 1,40p scripts/test_noria_dynamic_routing.cjs

OUT
17:const routerSourceCode = fs.readFileSync(path.join(root, 'n8n/sources/noria_router.js'), 'utf8');
51:new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', routerSourceCode);
  'CORE | Serviços | Executar EXT bootstrap',
  'CORE | Serviços | Preparar dispatch',
  'CORE | Serviços | Turno terminal?',
  'CORE | Serviços | Preparar resposta',
  'CORE | Serviços | Turno terminal após prepare?',
  'CORE | Serviços | Executar EXT decisão',
  'CORE | Serviços | Verificar disponibilidade',
  'CORE | Serviços | Executar EXT reavaliação',
  'CORE | Serviços | Finalizar resposta',
  'CORE | Serviços | Núbia v2?',
]);

function removeNubiaV2CoreNodes(workflow) {
  const resolver = 'CORE - Resolver extensão do tenant';
  const legacyNext = 'CORE - É Núbia?';
  const resolverNode = workflow.nodes.find(node => node.name === resolver);
  if (!resolverNode) throw new Error('MISSING_ROUTER_NODE');

  workflow.nodes = workflow.nodes.filter(node => !nubiaV2NodeNames.has(node.name));
  for (const nodeName of nubiaV2NodeNames) delete workflow.connections[nodeName];
  for (const entry of Object.values(workflow.connections)) {
    for (const branch of entry?.main || []) {
      for (let index = branch.length - 1; index >= 0; index -= 1) {
        if (nubiaV2NodeNames.has(branch[index].node)) branch.splice(index, 1);
      }
    }
  }
  // Restore the original Núbia v1 route; no tenant can reach v2 from the shared CORE.
  workflow.connections[resolver] = { main: [[{ node: legacyNext, type: 'main', index: 0 }]] };
  if (!workflow.nodes.some(node => node.name === legacyNext)) throw new Error('MISSING_LEGACY_NUBIA_ROUTE');
  if (workflow.nodes.some(node => nubiaV2NodeNames.has(node.name))) throw new Error('NUBIA_V2_CORE_NODES_REMAIN');
}

function deterministicNubiaExtId(name) {
  const h = crypto.createHash('sha1').update('noria-services-pipeline:' + name).digest('hex');
  return [h.slice(0, 8), h.slice(8, 12), '4' + h.slice(13, 16), '8' + h.slice(17, 20), h.slice(20, 32)].join('-');
}

function writeNubiaV2ExtWorkflow() {
  const target = path.join(root, 'n8n/workflows', NUBIA_EXT_WORKFLOW_FILE);
  const trigger = 'Entrada do NORIA CORE | Núbia serviços v2';
  const policy = 'EXT | Serviços Núbia v2';
  const previous = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : null;
  const workflow = {
    name: 'NORIA EXT | NB Bronze | Serviços v2', pinData: {}, active: false,
    nodes: [
===

const test = require('node:test');
const assert = require('node:assert/strict');

function routeTenant(input, mockDbSettings) {
  const v = { ...input };
  function required(x, label) {
    if (typeof x !== 'string' || !x.trim()) throw new Error('NORIA_ROTEAMENTO: ' + label + ' ausente');
    return x.trim();
  }
  const tenant_slug = required(v.tenant_slug, 'tenant_slug');
  const tenant_id = required(v.tenant_id, 'tenant_id');
  required(v.instance, 'instance');
  required(v.remoteJid, 'remoteJid');

  const byTenant = { clinica_nubia_oficial: 'nubia', wesley_automoveis: 'genesis' };
  const legacyExtension = byTenant[tenant_slug];
  if (legacyExtension) {
    return { ...v, noria_extension: legacyExtension, noria_contract_version: '1.0', noria_router: 'core_3wf_v1' };
  }

  const s = mockDbSettings[tenant_id] || {};
  if (!s.noria_client_policy) {
    throw new Error('NORIA_SEM_EXTENSAO_CONFIGURADA: ' + tenant_slug);
  }

  return {
    ...v,
    noria_extension: 'saas_dynamic',
    noria_client_policy: s.noria_client_policy,
    noria_contract_version: '1.0',
    noria_router: 'saas_dynamic_v1',
  };
}

function evaluateBranches(routed) {
  if (routed.noria_extension === 'nubia') {
    return { branch: 'subworkflow_nubia', policy: 'from_subworkflow' };
  }
  if (routed.noria_extension === 'genesis') {
    return { branch: 'subworkflow_genesis', policy: 'from_subworkflow' };
Bash Show previous simple router code
IN
cd "/c/Users/wever/OneDrive/Documentos/Shtorache/JIW/NORIA/Mag.IA" && F="n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json"; git show "2c30cba:$F" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const w=JSON.parse(s);console.log(w.nodes.find(n=>n.name==='CORE - Resolver extensão do tenant').parameters.jsCode)})"; echo ====; git show bc0c8d9 -- scripts/build_noria_workflows.cjs | grep -n "routerSourceCode\|Resolver extensão" 

OUT
// Resolucao de extensao hibrida: Tenants legados usam subworkflows isolados; novos tenants SaaS usam policy dinamica de tenant_settings.
const v = $json || {};
function required(x, label) { if (typeof x !== 'string' || !x.trim()) throw new Error('NORIA_ROTEAMENTO: '+label+' ausente'); return x.trim(); }
const tenant_slug = required(v.tenant_slug, 'tenant_slug');
const tenant_id = required(v.tenant_id, 'tenant_id');
required(v.instance, 'instance');
required(v.remoteJid, 'remoteJid');

const byTenant = { clinica_nubia_oficial: 'nubia', wesley_automoveis: 'genesis' };
const contractVersionByTenant = { wesley_automoveis: '2.0' };
const legacyExtension = byTenant[tenant_slug];
if (legacyExtension) {
  return { json: { ...v, noria_extension: legacyExtension, noria_contract_version: contractVersionByTenant[tenant_slug] || '1.0', noria_router: 'core_3wf_v1', noria_dispatch_phase: 'bootstrap' } };
}

// Para novos tenants SaaS autônomos, busca noria_client_policy diretamente em tenant_settings
const base = String($env.SUPABASE_URL || '').replace(new RegExp('/$'), '');
const key = String($env.SUPABASE_SERVICE_ROLE_KEY || '');
if (!base || !key) throw new Error('NORIA_ROTEAMENTO_SEM_CREDENCIAIS_DB');

const rows = await this.helpers.httpRequest({
  method: 'GET',
  url: base + '/rest/v1/tenant_settings?select=settings&tenant_id=eq.' + encodeURIComponent(tenant_id) + '&limit=1',
  headers: { apikey: key, Authorization: 'Bearer ' + key },
  json: true,
  timeout: 7000,
});

const s = rows?.[0]?.settings || {};
if (!s.noria_client_policy) {
  throw new Error('NORIA_SEM_EXTENSAO_CONFIGURADA: ' + tenant_slug);
}

return {
  json: {
    ...v,
    noria_extension: 'saas_dynamic',
    noria_client_policy: s.noria_client_policy,
    noria_contract_version: '1.0',
    noria_router: 'saas_dynamic_v1',
  },
};

====
18:+const routerSourceCode = fs.readFileSync(path.join(root, 'n8n/sources/noria_router.js'), 'utf8');
28:+new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', routerSourceCode);
53:+  const RESOLVER = 'CORE - Resolver extensão do tenant', LEGACY_NEXT = 'CORE - É Núbia?';
95:+  resolverNode.parameters.jsCode = routerSourceCode;
157:+    router_sha256: crypto.createHash('sha256').update(routerSourceCode).digest('hex'),
Vou restaurar o roteador simples de 20/10 como fonte própria para injeção no build, mantendo o noria_router.js reservado para a v2. Primeiro, vou checar os testes afetados.
Bash Read failing tests in services pipeline suite
IN
cd "/c/Users/wever/OneDrive/Documentos/Shtorache/JIW/NORIA/Mag.IA" && sed -n 205,250p scripts/test_noria_services_pipeline.cjs; echo .....; sed -n 375,420p scripts/test_noria_services_pipeline.cjs; grep -n "^test(" scripts/test_noria_services_pipeline.cjs

OUT
  assert.ok(finalize.indexOf('await commit()') < finalize.indexOf('schedulingReserve('), 'a reserva só ocorre depois do fencing da fila');
  assert.ok(finalize.indexOf('servicesVerifiedDecision(') < finalize.indexOf('await commit()'), 'a decisão é verificada antes de qualquer efeito');
  assert.equal((coreCode.match(/queueRpc\('claim'\)/g) || []).length, 1, 'o CORE mantém um único ponto de claim');
});

test('build: nós de serviços desabilitados e sem conexão com o grafo ao vivo; EXTs publicadas intactas', () => {
  const core = JSON.parse(read('n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json'));
  const services = core.nodes.filter(n => n.name.startsWith('CORE | Serviços | '));
  const gate = services.find(n => n.name === 'CORE | Serviços | Núbia v2?');
  const chain = services.filter(n => n !== gate);
  assert.equal(chain.length, 9);
  assert.ok(chain.every(n => n.disabled === true));
  assert.ok(gate && gate.disabled !== true, 'o seletor de versão precisa estar habilitado (um If desabilitado encaminharia tudo ao ramo verdadeiro)');
  const names = new Set(services.map(n => n.name));
  for (const [from, entry] of Object.entries(core.connections)) {
    if (names.has(from)) continue;
    const into = (entry.main || []).flat().filter(c => names.has(c.node));
    assert.ok(from === 'CORE - Resolver extensão do tenant' ? into.length === 1 && into[0].node === gate.name : !into.length, from + ' só o roteador entra, e apenas pelo seletor');
  }
  const branches = name => core.connections[name].main.map(b => b.map(c => c.node));
  assert.deepEqual(branches('CORE | Serviços | Núbia v2?'), [['CORE | Serviços | Executar EXT bootstrap'], ['CORE - É Núbia?']], 'ramo falso = fluxo atual');
  assert.deepEqual(branches('CORE - Resolver extensão do tenant'), [['CORE | Serviços | Núbia v2?']]);
  assert.equal(core.nodes.find(n => n.name === 'CORE - Resolver extensão do tenant').parameters.jsCode, read('n8n/sources/noria_router.js'), 'o roteador do workflow é a fonte canônica');
  assert.ok(chain.filter(n => n.type.endsWith('executeWorkflow')).every(n => n.parameters.workflowId.value === 'PREENCHER_ID_EXT_NUBIA_V2'), 'o ID real só é resolvido na publicação');
  const has = (from, to, branch) => (core.connections[from]?.main?.[branch] || []).some(c => c.node === to);
  assert.ok(has('CORE | Preparar dispatch Genesis', 'CORE | Turno terminal Genesis?', 0));
  assert.ok(has('CORE | Turno terminal Genesis?', 'CORE | Executar EXT Genesis por turno', 1));
  assert.ok(has('CORE | Executar EXT Genesis por turno', 'CORE | Preparar resposta', 0));
  assert.ok(has('CORE | Executar EXT Genesis comercial', 'CORE | Finalizar resposta', 0));
  assert.ok(has('CORE - É Núbia?', 'Executar EXT Nubia (PREENCHER ID)', 0));
  assert.ok(has('Executar EXT Nubia (PREENCHER ID)', 'CORE | Motor conversacional único', 0));
  assert.ok(has('Recuperar Fila WhatsApp', 'Ler Fila WhatsApp', 0));
  const diff = execFileSync('git', ['diff', '--stat', '--', 'n8n/workflows/NORIA EXT _ NB Bronze _ Política de negócio v2.json', 'n8n/sources/genesis_tenant_identity.js'], { cwd: root }).toString().trim();
  assert.equal(diff, '', 'EXT Núbia v1 e a identidade do tenant Gênesis não foram alteradas');
  const manifest = JSON.parse(read('n8n/build_manifest.json'));
  const sha = file => require('node:crypto').createHash('sha256').update(read(file)).digest('hex');
  assert.equal(manifest.services_pipeline.nubia_ext_sha256, sha('n8n/sources/nubia_extension.js'));
  assert.equal(manifest.services_pipeline.turn_dispatch_sha256, sha('n8n/sources/noria_turn_dispatch.js'));
  assert.equal(manifest.services_pipeline.router_sha256, sha('n8n/sources/noria_router.js'));
  assert.equal(manifest.services_pipeline.status, 'wired_default_v1_chain_disabled_until_publication');
  const ext = JSON.parse(read('n8n/workflows/NORIA EXT _ NB Bronze _ Serviços v2.json'));
  assert.equal(ext.active, false);
  assert.equal(ext.nodes.find(n => n.name === 'EXT | Serviços Núbia v2').parameters.jsCode, read('n8n/sources/nubia_extension.js'));
});

test('auditoria semântica: cada afirmação precisa de uma autoridade existente e do tipo permitido; sem cobertura ou sem fonte, rejeita', () => {
.....
  });
  await new Promise(resolve => server.listen(0, resolve));
  const env = { ...process.env, N8N_API_URL: 'http://127.0.0.1:' + server.address().port + '/api/v1', N8N_API_KEY: 'test' };
  // async on purpose: the mock n8n lives in this process, a blocking spawn would deadlock it
  const run = (extra = [], over = {}) => new Promise(resolve => execFile(process.execPath, [path.join(root, 'scripts/publish_nubia_v2.cjs'), ...extra], { env: { ...env, ...over }, encoding: 'utf8' }, (error, stdout, stderr) => resolve({ status: error ? (error.code ?? 1) : 0, stdout, stderr })));
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nubia-v2-'));
  try {
    const out = tmp();
    const ok = await run(['--out=' + out]);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    const artifact = JSON.parse(fs.readFileSync(path.join(out, 'NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json'), 'utf8'));
    const extNodes = artifact.nodes.filter(n => /Executar EXT (bootstrap|decisão|reavaliação)/.test(n.name) && n.name.startsWith('CORE | Serviços'));
    assert.equal(extNodes.length, 3);
    assert.ok(extNodes.every(n => n.parameters.workflowId.value === 'EXT-V2-REAL-ID' && !n.disabled));
    assert.ok(artifact.nodes.filter(n => n.name.startsWith('CORE | Serviços | ')).every(n => !n.disabled), 'a cadeia sai habilitada só no artefato');
    assert.ok(!JSON.stringify(artifact).includes('PREENCHER_ID_EXT_NUBIA_V2'));
    assert.deepEqual(state.writes, [], 'a simulação não escreve no n8n');
    assert.ok(!read('n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json').includes('EXT-V2-REAL-ID'), 'o repositório nunca guarda o ID real');
    // verifiable backups of the current CORE, router and live EXTs
    const manifest = JSON.parse(fs.readFileSync(path.join(out, 'backups/MANIFEST.json'), 'utf8'));
    assert.deepEqual(Object.keys(manifest).sort(), ['CORE_CORE-LIVE-ID.json', 'EXT_GEN-LIVE-ID.json', 'EXT_NB-LIVE-ID.json', 'ROUTER_NODE.json']);
    for (const [name, entry] of Object.entries(manifest)) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(out, 'backups', name))).digest('hex'), entry.sha256, name);
    assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'backups/CORE_CORE-LIVE-ID.json'), 'utf8')).nodes.length, liveCore.nodes.length);
    // the Gênesis, Núbia v1 and recovery routes are unchanged in the artifact
    const live = name => JSON.stringify(artifact.connections[name]) === JSON.stringify(liveCore.connections[name]);
    assert.ok(['CORE - É Núbia?', 'Executar EXT Nubia (PREENCHER ID)', 'CORE | Preparar dispatch Genesis', 'CORE | Executar EXT Genesis comercial', 'Recuperar Fila WhatsApp'].every(live));
    // drift: an instance node the repository does not know would be overwritten, so the run stops (exit 3)
    state.workflows[0] = { ...liveCore, nodes: [...liveCore.nodes, { name: 'Nó criado à mão na instância', type: 'n8n-nodes-base.code', parameters: {}, position: [0, 0], id: 'x' }] };
    const drift = await run(['--out=' + tmp()]);
    assert.equal(drift.status, 3);
    assert.match(drift.stdout, /node_only_in_instance:Nó criado à mão/);
    assert.equal((await run(['--apply', '--out=' + tmp()], { NORIA_PUBLISH_AUTHORIZED: '1' })).status, 3, '--apply recusado com divergência');
    state.workflows[0] = liveCore;
    // missing EXT: no artifact, no write, non-zero exit; --apply without authorisation is refused; ambiguous name refused
    state.workflows = state.workflows.filter(w => w.id !== 'EXT-V2-REAL-ID');
    const empty = tmp();
    assert.equal((await run(['--out=' + empty])).status, 2);
    assert.ok(!fs.existsSync(path.join(empty, 'NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json')));
    assert.notEqual((await run(['--apply', '--out=' + empty], { NORIA_PUBLISH_AUTHORIZED: '' })).status, 0);
    assert.deepEqual(state.writes, []);
    state.workflows.push({ ...ext, id: 'A' }, { ...ext, id: 'B' });
    assert.notEqual((await run(['--out=' + tmp()])).status, 0, 'nome ambíguo recusado');
  } finally { server.close(); }
});

test('piloto: só um JID de telefone do ingresso autenticado casa; LID, grupo e configuração com número inválido não', async () => {
34:test('Gênesis, Núbia v1 e tenant legado não selecionam o pipeline de serviços', () => {
43:test('Declaração ausente ou desabilitada preserva o legado; habilitada e inconsistente falha sem fallback', () => {
57:test('decisão com identidade, versão ou proveniência incorretas é recusada; recusada/malformada não autoriza nada', () => {
78:test('auditor: cada afirmação é checada na sua autoridade; horários, datas e valores da prosa precisam ser autorizados', () => {
131:test('despachante: um único claim, request_id = <último event_id>:<token>, sem envio nem reserva', async () => {
148:test('despachante: turno já reivindicado, política inválida, claim de outro escopo e fila vazia', async () => {
164:test('o request_id emitido pelo despachante é aceito pela identidade da EXT Núbia v2', async () => {
192:test('preparação não reserva nem altera pagamento; só responde (após commit) em ramos terminais', () => {
210:test('build: nós de serviços desabilitados e sem conexão com o grafo ao vivo; EXTs publicadas intactas', () => {
250:test('auditoria semântica: cada afirmação precisa de uma autoridade existente e do tipo permitido; sem cobertura ou sem fonte, rejeita', () => {
300:test('roteador: Gênesis e demais caminhos legados idênticos; Núbia só vai ao 2.0 por declaração válida, habilitada e no escopo', async () => {
325:test('roteador: declaração habilitada e inválida ou configuração indisponível falham fechado, sem fallback entre versões', async () => {
333:test('roteador: um lote em andamento fica na versão que o reivindicou (reversão de configuração não o muda)', async () => {
344:test('guardas do CORE: o legado recusa lote fixado no pipeline; turno despachado nunca cai no legado', async () => {
354:test('publicação: preflight contra a estrutura do n8n (simulado), ID da EXT v2 por nome, backups verificáveis, divergência recusada', async () => {
420:test('piloto: só um JID de telefone do ingresso autenticado casa; LID, grupo e configuração com número inválido não', async () => {
430:test('lote fixado: desligar a declaração não tira o turno em andamento do pipeline; só novos lotes mudam', () => {
Bash Read build script header and manifest section
IN
cd "/c/Users/wever/OneDrive/Documentos/Shtorache/JIW/NORIA/Mag.IA" && sed -n 1,60p scripts/build_noria_workflows.cjs; echo ....; grep -n "removeNubiaV2CoreNodes\|ensureGenesisTerminalBypass\|manifest\b\|artifacts:" scripts/build_noria_workflows.cjs | head -20

OUT
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// 1. Read sources
const coreSourcePath = path.join(root, 'n8n/sources/noria_core.js');
const extSourcePath = path.join(root, 'n8n/sources/genesis_extension.js');
const genesisIdentitySourcePath = path.join(root, 'n8n/sources/genesis_tenant_identity.js');
let coreCode = fs.readFileSync(coreSourcePath, 'utf8');
const extCode = fs.readFileSync(extSourcePath, 'utf8');
const genesisIdentityCode = fs.readFileSync(genesisIdentitySourcePath, 'utf8');
// The Núbia v2 EXT remains an isolated, inactive workflow for future work; it is no longer embedded in the CORE.
const nubiaExtCode = fs.readFileSync(path.join(root, 'n8n/sources/nubia_extension.js'), 'utf8');
const routerSourceCode = fs.readFileSync(path.join(root, 'n8n/sources/noria_router.js'), 'utf8');
const recoveryCode = fs.readFileSync(path.join(root, 'n8n/code/whatsapp_recover_core.js'), 'utf8');
const routerCode = fs.readFileSync(path.join(root, 'n8n/code/command_router.js'), 'utf8').replace(/\r\n/g, '\n');
const routerInsertStart = routerCode.indexOf('  async function insertEvent(event) {');
const routerInsertEnd = routerCode.indexOf('  async function loadTenantSettings(', routerInsertStart);
if (routerInsertStart < 0 || routerInsertEnd < 0) throw new Error('CONTROL_ORIGIN_SOURCE_MISSING');
const routerInsertCode = routerCode.slice(routerInsertStart, routerInsertEnd).trimEnd();

// 2. Compute SHA-256 hashes and build metadata
const extSha256 = crypto.createHash('sha256').update(extCode).digest('hex');
const now = new Date();
const todayStr = now.toISOString().slice(0, 10).replace(/-/g, '_');
const coreRevision = `conversation_core_v2_1_34_core_ext_decision_identity_${todayStr}`;
const builtAt = now.toISOString();

// To avoid circular hash dependency, compute coreSha256 over canonical code with fixed placeholder
const normalizedForHash = coreCode.replace(/const coreBuildMetadata = \{[\s\S]*?\};/, 'const coreBuildMetadata = { revision: "", built_at: "", core_sha256: "", ext_sha256: "" };');
const coreSha256 = crypto.createHash('sha256').update(normalizedForHash).digest('hex');

const updatedMetadataBlock = `const coreBuildMetadata = {
  revision: '${coreRevision}',
  built_at: '${builtAt}',
  core_sha256: '${coreSha256}',
  ext_sha256: '${extSha256}',
};`;

coreCode = coreCode.replace(/const coreBuildMetadata = \{[\s\S]*?\};/, updatedMetadataBlock);
fs.writeFileSync(coreSourcePath, coreCode);

// 3. Validate syntax of both sources
new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', coreCode);
new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', extCode);
new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', genesisIdentityCode);
new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', nubiaExtCode);
new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', routerSourceCode);
new AsyncFunction('$env', recoveryCode);
new AsyncFunction('$json', '$env', '$vars', routerCode);

// 4. Update workflow JSON files
const targets = [
  ['noria_core.js', 'NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json', 'CORE | Motor conversacional único', "const NORIA_NODE_PHASE = 'single';\n" + coreCode],
  ['noria_core.js', 'NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json', 'CORE | Preparar resposta', "const NORIA_NODE_PHASE = 'prepare';\n" + coreCode],
  ['noria_core.js', 'NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json', 'CORE | Finalizar resposta', "const NORIA_NODE_PHASE = 'finalize';\n" + coreCode],
  ['genesis_extension.js', 'NORIA EXT _ Gênesis _ Política comercial v2 (1).json', 'EXT | Política Gênesis', extCode],
....
63:function ensureGenesisTerminalBypass(workflow) {
207:function removeNubiaV2CoreNodes(workflow) {
285:      ensureGenesisTerminalBypass(workflow);
286:      removeNubiaV2CoreNodes(workflow);
309:const manifest = {
332:  artifacts: [
347:fs.writeFileSync(path.join(root, 'n8n/build_manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
350:console.log('Build manifest:', JSON.stringify(manifest, null, 2));
Bash Read publisher test mock setup and router tests
IN
cd "/c/Users/wever/OneDrive/Documentos/Shtorache/JIW/NORIA/Mag.IA" && sed -n 354,377p scripts/test_noria_services_pipeline.cjs; sed -n 300,345p scripts/test_noria_services_pipeline.cjs | head -20; grep -n "noria_router\|Resolver extensão" scripts/homolog/services_executor.cjs | head

OUT
test('publicação: preflight contra a estrutura do n8n (simulado), ID da EXT v2 por nome, backups verificáveis, divergência recusada', async () => {
  const http = require('node:http');
  const { execFile, execFileSync } = require('node:child_process');
  const os = require('node:os');
  const crypto = require('node:crypto');
  const wf = file => JSON.parse(read('n8n/workflows/' + file));
  const ext = wf('NORIA EXT _ NB Bronze _ Serviços v2.json');
  const repoCore = wf('NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json');
  // "live" = the published CORE before this work (git HEAD), the EXTs as exported
  const liveCore = { ...JSON.parse(execFileSync('git', ['show', 'HEAD:n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json'], { cwd: root, maxBuffer: 1 << 28 }).toString()), id: 'CORE-LIVE-ID' };
  const liveGenesis = { ...wf('NORIA EXT _ Gênesis _ Política comercial v2 (1).json'), id: 'GEN-LIVE-ID' };
  const liveNubia = { ...wf('NORIA EXT _ NB Bronze _ Política de negócio v2.json'), id: 'NB-LIVE-ID' };
  const state = { workflows: [liveCore, liveGenesis, liveNubia, { ...ext, id: 'EXT-V2-REAL-ID' }], writes: [] };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method !== 'GET') state.writes.push(req.method + ' ' + url.pathname);
    res.setHeader('Content-Type', 'application/json');
    const single = /\/workflows\/([^/]+)$/.exec(url.pathname);
    if (single) return res.end(JSON.stringify(state.workflows.find(w => w.id === single[1]) || {}));
    const name = url.searchParams.get('name');
    res.end(JSON.stringify({ data: state.workflows.filter(w => w.name === name).map(w => ({ id: w.id, name: w.name })) }));
  });
  await new Promise(resolve => server.listen(0, resolve));
  const env = { ...process.env, N8N_API_URL: 'http://127.0.0.1:' + server.address().port + '/api/v1', N8N_API_KEY: 'test' };
test('roteador: Gênesis e demais caminhos legados idênticos; Núbia só vai ao 2.0 por declaração válida, habilitada e no escopo', async () => {
  const genesis = await route({ input: { ...NUBIA, tenant_slug: 'wesley_automoveis' }, declared: validDeclaration });
  assert.equal(genesis.json.noria_contract_version, '2.0');
  assert.equal(genesis.json.noria_extension, 'genesis');
  assert.equal(genesis.json.noria_pipeline, undefined);
  assert.deepEqual(genesis.calls, [], 'a Gênesis não lê configuração do pipeline');
  const dynamic = await route({ input: { ...NUBIA, tenant_slug: 'novo_tenant' }, settingsExtra: { noria_client_policy: { profile: 'p' } }, declared: validDeclaration });
  assert.equal(dynamic.json.noria_extension, 'saas_dynamic');
  assert.equal(dynamic.json.noria_pipeline, undefined, 'tenant SaaS dinâmico não participa do pipeline de serviços');
  for (const [label, declared] of [['sem declaração', undefined], ['desabilitada', { ...validDeclaration, enabled: false }]]) {
    const r = await route({ declared });
    assert.equal(version(r), '1.0', label);
    assert.equal(r.json.noria_extension, 'nubia', label);
    assert.equal(r.json.noria_router, 'core_3wf_v1', label);
    assert.equal(r.json.noria_dispatch_phase, 'bootstrap', label);
  }
  const pilot = await route({ declared: validDeclaration });
  assert.equal(version(pilot), '2.0');
  assert.equal(pilot.json.noria_router, 'services_v2');
  assert.equal(pilot.json.noria_dispatch_phase, 'bootstrap');
613:    const ROUTER = 'n8n/sources/noria_router.js';
621:    check('o roteador (nó real) lê o marcador da base e mantém o lote na v2', pinned.noria_pipeline === 'services_v1' && pinned.noria_router === 'services_v2_pinned', pinned.noria_router);
624:    check('declaração desligada: o lote em andamento continua na v2', afterRollback.noria_pipeline === 'services_v1' && afterRollback.noria_router === 'services_v2_pinned', afterRollback.noria_router);
1:07 PM
Agora aplico as mudanças: o roteador simples como fonte própria, o build injetando esse roteador, o intervalo de 30 s e os testes atualizados.



Bash Create simple router source from 20/10 version
IN
cd "/c/Users/wever/OneDrive/Documentos/Shtorache/JIW/NORIA/Mag.IA" && F="n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json"; git show "2c30cba:$F" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const w=JSON.parse(s);let c=w.nodes.find(n=>n.name==='CORE - Resolver extensão do tenant').parameters.jsCode;c=c.replace(/^\/\/ Resolucao de extensao hibrida[^\n]*\n/, '// NORIA CORE — resolução de extensão do tenant (fonte canônica do nó \"CORE - Resolver extensão do tenant\").\n// Tenants legados usam subworkflows isolados, sem leitura de banco; novos tenants SaaS usam a policy dinâmica de tenant_settings.\n// O roteador com seleção de pipeline da Núbia v2 fica em noria_router.js e só volta ao CORE junto com a cadeia de serviços.\n');require('fs').writeFileSync('n8n/sources/noria_router_core.js',c)})"; head -5 n8n/sources/noria_router_core.js; wc -c n8n/sources/noria_router_core.js

OUT
// NORIA CORE — resolução de extensão do tenant (fonte canônica do nó "CORE - Resolver extensão do tenant").
// Tenants legados usam subworkflows isolados, sem leitura de banco; novos tenants SaaS usam a policy dinâmica de tenant_settings.
// O roteador com seleção de pipeline da Núbia v2 fica em noria_router.js e só volta ao CORE junto com a cadeia de serviços.
const v = $json || {};
function required(x, label) { if (typeof x !== 'string' || !x.trim()) throw new Error('NORIA_ROTEAMENTO: '+label+' ausente'); return x.trim(); }
2063 n8n/sources/noria_router_core.js
Read C:\Users\wever\OneDrive\Documentos\Shtorache\JIW\NORIA\Mag.IA\scripts\build_noria_workflows.cjs (lines 206-345)
Edit C:\Users\wever\OneDrive\Documentos\Shtorache\JIW\NORIA\Mag.IA\scripts\build_noria_workflows.cjs
Added 6 lines
Edit C:\Users\wever\OneDrive\Documentos\Shtorache\JIW\NORIA\Mag.IA\scripts\build_noria_workflows.cjs
Added 1 line
Edit C:\Users\wever\OneDrive\Documentos\Shtorache\JIW\NORIA\Mag.IA\scripts\build_noria_workflows.cjs
Added 3 lines
Edit C:\Users\wever\OneDrive\Documentos\Shtorache\JIW\NORIA\Mag.IA\scripts\build_noria_workflows.cjs
Added 2 lines
Edit C:\Users\wever\OneDrive\Documentos\Shtorache\JIW\NORIA\Mag.IA\scripts\build_noria_workflows.cjs
Added 1 line
1:07 PM
Agora os dois testes desatualizados.



Edit C:\Users\wever\OneDrive\Documentos\Shtorache\JIW\NORIA\Mag.IA\scripts\test_noria_services_pipeline.cjs
Removed 3 lines
Edit C:\Users\wever\OneDrive\Documentos\Shtorache\JIW\NORIA\Mag.IA\scripts\test_noria_services_pipeline.cjs
Removed 2 lines
1:08 PM
Agora o teste do publicador: troco a simulação completa por uma verificação de que ele se recusa a publicar a v2 a partir deste CORE.



Bash Replace obsolete publisher simulation test
IN
cd "/c/Users/wever/OneDrive/Documentos/Shtorache/JIW/NORIA/Mag.IA" && s=$(grep -n "^test('publicação: preflight" scripts/test_noria_services_pipeline.cjs | cut -d: -f1); e=$(grep -n "^test('piloto: só um JID" scripts/test_noria_services_pipeline.cjs | cut -d: -f1); echo $s $e; node -e "
const fs=require('fs');const f='scripts/test_noria_services_pipeline.cjs';const L=fs.readFileSync(f,'utf8').split('\n');
const s=$s-1,e=$e-1;
const repl=[
\"test('publicação: o CORE atual não carrega a cadeia da Núbia v2, então o publicador recusa gerar o artefato', () => {\",
\"  // A cadeia saiu do CORE (bcbabe3). Publicar a v2 exige reconstruir a cadeia no build; até lá o publicador falha fechado.\",
\"  const { buildArtifact } = require(path.join(root, 'scripts/publish_nubia_v2.cjs'));\",
\"  const core = JSON.parse(read('n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json'));\",
\"  assert.throws(() => buildArtifact(core, 'EXT-V2-REAL-ID'), /CHAIN_INCOMPLETE: 0/);\",
\"});\",
''];
L.splice(s,e-s,...repl);fs.writeFileSync(f,L.join('\n'));
"; grep -n "^const path\|require('node:path')\|^const root" scripts/test_noria_services_pipeline.cjs | head

OUT
349 415
6:const path = require('node:path');
10:const root = path.join(__dirname, '..');
1:08 PM
Agora o build e os testes.



Bash Rebuild workflows and run test suites
IN
cd "/c/Users/wever/OneDrive/Documentos/Shtorache/JIW/NORIA/Mag.IA" && node scripts/build_noria_workflows.cjs > /tmp/build.log 2>&1; echo "build exit $?"; tail -3 /tmp/build.log; for t in scripts/test_noria_services_pipeline.cjs scripts/test_nubia_extension_v2.cjs scripts/test_genesis_dialogue_recovery.cjs scripts/test_genesis_cnh_name_trade.cjs scripts/test_genesis_declared_deposit.cjs scripts/test_genesis_deposit_ext_core.cjs scripts/test_genesis_name_audit_flow.cjs scripts/test_noria_dynamic_routing.cjs; do printf "%s: " $t; node --test $t 2>&1 | grep -E "^# (pass|fail)" | tr '\n' ' '; echo; done

OUT
build exit 0
    "scripts/turn_queue_operational_bridge.cjs"
  ]
}
scripts/test_noria_services_pipeline.cjs: # pass 17 # fail 0 
scripts/test_nubia_extension_v2.cjs: # pass 11 # fail 0 
scripts/test_genesis_dialogue_recovery.cjs: # pass 12 # fail 0 
scripts/test_genesis_cnh_name_trade.cjs: # pass 10 # fail 0 
scripts/test_genesis_declared_deposit.cjs: # pass 4 # fail 0 
scripts/test_genesis_deposit_ext_core.cjs: # pass 3 # fail 0 
scripts/test_genesis_name_audit_flow.cjs: # pass 4 # fail 0 
scripts/test_noria_dynamic_routing.cjs: # pass 4 # fail 0
1:08 PM
Tudo verde. Confiro o que o build alterou, para não ter mudança inesperada no diff.



Bash Review diff produced by the rebuild
IN
cd "/c/Users/wever/OneDrive/Documentos/Shtorache/JIW/NORIA/Mag.IA" && git status --short; git diff --stat | tail -12; cd n8n/workflows && ls -la "NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json" | awk '{print $5}'; git diff -- "NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json" | grep -E '^[-+]' | grep -v '^[-+]{3}' | grep -vE 'jsCode' | head -20; git diff "NORIA EXT _ Gênesis _ Política comercial v2 (1).json" "NORIA EXT _ NB Bronze _ Serviços v2.json" | head -5

OUT
 M n8n/build_manifest.json
 M n8n/code/whatsapp_conversation_core.generated.js
 M n8n/code/whatsapp_sales.js
 M n8n/sources/noria_core.js
 M "n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json"
 M "n8n/workflows/NORIA EXT _ G\303\252nesis _ Pol\303\255tica comercial v2 (1).json"
 M "n8n/workflows/NORIA EXT _ NB Bronze _ Servi\303\247os v2.json"
 M scripts/build_noria_workflows.cjs
 M scripts/test_noria_services_pipeline.cjs
?? n8n/sources/noria_router_core.js
warning: in the working copy of 'n8n/build_manifest.json', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'n8n/code/whatsapp_conversation_core.generated.js', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'n8n/code/whatsapp_sales.js', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'n8n/sources/noria_core.js', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'n8n/workflows/NORIA EXT _ Gênesis _ Política comercial v2 (1).json', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'n8n/workflows/NORIA EXT _ NB Bronze _ Serviços v2.json', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'scripts/test_noria_services_pipeline.cjs', LF will be replaced by CRLF the next time Git touches it
 n8n/build_manifest.json                            |   9 +-
 n8n/code/whatsapp_conversation_core.generated.js   |   2 +-
 n8n/sources/noria_core.js                          |   2 +-
 ...ndos + Follow-ups _ Motor compartilhado v2.json |  12 +--
 ...ORIA EXT _ NB Bronze _ Servi\303\247os v2.json" |   2 +-
 scripts/build_noria_workflows.cjs                  |  17 +++-
 scripts/test_noria_services_pipeline.cjs           | 104 ++++-----------------
 7 files changed, 50 insertions(+), 98 deletions(-)
3054881
warning: in the working copy of 'n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json', LF will be replaced by CRLF the next time Git touches it
--- a/n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json	
+++ b/n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json	
-              "secondsInterval": 10
+              "secondsInterval": 30
warning: in the working copy of 'n8n/workflows/NORIA EXT _ Gênesis _ Política comercial v2 (1).json', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'n8n/workflows/NORIA EXT _ NB Bronze _ Serviços v2.json', LF will be replaced by CRLF the next time Git touches it
diff --git "a/n8n/workflows/NORIA EXT _ NB Bronze _ Servi\303\247os v2.json" "b/n8n/workflows/NORIA EXT _ NB Bronze _ Servi\303\247os v2.json"
index cb8e119..f5f9586 100644
--- "a/n8n/workflows/NORIA EXT _ NB Bronze _ Servi\303\247os v2.json"	
+++ "b/n8n/workflows/NORIA EXT _ NB Bronze _ Servi\303\247os v2.json"	
@@ -18,7 +18,7 @@
1:08 PM
Fiz as correções no código, só localmente: nada foi commitado nem publicado. Para o servidor, o que resolve de fato é parar de gravar as execuções com sucesso, e isso é uma configuração do n8n que você precisa aplicar.

O que mudei no código
Voltei o roteador do CORE para a versão simples de 20/10, agora com fonte própria em noria_router_core.js, que o build injeta no nó.
Gênesis e Núbia não fazem mais nenhuma leitura no banco nesse nó.
Ativar noria_turn_pipeline sem querer já não quebra a Núbia.
O roteador da v2 continua guardado em noria_router.js para quando ela voltar.
A recuperação da fila passou de 10 s para 30 s. Fica definido em build_noria_workflows.cjs, então o próximo build não desfaz. São 5.760 execuções a menos por dia.
Atualizei os 2 testes desatualizados. O teste do build agora confere que a cadeia v2 saiu do CORE, que não há conexão quebrada, que o roteador é o simples e que a recuperação roda a cada 30 s. O teste do publicador agora confere que ele se recusa a gerar o artefato da v2 a partir deste CORE.
Gerei os workflows de novo. No JSON do CORE só mudaram o roteador, o intervalo e a data do build. O arquivo tem 3,05 MB.
Todos os testes da Núbia, da Gênesis e do roteamento passaram.

O que resolve o servidor (ordem)
Desligue o n8n pelo SSH: docker service scale projeto_n8n=0. Se o SSH não responder, reinicie a VPS pelo painel do provedor.
Adicione as variáveis EXECUTIONS_DATA_SAVE_ON_SUCCESS=none e EXECUTIONS_DATA_PRUNE_MAX_COUNT=20000. É isso que corta a maior parte da escrita no banco.
Ligue o n8n de novo. Com ele de pé, importe a EXT Gênesis por cima de fXGorIlPbyf9Qtsp e o CORE novo por cima de 3N5oN6sxtir9lFrA.
Depois do CORE publicado, aplique no Supabase genesis_prompt_v14_21_photos_no_error.sql.
Se a Royal 4x4 não está atendendo, desative o workflow dela. Ele dispara a cada 10 s e soma mais 8.640 execuções por dia.
Quer que eu faça o commit em dev? Se o servidor ainda não estabilizar depois dos passos 1 a 3, me mande o resultado de docker stats --no-stream e df -h.



http://187.127.53.78:3000/

me ajude a acessar para desligar o auton8n/n8n
1:36 PM
Vou testar se o painel e o SSH desse servidor respondem.



Bash Check reachability of EasyPanel and SSH ports
IN
for p in 3000 22 80 443 5678; do (timeout 6 bash -c "</dev/tcp/187.127.53.78/$p" 2>/dev/null && echo "porta $p: aberta") || echo "porta $p: sem resposta"; done; echo; curl -s -o /dev/null -w "painel 3000: HTTP %{http_code} em %{time_total}s\n" --max-time 25 http://187.127.53.78:3000/

OUT
porta 3000: aberta
porta 22: aberta
porta 80: aberta
porta 443: aberta
porta 5678: sem resposta

painel 3000: HTTP 200 em 0.120014s
1:36 PM
O servidor está respondendo agora: o painel (porta 3000) abriu em 0,1 s e o SSH (porta 22) está aberto. O que provavelmente trava são as ações dentro do painel, porque o Docker está sobrecarregado. Eu não consigo entrar no seu EasyPanel daqui; os passos abaixo são para você fazer.

Opção 1: pelo painel
Abra http://187.127.53.78:3000/ e faça login.
Entre no projeto auton8n e clique no serviço n8n. Não é o n8n-db.
No topo da página do serviço, clique em Stop (ícone de quadrado) e espere até 1–2 minutos.
Se o botão girar sem fim ou der erro, use a opção 2.

Opção 2: pelo SSH (mais confiável)
No PowerShell do seu computador:


ssh root@187.127.53.78
Depois de entrar:


docker service ls | grep -i n8n
Deve aparecer algo como auton8n_n8n e auton8n_n8n-db. Pare só o n8n:


docker service scale auton8n_n8n=0
Para conferir, rode docker service ls | grep -i n8n. A linha do auton8n_n8n deve mostrar 0/0. Se o comando demorar, espere: com o servidor no limite, pode levar alguns minutos.

Se o nome que aparecer for diferente, me mande a saída do docker service ls que eu te digo o comando certo.

Logo depois de parar
Com o n8n parado, o painel deve ficar leve. No serviço n8n → Environment, adicione:

EXECUTIONS_DATA_SAVE_ON_SUCCESS=none
EXECUTIONS_DATA_PRUNE_MAX_COUNT=20000
Salve e clique em Deploy. Isso liga o n8n de novo, já com a configuração nova.
Para ligar pelo SSH em vez do painel: docker service scale auton8n_n8n=1.
Se puder, antes de religar, rode no SSH docker stats --no-stream e df -h / e me mande o resultado.



pelo ssh pede direto a senha, que não é a mesma que uso pra fazer login no painel. Que senha é essa?
1:41 PM
Essa é a senha do root da VPS, não a do EasyPanel. Ela foi definida (ou enviada por e-mail) quando o servidor foi contratado no provedor de hospedagem: Hostinger, Contabo, DigitalOcean, Hetzner etc.

Onde encontrar
E-mail de boas-vindas do provedor, da época da contratação. Procure por "VPS", "root" ou pelo IP 187.127.53.78.
Painel do provedor: entre na conta onde a VPS foi comprada e abra a VPS. Lá costuma haver:
Redefinir senha root (reset root password). Você cria uma nova e usa no ssh root@187.127.53.78.
Terminal ou console no navegador (Browser terminal, VNC). Ele abre o servidor direto, sem SSH, e você roda os mesmos comandos por ali.
O terminal do navegador costuma ser o caminho mais rápido.

Se não souber qual é o provedor
Veja quem paga o servidor: fatura no cartão ou e-mail de cobrança.
Pergunte a quem montou a infraestrutura.
Ao digitar a senha no SSH, o terminal não mostra nada enquanto você digita, nem asteriscos. É normal: digite e aperte Enter.

Depois de entrar

docker service ls | grep -i n8n
docker service scale auton8n_n8n=0
Me avise qual provedor é, se precisar que eu te guie no painel dele.



NORIA EXT _ Gênesis _ Política comercial v2 (1).json#1-92
provedor hostinger
1:56 PM
Na Hostinger dá para entrar sem saber a senha atual: pelo terminal do navegador, ou trocando a senha root no painel.

Opção 1: terminal do navegador (mais rápido)
Entre em hpanel.hostinger.com com a conta onde a VPS foi contratada.
No menu, clique em VPS e depois em Gerenciar, na VPS de IP 187.127.53.78.
No topo da página da VPS, clique em Terminal do navegador (Browser terminal).
Abre um terminal já logado como root. Rode:

docker service ls | grep -i n8n
docker service scale auton8n_n8n=0
Opção 2: definir uma nova senha root
Na mesma página da VPS, procure Configurações → Senha root (às vezes aparece em "Visão geral" → "Acesso SSH" → Alterar).
Defina uma senha nova e espere cerca de 1 minuto.
No seu PowerShell, rode ssh root@187.127.53.78 e use a senha nova. Ela não aparece enquanto você digita.
Se o terminal do navegador também não abrir, porque a VPS está travada, use Reiniciar VPS no mesmo painel. Assim que ela voltar, abra o terminal e rode o docker service scale auton8n_n8n=0 antes que o n8n suba e trave tudo de novo.

Depois de parar
No EasyPanel, serviço n8n → Environment, adicione:

EXECUTIONS_DATA_SAVE_ON_SUCCESS=none
EXECUTIONS_DATA_PRUNE_MAX_COUNT=20000
Clique em Deploy.
Se puder, me mande a saída de docker stats --no-stream e df -h /.
Vi que o JSON da EXT Gênesis agora tem saveDataSuccessExecution: "none" nas configurações. Isso ajuda, mas a EXT é pequena. O que pesa é o CORE e os gatilhos de 10 s, e a variável acima resolve tudo de uma vez. Também vi que o build_noria_workflows.cjs mudou desde a minha última edição. Considero a versão nova como a atual e confiro antes de mexer nele de novo.



Editor is now accessible via:
https://auton8n-n8n.tplv5d.easypanel.host
No matching task offer for request "RxiTZGH9lgKfIiZ7RdRnJ" (type "javascript"). Available offer types: [python]
No matching task offer for request "UbK7WboVQVGdGDfZRnqZb" (type "javascript"). Available offer types: [python]
No matching task offer for request "ojR0vVjMrc4329BDcgwr7" (type "javascript"). Available offer types: [python]
No matching task offer for request "IUUW09P3eN_4CICVPlWVi" (type "javascript"). Available offer types: [python]
No matching task offer for request "ARqBjNNjIzPZ20PwGie0i" (type "javascript"). Available offer types: [python]
No matching task offer for request "gq0N_O2gjJX67ctsNocG6" (type "javascript"). Available offer types: [python]
No matching task offer for request "m6Ag8f66TR_PJJ3aSjo9I" (type "javascript"). Available offer types: [python]
No matching task offer for request "UbAC3Q6FGT5bwEuoOwDAK" (type "javascript"). Available offer types: [python]
No matching task offer for request "6mhyTrATcgiEM4zXPauvb" (type "javascript"). Available offer types: [python]
No matching task offer for request "jPI4zr1OfMGY22sYxZOKL" (type "javascript"). Available offer types: [python]
No matching task offer for request "Dmi51CbPL466ZrqT1_iMJ" (type "javascript"). Available offer types: [python]
No matching task offer for request "5mSA1e3Xv3dicTThDLCOR" (type "javascript"). Available offer types: [python]
No matching task offer for request "yuVJEYQj4OKl8_Fv5ClNs" (type "javascript"). Available offer types: [python]
No matching task offer for request "_2bjJ2bGagLyZBFbA8Kup" (type "javascript"). Available offer types: [python]
No matching task offer for request "xpaXT9KSJhBWKMIuG7Fio" (type "javascript"). Available offer types: [python]
No matching task offer for request "Xmek5EQqcl_rOGdBqeRUT" (type "javascript"). Available offer types: [python]
No matching task offer for request "v5W_Bcqatp5INCyrU7sdm" (type "javascript"). Available offer types: [python]
No matching task offer for request "Nk45sfguHlJhFAYXK-tg5" (type "javascript"). Available offer types: [python]
No matching task offer for request "a0YRYFRBDwmv7mfvk5W6h" (type "javascript"). Available offer types: [python]
No matching task offer for request "mM0t9m-XoVR2S1vhzOoKA" (type "javascript"). Available offer types: [python]
No matching task offer for request "ZY5bJZcbsjsuvibEdImzn" (type "javascript"). Available offer types: [python]
No matching task offer for request "t9yqMCEPuEcVEMuGiB2z3" (type "javascript"). Available offer types: [python]
No matching task offer for request "isTr7jEAivyWVdxOEM5CQ" (type "javascript"). Available offer types: [python]
Show more
2:06 PM
O n8n voltou a subir. Esses erros mostram outro problema, mais grave, e provavelmente ligado à sobrecarga.

O que esses erros significam
No matching task offer ... (type "javascript"). Available offer types: [python]

Esta é a minha leitura do erro, ainda não confirmada nos logs. O n8n executa os nós Code num processo separado, o task runner. Só o runner de Python está conectado; o de JavaScript não está. Quase todos os nós da NORIA são Code em JavaScript, então:

toda execução do CORE falha logo no primeiro nó de código, e a IA não responde ninguém;
a recuperação da fila tenta de novo a cada 10 s, e cada falha é gravada como erro. Isso alimenta a carga.
A causa mais provável é o runner de JavaScript morrer por falta de memória e reiniciar em loop. Cada execução do CORE carrega 3 nós com 888 KB de código cada, e várias execuções rodam ao mesmo tempo.

O que fazer agora
1. Ache o motivo nos logs. No EasyPanel, abra os logs do serviço n8n e, se existir, também de um serviço separado de runners (algo como n8n-runners ou runners). Procure linhas anteriores a essas com:

heap out of memory ou JavaScript heap;
Task runner exited ou runner ... exited with code;
auth ou token, que indicaria runner externo sem autenticar.
2. Me mande as variáveis do serviço que começam com N8N_RUNNERS. Apague os valores de token ou senha antes. Com elas eu digo se o modo é interno ou externo e qual é o ajuste certo.

3. Enquanto isso, um ajuste que costuma resolver o caso de memória: no serviço que roda o runner (o próprio n8n ou o de runners), adicione:


N8N_RUNNERS_MAX_OLD_SPACE_SIZE=2048
N8N_RUNNERS_MAX_CONCURRENCY=3
A primeira dá 2 GB de memória ao runner de JavaScript. A segunda limita a 3 os nós de código rodando ao mesmo tempo. Só use 2048 se a VPS tiver memória sobrando para isso: confira no docker stats.

4. Diminua a carga enquanto investiga. No editor do n8n (https://auton8n-n8n.tplv5d.easypanel.host), desative o workflow Royal 4x4, porque ele dispara a cada 10 s. O CORE pode ficar ativo, já que está falhando de qualquer forma.

5. Importe o CORE novo quando o runner voltar. Ele tem 3,05 MB contra os 5,9 MB de antes, e a recuperação roda a cada 30 s. Isso alivia memória e CPU. Importe por cima do CORE atual (ID 3N5oN6sxtir9lFrA) e depois a EXT Gênesis por cima de fXGorIlPbyf9Qtsp.

Para saber se resolveu, essas mensagens No matching task offer param de aparecer nos logs e uma mensagem de teste no WhatsApp recebe resposta.




image.png
1377×107
é aqui que devo mexer?
2:28 PM
Não, esse botão não troca a senha. Ele redefine a configuração do SSH (o arquivo sshd_config e o shell do root) para o padrão da Hostinger. Só serve se o SSH estiver quebrado, e pode desfazer ajustes feitos por quem montou o servidor. Deixe-o quieto.

O que procurar
Na mesma tela de Configurações da VPS, um pouco acima ou abaixo, deve haver:

Alterar senha root (ou "Senha root" / "Root password"), com botão Alterar. É aí que você define a senha nova.
Para não precisar de senha nenhuma, use o Terminal do navegador: é um botão no topo da página da VPS (visão geral), geralmente ao lado de "Reiniciar" ou "Parar".

Talvez você nem precise mais do SSH
O n8n voltou: o log mostrou Editor is now accessible. Então o EasyPanel e o editor devem abrir agora. O próximo passo é pelo painel:

No EasyPanel, abra o serviço n8n, vá em Environment e me mande as variáveis N8N_RUNNERS_*, sem os valores de token.
Abra os logs do n8n e procure heap out of memory ou runner ... exited, acima das mensagens No matching task offer.
No editor do n8n, desative o workflow Royal 4x4.
O SSH só vira necessário se o painel travar de novo.



consegui acessar. o que fazer agora para derrubar o auton8n/n8n?
2:30 PM
Com o terminal aberto, rode os comandos abaixo, um de cada vez.

1. Ver o nome exato dos serviços

docker service ls | grep -i n8n
Deve aparecer algo como auton8n_n8n e auton8n_n8n-db, talvez também um de runners.

2. Derrubar só o n8n (o banco fica ligado)

docker service scale auton8n_n8n=0
Se o nome na lista for outro, use o que apareceu. Não pare o auton8n_n8n-db.

3. Confirmar que parou

docker service ls | grep -i n8n
A linha do auton8n_n8n deve mostrar 0/0 em REPLICAS. Pode levar até 1–2 minutos.

4. Coletar o diagnóstico (me mande a saída)

docker stats --no-stream
df -h /
free -h
docker service logs auton8n_n8n --since 2h 2>&1 | grep -iE "heap|memory|runner|exited|killed" | tail -30
5. Depois, antes de ligar de novo
No EasyPanel, serviço n8n → Environment, confira ou adicione:


EXECUTIONS_DATA_SAVE_ON_SUCCESS=none
EXECUTIONS_DATA_PRUNE_MAX_COUNT=20000
Mande também as variáveis N8N_RUNNERS_* daí, sem os tokens. Com isso eu te digo o ajuste do runner de JavaScript antes de religar.

Enquanto o n8n estiver parado, a IA não responde no WhatsApp.



root@srv1909930:~# docker service ls | grep -i n8n
f4ahgkt730jp   auton8n_evolution-api           replicated   1/1        evoapicloud/evolution-api:latest
kbg2vucu1bd2   auton8n_evolution-api-db        replicated   1/1        postgres:17
wu1cwb9qi13g   auton8n_evolution-api-redis     replicated   1/1        redis:7
y955il509cff   auton8n_n8n                     replicated   0/1        docker.n8n.io/n8nio/n8n:latest
jrbgltlotwfh   auton8n_n8n-db                  replicated   1/1        postgres:17
ckxabscl47zl   auton8n_n8n-db_dbgate           replicated   1/1        dbgate/dbgate:6.0.0
betzvjhvyuc9   auton8n_n8n-db_pgweb            replicated   1/1        sosedoff/pgweb:0.16.2
0ruikakh1x9d   auton8n_n8n-runner              replicated   1/1        n8nio/runners:2.21.0
jgj8s1hyt7ch   auton8n_noria-ingress-genesis   replicated   1/1        easypanel/auton8n/noria-ingress-genesis
mxrcy17yb410   auton8n_noria-ingress-nubia     replicated   1/1        easypanel/auton8n/noria-ingress-nubia
zwvvy5rhpjrx   auton8n_redis                   replicated   1/1        redis:7
aayskwu06ymp   extracao_n8n                    replicated   1/1        docker.n8n.io/n8nio/n8n:latest
s0fiuyq3veh3   extracao_n8n-db                 replicated   1/1        postgres:17
f5i5sm9dkcmz   extracao_n8n-runner             replicated   1/1        n8nio/runners:2.21.0
9qnlnfw42vuh   n8n_evolution-api               replicated   1/1        evoapicloud/evolution-api:latest
pmir1zlluknp   n8n_evolution-api-db            replicated   1/1        postgres:17
kphnggx7tjc5   n8n_evolution-api-redis         replicated   1/1        redis:7
ou7cqkxx9fbn   n8n_n8n                         replicated   1/1        docker.n8n.io/n8nio/n8n:latest
v3682pmmgpl5   n8n_n8n-db                      replicated   1/1        postgres:17
neh1pfq8mbg5   n8n_n8n-runner                  replicated   1/1        n8nio/runners:2.21.0
ukitazatmc8t   n8n_redis                       replicated   1/1        redis:7
Show more
2:31 PM
Essa lista explica muito. Há três achados importantes.

O que a lista mostra
1. O auton8n_n8n não está rodando: 0/1. O Docker quer 1 cópia e consegue 0. Ou seja, o n8n está caindo e reiniciando em loop.

2. As versões do n8n e do runner provavelmente não batem. É o suspeito nº 1.

n8n: n8nio/n8n:latest
runner: n8nio/runners:2.21.0
O latest baixa a versão mais nova a cada Deploy. O Deploy que vocês fizeram hoje para adicionar EXECUTIONS_DATA_MAX_AGE pode ter puxado um n8n mais novo que o runner 2.21.0. O runner de JavaScript precisa ser da mesma versão do n8n. Se não for, ele não se conecta, e sobra só o de Python. É exatamente o erro Available offer types: [python] que você viu.

3. Há 3 instalações completas de n8n na mesma VPS: auton8n, extracao e n8n. Cada uma tem seu próprio n8n, Postgres e runner, e duas têm Evolution e Redis. São mais de 20 containers dividindo a mesma CPU e memória.

Passo a passo
A. Pare o loop e veja por que ele cai:


docker service scale auton8n_n8n=0
docker service ps auton8n_n8n --no-trunc | head -6
docker service logs auton8n_n8n --tail 80 2>&1 | grep -iE "version|error|heap|memory|exited|runner" | tail -30
No service ps, a coluna ERROR mostra o motivo: exit 137 é falta de memória. No log, a linha Version: 2.xx.x mostra a versão do n8n que está rodando.

B. Iguale as versões. No EasyPanel, abra o serviço n8n do projeto auton8n e troque a imagem de docker.n8n.io/n8nio/n8n:latest para:


docker.n8n.io/n8nio/n8n:2.21.0
Assim ele fica na mesma versão do runner. Não use mais latest, nem no n8n nem no runner.

C. Libere recursos. Os projetos extracao e n8n estão em uso? Se não estiverem, pare temporariamente:


docker service scale extracao_n8n=0 extracao_n8n-runner=0 n8n_n8n=0 n8n_n8n-runner=0
Só rode esse comando se tiver certeza de que ninguém depende deles. O Evolution do projeto n8n (n8n_evolution-api) pode estar atendendo algum número; nesse caso, deixe-o.

D. Ligue de novo, já com EXECUTIONS_DATA_SAVE_ON_SUCCESS=none configurado:


docker service scale auton8n_n8n=1
Ou clique em Deploy no EasyPanel.

Me mande a saída do passo A e do docker stats --no-stream, e me diga se extracao e n8n são usados. Com a versão real em mãos, confirmo se a troca da imagem (B) é a correção.



root@srv1909930:~# docker service scale auton8n_n8n=0
docker service ps auton8n_n8n --no-trunc | head -6
docker service logs auton8n_n8n --tail 80 2>&1 | grep -iE "version|error|heap|memory|exited|runner" | tail -30
auton8n_n8n scaled to 0
overall progress: 0 out of 0 tasks
verify: Service auton8n_n8n converged
ID                          NAME                IMAGE                            NODE         DESIRED STATE   CURRENT STATE             ERROR                       PORTS
nyigqigo2xuoybszxf4ajj3m3   auton8n_n8n.1       docker.n8n.io/n8nio/n8n:latest   srv1909930   Remove          Running 6 seconds ago
tbie2xwk7vz86koemu16ghmzu    \_ auton8n_n8n.1   docker.n8n.io/n8nio/n8n:latest   srv1909930   Shutdown        Shutdown 20 seconds ago
g39z3yvsttjrwhzan8yvrgazy    \_ auton8n_n8n.1   docker.n8n.io/n8nio/n8n:latest   srv1909930   Shutdown        Failed 2 minutes ago      "task: non-zero exit (1)"
e6kuusv1gbspis1sydnbpwb62    \_ auton8n_n8n.1   docker.n8n.io/n8nio/n8n:latest   srv1909930   Shutdown        Shutdown 5 minutes ago
x3stdmwrbk5kzr12f3wuc121s    \_ auton8n_n8n.1   docker.n8n.io/n8nio/n8n:latest   srv1909930   Shutdown        Shutdown 10 minutes ago
auton8n_n8n.1.e6kuusv1gbsp@srv1909930    |     at DbConnectionMonitor.timeAcquisition (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+db@file++++home+runner+_work+n8n+n8n+packages+@n8n+db/node_modules/@n8n/db/src/connection/db-connection-monitor.ts:579:25)
auton8n_n8n.1.e6kuusv1gbsp@srv1909930    |     at DbConnectionMonitor.acquireConnection (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+db@file++++home+runner+_work+n8n+n8n+packages+@n8n+db/node_modules/@n8n/db/src/connection/db-connection-monitor.ts:555:11)
auton8n_n8n.1.e6kuusv1gbsp@srv1909930    |     at PostgresDriver.driver.obtainMasterConnection (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+db@file++++home+runner+_work+n8n+n8n+packages+@n8n+db/node_modules/@n8n/db/src/connection/db-connection-monitor.ts:543:47)
auton8n_n8n.1.e6kuusv1gbsp@srv1909930    |     at PostgresQueryRunner.query (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+typeorm@file++++home+runner+_work+n8n+n8n+packages+@n8n+typeorm/node_modules/@n8n/typeorm/dist/driver/postgres/PostgresQueryRunner.js:178:36)
auton8n_n8n.1.e6kuusv1gbsp@srv1909930    |     at DataSource.query (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+typeorm@file++++home+runner+_work+n8n+n8n+packages+@n8n+typeorm/node_modules/@n8n/typeorm/dist/data-source/DataSource.js:310:20)
auton8n_n8n.1.e6kuusv1gbsp@srv1909930    |     at WorkflowPublicationOutboxRepository.claimWithPostgresLocking (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+db@file++++home+runner+_work+n8n+n8n+packages+@n8n+db/node_modules/@n8n/db/src/repositories/workflow-publication-outbox.repository.ts:389:57)
auton8n_n8n.1.e6kuusv1gbsp@srv1909930    |     at WorkflowPublicationOutboxRepository.claimNextPendingRecord (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+db@file++++home+runner+_work+n8n+n8n+packages+@n8n+db/node_modules/@n8n/db/src/repositories/workflow-publication-outbox.repository.ts:377:11)
auton8n_n8n.1.e6kuusv1gbsp@srv1909930    | Error: getaddrinfo ENOTFOUND auton8n_n8n-db
auton8n_n8n.1.e6kuusv1gbsp@srv1909930    |     at PostgresDriver.obtainMasterConnection (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+typeorm@file++++home+runner+_work+n8n+n8n+packages+@n8n+typeorm/node_modules/@n8n/typeorm/dist/driver/postgres/PostgresDriver.js:870:28)
auton8n_n8n.1.e6kuusv1gbsp@srv1909930    |     at DbConnectionMonitor.timeAcquisition (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+db@file++++home+runner+_work+n8n+n8n+packages+@n8n+db/node_modules/@n8n/db/src/connection/db-connection-monitor.ts:579:25)
auton8n_n8n.1.e6kuusv1gbsp@srv1909930    |     at DbConnectionMonitor.acquireConnection (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+db@file++++home+runner+_work+n8n+n8n+packages+@n8n+db/node_modules/@n8n/db/src/connection/db-connection-monitor.ts:555:11)
auton8n_n8n.1.e6kuusv1gbsp@srv1909930    |     at PostgresDriver.driver.obtainMasterConnection (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+db@file++++home+runner+_work+n8n+n8n+packages+@n8n+db/node_modules/@n8n/db/src/connection/db-connection-monitor.ts:543:47)
auton8n_n8n.1.e6kuusv1gbsp@srv1909930    |     at PostgresQueryRunner.query (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+typeorm@file++++home+runner+_work+n8n+n8n+packages+@n8n+typeorm/node_modules/@n8n/typeorm/dist/driver/postgres/PostgresQueryRunner.js:178:36)
auton8n_n8n.1.e6kuusv1gbsp@srv1909930    |     at DataSource.query (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+typeorm@file++++home+runner+_work+n8n+n8n+packages+@n8n+typeorm/node_modules/@n8n/typeorm/dist/data-source/DataSource.js:310:20)
auton8n_n8n.1.e6kuusv1gbsp@srv1909930    |     at WorkflowPublicationOutboxRepository.claimWithPostgresLocking (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+db@file++++home+runner+_work+n8n+n8n+packages+@n8n+db/node_modules/@n8n/db/src/repositories/workflow-publication-outbox.repository.ts:389:57)
auton8n_n8n.1.e6kuusv1gbsp@srv1909930    |     at WorkflowPublicationOutboxRepository.claimNextPendingRecord (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+db@file++++home+runner+_work+n8n+n8n+packages+@n8n+db/node_modules/@n8n/db/src/repositories/workflow-publication-outbox.repository.ts:377:11)
auton8n_n8n.1.e6kuusv1gbsp@srv1909930    | Error: getaddrinfo ENOTFOUND auton8n_n8n-db
auton8n_n8n.1.e6kuusv1gbsp@srv1909930    |     at PostgresDriver.obtainMasterConnection (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+typeorm@file++++home+runner+_work+n8n+n8n+packages+@n8n+typeorm/node_modules/@n8n/typeorm/dist/driver/postgres/PostgresDriver.js:870:28)
auton8n_n8n.1.e6kuusv1gbsp@srv1909930    |     at DbConnectionMonitor.timeAcquisition (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+db@file++++home+runner+_work+n8n+n8n+packages+@n8n+db/node_modules/@n8n/db/src/connection/db-connection-monitor.ts:579:25)
auton8n_n8n.1.e6kuusv1gbsp@srv1909930    |     at DbConnectionMonitor.acquireConnection (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+db@file++++home+runner+_work+n8n+n8n+packages+@n8n+db/node_modules/@n8n/db/src/connection/db-connection-monitor.ts:555:11)
auton8n_n8n.1.e6kuusv1gbsp@srv1909930    |     at PostgresDriver.driver.obtainMasterConnection (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+db@file++++home+runner+_work+n8n+n8n+packages+@n8n+db/node_modules/@n8n/db/src/connection/db-connection-monitor.ts:543:47)
auton8n_n8n.1.e6kuusv1gbsp@srv1909930    |     at PostgresQueryRunner.query (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+typeorm@file++++home+runner+_work+n8n+n8n+packages+@n8n+typeorm/node_modules/@n8n/typeorm/dist/driver/postgres/PostgresQueryRunner.js:178:36)
auton8n_n8n.1.e6kuusv1gbsp@srv1909930    |     at SelectQueryBuilder.loadRawResults (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+typeorm@file++++home+runner+_work+n8n+n8n+packages+@n8n+typeorm/node_modules/@n8n/typeorm/dist/query-builder/SelectQueryBuilder.js:1949:25)
auton8n_n8n.1.e6kuusv1gbsp@srv1909930    |     at SelectQueryBuilder.getRawMany (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+typeorm@file++++home+runner+_work+n8n+n8n+packages+@n8n+typeorm/node_modules/@n8n/typeorm/dist/query-builder/SelectQueryBuilder.js:618:29)
auton8n_n8n.1.e6kuusv1gbsp@srv1909930    |     at WorkflowPublicationTriggerStatusRepository.findActivatedInMemoryTriggers (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+db@file++++home+runner+_work+n8n+n8n+packages+@n8n+db/node_modules/@n8n/db/src/repositories/workflow-publication-trigger-status.repository.ts:66:10)
auton8n_n8n.1.e6kuusv1gbsp@srv1909930    | Error: getaddrinfo ENOTFOUND auton8n_n8n-db
auton8n_n8n.1.e6kuusv1gbsp@srv1909930    |     at DbConnectionMonitor.raceTimeout (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+db@file++++home+runner+_work+n8n+n8n+packages+@n8n+db/node_modules/@n8n/db/src/connection/db-connection-monitor.ts:275:11)
auton8n_n8n.1.e6kuusv1gbsp@srv1909930    |     at DbConnectionMonitor.runPing (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+db@file++++home+runner+_work+n8n+n8n+packages+@n8n+db/node_modules/@n8n/db/src/connection/db-connection-monitor.ts:236:13)
auton8n_n8n.1.e6kuusv1gbsp@srv1909930    |     at DbConnectionMonitor.ping (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+db@file++++home+runner+_work+n8n+n8n+packages+@n8n+db/node_modules/@n8n/db/src/connection/db-connection-monitor.ts:167:4)
auton8n_n8n.1.e6kuusv1gbsp@srv1909930    |     at Timeout._onTimeout (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+db@file++++home+runner+_work+n8n+n8n+packages+@n8n+db/node_modules/@n8n/db/src/connection/db-connection-monitor.ts:150:17)
root@srv1909930:~#
Show more
2:34 PM
Achamos a causa direta do 503: o n8n não consegue achar o banco pelo nome.


Error: getaddrinfo ENOTFOUND auton8n_n8n-db
O banco (auton8n_n8n-db) está rodando (1/1), mas o nome dele não resolve na rede interna do Docker. Sem banco, o n8n sai com erro (non-zero exit (1)) e o Swarm tenta de novo em loop. Daí vem o "Database is not ready!". O problema de versão do runner é outro, e tratamos depois que isso voltar.

As causas comuns são o banco ou o n8n terem ficado fora da rede do projeto depois de um Deploy, ou o DNS interno do Docker ter travado com o servidor no limite.

1. Diagnóstico rápido (me mande a saída)

docker service ps auton8n_n8n-db --no-trunc | head -4
docker service inspect auton8n_n8n --format '{{json .Spec.TaskTemplate.Networks}}'
docker service inspect auton8n_n8n-db --format '{{json .Spec.TaskTemplate.Networks}}'
docker exec $(docker ps -q -f name=auton8n_n8n-db_pgweb | head -1) nslookup auton8n_n8n-db
Os dois inspect devem mostrar a mesma rede (mesmo Target).
O nslookup roda de dentro do pgweb, que está na mesma rede do banco, e testa se o nome resolve.
2. Correção provável
Se as redes forem iguais, reinicie o banco e depois o n8n. Isso força o Docker a registrar o nome de novo:


docker service update --force auton8n_n8n-db
Espere uns 30 s, até docker service ls | grep auton8n_n8n-db mostrar 1/1. Então:


docker service scale auton8n_n8n=1
docker service logs auton8n_n8n --since 2m -f 2>&1 | grep -iE "ENOTFOUND|ready|Editor is now|error"
Se aparecer Editor is now accessible sem ENOTFOUND, o banco voltou. Saia do log com Ctrl+C.

Reiniciar o Postgres é um desligamento controlado, como o que aconteceu no Deploy de hoje cedo. Nenhum dado se perde.

Se as redes forem diferentes, não rode o passo 2: me mande a saída que te digo como religar a rede.

3. Antes de religar, se der tempo
No EasyPanel, serviço n8n → Environment, confira:


EXECUTIONS_DATA_SAVE_ON_SUCCESS=none
DB_POSTGRESDB_HOST=auton8n_n8n-db
Confira também que o valor do host não tem \ no final. Se houver uma barra invertida, ela vira parte do nome e causa exatamente esse ENOTFOUND.



root@srv1909930:~# docker service ps auton8n_n8n-db --no-trunc | head -4
docker service inspect auton8n_n8n --format '{{json .Spec.TaskTemplate.Networks}}'
docker service inspect auton8n_n8n-db --format '{{json .Spec.TaskTemplate.Networks}}'
docker exec $(docker ps -q -f name=auton8n_n8n-db_pgweb | head -1) nslookup auton8n_n8n-db
ID                          NAME                   IMAGE         NODE         DESIRED STATE   CURRENT STATE             ERROR     PORTS
yuqjq9dy8oclq0eyb7z85rw5t   auton8n_n8n-db.1       postgres:17   srv1909930   Running         Running 2 minutes ago     
vi3hqwuuqkr418hrrus5ycl9p    \_ auton8n_n8n-db.1   postgres:17   srv1909930   Shutdown        Shutdown 3 minutes ago    
hbtpofc4h9rhjjltf49if5hbr    \_ auton8n_n8n-db.1   postgres:17   srv1909930   Shutdown        Shutdown 8 minutes ago    
[{"Target":"oozb268mv3br57u7lsoshnq3q","Aliases":["auton8n-n8n"]},{"Target":"uggzwa2zuzsrs86nj160avb0u","Aliases":["auton8n-n8n","n8n"]}]
[{"Target":"oozb268mv3br57u7lsoshnq3q","Aliases":["auton8n-n8n-db"]},{"Target":"uggzwa2zuzsrs86nj160avb0u","Aliases":["auton8n-n8n-db","n8n-db"]}]
OCI runtime exec failed: exec failed: unable to start container process: exec: "nslookup": executable file not found in $PATH
root@srv1909930:~#
Show more
2:36 PM
As redes estão certas: n8n e banco estão nas mesmas duas redes. Mas apareceu outra coisa importante.

O banco está sendo recriado a cada ~5 minutos: Running 2 minutes ago, com cópias anteriores encerradas há 3 e há 8 minutos. A coluna ERROR está vazia, então não é queda: alguém ou algo está recriando o serviço, por exemplo um Deploy no EasyPanel ou um healthcheck. Enquanto o Postgres está sendo recriado, o nome dele some da rede, e é aí que aparece o ENOTFOUND.

1. Testar o nome e ver por que o banco reinicia

docker exec $(docker ps -q -f name=auton8n_n8n-db.1 | head -1) getent hosts auton8n_n8n-db auton8n-n8n-db
docker service logs auton8n_n8n-db --since 15m 2>&1 | grep -viE "checkpoint" | tail -30
docker service inspect auton8n_n8n-db --format '{{json .Spec.TaskTemplate.ContainerSpec.Healthcheck}} {{json .Spec.TaskTemplate.Resources}}'
O getent deve mostrar um IP para cada nome.
Os logs mostram se o Postgres recebeu ordem de desligar (fast shutdown request) ou se morreu (killed, out of memory).
O inspect mostra o healthcheck e o limite de memória do banco.
2. Se o getent mostrar os IPs, religue o n8n agora

docker service scale auton8n_n8n=1
docker service logs auton8n_n8n --since 2m -f 2>&1 | grep -iE "ENOTFOUND|Editor is now|error"
Saia do log com Ctrl+C.

Importante enquanto isso
Não clique em Deploy no EasyPanel em nenhum serviço do projeto auton8n até sabermos quem está recriando o banco. Se vocês ou outra pessoa estavam fazendo Deploy nos últimos minutos, isso explica as recriações, e o problema deve parar sozinho.

Me mande a saída do passo 1 e do log do passo 2.



docker exec $(docker ps -q -f name=auton8n_n8n-db.1 | head -1) getent hosts auton8n_n8n-db auton8n-n8n-db
docker service logs auton8n_n8n-db --since 15m 2>&1 | grep -viE "checkpoint" | tail -30
docker service inspect auton8n_n8n-db --format '{{json .Spec.TaskTemplate.ContainerSpec.Healthcheck}} {{json .Spec.TaskTemplate.Resources}}'
10.11.4.40      auton8n_n8n-db
10.11.4.40      auton8n-n8n-db
auton8n_n8n-db.1.vi3hqwuuqkr4@srv1909930    | 2026-10-21 17:30:17.618 UTC [35] STATEMENT:  SELECT "WorkflowPublishedVersion"."updatedAt" AS "WorkflowPublishedVersion_updatedAt", "WorkflowPublishedVersion"."createdAt" AS "WorkflowPublishedVersion_createdAt", "WorkflowPublishedVersion"."workflowId" AS "WorkflowPublishedVersion_workflowId", "WorkflowPublishedVersion"."publishedVersionId" AS "WorkflowPublishedVersion_publishedVersionId", "WorkflowPublishedVersion__WorkflowPublishedVersion_workflow"."updatedAt" AS "dee3c7a081e24411d87bd3bd9db40cb0f2150107", "WorkflowPublishedVersion__WorkflowPublishedVersion_workflow"."createdAt" AS "8d5f6cdaeca4e69848e403c1b1d4699251433853", "WorkflowPublishedVersion__WorkflowPublishedVersion_workflow"."id" AS "WorkflowPublishedVersion__WorkflowPublishedVersion_workflow_id", "WorkflowPublishedVersion__WorkflowPublishedVersion_workflow"."name" AS "b30c309bf10ee27c8ebdd1124cb6eb3ed4ecc878", "WorkflowPublishedVersion__WorkflowPublishedVersion_workflow"."description" AS "64d2187b945dd3aac3d4a0832b27f52aec2542a2", "WorkflowPublishedVersion__WorkflowPublishedVersion_workflow"."active" AS "6cb20ce414d113e8fcef0833a2855d0623fbcb38", "WorkflowPublishedVersion__WorkflowPublishedVersion_workflow"."isArchived" AS "254d169da1c9645043c27db0d386e75cb89ccd1d", "WorkflowPublishedVersion__WorkflowPublishedVersion_workflow"."nodes" AS "1eeced1816042bf77796548a8cd0b2a8b89ed292", "WorkflowPublishedVersion__WorkflowPublishedVersion_workflow"."connections" AS "6745a319d00aff3d15affd89cfca2cda9782bb7f", "WorkflowPublishedVersion__WorkflowPublishedVersion_workflow"."settings" AS "b440bcdbd20e80e49828e28f06747789e47d7498", "WorkflowPublishedVersion__WorkflowPublishedVersion_workflow"."staticData" AS "dd8ce345db09ffc0f4ab6a7eaaaf24981e6f11d7", "WorkflowPublishedVersion__WorkflowPublishedVersion_workflow"."meta" AS "f26fbe353862946e8ecd58b4f8cfbeb562c6c5be", "WorkflowPublishedVersion__WorkflowPublishedVersion_workflow"."nodeGroups" AS "9f284b3e04e199a45f97d2fcaa0040adaca97d98", "WorkflowPublishedVersion__WorkflowPublishedVersion_workflow"."pinData" AS "532aa0668401652d460d0458c59d1b8cbbf8f71d", "WorkflowPublishedVersion__WorkflowPublishedVersion_workflow"."versionId" AS "ac68aae573ebf374d57962a3abdaf338989a7f83", "WorkflowPublishedVersion__WorkflowPublishedVersion_workflow"."activeVersionId" AS "2d71b7097ee7d593034678bc972aa163988ad97c", "WorkflowPublishedVersion__WorkflowPublishedVersion_workflow"."versionCounter" AS "8d466d91aadb7a441d28ddd1ca84012c78ef16e0", "WorkflowPublishedVersion__WorkflowPublishedVersion_workflow"."triggerCount" AS "c2cbc455003c1f2a3201bc915f79bfb1607bd41e", "WorkflowPublishedVersion__WorkflowPublishedVersion_workflow"."sourceWorkflowId" AS "61660baebf5f0f88220c96a213fe1408b05b959e", "WorkflowPublishedVersion__WorkflowPublishedVersion_workflow"."parentFolderId" AS "1fbdb92c4feb4d6aebe94ac5aaf4409bbd144985", "04ba888313cdd8af38d561c50f9daa4e3966da12"."updatedAt" AS "04ba888313cdd8af38d561c50f9daa4e3966da12_updatedAt", "04ba888313cdd8af38d561c50f9daa4e3966da12"."createdAt" AS "04ba888313cdd8af38d561c50f9daa4e3966da12_createdAt", "04ba888313cdd8af38d561c50f9daa4e3966da12"."role" AS "04ba888313cdd8af38d561c50f9daa4e3966da12_role", "04ba888313cdd8af38d561c50f9daa4e3966da12"."workflowId" AS "04ba888313cdd8af38d561c50f9daa4e3966da12_workflowId", "04ba888313cdd8af38d561c50f9daa4e3966da12"."projectId" AS "04ba888313cdd8af38d561c50f9daa4e3966da12_projectId", "b64a84bcedd932207d65aa385c1417eb01122481"."updatedAt" AS "b64a84bcedd932207d65aa385c1417eb01122481_updatedAt", "b64a84bcedd932207d65aa385c1417eb01122481"."createdAt" AS "b64a84bcedd932207d65aa385c1417eb01122481_createdAt", "b64a84bcedd932207d65aa385c1417eb01122481"."id" AS "b64a84bcedd932207d65aa385c1417eb01122481_id", "b64a84bcedd932207d65aa385c1417eb01122481"."name" AS "b64a84bcedd932207d65aa385c1417eb01122481_name", "b64a84bcedd932207d65aa385c1417eb01122481"."type" AS "b64a84bcedd932207d65aa385c1417eb01122481_type", "b64a84bcedd932207d65aa385c1417eb01122481"."icon" AS "b64a84bcedd932207d65aa385c1417eb01122481_icon", "b64a84bcedd932207d65aa385c1417eb01122481"."description" AS "b64a84bcedd932207d65aa385c1417eb01122481_description", "b64a84bcedd932207d65aa385c1417eb01122481"."customTelemetryTags" AS "b64a84bcedd932207d65aa385c1417eb01122481_customTelemetryTags", "b64a84bcedd932207d65aa385c1417eb01122481"."creatorId" AS "b64a84bcedd932207d65aa385c1417eb01122481_creatorId", "d034fec3264c245689851d4bc291437b073b4ed7"."updatedAt" AS "d034fec3264c245689851d4bc291437b073b4ed7_updatedAt", "d034fec3264c245689851d4bc291437b073b4ed7"."createdAt" AS "d034fec3264c245689851d4bc291437b073b4ed7_createdAt", "d034fec3264c245689851d4bc291437b073b4ed7"."versionId" AS "d034fec3264c245689851d4bc291437b073b4ed7_versionId", "d034fec3264c245689851d4bc291437b073b4ed7"."workflowId" AS "d034fec3264c245689851d4bc291437b073b4ed7_workflowId", "d034fec3264c245689851d4bc291437b073b4ed7"."nodes" AS "d034fec3264c245689851d4bc291437b073b4ed7_nodes", "d034fec3264c245689851d4bc291437b073b4ed7"."connections" AS "d034fec3264c245689851d4bc291437b073b4ed7_connections", "d034fec3264c245689851d4bc291437b073b4ed7"."nodeGroups" AS "d034fec3264c245689851d4bc291437b073b4ed7_nodeGroups", "d034fec3264c245689851d4bc291437b073b4ed7"."authors" AS "d034fec3264c245689851d4bc291437b073b4ed7_authors", "d034fec3264c245689851d4bc291437b073b4ed7"."name" AS "d034fec3264c245689851d4bc291437b073b4ed7_name", "d034fec3264c245689851d4bc291437b073b4ed7"."description" AS "d034fec3264c245689851d4bc291437b073b4ed7_description", "d034fec3264c245689851d4bc291437b073b4ed7"."autosaved" AS "d034fec3264c245689851d4bc291437b073b4ed7_autosaved" FROM "public"."workflow_published_version" "WorkflowPublishedVersion" LEFT JOIN "public"."workflow_entity" "WorkflowPublishedVersion__WorkflowPublishedVersion_workflow" ON "WorkflowPublishedVersion__WorkflowPublishedVersion_workflow"."id"="WorkflowPublishedVersion"."workflowId"  LEFT JOIN "public"."shared_workflow" "04ba888313cdd8af38d561c50f9daa4e3966da12" ON "04ba888313cdd8af38d561c50f9daa4e3966da12"."workflowId"="WorkflowPublishedVersion__WorkflowPublishedVersion_workflow"."id"  LEFT JOIN "public"."project" "b64a84bcedd932207d65aa385c1417eb01122481" ON "b64a84bcedd932207d65aa385c1417eb01122481"."id"="04ba888313cdd8af38d561c50f9daa4e3966da12"."projectId"  LEFT JOIN "public"."workflow_history" "d034fec3264c245689851d4bc291437b073b4ed7" ON "d034fec3264c245689851d4bc291437b073b4ed7"."versionId"="WorkflowPublishedVersion"."publishedVersionId" WHERE ( (("WorkflowPublishedVersion"."workflowId" = $1)) ) AND ( "WorkflowPublishedVersion"."workflowId" IN ($2) )
auton8n_n8n-db.1.vi3hqwuuqkr4@srv1909930    | 2026-10-21 17:30:17.624 UTC [47] FATAL:  connection to client lost
auton8n_n8n-db.1.vi3hqwuuqkr4@srv1909930    | 2026-10-21 17:30:17.624 UTC [47] STATEMENT:  SELECT "WorkflowPublishedVersion"."updatedAt" AS "WorkflowPublishedVersion_updatedAt", "WorkflowPublishedVersion"."createdAt" AS "WorkflowPublishedVersion_createdAt", "WorkflowPublishedVersion"."workflowId" AS "WorkflowPublishedVersion_workflowId", "WorkflowPublishedVersion"."publishedVersionId" AS "WorkflowPublishedVersion_publishedVersionId", "WorkflowPublishedVersion__WorkflowPublishedVersion_workflow"."updatedAt" AS "dee3c7a081e24411d87bd3bd9db40cb0f2150107", "WorkflowPublishedVersion__WorkflowPublishedVersion_workflow"."createdAt" AS "8d5f6cdaeca4e69848e403c1b1d4699251433853", "WorkflowPublishedVersion__WorkflowPublishedVersion_workflow"."id" AS "WorkflowPublishedVersion__WorkflowPublishedVersion_workflow_id", "WorkflowPublishedVersion__WorkflowPublishedVersion_workflow"."name" AS "b30c309bf10ee27c8ebdd1124cb6eb3ed4ecc878", "WorkflowPublishedVersion__WorkflowPublishedVersion_workflow"."description" AS "64d2187b945dd3aac3d4a0832b27f52aec2542a2", "WorkflowPublishedVersion__WorkflowPublishedVersion_workflow"."active" AS "6cb20ce414d113e8fcef0833a2855d0623fbcb38", "WorkflowPublishedVersion__WorkflowPublishedVersion_workflow"."isArchived" AS "254d169da1c9645043c27db0d386e75cb89ccd1d", "WorkflowPublishedVersion__WorkflowPublishedVersion_workflow"."nodes" AS "1eeced1816042bf77796548a8cd0b2a8b89ed292", "WorkflowPublishedVersion__WorkflowPublishedVersion_workflow"."connections" AS "6745a319d00aff3d15affd89cfca2cda9782bb7f", "WorkflowPublishedVersion__WorkflowPublishedVersion_workflow"."settings" AS "b440bcdbd20e80e49828e28f06747789e47d7498", "WorkflowPublishedVersion__WorkflowPublishedVersion_workflow"."staticData" AS "dd8ce345db09ffc0f4ab6a7eaaaf24981e6f11d7", "WorkflowPublishedVersion__WorkflowPublishedVersion_workflow"."meta" AS "f26fbe353862946e8ecd58b4f8cfbeb562c6c5be", "WorkflowPublishedVersion__WorkflowPublishedVersion_workflow"."nodeGroups" AS "9f284b3e04e199a45f97d2fcaa0040adaca97d98", "WorkflowPublishedVersion__WorkflowPublishedVersion_workflow"."pinData" AS "532aa0668401652d460d0458c59d1b8cbbf8f71d", "WorkflowPublishedVersion__WorkflowPublishedVersion_workflow"."versionId" AS "ac68aae573ebf374d57962a3abdaf338989a7f83", "WorkflowPublishedVersion__WorkflowPublishedVersion_workflow"."activeVersionId" AS "2d71b7097ee7d593034678bc972aa163988ad97c", "WorkflowPublishedVersion__WorkflowPublishedVersion_workflow"."versionCounter" AS "8d466d91aadb7a441d28ddd1ca84012c78ef16e0", "WorkflowPublishedVersion__WorkflowPublishedVersion_workflow"."triggerCount" AS "c2cbc455003c1f2a3201bc915f79bfb1607bd41e", "WorkflowPublishedVersion__WorkflowPublishedVersion_workflow"."sourceWorkflowId" AS "61660baebf5f0f88220c96a213fe1408b05b959e", "WorkflowPublishedVersion__WorkflowPublishedVersion_workflow"."parentFolderId" AS "1fbdb92c4feb4d6aebe94ac5aaf4409bbd144985", "04ba888313cdd8af38d561c50f9daa4e3966da12"."updatedAt" AS "04ba888313cdd8af38d561c50f9daa4e3966da12_updatedAt", "04ba888313cdd8af38d561c50f9daa4e3966da12"."createdAt" AS "04ba888313cdd8af38d561c50f9daa4e3966da12_createdAt", "04ba888313cdd8af38d561c50f9daa4e3966da12"."role" AS "04ba888313cdd8af38d561c50f9daa4e3966da12_role", "04ba888313cdd8af38d561c50f9daa4e3966da12"."workflowId" AS "04ba888313cdd8af38d561c50f9daa4e3966da12_workflowId", "04ba888313cdd8af38d561c50f9daa4e3966da12"."projectId" AS "04ba888313cdd8af38d561c50f9daa4e3966da12_projectId", "b64a84bcedd932207d65aa385c1417eb01122481"."updatedAt" AS "b64a84bcedd932207d65aa385c1417eb01122481_updatedAt", "b64a84bcedd932207d65aa385c1417eb01122481"."createdAt" AS "b64a84bcedd932207d65aa385c1417eb01122481_createdAt", "b64a84bcedd932207d65aa385c1417eb01122481"."id" AS "b64a84bcedd932207d65aa385c1417eb01122481_id", "b64a84bcedd932207d65aa385c1417eb01122481"."name" AS "b64a84bcedd932207d65aa385c1417eb01122481_name", "b64a84bcedd932207d65aa385c1417eb01122481"."type" AS "b64a84bcedd932207d65aa385c1417eb01122481_type", "b64a84bcedd932207d65aa385c1417eb01122481"."icon" AS "b64a84bcedd932207d65aa385c1417eb01122481_icon", "b64a84bcedd932207d65aa385c1417eb01122481"."description" AS "b64a84bcedd932207d65aa385c1417eb01122481_description", "b64a84bcedd932207d65aa385c1417eb01122481"."customTelemetryTags" AS "b64a84bcedd932207d65aa385c1417eb01122481_customTelemetryTags", "b64a84bcedd932207d65aa385c1417eb01122481"."creatorId" AS "b64a84bcedd932207d65aa385c1417eb01122481_creatorId", "d034fec3264c245689851d4bc291437b073b4ed7"."updatedAt" AS "d034fec3264c245689851d4bc291437b073b4ed7_updatedAt", "d034fec3264c245689851d4bc291437b073b4ed7"."createdAt" AS "d034fec3264c245689851d4bc291437b073b4ed7_createdAt", "d034fec3264c245689851d4bc291437b073b4ed7"."versionId" AS "d034fec3264c245689851d4bc291437b073b4ed7_versionId", "d034fec3264c245689851d4bc291437b073b4ed7"."workflowId" AS "d034fec3264c245689851d4bc291437b073b4ed7_workflowId", "d034fec3264c245689851d4bc291437b073b4ed7"."nodes" AS "d034fec3264c245689851d4bc291437b073b4ed7_nodes", "d034fec3264c245689851d4bc291437b073b4ed7"."connections" AS "d034fec3264c245689851d4bc291437b073b4ed7_connections", "d034fec3264c245689851d4bc291437b073b4ed7"."nodeGroups" AS "d034fec3264c245689851d4bc291437b073b4ed7_nodeGroups", "d034fec3264c245689851d4bc291437b073b4ed7"."authors" AS "d034fec3264c245689851d4bc291437b073b4ed7_authors", "d034fec3264c245689851d4bc291437b073b4ed7"."name" AS "d034fec3264c245689851d4bc291437b073b4ed7_name", "d034fec3264c245689851d4bc291437b073b4ed7"."description" AS "d034fec3264c245689851d4bc291437b073b4ed7_description", "d034fec3264c245689851d4bc291437b073b4ed7"."autosaved" AS "d034fec3264c245689851d4bc291437b073b4ed7_autosaved" FROM "public"."workflow_published_version" "WorkflowPublishedVersion" LEFT JOIN "public"."workflow_entity" "WorkflowPublishedVersion__WorkflowPublishedVersion_workflow" ON "WorkflowPublishedVersion__WorkflowPublishedVersion_workflow"."id"="WorkflowPublishedVersion"."workflowId"  LEFT JOIN "public"."shared_workflow" "04ba888313cdd8af38d561c50f9daa4e3966da12" ON "04ba888313cdd8af38d561c50f9daa4e3966da12"."workflowId"="WorkflowPublishedVersion__WorkflowPublishedVersion_workflow"."id"  LEFT JOIN "public"."project" "b64a84bcedd932207d65aa385c1417eb01122481" ON "b64a84bcedd932207d65aa385c1417eb01122481"."id"="04ba888313cdd8af38d561c50f9daa4e3966da12"."projectId"  LEFT JOIN "public"."workflow_history" "d034fec3264c245689851d4bc291437b073b4ed7" ON "d034fec3264c245689851d4bc291437b073b4ed7"."versionId"="WorkflowPublishedVersion"."publishedVersionId" WHERE ( (("WorkflowPublishedVersion"."workflowId" = $1)) ) AND ( "WorkflowPublishedVersion"."workflowId" IN ($2) )
auton8n_n8n-db.1.vi3hqwuuqkr4@srv1909930    | 2026-10-21 17:30:17.631 UTC [57] LOG:  could not receive data from client: Connection reset by peer
auton8n_n8n-db.1.vi3hqwuuqkr4@srv1909930    | 2026-10-21 17:30:17.636 UTC [58] LOG:  could not receive data from client: Connection reset by peer
auton8n_n8n-db.1.vi3hqwuuqkr4@srv1909930    | 2026-10-21 17:32:38.361 UTC [7] LOG:  received fast shutdown request
auton8n_n8n-db.1.vi3hqwuuqkr4@srv1909930    | 2026-10-21 17:32:38.367 UTC [7] LOG:  aborting any active transactions
auton8n_n8n-db.1.vi3hqwuuqkr4@srv1909930    | 2026-10-21 17:32:38.368 UTC [79] FATAL:  terminating connection due to administrator command
auton8n_n8n-db.1.vi3hqwuuqkr4@srv1909930    | 2026-10-21 17:32:38.382 UTC [83] FATAL:  terminating connection due to administrator command
auton8n_n8n-db.1.vi3hqwuuqkr4@srv1909930    | 2026-10-21 17:32:38.383 UTC [82] FATAL:  terminating connection due to administrator command
auton8n_n8n-db.1.vi3hqwuuqkr4@srv1909930    | 2026-10-21 17:32:38.389 UTC [81] FATAL:  terminating connection due to administrator command
auton8n_n8n-db.1.vi3hqwuuqkr4@srv1909930    | 2026-10-21 17:32:38.394 UTC [80] FATAL:  terminating connection due to administrator command
auton8n_n8n-db.1.vi3hqwuuqkr4@srv1909930    | 2026-10-21 17:32:38.397 UTC [78] FATAL:  terminating connection due to administrator command
auton8n_n8n-db.1.vi3hqwuuqkr4@srv1909930    | 2026-10-21 17:32:38.402 UTC [77] FATAL:  terminating connection due to administrator command
auton8n_n8n-db.1.vi3hqwuuqkr4@srv1909930    | 2026-10-21 17:32:38.410 UTC [76] FATAL:  terminating connection due to administrator command
auton8n_n8n-db.1.vi3hqwuuqkr4@srv1909930    | 2026-10-21 17:32:38.413 UTC [74] FATAL:  terminating connection due to administrator command
auton8n_n8n-db.1.vi3hqwuuqkr4@srv1909930    | 2026-10-21 17:32:38.422 UTC [73] FATAL:  terminating connection due to administrator command
auton8n_n8n-db.1.vi3hqwuuqkr4@srv1909930    | 2026-10-21 17:32:38.425 UTC [71] FATAL:  terminating connection due to administrator command
auton8n_n8n-db.1.vi3hqwuuqkr4@srv1909930    | 2026-10-21 17:32:38.432 UTC [69] FATAL:  terminating connection due to administrator command
auton8n_n8n-db.1.vi3hqwuuqkr4@srv1909930    | 2026-10-21 17:32:38.450 UTC [67] FATAL:  terminating connection due to administrator command
auton8n_n8n-db.1.vi3hqwuuqkr4@srv1909930    | 2026-10-21 17:32:38.461 UTC [64] FATAL:  terminating connection due to administrator command
auton8n_n8n-db.1.vi3hqwuuqkr4@srv1909930    | 2026-10-21 17:32:38.474 UTC [63] FATAL:  terminating connection due to administrator command
auton8n_n8n-db.1.vi3hqwuuqkr4@srv1909930    | 2026-10-21 17:32:38.489 UTC [72] FATAL:  terminating connection due to administrator command
auton8n_n8n-db.1.vi3hqwuuqkr4@srv1909930    | 2026-10-21 17:32:38.495 UTC [65] FATAL:  terminating connection due to administrator command
auton8n_n8n-db.1.vi3hqwuuqkr4@srv1909930    | 2026-10-21 17:32:38.498 UTC [66] FATAL:  terminating connection due to administrator command
auton8n_n8n-db.1.vi3hqwuuqkr4@srv1909930    | 2026-10-21 17:32:38.504 UTC [75] FATAL:  terminating connection due to administrator command
auton8n_n8n-db.1.vi3hqwuuqkr4@srv1909930    | 2026-10-21 17:32:38.508 UTC [70] FATAL:  terminating connection due to administrator command
auton8n_n8n-db.1.vi3hqwuuqkr4@srv1909930    | 2026-10-21 17:32:38.805 UTC [7] LOG:  background worker "logical replication launcher" (PID 31) exited with exit code 1
auton8n_n8n-db.1.vi3hqwuuqkr4@srv1909930    | 2026-10-21 17:32:39.016 UTC [26] LOG:  shutting down
auton8n_n8n-db.1.vi3hqwuuqkr4@srv1909930    | 2026-10-21 17:32:40.023 UTC [7] LOG:  database system is shut down
null {"Limits":{},"Reservations":{}}
root@srv1909930:~#
Show more
2:37 PM
O nome do banco resolve normalmente agora (10.11.4.40), e não há healthcheck nem limite de memória no banco. O desligamento das 17:32 UTC (14:32 em Brasília) foi uma ordem de parada (fast shutdown request, "administrator command"), não uma queda. Provavelmente alguém clicou em Deploy no EasyPanel. O ENOTFOUND aconteceu nesses intervalos em que o banco estava sendo recriado. O banco está saudável.

Agora: religar o n8n e checar a versão

docker service scale auton8n_n8n=1
docker service logs auton8n_n8n --since 3m -f 2>&1 | grep -iE "version|ENOTFOUND|Editor is now|task offer|runner|error"
Espere cerca de 1 minuto e saia com Ctrl+C. Procure:

Version: 2.xx.x: me diga qual número aparece.
Editor is now accessible: o n8n subiu.
No matching task offer ... javascript: o problema do runner continua.
Se aparecer o No matching task offer de novo
É quase certo que é a diferença de versão entre o n8n (latest) e o runner (2.21.0). Para igualar:


docker service update --image docker.n8n.io/n8nio/n8n:2.21.0 auton8n_n8n
Depois troque a imagem também no EasyPanel: serviço n8n → imagem docker.n8n.io/n8nio/n8n:2.21.0. Senão o próximo Deploy volta para latest.

Se a versão do log for maior que 2.21.0, voltar para a 2.21.0 pode não funcionar, porque o banco já pode ter sido migrado para a versão nova. Nesse caso, o certo é subir o runner para a mesma versão do n8n. Por isso preciso do número antes.

Enquanto testamos, não clique em Deploy no EasyPanel.



root@srv1909930:~# docker service ps auton8n_n8n
ID             NAME                IMAGE                            NODE         DESIRED STATE   CURRENT STATE             ERROR                       PORTS
jaldi7nwos5e   auton8n_n8n.1       docker.n8n.io/n8nio/n8n:2.21.0   srv1909930   Running         Running 43 seconds ago 
mjice6aik12k    \_ auton8n_n8n.1   docker.n8n.io/n8nio/n8n:latest   srv1909930   Shutdown        Shutdown 39 seconds ago
tbie2xwk7vz8    \_ auton8n_n8n.1   docker.n8n.io/n8nio/n8n:latest   srv1909930   Shutdown        Shutdown 5 minutes ago 
g39z3yvsttjr    \_ auton8n_n8n.1   docker.n8n.io/n8nio/n8n:latest   srv1909930   Shutdown        Failed 7 minutes ago      "task: non-zero exit (1)"
e6kuusv1gbsp    \_ auton8n_n8n.1   docker.n8n.io/n8nio/n8n:latest   srv1909930   Shutdown        Shutdown 10 minutes ago
root@srv1909930:~#
Show more
2:38 PM
O n8n subiu na 2.21.0, a mesma versão do runner, e está rodando há 43 s. Agora confirme que ele está saudável.

1. Conferir o log

docker service logs auton8n_n8n --since 2m 2>&1 | grep -iE "version|Editor is now|task offer|runner|migration|ENOTFOUND|error" | tail -25
O resultado bom tem:

Editor is now accessible;
nenhum No matching task offer ... javascript;
nenhum erro de migration. Se a versão latest anterior era mais nova e já tinha migrado o banco, a 2.21.0 reclamaria aqui.
2. Teste real
Abra https://auton8n-n8n.tplv5d.easypanel.host e veja se os workflows aparecem.
Mande uma mensagem de teste no WhatsApp da Gênesis ou da Núbia, de um número seu.
Nas Executions do CORE, veja se aparece execução com sucesso e se a resposta chega no WhatsApp.
3. Fixar a versão no EasyPanel (importante)
A troca de imagem foi feita só pelo terminal. Se ninguém mudar no painel, o próximo Deploy volta para latest e o problema retorna. No EasyPanel, abra o serviço n8n do projeto auton8n e:

Imagem: docker.n8n.io/n8nio/n8n:2.21.0;
Environment: confira EXECUTIONS_DATA_SAVE_ON_SUCCESS=none e EXECUTIONS_DATA_PRUNE_MAX_COUNT=20000.
Salve. O Deploy só depois que o teste do passo 2 passar.

Faça o mesmo nos projetos extracao e n8n: eles também usam n8n:latest com runner 2.21.0 e vão quebrar do mesmo jeito no próximo Deploy.

4. Depois que estiver estável
Importe a EXT Gênesis por cima de fXGorIlPbyf9Qtsp e o CORE novo por cima de 3N5oN6sxtir9lFrA. O CORE novo tem 3,05 MB (antes eram 5,9 MB) e a recuperação da fila roda a cada 30 s.
Rode docker stats --no-stream e me mande o resultado, para vermos quanto de CPU e memória sobrou.
Se o log do passo 1 mostrar erro, me mande que eu analiso.



docker service logs auton8n_n8n --since 2m 2>&1 | grep -iE "version|Editor is now|task offer|runner|migration|ENOTFOUND|error" | tail -25
auton8n_n8n.1.jaldi7nwos5e@srv1909930    | Error tracking disabled because this release is older than 6 weeks.
auton8n_n8n.1.jaldi7nwos5e@srv1909930    | Registered runner "launcher-javascript" (3ca72ac0a5746200)
auton8n_n8n.1.jaldi7nwos5e@srv1909930    | Registered runner "launcher-python" (f643a786e6f92c61)
auton8n_n8n.1.jaldi7nwos5e@srv1909930    | Recorded version change: 2.44.5 -> 2.21.0
auton8n_n8n.1.jaldi7nwos5e@srv1909930    | No matching task offer for request "Mu7HuogtyJQa3z8dIkaQ9" (type "javascript"). Available offer types: [python]
auton8n_n8n.1.jaldi7nwos5e@srv1909930    | No matching task offer for request "NwQDzdzVb2Gl21kci-f8p" (type "javascript"). Available offer types: [python]
auton8n_n8n.1.jaldi7nwos5e@srv1909930    | No matching task offer for request "09WE5H8wV-Hgz7zXNtiKK" (type "javascript"). Available offer types: [python]
auton8n_n8n.1.jaldi7nwos5e@srv1909930    | No matching task offer for request "WrbLyIDa8iC3vxkLhBUkF" (type "javascript"). Available offer types: [python]
auton8n_n8n.1.jaldi7nwos5e@srv1909930    | No matching task offer for request "YESq0h_dJ16gjG7J-6W3f" (type "javascript"). Available offer types: [python]
auton8n_n8n.1.jaldi7nwos5e@srv1909930    | No matching task offer for request "yoeK5K3wnIRjZvgAQvmji" (type "javascript"). Available offer types: [python]
auton8n_n8n.1.jaldi7nwos5e@srv1909930    | No matching task offer for request "HQRiOx1RCkh6FHOIRh_mI" (type "javascript"). Available offer types: [python]
auton8n_n8n.1.jaldi7nwos5e@srv1909930    | No matching task offer for request "_gzw0HbnkpJTYep0toK76" (type "javascript"). Available offer types: [python]
auton8n_n8n.1.jaldi7nwos5e@srv1909930    | Registered runner "JS Task Runner" (qns8q9SHVjHa_2Fyn769G)
auton8n_n8n.1.jaldi7nwos5e@srv1909930    | Version: 2.21.0
auton8n_n8n.1.jaldi7nwos5e@srv1909930    | Editor is now accessible via:
root@srv1909930:~#
Show more
2:39 PM
O log tem uma boa notícia e um alerta sério.

Boa notícia: o runner de JavaScript conectou (Registered runner "JS Task Runner"). Os 8 erros No matching task offer são do arranque, antes dele registrar. Com n8n e runner na mesma versão, ele funciona. Isso confirma que a diferença de versão era a causa dos erros de JavaScript.

Alerta: Recorded version change: 2.44.5 -> 2.21.0

O n8n estava na 2.44.5, porque o latest puxou essa versão em algum Deploy.
O banco já foi migrado para o formato da 2.44.5.
Agora a 2.21.0 está rodando por cima desse banco mais novo. O n8n não desfaz migrações ao voltar de versão, então podem surgir erros ao salvar ou importar workflows, ou até dados inconsistentes.
A correção certa: subir o runner, não descer o n8n
Deixe os dois na 2.44.5.

Enquanto isso, não importe nem salve nenhum workflow no editor.


# 1. Confirmar que a imagem do runner existe nessa versão
docker pull n8nio/runners:2.44.5

# 2. Se o pull funcionou: runner primeiro, depois o n8n
docker service update --image n8nio/runners:2.44.5 auton8n_n8n-runner
docker service update --image docker.n8n.io/n8nio/n8n:2.44.5 auton8n_n8n

# 3. Conferir
docker service logs auton8n_n8n --since 3m 2>&1 | grep -iE "Version:|Registered runner|task offer|Editor is now|error" | tail -20
O resultado esperado tem Version: 2.44.5, Registered runner "JS Task Runner" e nenhum No matching task offer depois que o runner registrar.

Se o docker pull do passo 1 falhar (tag inexistente), pare e me mande o erro. Não suba o n8n para 2.44.5 sem um runner igual.

Depois: fixar no EasyPanel
Para o próximo Deploy não desfazer nada, no projeto auton8n:

serviço n8n: imagem docker.n8n.io/n8nio/n8n:2.44.5;
serviço n8n-runner: imagem n8nio/runners:2.44.5;
Environment do n8n: EXECUTIONS_DATA_SAVE_ON_SUCCESS=none e EXECUTIONS_DATA_PRUNE_MAX_COUNT=20000.
Daqui para frente, nunca use latest. Para atualizar o n8n, mude as duas imagens juntas para a mesma versão. Os projetos extracao e n8n têm o mesmo risco: n8n em latest com runner em 2.21.0.

Quando o log mostrar a 2.44.5 com o JS Task Runner registrado, mande uma mensagem de teste no WhatsApp. Se responder, aí sim importamos o CORE novo.



root@srv1909930:~# docker service logs auton8n_n8n --since 3m 2>&1 | grep -iE "Version:|Registered runner|task offer|Editor is now|error" | tail -20
auton8n_n8n.1.eov8nqd5ps7t@srv1909930    | Registered runner "launcher-javascript" (1aea98817c0a8a23)
auton8n_n8n.1.eov8nqd5ps7t@srv1909930    | Registered runner "launcher-python" (2f5f5317cd14da40)
auton8n_n8n.1.eov8nqd5ps7t@srv1909930    | Error: Node execution failed
auton8n_n8n.1.eov8nqd5ps7t@srv1909930    |     at DefaultTaskRunnerDisconnectAnalyzer.toDisconnectError (/usr/local/lib/node_modules/n8n/src/task-runners/default-task-runner-disconnect-analyzer.ts:32:10)
auton8n_n8n.1.eov8nqd5ps7t@srv1909930    | No matching task offer for request "kIAV4A2JgEAROqP74iacr" (type "javascript"). Available offer types: [python]
auton8n_n8n.1.eov8nqd5ps7t@srv1909930    | No matching task offer for request "gm74KYc-ew_lJAnIH4H7y" (type "javascript"). Available offer types: [python]
auton8n_n8n.1.eov8nqd5ps7t@srv1909930    | No matching task offer for request "2Q9X3ii5N3yt5ef5dZUxz" (type "javascript"). Available offer types: [python]
auton8n_n8n.1.eov8nqd5ps7t@srv1909930    | No matching task offer for request "jwHodGo-UpVvkQJbRYPK-" (type "javascript"). Available offer types: [python]
auton8n_n8n.1.eov8nqd5ps7t@srv1909930    | No matching task offer for request "_MqhUwjb9DrX0uUDQc1vP" (type "javascript"). Available offer types: [python]
auton8n_n8n.1.eov8nqd5ps7t@srv1909930    | No matching task offer for request "tgEtGEyNgsezOPCM39-wF" (type "javascript"). Available offer types: [python]
auton8n_n8n.1.eov8nqd5ps7t@srv1909930    | Registered runner "JS Task Runner" (vEzW8iZcLuOFGjKh9-vfy)
root@srv1909930:~#
Show more
2:47 PM
Agora o runner certo conecta, mas cai no meio da execução:


Error: Node execution failed
  at DefaultTaskRunnerDisconnectAnalyzer.toDisconnectError
Esse erro aparece quando o runner de JavaScript desconecta enquanto roda um nó Code. Logo depois vêm os No matching task offer (sem runner JS disponível) e, em seguida, Registered runner "JS Task Runner" (ele reinicia). Ou seja, o runner morre e volta em ciclo. A causa mais comum é falta de memória: cada execução do CORE manda ao runner um código de 888 KB e dados grandes, e várias rodam ao mesmo tempo.

1. Confirmar a causa e a versão (me mande a saída)

docker service logs auton8n_n8n --since 5m 2>&1 | grep -A6 "Node execution failed" | head -20
docker service logs auton8n_n8n-runner --since 5m 2>&1 | grep -iE "heap|memory|exit|killed|signal|error" | tail -15
docker service logs auton8n_n8n --since 10m 2>&1 | grep "Version:"
free -h
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" | sort -k3 -h | tail -12
2. Ajuste provável: mais memória e menos tarefas simultâneas no runner
No EasyPanel, serviço n8n-runner do projeto auton8n → Environment, adicione:


N8N_RUNNERS_MAX_CONCURRENCY=2
NODE_OPTIONS=--max-old-space-size=2048
Use 1024 em vez de 2048 se o free -h mostrar menos de ~3 GB livres. Salve e faça Deploy só desse serviço, depois de conferir que a imagem dele está em n8nio/runners:2.44.5.

Esses dois nomes de variável costumam funcionar no runner externo, mas não conferi na documentação desta versão. Se o runner ignorar algum deles, a saída do passo 1 vai mostrar e eu ajusto.

3. A maior redução: importar o CORE novo
Agora que n8n e runner estão na mesma versão, é seguro importar. O CORE novo tem 3,05 MB contra 5,9 MB e a recuperação da fila roda a cada 30 s. Isso reduz bastante a memória de cada tarefa e a quantidade de tarefas.

No editor, abra o workflow NORIA EXT | Gênesis | Política comercial v2 → ⋯ → Import from File → NORIA EXT _ Gênesis _ Política comercial v2 (1).json → Save.
Abra o NORIA CORE | WhatsApp + Comandos + Follow-ups | Motor compartilhado v2 → ⋯ → Import from File → NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json → Save.
Os arquivos estão em Mag.IA/n8n/workflows/. Baixe um backup de cada workflow antes (⋯ → Download).

Me mande a saída do passo 1. Com ela confirmo se é memória e calibro os números.



auton8n_n8n.1.eov8nqd5ps7t@srv1909930    | Registered runner "JS Task Runner" (vEzW8iZcLuOFGjKh9-vfy)
root@srv1909930:~# docker service logs auton8n_n8n --since 5m 2>&1 | grep -A6 "Node execution failed" | head -20
docker service logs auton8n_n8n-runner --since 5m 2>&1 | grep -iE "heap|memory|exit|killed|signal|error" | tail -15
docker service logs auton8n_n8n --since 10m 2>&1 | grep "Version:"
free -h
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" | sort -k3 -h | tail -12
auton8n_n8n.1.eov8nqd5ps7t@srv1909930    | Node execution failed
auton8n_n8n.1.eov8nqd5ps7t@srv1909930    | Error: Node execution failed
auton8n_n8n.1.eov8nqd5ps7t@srv1909930    |     at DefaultTaskRunnerDisconnectAnalyzer.toDisconnectError (/usr/local/lib/node_modules/n8n/src/task-runners/default-task-runner-disconnect-analyzer.ts:32:10)
auton8n_n8n.1.eov8nqd5ps7t@srv1909930    |     at TaskBrokerWsServer.removeConnection (/usr/local/lib/node_modules/n8n/src/task-runners/task-broker/task-broker-ws-server.ts:246:58)
auton8n_n8n.1.eov8nqd5ps7t@srv1909930    |     at WebSocket.<anonymous> (/usr/local/lib/node_modules/n8n/src/task-runners/task-broker/task-broker-ws-server.ts:213:15)
auton8n_n8n.1.eov8nqd5ps7t@srv1909930    |     at WebSocket.wrapper (node:events:639:12)
auton8n_n8n.1.eov8nqd5ps7t@srv1909930    |     at WebSocket.emit (node:events:526:24)
auton8n_n8n.1.eov8nqd5ps7t@srv1909930    |     at WebSocket.emitClose (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/ws@8.21.1_bufferutil@4.0.9_utf-8-validate@5.0.10/node_modules/ws/lib/websocket.js:279:10)
auton8n_n8n-runner.1.y0yn9fne8js2@srv1909930    | 2026/10/21 17:44:04 ERROR [runner:js] (node:14) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
auton8n_n8n-runner.1.y0yn9fne8js2@srv1909930    | 2026/10/21 17:44:04 ERROR [runner:js] (Use `node --trace-warnings ...` to show where the warning was created)
auton8n_n8n-runner.1.y0qe5pbly09i@srv1909930    | 2026/10/21 17:42:43 ERROR [runner:js] Connection to task broker closed unexpectedly, exiting...
auton8n_n8n-runner.1.y0qe5pbly09i@srv1909930    | 2026/10/21 17:42:43 ERROR [launcher:js] Runner process exited with error: exit status 1
auton8n_n8n.1.jaldi7nwos5e@srv1909930    | Version: 2.21.0
auton8n_n8n.1.eov8nqd5ps7t@srv1909930    | Version: 2.44.5
               total        used        free      shared  buff/cache   available
Mem:           3.8Gi       3.0Gi       191Mi       335Mi       1.3Gi       872Mi
Swap:             0B          0B          0B
auton8n_noria-ingress-genesis.1.7wdo62hraa7khqi295xnjv7ww   0.00%     33.88MiB / 3.823GiB
easypanel-traefik.1.vdc5nzaowgrw466mt6i263ymp               0.00%     41.66MiB / 3.823GiB
auton8n_n8n-runner.1.y0yn9fne8js2s7ibftkw9x1fa              16.84%    104.3MiB / 3.823GiB
extracao_evolution-api.1.h7tce6u6rzpep55b3b00ut470          0.00%     115.3MiB / 3.823GiB
n8n_evolution-api.1.z8arjgw5dkecc39eucce84kgw               0.00%     132.2MiB / 3.823GiB
auton8n_evolution-api-db.1.46t1yrh4537qi9l6y8us6x5ty        0.03%     146.4MiB / 3.823GiB
easypanel.1.p7zr90fw0rny8s88tweardanf                       0.79%     150.8MiB / 3.823GiB
auton8n_evolution-api.1.ijsh6f9mvbqxwxqea1y7us5vc           0.00%     169.9MiB / 3.823GiB
auton8n_n8n-db.1.yuqjq9dy8oclq0eyb7z85rw5t                  0.34%     219.9MiB / 3.823GiB
extracao_n8n.1.y97l0ne6v7j1ct9r5tgb9rwrs                    0.22%     281.1MiB / 3.823GiB
n8n_n8n.1.c0fi2zpcn1x3pzsiyuchs1tu2                         0.87%     297.3MiB / 3.823GiB
auton8n_n8n.1.eov8nqd5ps7ticru56q9kue6s                     9.94%     565.8MiB / 3.823GiB
root@srv1909930:~#
Show more
2:48 PM
Os números mudam o diagnóstico. Na verdade, está quase tudo certo agora.

O que os logs mostram
O n8n está na 2.44.5, com o runner registrado na mesma versão.
O runner não morreu por falta de memória. O erro dele às 17:42:43 foi Connection to task broker closed unexpectedly, no exato momento em que o n8n foi reiniciado na troca de versão. O Node execution failed é das execuções que estavam rodando nessa hora.
A partir de 17:44 o runner está de pé. O ExperimentalWarning: localStorage é só um aviso, inofensivo.
A falta de JavaScript vinha da diferença de versão, e isso está resolvido.
O risco que sobra: memória
A VPS tem 3,8 GB no total, só 872 MB disponíveis e nenhum swap. Num pico, o sistema mata processos sem aviso.
Rodam 3 instalações completas de n8n e Evolution. Só os n8n de extracao e n8n ocupam cerca de 580 MB.
Não use o NODE_OPTIONS=--max-old-space-size=2048 que sugeri antes: não há memória para isso.
Próximos passos
1. Confirmar que estabilizou (sem erros novos):


docker service logs auton8n_n8n --since 3m 2>&1 | grep -ciE "task offer|Node execution failed"
O esperado é 0. Depois mande uma mensagem de teste no WhatsApp e veja se a resposta chega.

2. Criar um swap de 4 GB. É rápido, reversível e evita que os processos sejam mortos num pico. Antes, confira o disco:


df -h /
Se houver mais de 10 GB livres:


fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
free -h
A linha Swap: deve mostrar 4.0Gi.

3. Limitar o runner a 2 tarefas por vez. No EasyPanel, serviço n8n-runner → Environment:


N8N_RUNNERS_MAX_CONCURRENCY=2
4. Fixar as versões no EasyPanel antes de qualquer Deploy. Use n8n:2.44.5 e runners:2.44.5. Confira no painel se a imagem do n8n-runner está em n8nio/runners:2.44.5. Se o painel ainda mostrar 2.21.0, o próximo Deploy quebra tudo de novo.

5. Importar o CORE novo e a EXT Gênesis, com backup antes. Isso corta a memória por execução quase pela metade.

6. Depois, decidir: os projetos extracao e n8n precisam rodar nesta VPS? Se precisarem, vale subir o plano na Hostinger. Os planos KVM 2 da Hostinger têm 8 GB.



Depois, decidir: os projetos extracao e n8n precisam rodar nesta VPS? Se precisarem, vale subir o plano na Hostinger. Os planos KVM 2 da Hostinger têm 8 GB.


queria saber o quanto elas estão consumindo pra saber se realmente tem impacto
Show more
2:52 PM
Pela saída que você já mandou, dá para ter uma noção parcial. Ela mostrava só os 12 maiores containers:

Projeto	Containers vistos	Memória
extracao	n8n 281 MB, evolution 115 MB	≈ 396 MB
n8n	n8n 297 MB, evolution 132 MB	≈ 429 MB
Isso já soma ~825 MB, quase o mesmo que os 872 MB que estão livres hoje. Ainda faltam os bancos, runners e redis desses dois projetos, que não apareceram na lista.

Total exato por projeto
Rode na VPS:


docker stats --no-stream --format "{{.Name}} {{.CPUPerc}} {{.MemUsage}}" | awk '
function mb(v){ if (v ~ /GiB/) {sub(/GiB/,"",v); return v*1024} if (v ~ /MiB/) {sub(/MiB/,"",v); return v} if (v ~ /KiB/) {sub(/KiB/,"",v); return v/1024} sub(/B/,"",v); return v/1048576 }
{ split($1,p,"_"); proj=p[1]; if (proj ~ /^easypanel/) proj="easypanel"; cpu=$2; sub(/%/,"",cpu);
  mem[proj]+=mb($3); c[proj]+=cpu; n[proj]++; total+=mb($3) }
END { printf "%-12s %6s %10s %8s\n","PROJETO","CONT.","MEMORIA","CPU"; for (k in mem) printf "%-12s %6d %8.0f MB %7.1f%%\n",k,n[k],mem[k],c[k]; printf "\nTOTAL em uso pelos containers: %.0f MB\n", total }' | sort -k3 -n -r
Isso mostra, para cada projeto (auton8n, extracao, n8n, easypanel), quantos containers ele tem, quanta memória usa e quanto de CPU naquele instante.

CPU ao longo de 1 minuto
A CPU varia muito de um segundo para o outro, então vale tirar algumas amostras:


for i in 1 2 3 4 5 6; do docker stats --no-stream --format "{{.Name}} {{.CPUPerc}}" | awk '{split($1,p,"_"); s=$2; sub(/%/,"",s); c[p[1]]+=s} END {for (k in c) printf "%s=%.1f%%  ", k, c[k]; print ""}'; sleep 10; done
Como interpretar
Se extracao + n8n passarem de ~800 MB (o mais provável), desligá-los praticamente dobra a memória livre da VPS. Nesse caso o impacto é real.
Se a CPU deles ficar perto de 0%, eles não disputam processador com o auton8n. O único problema é a memória.
Se algum tiver CPU alta parada, ele tem gatilhos agendados rodando, como os 10 s da Royal. Aí também compete pelo processador.
Me mande as duas saídas que eu fecho a recomendação: desligar, mover para outra VPS ou subir o plano.



Problem in node ‘CORE | Executar EXT Gênesis‘
Error executing workflow with item at index 0
2:54 PM
Essa mensagem só diz que o subworkflow da EXT Gênesis falhou. A causa real fica dentro da execução da EXT. Preciso do erro de lá.

Onde ver o erro real
No n8n, abra o workflow NORIA EXT | Gênesis | Política comercial v2 → aba Executions.
Clique na execução com erro mais recente, no mesmo horário da do CORE.
Veja qual nó ficou vermelho (Validar identidade e capacidade do tenant ou EXT | Política Gênesis) e copie a mensagem de erro dele.
Se não aparecer nenhuma execução na EXT, a falha foi antes de ela rodar. Nesse caso, copie o texto completo do erro no nó CORE | Executar EXT Gênesis (clique em Details no painel do erro).

Causas prováveis depois do que mudou hoje
Se o erro disser…	Causa	O que fazer
algo como not published, no published version ou workflow is not active	A atualização para a 2.44.5 trouxe o modelo de rascunho e publicação. Se a EXT foi importada e salva sem Publish, ou ficou sem versão publicada, o CORE não consegue chamá-la. Essa é a explicação mais provável.	Na EXT, clique em Publish. Faça o mesmo no CORE se você o importou.
not allowed to be called / caller policy	A EXT só aceita chamadas de workflows do mesmo dono (workflowsFromSameOwner). Se o import foi feito por outro usuário, os donos ficam diferentes.	Na EXT, Settings → "This workflow can be called by" → Any workflow, ou importe com o mesmo usuário dono do CORE.
Node execution failed / task runner	O runner de JavaScript caiu durante a execução.	Me mande a saída de docker service logs auton8n_n8n-runner --since 10m 2>&1 | tail -20.
NORIA_CREDENCIAIS_SUPABASE_AUSENTES	As variáveis SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sumiram do serviço n8n, talvez com o Deploy.	Confira no Environment do n8n no EasyPanel.
NORIA_EXTENSAO_CONTRACT_VERSION_MISMATCH ou outro código NORIA_…	Incompatibilidade entre o CORE e a EXT, por exemplo se só um dos dois foi importado.	Importe os dois arquivos do repositório e publique os dois.
Me diga também se você já importou o CORE e a EXT novos ou se este ainda é o workflow antigo. Com a mensagem exata eu te digo a correção.



modules/ws/lib/websocket.js:1228:20)
    at Receiver.emit (node:events:514:20)
    at finish (node:internal/streams/writable:957:10)
    at node:internal/streams/writable:938:13

Node execution failed
Error: Node execution failed
    at DefaultTaskRunnerDisconnectAnalyzer.toDisconnectError (/usr/local/lib/node_modules/n8n/src/task-runners/default-task-runner-disconnect-analyzer.ts:32:10)
    at TaskBrokerWsServer.removeConnection (/usr/local/lib/node_modules/n8n/src/task-runners/task-broker/task-broker-ws-server.ts:246:58)
    at WebSocket.<anonymous> (/usr/local/lib/node_modules/n8n/src/task-runners/task-broker/task-broker-ws-server.ts:213:15)
    at WebSocket.wrapper (node:events:639:12)
    at WebSocket.emit (node:events:526:24)
    at WebSocket.emitClose (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/ws@8.21.1_bufferutil@4.0.9_utf-8-validate@5.0.10/node_modules/ws/lib/websocket.js:279:10)
    at Receiver.receiverOnFinish (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/ws@8.21.1_bufferutil@4.0.9_utf-8-validate@5.0.10/node_modules/ws/lib/websocket.js:1228:20)
    at Receiver.emit (node:events:514:20)
    at finish (node:internal/streams/writable:957:10)
    at node:internal/streams/writable:938:13

Node execution failed
Error: Node execution failed
    at DefaultTaskRunnerDisconnectAnalyzer.toDisconnectError (/usr/local/lib/node_modules/n8n/src/task-runners/default-task-runner-disconnect-analyzer.ts:32:10)
    at TaskBrokerWsServer.removeConnection (/usr/local/lib/node_modules/n8n/src/task-runners/task-broker/task-broker-ws-server.ts:246:58)
    at WebSocket.<anonymous> (/usr/local/lib/node_modules/n8n/src/task-runners/task-broker/task-broker-ws-server.ts:213:15)
    at WebSocket.wrapper (node:events:639:12)
    at WebSocket.emit (node:events:526:24)
    at WebSocket.emitClose (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/ws@8.21.1_bufferutil@4.0.9_utf-8-validate@5.0.10/node_modules/ws/lib/websocket.js:279:10)
    at Receiver.receiverOnFinish (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/ws@8.21.1_bufferutil@4.0.9_utf-8-validate@5.0.10/node_modules/ws/lib/websocket.js:1228:20)
    at Receiver.emit (node:events:514:20)
    at finish (node:internal/streams/writable:957:10)
    at node:internal/streams/writable:938:13

Node execution failed
Error: Node execution failed
    at DefaultTaskRunnerDisconnectAnalyzer.toDisconnectError (/usr/local/lib/node_modules/n8n/src/task-runners/default-task-runner-disconnect-analyzer.ts:32:10)
    at TaskBrokerWsServer.removeConnection (/usr/local/lib/node_modules/n8n/src/task-runners/task-broker/task-broker-ws-server.ts:246:58)
    at WebSocket.<anonymous> (/usr/local/lib/node_modules/n8n/src/task-runners/task-broker/task-broker-ws-server.ts:213:15)
    at WebSocket.wrapper (node:events:639:12)
    at WebSocket.emit (node:events:526:24)
    at WebSocket.emitClose (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/ws@8.21.1_bufferutil@4.0.9_utf-8-validate@5.0.10/node_modules/ws/lib/websocket.js:279:10)
    at Receiver.receiverOnFinish (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/ws@8.21.1_bufferutil@4.0.9_utf-8-validate@5.0.10/node_modules/ws/lib/websocket.js:1228:20)
    at Receiver.emit (node:events:514:20)
    at finish (node:internal/streams/writable:957:10)
    at node:internal/streams/writable:938:13

Node execution failed
Error: Node execution failed
    at DefaultTaskRunnerDisconnectAnalyzer.toDisconnectError (/usr/local/lib/node_modules/n8n/src/task-runners/default-task-runner-disconnect-analyzer.ts:32:10)
    at TaskBrokerWsServer.removeConnection (/usr/local/lib/node_modules/n8n/src/task-runners/task-broker/task-broker-ws-server.ts:246:58)
    at WebSocket.<anonymous> (/usr/local/lib/node_modules/n8n/src/task-runners/task-broker/task-broker-ws-server.ts:213:15)
    at WebSocket.wrapper (node:events:639:12)
    at WebSocket.emit (node:events:526:24)
    at WebSocket.emitClose (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/ws@8.21.1_bufferutil@4.0.9_utf-8-validate@5.0.10/node_modules/ws/lib/websocket.js:279:10)
    at Receiver.receiverOnFinish (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/ws@8.21.1_bufferutil@4.0.9_utf-8-validate@5.0.10/node_modules/ws/lib/websocket.js:1228:20)
    at Receiver.emit (node:events:514:20)
    at finish (node:internal/streams/writable:957:10)
    at node:internal/streams/writable:938:13

Query runner already released. Cannot run queries anymore.
QueryRunnerAlreadyReleasedError: Query runner already released. Cannot run queries anymore.
    at PostgresQueryRunner.query (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+typeorm@file++++home+runner+_work+n8n+n8n+packages+@n8n+typeorm/node_modules/@n8n/typeorm/dist/driver/postgres/PostgresQueryRunner.js:177:19)
    at InsertQueryBuilder.execute (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+typeorm@file++++home+runner+_work+n8n+n8n+packages+@n8n+typeorm/node_modules/@n8n/typeorm/dist/query-builder/InsertQueryBuilder.js:95:51)
    at processTicksAndRejections (node:internal/process/task_queues:104:5)

Error in handling webhook request POST /webhook/magia-whatsapp: There was a problem executing the workflow
terminating connection due to administrator command
error: terminating connection due to administrator command
    at parseErrorMessage (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/pg-protocol@1.15.0/node_modules/pg-protocol/dist/parser.js:305:11)
    at Parser.handlePacket (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/pg-protocol@1.15.0/node_modules/pg-protocol/dist/parser.js:143:27)
    at Parser.parse (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/pg-protocol@1.15.0/node_modules/pg-protocol/dist/parser.js:37:38)
    at Socket.<anonymous> (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/pg-protocol@1.15.0/node_modules/pg-protocol/dist/index.js:12:42)
    at Socket.emit (node:events:514:20)
    at addChunk (node:internal/streams/readable:576:12)
    at readableAddChunkPushByteMode (node:internal/streams/readable:527:3)
    at Socket.Readable.push (node:internal/streams/readable:407:5)
    at TCP.onStreamRead (node:internal/stream_base_commons:194:23)

Error in handling webhook request POST /webhook/magia-whatsapp: Client has encountered a connection error and is not queryable
Error executing workflow with item at index 0
Query runner already released. Cannot run queries anymore.
QueryRunnerAlreadyReleasedError: Query runner already released. Cannot run queries anymore.
    at PostgresQueryRunner.query (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+typeorm@file++++home+runner+_work+n8n+n8n+packages+@n8n+typeorm/node_modules/@n8n/typeorm/dist/driver/postgres/PostgresQueryRunner.js:177:19)
    at SelectQueryBuilder.loadRawResults (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+typeorm@file++++home+runner+_work+n8n+n8n+packages+@n8n+typeorm/node_modules/@n8n/typeorm/dist/query-builder/SelectQueryBuilder.js:1949:43)
    at SelectQueryBuilder.executeEntitiesAndRawResults (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+typeorm@file++++home+runner+_work+n8n+n8n+packages+@n8n+typeorm/node_modules/@n8n/typeorm/dist/query-builder/SelectQueryBuilder.js:1813:37)
    at SelectQueryBuilder.getRawAndEntities (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+typeorm@file++++home+runner+_work+n8n+n8n+packages+@n8n+typeorm/node_modules/@n8n/typeorm/dist/query-builder/SelectQueryBuilder.js:655:40)
    at SelectQueryBuilder.getOne (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+typeorm@file++++home+runner+_work+n8n+n8n+packages+@n8n+typeorm/node_modules/@n8n/typeorm/dist/query-builder/SelectQueryBuilder.js:682:36)
    at EntityManager.findOneBy (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+typeorm@file++++home+runner+_work+n8n+n8n+packages+@n8n+typeorm/node_modules/@n8n/typeorm/dist/entity-manager/EntityManager.js:579:14)
    at /usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+db@file++++home+runner+_work+n8n+n8n+packages+@n8n+db/node_modules/@n8n/db/src/repositories/execution.repository.ts:541:35
    at EntityManager.transaction (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+typeorm@file++++home+runner+_work+n8n+n8n+packages+@n8n+typeorm/node_modules/@n8n/typeorm/dist/entity-manager/EntityManager.js:70:34)
    at processTicksAndRejections (node:internal/process/task_queues:104:5)
    at ExecutionRepository.setRunning (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+db@file++++home+runner+_work+n8n+n8n+packages+@n8n+db/node_modules/@n8n/db/src/repositories/execution.repository.ts:540:10)

terminating connection due to administrator command
error: terminating connection due to administrator command
    at parseErrorMessage (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/pg-protocol@1.15.0/node_modules/pg-protocol/dist/parser.js:305:11)
    at Parser.handlePacket (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/pg-protocol@1.15.0/node_modules/pg-protocol/dist/parser.js:143:27)
    at Parser.parse (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/pg-protocol@1.15.0/node_modules/pg-protocol/dist/parser.js:37:38)
    at Socket.<anonymous> (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/pg-protocol@1.15.0/node_modules/pg-protocol/dist/index.js:12:42)
    at Socket.emit (node:events:514:20)
    at addChunk (node:internal/streams/readable:576:12)
    at readableAddChunkPushByteMode (node:internal/streams/readable:527:3)
    at Socket.Readable.push (node:internal/streams/readable:407:5)
    at TCP.onStreamRead (node:internal/stream_base_commons:194:23)

terminating connection due to administrator command
error: terminating connection due to administrator command
    at parseErrorMessage (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/pg-protocol@1.15.0/node_modules/pg-protocol/dist/parser.js:305:11)
    at Parser.handlePacket (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/pg-protocol@1.15.0/node_modules/pg-protocol/dist/parser.js:143:27)
    at Parser.parse (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/pg-protocol@1.15.0/node_modules/pg-protocol/dist/parser.js:37:38)
    at Socket.<anonymous> (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/pg-protocol@1.15.0/node_modules/pg-protocol/dist/index.js:12:42)
    at Socket.emit (node:events:514:20)
    at addChunk (node:internal/streams/readable:576:12)
    at readableAddChunkPushByteMode (node:internal/streams/readable:527:3)
    at Socket.Readable.push (node:internal/streams/readable:407:5)
    at TCP.onStreamRead (node:internal/stream_base_commons:194:23)

terminating connection due to administrator command
error: terminating connection due to administrator command
    at parseErrorMessage (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/pg-protocol@1.15.0/node_modules/pg-protocol/dist/parser.js:305:11)
    at Parser.handlePacket (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/pg-protocol@1.15.0/node_modules/pg-protocol/dist/parser.js:143:27)
    at Parser.parse (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/pg-protocol@1.15.0/node_modules/pg-protocol/dist/parser.js:37:38)
    at Socket.<anonymous> (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/pg-protocol@1.15.0/node_modules/pg-protocol/dist/index.js:12:42)
    at Socket.emit (node:events:514:20)
    at addChunk (node:internal/streams/readable:576:12)
    at readableAddChunkPushByteMode (node:internal/streams/readable:527:3)
Last session crashed
Initializing n8n process
Error tracking disabled because this release is older than 6 weeks.
n8n ready on ::, port 5678
n8n Task Broker ready on 0.0.0.0, port 5679
[license SDK] Skipping renewal on init: license cert is not due for renewal
Registered runner "launcher-javascript" (3ca72ac0a5746200) 
Registered runner "launcher-python" (f643a786e6f92c61) 
Instance registered
Discovered 4 cluster checks
Recorded version change: 2.44.5 -> 2.21.0
Currently active workflows:
   - NORIA EXT | Gênesis | Política comercial v2 (ID: fXGorIlPbyf9Qtsp)
   - NORIA CORE | WhatsApp + Comandos + Follow-ups | Motor compartilhado v2 (ID: 3N5oN6sxtir9lFrA)
[Recovery] Logs available, amended execution
No matching task offer for request "Mu7HuogtyJQa3z8dIkaQ9" (type "javascript"). Available offer types: [python]
No matching task offer for request "NwQDzdzVb2Gl21kci-f8p" (type "javascript"). Available offer types: [python]
No matching task offer for request "09WE5H8wV-Hgz7zXNtiKK" (type "javascript"). Available offer types: [python]
No matching task offer for request "WrbLyIDa8iC3vxkLhBUkF" (type "javascript"). Available offer types: [python]
[Recovery] Logs available, amended execution
No matching task offer for request "YESq0h_dJ16gjG7J-6W3f" (type "javascript"). Available offer types: [python]
No matching task offer for request "yoeK5K3wnIRjZvgAQvmji" (type "javascript"). Available offer types: [python]
[Recovery] Logs available, amended execution
Marked executions as `crashed`
[Recovery] Logs available, amended execution
No matching task offer for request "HQRiOx1RCkh6FHOIRh_mI" (type "javascript"). Available offer types: [python]
No matching task offer for request "_gzw0HbnkpJTYep0toK76" (type "javascript"). Available offer types: [python]
Marked executions as `crashed`
[Recovery] Logs available, amended execution
Registered runner "JS Task Runner" (qns8q9SHVjHa_2Fyn769G) 
Marked executions as `crashed`
[Recovery] Logs available, amended execution
Marked executions as `crashed`
[Recovery] Logs available, amended execution
Marked executions as `crashed`
[Recovery] Logs available, amended execution
Marked executions as `crashed`
[Recovery] Logs available, amended execution
Marked executions as `crashed`
[Recovery] Logs available, amended execution
Marked executions as `crashed`
[Recovery] Logs available, amended execution
(node:7) MaxListenersExceededWarning: Possible EventEmitter memory leak detected. 11 editorUiConnected listeners added to [Push]. MaxListeners is 10. Use emitter.setMaxListeners() to increase limit
(Use `node --trace-warnings ...` to show where the warning was created)
Marked executions as `crashed`
[Recovery] Logs available, amended execution
Marked executions as `crashed`
[Recovery] Logs available, amended execution
Marked executions as `crashed`
[Recovery] Logs available, amended execution
Marked executions as `crashed`
[Recovery] Logs available, amended execution
Marked executions as `crashed`
[Recovery] Logs available, amended execution
Marked executions as `crashed`
[Recovery] Logs available, amended execution
Marked executions as `crashed`
[Recovery] Logs available, amended execution
Marked executions as `crashed`
[Recovery] Logs available, amended execution
Marked executions as `crashed`
[Recovery] Logs available, amended execution
Marked executions as `crashed`
[Recovery] Logs available, amended execution
Marked executions as `crashed`
[Recovery] Logs available, amended execution
Found unfinished executions: 432917, 432931, 432944, 432856, 432879, 432878, 432916, 432933, 432934, 432937, 432941, 432915, 432939, 432940, 432899, 432932, 432945, 432943, 432942, 432911, 432910, 432900
This could be due to a crash of an active workflow or a restart of n8n
Version: 2.21.0
Building workflow dependency index...
Finished building workflow dependency index. Processed 0 draft workflows, 0 published workflows.
Start Active Workflows:
Execution is already being resumed by another process
Activated workflow "NORIA EXT | Gênesis | Política comercial v2" (ID: fXGorIlPbyf9Qtsp)
Activated workflow "NORIA CORE | WhatsApp + Comandos + Follow-ups | Motor compartilhado v2" (ID: 3N5oN6sxtir9lFrA)

Editor is now accessible via:
https://auton8n-n8n.tplv5d.easypanel.host
No matching task offer for request "YeqsBRZH_Kjgji7sOlDZi" (type "javascript"). Available offer types: [python]
No matching task offer for request "cl5A3DinmRHYhSOZfe3t8" (type "javascript"). Available offer types: [python]
No matching task offer for request "U9q04hSXOYIttFcTFaJ57" (type "javascript"). Available offer types: [python]
No matching task offer for request "kGZ9nufr5u7vUXdUOehK1" (type "javascript"). Available offer types: [python]
No matching task offer for request "JhnWZtWM7fUB0v9S9CxcZ" (type "javascript"). Available offer types: [python]
(node:7) [DEP0060] DeprecationWarning: The `util._extend` API is deprecated. Please use Object.assign() instead.
Received SIGTERM. Shutting down...
Deregistered all crons for workflow

Stopping n8n...
Task request timed out
Error: Task request timed out
    at ErrorReporter.wrap (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/n8n-core@file+packages+core_@opentelemetry+api@1.9.0_@opentelemetry+exporter-trace-otlp_2c2e1f47b69b34bef6f634a13cbf61d9/node_modules/n8n-core/src/errors/error-reporter.ts:310:37)
    at ErrorReporter.error (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/n8n-core@file+packages+core_@opentelemetry+api@1.9.0_@opentelemetry+exporter-trace-otlp_2c2e1f47b69b34bef6f634a13cbf61d9/node_modules/n8n-core/src/errors/error-reporter.ts:296:25)
    at LocalTaskRequester.requestExpired (/usr/local/lib/node_modules/n8n/src/task-runners/task-managers/task-requester.ts:309:22)
    at LocalTaskRequester.onMessage (/usr/local/lib/node_modules/n8n/src/task-runners/task-managers/task-requester.ts:272:10)
    at TaskBroker.taskRequested (/usr/local/lib/node_modules/n8n/src/task-runners/task-broker/task-broker.service.ts:684:51)
    at TaskBroker.onRequesterMessage (/usr/local/lib/node_modules/n8n/src/task-runners/task-broker/task-broker.service.ts:336:10)
    at LocalTaskRequester.sendMessage (/usr/local/lib/node_modules/n8n/src/task-runners/task-managers/local-task-requester.ts:40:24)
    at LocalTaskRequester.startTask (/usr/local/lib/node_modules/n8n/src/task-runners/task-managers/task-requester.ts:142:8)
    at Object.startRunnerTask (/usr/local/lib/node_modules/n8n/src/workflow-execute-additional-data.ts:597:46)
    at ExecuteContext.startJob (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/n8n-core@file+packages+core_@opentelemetry+api@1.9.0_@opentelemetry+exporter-trace-otlp_2c2e1f47b69b34bef6f634a13cbf61d9/node_modules/n8n-core/src/execution-engine/node-execution-context/base-execute-context.ts:273:36)

Task request timed out after 60 seconds
error Error: Cannot use a pool after calling end on the pool
    at BoundPool.connect (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/pg-pool@3.11.0_pg@8.17.0/node_modules/pg-pool/index.js:184:19)
    at PostgresDriver.obtainMasterConnection (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+typeorm@0.3.20-16_@sentry+node@10.36.0_pg@8.17.0_sqlite3@5.1.7/node_modules/src/driver/postgres/PostgresDriver.ts:1182:46)
    at PostgresQueryRunner.connect (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+typeorm@0.3.20-16_@sentry+node@10.36.0_pg@8.17.0_sqlite3@5.1.7/node_modules/src/driver/postgres/PostgresQueryRunner.ts:111:18)
    at PostgresQueryRunner.query (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+typeorm@0.3.20-16_@sentry+node@10.36.0_pg@8.17.0_sqlite3@5.1.7/node_modules/src/driver/postgres/PostgresQueryRunner.ts:248:47)
    at DataSource.query (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+typeorm@0.3.20-16_@sentry+node@10.36.0_pg@8.17.0_sqlite3@5.1.7/node_modules/src/data-source/DataSource.ts:487:42)
    at EntityManager.query (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+typeorm@0.3.20-16_@sentry+node@10.36.0_pg@8.17.0_sqlite3@5.1.7/node_modules/src/entity-manager/EntityManager.ts:172:32)
    at WorkflowStatisticsRepository.query (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+typeorm@0.3.20-16_@sentry+node@10.36.0_pg@8.17.0_sqlite3@5.1.7/node_modules/src/repository/Repository.ts:638:29)
    at WorkflowStatisticsRepository.upsertWorkflowStatistics (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+db@file+packages+@n8n+db_@opentelemetry+api@1.9.0_@opentelemetry+exporter-trace-ot_53c95b5a67c4fdcdafd345fdd3687cef/node_modules/@n8n/db/src/repositories/workflow-statistics.repository.ts:96:37)
    at WorkflowStatisticsService.workflowExecutionCompleted (/usr/local/lib/node_modules/n8n/src/services/workflow-statistics.service.ts:131:47)
    at WorkflowStatisticsService.<anonymous> (/usr/local/lib/node_modules/n8n/src/services/workflow-statistics.service.ts:96:16)
There was a problem running hook "workflowExecuteAfter" Error: Cannot use a pool after calling end on the pool
    at BoundPool.connect (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/pg-pool@3.11.0_pg@8.17.0/node_modules/pg-pool/index.js:184:19)
    at PostgresDriver.obtainMasterConnection (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+typeorm@0.3.20-16_@sentry+node@10.36.0_pg@8.17.0_sqlite3@5.1.7/node_modules/src/driver/postgres/PostgresDriver.ts:1182:46)
    at PostgresQueryRunner.connect (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+typeorm@0.3.20-16_@sentry+node@10.36.0_pg@8.17.0_sqlite3@5.1.7/node_modules/src/driver/postgres/PostgresQueryRunner.ts:111:18)
    at PostgresQueryRunner.query (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+typeorm@0.3.20-16_@sentry+node@10.36.0_pg@8.17.0_sqlite3@5.1.7/node_modules/src/driver/postgres/PostgresQueryRunner.ts:248:47)
    at PostgresQueryRunner.startTransaction (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+typeorm@0.3.20-16_@sentry+node@10.36.0_pg@8.17.0_sqlite3@5.1.7/node_modules/src/driver/postgres/PostgresQueryRunner.ts:178:24)
    at processTicksAndRejections (node:internal/process/task_queues:104:5)
    at EntityManager.transaction (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+typeorm@0.3.20-16_@sentry+node@10.36.0_pg@8.17.0_sqlite3@5.1.7/node_modules/src/entity-manager/EntityManager.ts:151:13)
    at ExecutionRepository.updateExistingExecution (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+db@file+packages+@n8n+db_@opentelemetry+api@1.9.0_@opentelemetry+exporter-trace-ot_53c95b5a67c4fdcdafd345fdd3687cef/node_modules/@n8n/db/src/repositories/execution.repository.ts:428:10)
    at updateExistingExecution (/usr/local/lib/node_modules/n8n/src/execution-lifecycle/shared/shared-hook-functions.ts:107:2)
    at ExecutionLifecycleHooks.<anonymous> (/usr/local/lib/node_modules/n8n/src/execution-lifecycle/execution-lifecycle-hooks.ts:598:4)
error Error: Cannot use a pool after calling end on the pool
    at BoundPool.connect (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/pg-pool@3.11.0_pg@8.17.0/node_modules/pg-pool/index.js:184:19)
    at PostgresDriver.obtainMasterConnection (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+typeorm@0.3.20-16_@sentry+node@10.36.0_pg@8.17.0_sqlite3@5.1.7/node_modules/src/driver/postgres/PostgresDriver.ts:1182:46)
    at PostgresQueryRunner.connect (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+typeorm@0.3.20-16_@sentry+node@10.36.0_pg@8.17.0_sqlite3@5.1.7/node_modules/src/driver/postgres/PostgresQueryRunner.ts:111:18)
    at PostgresQueryRunner.query (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+typeorm@0.3.20-16_@sentry+node@10.36.0_pg@8.17.0_sqlite3@5.1.7/node_modules/src/driver/postgres/PostgresQueryRunner.ts:248:47)
    at DataSource.query (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+typeorm@0.3.20-16_@sentry+node@10.36.0_pg@8.17.0_sqlite3@5.1.7/node_modules/src/data-source/DataSource.ts:487:42)
    at EntityManager.query (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+typeorm@0.3.20-16_@sentry+node@10.36.0_pg@8.17.0_sqlite3@5.1.7/node_modules/src/entity-manager/EntityManager.ts:172:32)
    at WorkflowStatisticsRepository.query (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+typeorm@0.3.20-16_@sentry+node@10.36.0_pg@8.17.0_sqlite3@5.1.7/node_modules/src/repository/Repository.ts:638:29)
    at WorkflowStatisticsRepository.upsertWorkflowStatistics (/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+db@file+packages+@n8n+db_@opentelemetry+api@1.9.0_@opentelemetry+exporter-trace-ot_53c95b5a67c4fdcdafd345fdd3687cef/node_modules/@n8n/db/src/repositories/workflow-statistics.repository.ts:96:37)
    at WorkflowStatisticsService.workflowExecutionCompleted (/usr/local/lib/node_modules/n8n/src/services/workflow-statistics.service.ts:131:47)
    at WorkflowStatisticsService.<anonymous> (/usr/local/lib/node_modules/n8n/src/services/workflow-statistics.service.ts:96:16)

No matching task offer for request "mI9UlqOsY7WXvpjUcbdUX" (type "javascript"). Available offer types: [python]
No matching task offer for request "LXW5G96Iz9sFciTU4TatH" (type "javascript"). Available offer types: [python]
No matching task offer for request "fcZNtPmpU1UKEyvoUYGiA" (type "javascript"). Available offer types: [python]
No matching task offer for request "sVcD5z7C33rwOLT4HP-5x" (type "javascript"). Available offer types: [python]
Skipped a system task occurrence, its previous run is still going
No matching task offer for request "zbFrz_9ZC4RlsZtiVTACb" (type "javascript"). Available offer types: [python]
No matching task offer for request "XfbxiMXNwBKxcxaJYH8MJ" (type "javascript"). Available offer types: [python
Show more
3:06 PM
Esse log é o histórico das reinicializações de hoje, não o estado atual. Dá para ver a sequência:

Trecho do log	O que foi
terminating connection due to administrator command, Query runner already released	O banco sendo parado ou recriado (os Deploys)
Last session crashed, Found unfinished executions …	O n8n caindo, com execuções em andamento interrompidas
Recorded version change: 2.44.5 -> 2.21.0	A troca de versão para a 2.21.0
Received SIGTERM, Cannot use a pool after calling end	O desligamento para subir a 2.44.5
No matching task offer … logo após cada início	Mensagens que chegaram antes do runner de JavaScript terminar de conectar
Marked executions as crashed	Execuções interrompidas nas quedas
O erro "Problem in node 'CORE | Executar EXT Gênesis'" que você viu é, com grande chance, de uma dessas execuções interrompidas.

Conferir se ainda acontece agora
1. Erros nos últimos 5 minutos:


docker service logs auton8n_n8n --since 5m 2>&1 | grep -ciE "task offer|Node execution failed|timed out|crashed"
0 significa estável.

2. Horário da execução com erro: no editor, veja a hora dela na lista de Executions. Se for antes de ~14:45 (horário de Brasília), é do período das reinicializações e pode ser ignorada.

3. Teste real: mande agora uma mensagem no WhatsApp da Gênesis e veja se a resposta chega e se a execução nova fica verde.

Se o passo 1 der mais que 0, ou se a execução nova falhar, mande só as últimas 30 linhas:


docker service logs auton8n_n8n --since 5m 2>&1 | tail -30
Conversas afetadas pelas quedas
As execuções marcadas como crashed interromperam turnos de clientes. Pelo desenho do CORE:

turnos que caíram antes do envio voltam para a fila e são tentados de novo;
turnos que caíram durante o envio ficam como uncertain. Esses nunca são reenviados sozinhos, para não duplicar mensagem ao cliente;
turnos com erro sem classificação ficam como review.
Quer que eu consulte o Supabase, só leitura, e liste os turnos da Gênesis e da Núbia que ficaram em uncertain ou review hoje? Assim alguém responde manualmente quem ficou sem resposta.



mas o n8n não está iniciando para eu mexer nos workflows. O que faço?
3:07 PM
Primeiro preciso ver por que ele não sobe agora. Rode na VPS e me mande a saída:


docker service ps auton8n_n8n --no-trunc | head -5
docker service logs auton8n_n8n --since 5m 2>&1 | grep -vE "^\s+at " | tail -40
free -h
A coluna ERROR do service ps diz como ele caiu. exit (137) é falta de memória, exit (1) é erro na inicialização.
O log, sem as linhas de pilha (at …), mostra a última coisa que ele fez antes de cair.
Enquanto isso: dois passos seguros que ajudam em qualquer caso
1. Criar swap. Hoje são 3,8 GB de RAM e zero swap. Confira o disco com df -h /; se houver mais de 10 GB livres:


fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
free -h
2. Liberar memória parando o que não for essencial agora. Faça isso só se extracao e n8n não estiverem atendendo clientes neste momento:


docker service scale extracao_n8n=0 n8n_n8n=0
Para voltar depois: docker service scale extracao_n8n=1 n8n_n8n=1.

Se ele cair por sobrecarga logo ao iniciar
Ao subir, o n8n faz várias coisas de uma vez:

retoma as cerca de 22 execuções interrompidas;
ativa o gatilho de 10 s;
recebe de uma vez as mensagens do WhatsApp que ficaram acumuladas.
Se esse pico o derruba, há uma saída: subir o n8n com o CORE desativado direto no banco. O editor abre sem carga, você importa o CORE novo (mais leve, recuperação a cada 30 s) e reativa. Para isso preciso confirmar os nomes das colunas nesta versão. Rode:


docker exec -it $(docker ps -q -f name=auton8n_n8n-db.1 | head -1) psql -U postgres -d auton8n -c \
"select id, name, active, \"activeVersionId\" from workflow_entity where active or \"activeVersionId\" is not null;"
Se der erro de banco inexistente, troque -d auton8n pelo valor de DB_POSTGRESDB_DATABASE.

Não altere nada no banco ainda: me mande essa saída junto com as do topo. Com ela te passo o comando exato para desativar e, depois, para reativar, com os valores originais guardados.



root@srv1909930:~# docker service ps auton8n_n8n --no-trunc | head -5
docker service logs auton8n_n8n --since 5m 2>&1 | grep -vE "^\s+at " | tail -40
free -h
ID                          NAME                IMAGE                            NODE         DESIRED STATE   CURRENT STATE             ERROR     PORTS
4srcev0466uh0zdp4a8f0bjzq   auton8n_n8n.1       docker.n8n.io/n8nio/n8n:2.44.5   srv1909930   Running         Running 13 minutes ago
jaldi7nwos5e21jmnk928kc0d    \_ auton8n_n8n.1   docker.n8n.io/n8nio/n8n:2.21.0   srv1909930   Shutdown        Shutdown 27 minutes ago
mjice6aik12k0s3bp5i1b5kbc    \_ auton8n_n8n.1   docker.n8n.io/n8nio/n8n:latest   srv1909930   Shutdown        Shutdown 32 minutes ago
tbie2xwk7vz86koemu16ghmzu    \_ auton8n_n8n.1   docker.n8n.io/n8nio/n8n:latest   srv1909930   Shutdown        Shutdown 37 minutes ago
auton8n_n8n.1.4srcev0466uh@srv1909930    | Error in handling webhook request POST /webhook/magia-whatsapp: Request body stream was aborted or is not readable
auton8n_n8n.1.4srcev0466uh@srv1909930    | Skipped a system task occurrence, its previous run is still going
auton8n_n8n.1.4srcev0466uh@srv1909930    | Runner (WV0sbqdyoEEJ8BlJ79CZO) took too long to acknowledge acceptance of task (p4X0h9Qf)
auton8n_n8n.1.4srcev0466uh@srv1909930    | No matching task offer for request "2zYHlREbBTye3qHYlEv3T" (type "javascript"). Available offer types: [python]
auton8n_n8n.1.4srcev0466uh@srv1909930    | Runner (WV0sbqdyoEEJ8BlJ79CZO) took too long to acknowledge acceptance of task (MBilFsCw)
auton8n_n8n.1.4srcev0466uh@srv1909930    | No matching task offer for request "UE-z85vBvfaSO1fwyg2-y" (type "javascript"). Available offer types: [python]
auton8n_n8n.1.4srcev0466uh@srv1909930    | Runner (WV0sbqdyoEEJ8BlJ79CZO) took too long to acknowledge acceptance of task (uS4izQiE)
auton8n_n8n.1.4srcev0466uh@srv1909930    | No matching task offer for request "GdmaZ55SnsS-1mUEVUAvO" (type "javascript"). Available offer types: [python]
auton8n_n8n.1.4srcev0466uh@srv1909930    | No matching task offer for request "aHAZwiO1vhjbndorG8_lT" (type "javascript"). Available offer types: [python]
auton8n_n8n.1.4srcev0466uh@srv1909930    | No matching task offer for request "3BChJC_rlB8rhj7ezGY8D" (type "javascript"). Available offer types: [python]
auton8n_n8n.1.4srcev0466uh@srv1909930    | No matching task offer for request "VeWg2I0yf8Qt5uKE7gHrU" (type "javascript"). Available offer types: [python]
auton8n_n8n.1.4srcev0466uh@srv1909930    | Skipped a system task occurrence, its previous run is still going
auton8n_n8n.1.4srcev0466uh@srv1909930    | No matching task offer for request "HCfICb_tveyzllt-k6bx2" (type "javascript"). Available offer types: [python]
auton8n_n8n.1.4srcev0466uh@srv1909930    | No matching task offer for request "EOpuTEv5nChy27HE85MEW" (type "javascript"). Available offer types: [python]
auton8n_n8n.1.4srcev0466uh@srv1909930    | No matching task offer for request "HizLvFUbX3L8RdY84Odsl" (type "javascript"). Available offer types: [python]
auton8n_n8n.1.4srcev0466uh@srv1909930    | No matching task offer for request "1PQW9mphfSWBRTvRz1nSC" (type "javascript"). Available offer types: [python]
auton8n_n8n.1.4srcev0466uh@srv1909930    | Skipped a system task occurrence, its previous run is still going
auton8n_n8n.1.4srcev0466uh@srv1909930    | Task (mxX3fJ4a) rejected by Runner with reason "Offer expired - not accepted within validity window"
auton8n_n8n.1.4srcev0466uh@srv1909930    | Slow database query
auton8n_n8n.1.4srcev0466uh@srv1909930    | Slow database query
auton8n_n8n.1.4srcev0466uh@srv1909930    | Task execution timed out after 60 seconds
auton8n_n8n.1.4srcev0466uh@srv1909930    | Task execution timed out after 60 seconds
auton8n_n8n.1.4srcev0466uh@srv1909930    | Error: Task execution timed out after 60 seconds
auton8n_n8n.1.4srcev0466uh@srv1909930    |     at AbortSignal.abortHandler (/opt/runners/task-runner-javascript/dist/js-task-runner/js-task-runner.js:251:32)
auton8n_n8n.1.4srcev0466uh@srv1909930    |     at [nodejs.internal.kHybridDispatch] (node:internal/event_target:872:20)
auton8n_n8n.1.4srcev0466uh@srv1909930    |     at AbortSignal.dispatchEvent (node:internal/event_target:813:26)
auton8n_n8n.1.4srcev0466uh@srv1909930    |     at runAbort (node:internal/abort_controller:561:10)
auton8n_n8n.1.4srcev0466uh@srv1909930    |     at abortSignal (node:internal/abort_controller:525:3)
auton8n_n8n.1.4srcev0466uh@srv1909930    |     at AbortController.abort (node:internal/abort_controller:580:5)
auton8n_n8n.1.4srcev0466uh@srv1909930    |     at Object.running (/opt/runners/task-runner-javascript/dist/task-runner.js:266:43)
auton8n_n8n.1.4srcev0466uh@srv1909930    |     at TaskState.caseOf (/opt/runners/task-runner-javascript/dist/task-state.js:56:45)
auton8n_n8n.1.4srcev0466uh@srv1909930    |     at JsTaskRunner.taskTimedOut (/opt/runners/task-runner-javascript/dist/task-runner.js:250:25)
auton8n_n8n.1.4srcev0466uh@srv1909930    |     at Timeout.onTimeout [as _onTimeout] (/opt/runners/task-runner-javascript/dist/task-runner.js:220:27)
auton8n_n8n.1.4srcev0466uh@srv1909930    |
auton8n_n8n.1.4srcev0466uh@srv1909930    | Registered runner "launcher-javascript" (5a1fe39b0ee0e824)
auton8n_n8n.1.4srcev0466uh@srv1909930    | No matching task offer for request "AvZaAoTCsnxwRB5BgPa6L" (type "javascript"). Available offer types: [python]
auton8n_n8n.1.4srcev0466uh@srv1909930    | No matching task offer for request "QpUYYwSBvAJaIh-IIUUsO" (type "javascript"). Available offer types: [python]
auton8n_n8n.1.4srcev0466uh@srv1909930    | No matching task offer for request "Q3GwbMjyBF8fr0fuwBFCi" (type "javascript"). Available offer types: [python]
auton8n_n8n.1.4srcev0466uh@srv1909930    | No matching task offer for request "jbbS9qmP0gCdOa9NqMpr5" (type "javascript"). Available offer types: [python]
auton8n_n8n.1.4srcev0466uh@srv1909930    | Registered runner "JS Task Runner" (d1JoGjIg1xWM548oXJzwZ)
               total        used        free      shared  buff/cache   available
Mem:           3.8Gi       2.4Gi       164Mi       271Mi       1.8Gi       1.4Gi
Swap:          4.0Gi       1.2Gi       2.8Gi
root@srv1909930:~#
Show more
3:11 PM
O n8n está rodando há 13 minutos, na 2.44.5, e o swap foi criado (1,2 GB já em uso). O que acontece é que ele está afogado de trabalho. Por isso o editor não abre.

O que o log mostra
Task execution timed out after 60 seconds: nós Code levando mais de 60 s. O runner é encerrado por tempo e reinicia; é por isso que voltam os No matching task offer.
took too long to acknowledge e Offer expired: o runner está tão ocupado que nem aceita tarefas novas.
Skipped a system task occurrence, its previous run is still going: o gatilho de 10 s dispara antes de a rodada anterior acabar.
Slow database query, e 1,2 GB já no swap, que é bem mais lento que a RAM.
Em resumo: a fila de mensagens acumulou durante as quedas, e o CORE pesado (5,9 MB) tenta processar tudo de uma vez.

Saída: desligar o CORE por alguns minutos, abrir o editor e importar o CORE leve
Enquanto o CORE estiver desligado, a IA não responde no WhatsApp. Faça isso rápido.

1. Desativar o CORE pela linha de comando do n8n, sem mexer no banco:


C=$(docker ps -q -f name=auton8n_n8n.1 | head -1)
docker exec -u node $C n8n unpublish:workflow --id=3N5oN6sxtir9lFrA
Se responder que o comando não existe, use a forma antiga:


docker exec -u node $C n8n update:workflow --id=3N5oN6sxtir9lFrA --active=false
2. Reiniciar o n8n, para que a desativação valha:


docker service update --force auton8n_n8n
docker service logs auton8n_n8n --since 2m -f 2>&1 | grep -iE "Editor is now|Activated workflow|error"
O log não deve mostrar Activated workflow "NORIA CORE...". Quando aparecer Editor is now accessible, saia com Ctrl+C e abra o editor.

3. No editor, sem carga:

Baixe um backup do CORE e da EXT Gênesis (⋯ → Download).
Na EXT Gênesis: ⋯ → Import from File → NORIA EXT _ Gênesis _ Política comercial v2 (1).json → Save → Publish.
No CORE: ⋯ → Import from File → NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json → Save.
Ainda não publique o CORE. Antes, veja o passo 4.
4. Antes de religar o CORE, olhar a fila acumulada. Quando ele voltar, a recuperação vai processar as mensagens que ficaram paradas durante as quedas, e alguns clientes podem receber respostas com horas de atraso. Posso consultar agora no Supabase, só leitura, quantas mensagens estão pendentes na fila e há quanto tempo, por cliente (Gênesis e Núbia). Aí decidimos se religamos direto ou se alguém responde manualmente as mais antigas antes.

