# I&C Salon: pendências

Atualizado em 05/11/2026. Fonte: `questionario-ic-salon-cesar-medeiros-2026-11-03.json`, revisado pelo Cesar.
Tenant `ic_salon` · instância Evolution `ic_saloon` · número `5521994037748`.

## 1. Valores de serviços que faltam

O questionário **não traz o valor** destes 13 serviços (o campo de valor veio vazio). O Cesar confirmou que **todos são "a partir de"**.
Enquanto não houver valor, a IA diz que a equipe confirma e, nos que exigem avaliação, que o valor é definido na avaliação presencial.
Para preencher: informar o valor (Pix/dinheiro) e atualizar `tenant_service_catalog.price` do serviço (ou pedir ao suporte).

| Serviço | Categoria | Duração informada | Avaliação |
|---|---|---|---|
| Mechas loiras | Cabelo | 4 a 5 h (meio período) | presencial, gratuita |
| Morena iluminada | Cabelo | 4 a 5 h (meio período) | presencial, gratuita |
| Coloração | Cabelo | 1h30 com escova / 1h sem | presencial |
| Progressiva | Cabelo | mínimo 3 h | presencial |
| Realinhamento capilar | Cabelo | mínimo 3 h | presencial |
| Corte | Cabelo | 1 h | não |
| Escova | Cabelo | mínimo 30 min | não |
| Terapia capilar | Cabelo | 1h30 | presencial |
| Cronograma capilar | Cabelo | 1h20 | não |
| Limpeza de pele | Estética e corpo | 1h30 | não |
| Drenagem | Estética e corpo | 2 h | não |
| Massagem modeladora | Estética e corpo | 2 h | não |
| Massagem relaxante | Estética e corpo | 2 h | não |

Os outros 8 serviços já têm valor (Design de sobrancelha R$ 40, Mão R$ 33, Pé R$ 35, Pé e mão R$ 57, Spa dos pés R$ 84, Plástica dos pés R$ 75, Maquiagem R$ 180, Penteado R$ 180).

## 2. Decisões já tomadas (05/11/2026)

- Endereço: **Av. das Acácias, 209 - Cidade Jardim** (a correção "207, Loja 4" do questionário foi substituída por esta).
- Emojis: permitidos com moderação (no máximo um por mensagem).
- O salão **não aplica coloração trazida pela cliente**.
- Mensagem de cancelamento pelo salão: **o próprio usuário envia**; a IA não cria essa mensagem.
- **Primeiro agendamento não tem sinal.** Quem faltou passa a exigir sinal de 50% via Pix (ver seção 4).
- A IA **não marca horário** na v1: recepciona, informa e coleta os dados; o dono confirma e lança o agendamento na aba Agendamentos.

## 3. Ainda em aberto

- **Telefone a divulgar**: o questionário cita (22) 99963-3775; a instância da IA é (21) 99403-7748. Nenhum telefone foi colocado no prompt.
- **Agenda automática pela IA (fase 2)**: o motor atual usa uma duração única por tenant e um recurso por serviço; o salão tem durações de 30 min a 5 h e serviços com dois profissionais. Exige motor novo (duração por serviço, profissional por recurso, sem dupla marcação). O questionário pede "a IA agenda a avaliação".
- **Dupla marcação**: a aba Agendamentos não bloqueia dois agendamentos no mesmo profissional e horário (o Cesar listou isso como erro proibido). Hoje depende do dono.
- **Lembrete 24 h antes**: depende de agenda automática.
- **Lista de espera** (oferecer horário vago após desistência): processo manual da equipe por enquanto.
- **Terceiros agendando para outra pessoa**, **resumo de confirmação pela cliente**, **mensagem padrão de encaminhamento** e **mensagem de encerramento**: "ainda não definido" no questionário.
- **Fotos de antes e depois**: a IA só oferece que a equipe envie; o envio de mídia é manual.
- **Follow-ups**: coluna existe no Kanban, mas não há política de follow-up configurada.
- **Conta do Cesar**: o dono hoje é `ic_saloon@gmail.com`. Criar usuários individuais quando houver equipe no painel.

## 4. Cliente não veio e sinal obrigatório

Migration `supabase/migrations/030_appointment_outcomes_no_show.sql` e painel (Kanban e Agendamentos), ligados por
`settings.appointment_outcome_tracking = true` (somente neste tenant).

- O dono lança o agendamento confirmado na aba **Agendamentos**, vinculado à conversa.
- Depois do horário, usa **Compareceu** ou **Cliente não veio**. "Não veio" marca o agendamento como `no_show`, **encerra a conversa** e leva o cartão para a coluna **Não compareceu**.
- Quem tem "não veio" como desfecho mais recente aparece com o selo **Sinal obrigatório**. Comparecer depois volta ao normal. Clique errado pode ser corrigido.
- Vale só para agendamentos feitos no sistema: **nenhum cliente anterior à ativação é considerado**.
- A IA **ainda não sabe** da lista (o motor só enxerga agendamentos futuros): o selo avisa o dono, que cobra o sinal ao confirmar. Para a IA avisar sozinha é preciso uma mudança genérica no CORE (opcional por tenant), ainda não feita.
- Limite técnico existente: o painel carrega só os 200 primeiros agendamentos por tenant em ordem crescente de data; com mais que isso os recentes deixam de aparecer. Corrigir antes de o salão passar de ~200 agendamentos.

## 5. Coluna Confirmar agendamento

Implementada na `dev` em 06/11/2026, ainda **desligada** e fora de produção. Plano: `docs/operations/plano_coluna_confirmacao_agendamento.md`.

Quando ligada, substitui a regra da seção 2: a IA registra o pedido com data e hora exatas e o dono confirma pelo Kanban, sem lançar à mão na aba Agendamentos. A IA continua sem ver a agenda. Depende dos textos aprovados pelo Cesar em `05_confirmacao_agendamento.sql`.
