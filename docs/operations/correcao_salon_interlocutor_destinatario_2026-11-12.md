# Salon: quem escreve × pessoa atendida (12/11/2026)

## Evidência

- Após uma conversa encerrada, João pediu mão tradicional. Havia um pedido pendente de design de sobrancelha para a mãe, Louzania Santos. A IA respondeu “Adorei a escolha, Louzania” e, após João dizer que o serviço novo era para a namorada, repetiu “Entendi perfeitamente, Louzania”. As duas saídas tiveram `adapter_outcome=passed`.
- Perguntar o nome completo da namorada foi correto; usar Louzania como vocativo para João e presumir que o serviço novo era para a mãe não foi. O pedido antigo de Louzania permaneceu `pending_confirmation`.

## Correção

| Fonte | Mudança |
| --- | --- |
| `clients/ic_saloon/salon_engine.js` | Identifica separadamente nome exibido do contato (pista, sem prova) e pessoa atendida nos agendamentos; orienta a confirmar o destinatário de um serviço novo e preservar o pedido anterior. |
| `clients/ic_saloon/conversation_adapter.cjs` | Passa ao revisor os beneficiários dos pedidos e evidências de nome da sessão. Exige `wrong_contact_name=false` e `recipient_assumed=false` na resposta inicial, no reparo e antes de registrar pedido. |
| `clients/ic_saloon/18_proposta_prompt_v11_interlocutor_destinatario.sql` | Atualiza a regra de conversa do tenant somente se v10 e o trecho esperado estiverem ativos. Arquivo `_rollback.sql` reverte somente v11. |
| `clients/ic_saloon/conversation_adapter.test.cjs` | Reproduz os dois turnos que antes passavam e confere a resposta corrigida. |

Nenhuma reserva foi alterada pela correção. Um pedido pendente só deve ser alterado ou cancelado após decisão explícita da pessoa.

## Verificação e rollback

- Testes focados: 30/30; gate de liberação: 485/485; auditoria anti-hardcode: passou. Export do Salon gerado duas vezes com hash idêntico.
- A verificação local não substitui uma conversa real após a publicação. Conferir primeiro os turnos posteriores ao horário de ativação.
- Para rollback, aplicar `clients/ic_saloon/18_proposta_prompt_v11_interlocutor_destinatario_rollback.sql` somente se v11 estiver ativo e republicar o backup anterior do workflow do Salon. Reverter as fontes e regenerar o export para manter o repositório alinhado.
