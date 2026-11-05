# Workflows atuais, regras comerciais e alinhamento de prompts

Rodada de 23/10/2026, com consultas finais em 24/10 UTC. Produção consultada somente para leitura. Fontes canônicas, testes, prompts e patches preparados localmente. Nenhuma publicação, atualização do Supabase, migração, chamada real ao Gemini ou mensagem WhatsApp foi executada.

## Atribuição por versão

O usuário apontou corretamente que a janela de 48 horas mistura versões. Os totais históricos do relatório anterior não identificam automaticamente defeitos do workflow atualmente publicado.

| Workflow | Estado verificado | Atualização UTC |
| --- | --- | --- |
| CORE entrada `3N5oN6sxtir9lFrA` | ativo, 70 nós | 21/10 22:48:48 |
| Motor `mlKNPv862H2g3Gap` | ativo, 2 nós | 22/10 01:51:01 |
| Gênesis EXT `fXGorIlPbyf9Qtsp` | ativo, 3 nós | 22/10 01:50:59 |
| Núbia legado `vCDXJLqIBCZJRTVv` | ativo, 3 nós | 09/10 |
| Royal `QlKuGOCnI5eKwlSF` | inativo, 9 nós | 21/10 |

Motor publicado: versão `a2b2d99e-01ae-458c-80b0-7a1229bc51f0`, CORE hash `fd6dba9cc20cf93e27b60072144e3886e63a5a5771495bf83753fc6726041589`, EXT hash `8fbd0e8555ac0dc6fd121587ceda7169c7404db8bf3ffd018fe53eaa93ceb5f8`, build de 22/10 01:49:51 UTC. A EXT publicada tem versão `29e1b312-3c67-4361-9dee-3598858f0507`.

Na amostra consultada de quatro dias, 113 eventos de saída da Gênesis têm exatamente esses hashes; 12 registram erro, desde 22/10 01:54 até 24/10 01:17 UTC. Distribuição dos 12:

- 3 divergências entre identidade do produto e fonte de preço de catálogo;
- 4 rejeições com falta de suporte semântico, uma delas também com exposição técnica de mídia;
- 1 divergência de cobertura dos segmentos;
- 1 alegação de entrega de foto sem confirmação;
- 1 pedido de catálogo não atendido;
- 1 falha de geração;
- 1 resposta primária inválida/contrato ausente.

Esses são registros de bloqueio/erro, não prova de que a resposta indevida foi entregue. A identidade e a entrega continuam protegidas; não removi esses bloqueios. Várias recuperações já estavam presentes no trabalho local anterior do Claude. As novas correções não foram publicadas, portanto não se pode atribuir melhora de produção a elas.

Na Núbia, 98 eventos da revisão diária atual não tinham erro, mas falta o hash completo de build nesses registros. Revisão diária e proximidade temporal não comprovam a versão exata. Os HTTP 400 e filas antigas do relatório anterior continuam históricos, sem atribuição automática ao motor atual. A Royal está deliberadamente desabilitada no roteamento: não foi ativada.

## Conferência comercial com o Supabase

| Tema | Autoridade verificada | Resultado local |
| --- | --- | --- |
| Gênesis: entrada | valor estruturado e validado pelo CORE | EXT deixou de reinterpretar o texto e sobrescrever o valor |
| Gênesis: financiamento | coleta habilitada; exigência de entrada depende de configuração; 30% classifica temperatura | rascunho remove exigência incondicional de entrada para coletar documentos |
| Gênesis: compra direta | ano mínimo 1995 e marcas recusadas nas configurações | comparação usa marca estruturada completa; não procura marca no relato livre |
| Gênesis: ano desconhecido | declaração semântica com evidência inbound atual | campo opcional `year_unknown` com IDs próprios substitui o gatilho lexical |
| Gênesis: troca | aceitação sujeita à avaliação; regra de compra direta não é aplicada indiscriminadamente | preservada |
| Gênesis: cartão | até 21 parcelas, separado de financiamento | preservado |
| Gênesis: avaliação | remota exige fotos/condição; presencial admite visita sem isso | preservado |
| Gênesis: serviços humanos | configuração contém despachante | prompt passa a orientar `human_service_id` configurado, sem inventar serviço |
| Gênesis: disponibilidade | falta de prova não comprova venda | instrução interna distingue vendido, reservado, desconhecido e indisponibilidade de verificação |
| Núbia: preços | 14 serviços ativos; preço da própria linha do catálogo | vínculo por ID, valor em centavos e auditoria semântica do texto |
| Núbia: sinal | 50%, confirmação manual | calculado sobre o preço do mesmo serviço; declaração não confirma pagamento |
| Núbia: adicional | R$ 10 após 17h/domingo/feriado, conforme política | fonte de taxa separada de preço e sinal |
| Núbia: agenda | seis serviços com recursos automáticos, demais com equipe; slots de 90 minutos | preservada a rota legado; v2 não foi ativada |
| Núbia: intenção | pergunta sobre serviço não equivale a escolha para reserva | rascunho explicita continuidade e evidência atual |

O valor permanece associado ao cadastro correto. Não foi criada restrição de unicidade entre os valores numéricos: o catálogo pode ter serviços diferentes com o mesmo preço, sem permitir que a IA misture suas identidades.

## Correções desta rodada

