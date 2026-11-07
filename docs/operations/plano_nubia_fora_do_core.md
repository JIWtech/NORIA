# Plano: tirar a Núbia do CORE

Data: 07/11/2026. Pedido: mover tudo o que é da Núbia do CORE para a EXT, sem regex nem texto fixo, com boas práticas.

## 1. Diagnóstico

### Por que a IA da Núbia quase não responde

Medido em produção nas últimas 48 horas:

| Medida | Valor |
|---|---|
| Atraso mediano entre o envio da cliente e a chegada ao sistema | 24,7 h |
| Atraso máximo | 37 h |
| Mensagens com mais de 6 h de atraso | 59 de 65 |
| Respostas da IA desde 05/11 | 0 (só a equipe respondeu, pelo celular) |
| Turnos em revisão por `TERMINAL_EVIDENCE_MISSING:done` | 6 |

A causa é a entrega atrasada entre o WhatsApp e a Evolution, e o QR Code está pendente. A trava de mensagens antigas barra o que chega com mais de 6 horas, e é isso que deve fazer. Os 6 turnos em revisão vêm de um defeito nessa trava. **Mover código para a EXT não resolve nenhum dos dois.**

### O que é da Núbia dentro do CORE

São 44 linhas marcadas, ligadas ao perfil `nb_bronze_v1`, que a EXT v1 entrega:

| Ponto | Onde (`n8n/sources/noria_core.js`) |
|---|---|
| Contrato da v1 (mensagens `home_booking`, `spray_schedule` e outras) | 64, 79-82 |
| Bronze a jato e domicílio, por regex no texto (`groundingNubiaSprayInformation`) | 3680-3722, 3756-3770, 3803 |
| Textos aprovados por serviço (`groundingNubiaApprovedConfig`) | 3980-4140, 4406, 14688 |
| Regex de disponibilidade com frase fixa | 4532-4536 |
| Guarda de agendamento duplicado da Núbia e erros `NB_*` | 4612-4650, 14780-14805 |
| Palavras "bronze" e "bronzeamento" na classificação genérica | 2619 |

O caminho de "grounding" (`canonical_v2`), de cerca de 1.100 linhas, só é usado pela Núbia. A Gênesis, que também tem `canonical_v2`, sai antes, pelo caminho de vendas.

### O que já existe e está desligado

- **EXT Núbia v2** (`n8n/sources/nubia_extension.js`, workflow `6jSiEH2ugboYSack`, inativo): só autoriza ou recusa. Lê preços, serviços, duração e capacidade do tenant. A intenção vem do Gemini, em contrato estruturado, sem regex decidindo significado.
- **Pipeline de serviços no CORE** (`runServicesTurnPrepare`, `runServicesAvailability`, `runServicesTurnFinalize`): é selecionado por `settings.noria_turn_pipeline`, nunca pelo nome do tenant.
- **Testes:** 31 testes passando (`test_nubia_extension_v2`, `test_noria_services_pipeline`, `test_noria_nubia_route`).
- **Homologação:** `scripts/homolog/services_executor.cjs` roda 4 conversas, também com o Gemini real.

O caminho certo é **ligar a v2 e depois apagar a v1 do CORE**, e não reescrever a v1 dentro da EXT.

## 2. Boas práticas que valem para todas as fases

- O teste vem antes da mudança. Cada fase termina com o gate e o frontend sem falha nova em relação à base.
- O CORE não ganha nenhum `if` por tenant: a seleção é sempre por configuração e contrato.
- Toda mudança de comportamento tem chave de configuração, que permite voltar ao estado anterior na hora.
- Um commit por passo lógico, e a publicação no n8n com o publicador, que verifica a versão no ar e faz backup.
- Nenhum teste em cliente real antes da homologação. Nenhuma fila antiga é liberada e nenhuma mensagem é reenviada.

## 3. Fases

### Fase 0: base estável

1. Reconectar o WhatsApp da Núbia (QR Code). Sem isso não há como validar nada em produção.
2. Corrigir o defeito da trava de mensagens antigas (`TERMINAL_EVIDENCE_MISSING:done`), com teste que reproduz a falha.
3. Registrar a base: gate, frontend e as 4 conversas de homologação.

### Fase 1: ligar a cadeia v2, ainda desligada para a Núbia

1. Preencher o ID real do workflow da EXT v2 nos nós de execução e conectar a cadeia.
2. Trocar o roteamento fixo (`byTenant`, contrato `1.0`) por seleção explícita pela configuração.
3. Publicar o CORE com a v2 desligada. Os outros tenants não podem mudar em nada, e o gate prova isso.

### Fase 2: homologação

1. Criar um tenant de homologação com a configuração da Núbia e um número de teste.
2. Rodar `services_executor.cjs --mode=real`: comparação de serviços, reserva com nome, troca de assunto, saúde e segurança, e o caso adversarial do auditor.
3. Revisar o sinal: substituir o literal `SINAL PAGO` pela decisão `forward_payment_declaration` da EXT.

### Fase 3: ligar a v2 na Núbia

1. Gravar `noria_turn_pipeline` com `enabled: true` na Núbia.
2. Acompanhar por alguns dias: respostas, reservas, revisões e erros.
3. Para voltar atrás, basta desligar a chave. A v1 continua no código até a fase 4.

### Fase 4: tirar a Núbia do CORE

1. Apagar os pontos da seção 1 (perfil `nb_bronze_v1`, `groundingNubia*`, regex, textos fixos e erros `NB_*`).
2. Avaliar se o caminho `canonical_v2` ainda tem uso. Se não tiver, removê-lo junto, com teste.
3. Desativar a EXT v1 no n8n e remover o contrato `1.0` do roteador.
4. Rodar o gate e confirmar que os outros tenants continuam iguais.

### Fase 5: agendamento padrão

O pipeline de serviços passa a ser a base do agendamento de todos os tenants de serviço. O I&C e o Noria já estão com o perfil `services_booking_v2`.

- **EXT genérica de serviços:** lê tudo da configuração e atende quem não tem política própria.
- **Motor de agenda no banco:** duração por serviço, profissionais, horário de funcionamento com intervalo de encaixe, vários serviços por reserva e bloqueio de dupla marcação.
- **Pedido com confirmação do dono:** continua como modo para quem não quer agenda automática.

## 4. Riscos

| Risco | Tratamento |
|---|---|
| Ligar a v2 com a entrega ainda atrasada mascara os resultados | A fase 0 vem antes |
| A v2 se comporta diferente da v1 com clientes reais | Homologação com Gemini real e a chave para voltar na hora |
| Remover a v1 afeta outro tenant | O gate e os testes por tenant; nenhum outro tenant usa `nb_bronze_v1` |
| Sinal pago perdido na troca | Teste específico na fase 2 antes de desligar o literal |
