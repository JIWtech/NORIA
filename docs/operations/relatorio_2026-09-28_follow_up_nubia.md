# Relatório de alterações — 28/09/2026

> Registro histórico. Os nomes de workflows e comandos de publicação desta fase foram substituídos. Consulte o [índice atual](../INDEX.md) para localizar os exports do NORIA.

## Objetivo do dia

Preparar o follow-up automático do WhatsApp para conversar somente com pessoas
que ainda não possuem agendamento, usando o prompt e os dados do tenant. Criar
uma visualização operacional desses follow-ups no Kanban da Clínica da Núbia.

## Diagnóstico realizado

- O atendimento WhatsApp usa um único workflow compartilhado. O tenant é
  identificado pelo canal/instância e o prompt é carregado de
  `tenant_settings.settings.system_prompt`.
- A Evolution ainda depende das variáveis de ambiente por tenant. A automação
  do cadastro de novos clientes e credenciais foi deixada para a próxima etapa.
- Foi identificado que o caso de agendamento que caiu em atendimento humano
  não criou registro porque o fluxo não possuía todos os dados necessários para
  registrar a reserva. A melhoria do prompt de agendamento foi separada do
  follow-up para não misturar entregas.
- Também foi identificado que a referência ao salão do Rio vinha das
  configurações do tenant da Núbia. A correção desse conteúdo no banco ficou
  pendente de aplicação no Supabase.

## Follow-up implementado

### Banco de dados

Foram criadas as migrations abaixo:

1. `019_follow_up_jobs.sql`
   - Cria `follow_up_policies` e `follow_up_jobs`.
   - Define a sequência padrão de `3h`, `24h` e `15d`.
   - Mantém cada política desativada por padrão.
   - Impede duplicidade por conversa, mensagem de origem e etapa.
   - Cancela jobs pendentes se a cliente responder, se houver handoff humano ou
     se a conversa for encerrada.
   - Usa uma lease de cinco minutos para evitar envio duplicado quando houver
     duas execuções do n8n.

2. `020_nubia_follow_up_kanban.sql`
   - Cria a coluna `Follow Ups` apenas no board da
     `clinica_nubia_oficial`.
   - Libera somente a leitura necessária dos jobs para o painel da Núbia.

3. `021_follow_up_cancel_on_appointment.sql`
   - Impede a criação de follow-up para conversa com agendamento ou
     pré-agendamento futuro.
   - Cancela imediatamente os jobs pendentes quando um agendamento é criado ou
     atualizado.

### Workflow principal do WhatsApp

O nó `Processar Conversa WhatsApp` passou a criar os jobs após gravar uma
resposta elegível da IA.

Ele não cria follow-up para:

- atendimento humano;
- conversa encerrada;
- pagamento de sinal;
- agendamento ou pré-agendamento.

Quando a cliente responde ao follow-up de 3h, os jobs de 1 dia e 15 dias da
sequência anterior são cancelados. Se ela ainda não agendar, a IA continua o
atendimento e cria uma nova sequência a partir da última resposta.

### Envio de follow-ups

- Executa a cada minuto.
- Busca jobs vencidos e reserva cada job antes do processamento.
- Carrega o `system_prompt`, o modelo do tenant e o histórico recente da
  conversa.
- Gera uma mensagem curta e contextual com Gemini.
- Consulta novamente a conversa e os agendamentos imediatamente antes de
  enviar.
- Registra o envio em `channel_events` com a etapa correspondente.

O workflow utiliza a configuração Evolution já existente para cada tenant.

## Painel da Clínica da Núbia

O painel passou a ler os jobs pendentes e em processamento exclusivamente para
`clinica_nubia_oficial`.

- A coluna `Follow Ups` mostra um card por conversa.
- O card exibe a próxima etapa: `3h`, `1 dia` ou `15 dias`.
- Quando o job está sendo processado, mostra `Em execução`.
- Cards da coluna são apenas para acompanhamento e não podem ser arrastados.
- Ao haver resposta, handoff, encerramento ou agendamento, o card deixa de
  aparecer assim que o job é cancelado.

## Arquivos principais alterados

- `app/src/dataService.js`
- `app/src/main.jsx`
- `app/src/styles.css`
- `n8n/code/whatsapp_core_overrides.js`
- `n8n/code/whatsapp_conversation_core.generated.js`
- `n8n/code/whatsapp_follow_up_dispatch.js`
- `supabase/migrations/019_follow_up_jobs.sql`
- `supabase/migrations/020_nubia_follow_up_kanban.sql`
- `supabase/migrations/021_follow_up_cancel_on_appointment.sql`
- `docs/operations/whatsapp_follow_up.md`

## GitHub

As alterações foram enviadas para a branch `dev`:

- `083a8a8` — `add whatsapp follow-up workflow and nubia kanban`
- `a2b41fb` — `cancel follow-ups after appointment booking`

Os commits estão com autor `IzzeiWTB <wesleyteles.bastos@gmail.com>`.

## Validações realizadas

- JSON dos workflows validado.
- Código do nó `Processar Follow-ups` validado contra o arquivo fonte.
- `git diff --check` executado sem erros de whitespace.
- Branch local e `origin/dev` sincronizadas no momento do envio.

Não foram executadas migrations nem testes reais de envio em produção.

## Referência de operação

Consulte o [guia de follow-ups do NORIA](whatsapp_follow_up.md).