1. `genesis_extension.js`: `commercial.decide` usa exclusivamente `state.deposit_cents` estruturalmente válido. Não calcula outra entrada a partir da mensagem. Dois novos testes falharam antes e passaram depois.
2. CORE/EXT: `customer_vehicle.year_unknown` e `year_evidence_ids` opcionais, somente com evidências atuais válidas. Não saber o horário da visita não significa desconhecer o ano do carro. Quatro testes reproduziram a falha e passaram após a correção.
3. EXT: marca estruturada comparada integralmente à configuração; retiradas inferência por texto livre e aproximação por distância de edição. Cinco casos cobrem marca citada de outro veículo, marca composta, acentos e marca desconhecida; quatro falhavam antes.
4. CORE: `price_claims` exige tipo de fonte, ID, centavos e trecho. Validação determinística vincula serviço/preço/sinal/taxa; auditoria independente confere sujeito e sentido da resposta inteira. O conjunto global de valores foi removido. Cada resposta livre desse fluxo recebe uma auditoria; blocos oficiais literais com snapshots válidos dispensam a chamada extra. Orçamento atômico existente e recusa em indisponibilidade foram preservados.
5. Instruções internas: contrato de preço informado mesmo antes de eventual troca do prompt no banco; ano desconhecido explicado; ausência de disponibilidade deixa de ser tratada como prova de venda.

As correções anteriores desta investigação continuam presentes: retirada do desvio lexical que enfraquecia a auditoria factual, recuperação semântica limitada a uma reescrita com nova auditoria, bloqueio de downgrade para evitar a auditoria e build determinístico entre regenerações. O relatório anterior documenta suas reproduções.

## Prompts preparados, sem aplicar

- Gênesis: `clients/wesley_automoveis/prompts/system_prompt_v14_25_contract_alignment.md`, derivado do prompt ativo v14.24, preservando as demais regras.
- Núbia: `clients/clinica_nubia_oficial/prompts/system_prompt_contract_alignment_v5.txt`, derivado do prompt ativo v4, com continuidade, seleção de serviço, preços por fonte, sinal e contrato `price_claims`. Retiradas as cópias numéricas de preços, sinal e adicional do texto de instrução: o modelo consulta as respectivas linhas e políticas atuais do Supabase, evitando divergência quando o cadastro mudar.
- Patch: `supabase/migrations_pending_review/prompt_contract_alignment_20261023.sql`.
- Rollback: `supabase/migrations_pending_review/prompt_contract_alignment_20261023_rollback.sql`.

Ambos os SQLs são dados pendentes de revisão, sem DDL. Transação única, bloqueio das linhas, ID e slug exatos, comparação de revisão e hash do conteúdo esperado. Repetir o estado já aplicado é no-op. Qualquer edição concorrente aborta o conjunto, inclusive a alteração anterior do outro tenant. Só mudam `system_prompt`, `prompt_revision` e `updated_at`; pagamento, agenda, preços, modelo e customizações permanecem intactos. Rollback também recusa apagar edição posterior.

Baselines reconsultados no Supabase: Gênesis `wesley-sales-v14.24-sale-year-2026-10-21`, MD5 `1213c4d84e69e0ce4967ecbe3b6a56f5`; Núbia `nubia-2026-10-07-textos-v4-info-primeiro`, MD5 `041110318c4d8a249380e7f015d0a349`. Os testes conferem que o SQL parte exatamente desses conteúdos e que seu destino coincide com os arquivos revisáveis.

Não aplicar o patch isoladamente como substituto da correção do motor. Uma implantação exige revisão dos workflows regenerados e publicação coordenada com os contratos correspondentes. O pipeline Núbia v2 permanece isolado.

## Validação

Bateria ampliada: 170/170 testes em 26 arquivos; depois, mais um caso de bloco literal/snapshot foi acrescentado e passou na bateria de preço, totalizando 171 testes distintos aprovados. A bateria de preço terminou em 13/13; patch/rollback em PGlite, 5/5. Gemini, Supabase e envio usam transporte simulado nesses testes; nenhuma chamada paga foi realizada.

Verificações adicionais: fotos 5/5 + 7/7 + 4/4; anti-hardcode passou; 32 nós JavaScript compilados em quatro workflows, sem IDs/nomes duplicados ou conexões ausentes; sintaxe do builder válida; regeneração repetida preservou todas as 15 entradas; `git diff --check` passou.

Build local final: CORE `5a43c0c04e29325dd5c30ebf3fea1351f09ba26e8944d6d844dfa2d68a370c71`, EXT `3fffdf4d39074c3857d0269fd1c4ce5d011ff32f619007c7e995eaa3059de663`. Esses hashes são locais, diferentes dos publicados.

As duas suítes antigas continuam com as mesmas 72 falhas anteriores: CORE 50 e vendas 22, principalmente fixtures incompatíveis com a entrada atual. Foram executadas novamente sem reduzir asserções. Isso impede declarar a suíte completa verde. A correção de preços adiciona custo/latência nas respostas livres e ainda precisa de homologação autorizada com o modelo real; testes de protocolo não comprovam a precisão semântica do provedor.

## Limitações e rollback

- Não há demonstração de preço incorreto efetivamente enviado pela Núbia; a brecha foi reproduzida em candidata offline.
- Não houve recuperação de filas antigas, alteração de estoque, publicação, migração ou ativação da Royal/Núbia v2.
- Catálogo de veículos com sincronização antiga e políticas de idade/apresentação ausentes continuam pendências de configuração, não foram preenchidas com regras inventadas.
- Advisors de segurança/performance permanecem triagem do relatório anterior, sem alterações automáticas em RLS ou índices.
- Trabalho preexistente nos três arquivos de `app/` foi preservado.
- Rollback local: reverter apenas os hunks desta rodada nas fontes, preservar trabalho posterior e regenerar. Não restaurar o checkout inteiro. Os SQLs de rollback são para uma aplicação futura, que não ocorreu.

O estado atual é uma correção local testada e revisável. Não é comprovação de implantação nem garantia de que todas as classes de falhas foram eliminadas.
