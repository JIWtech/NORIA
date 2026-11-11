# Plano de adequação da NB Bronze

Status: planejamento para revisão. Nenhuma alteração operacional autorizada por este documento.

## 1. Base e limites

- Fonte: `questionario-clinica-nubia-beatriz-2026-10-02.pdf`, 17 páginas, respondido por Beatriz em 02/10/2026. Núbia consta como aprovadora no início; a aprovação final não foi preenchida.
- Código inspecionado: branch `prod`, commit `7dc217d`. As alterações locais do nome NB Bronze já existentes foram preservadas.
- Esta análise compara o PDF com os arquivos atuais; não confirma o conteúdo LIVE do Supabase nem a versão publicada dos workflows.
- Não executar novamente os pacotes antigos 01 a 06 para implantar este plano: podem sobrescrever personalizações posteriores.
- Resposta em branco não significa exclusão de regra existente. Divergências ficam pendentes; não escolher uma versão silenciosamente.
- Escopo de ativação: somente `clinica_nubia_oficial`. Nenhuma regra comercial da Gênesis será alterada.
- A extração do PDF apresentou falhas de codificação nos emojis. Conferir visualmente os textos antes de publicar mensagens literais; não copiar caracteres corrompidos.

## 2. O que mudar no atendimento

| Tema | Resposta do questionário | Mudança planejada |
|---|---|---|
| Identidade (1.1) | NB Bronze; recepcionista do espaço | Alinhar cadastro, fatos e prompt. Não se passar pela Núbia. Confirmar aplicação LIVE do patch 07 de nome. |
| Abertura (1.1.3-4) | “Qual seu nome ?”; responder pergunta específica e apresentar-se na mesma mensagem | Perguntar o nome quando ausente, sem ignorar a dúvida inicial e sem repetir nome já informado. Aprovar a composição da apresentação com essa pergunta. |
| Linguagem (1.1.5-8) | Acolhedora, descontraída; emojis quando necessário; responder “Sim” sobre IA | Substituir a rigidez atual de estilo. Política de emojis configurável por tenant; não mudar a política dos outros clientes. Não inventar apelidos autorizados. |
| Endereço (1.2.2) | Av. Itaguaí, 200, Nova Angra; casa verde de três andares, portão de ferro branco | Atualizar fatos e resposta determinística de localização. Não inventar link, acessibilidade ou outra unidade. Exclusividade em Angra ficou sem resposta; não abrir unidade nova. |
| Equipe (1.2.7) | Responde das 9h às 20h | Separar horário humano de horário dos procedimentos. Dias da semana e prazo de retorno ainda precisam ser definidos. |
| Apresentações (8.1) | Mostrar todos os serviços; preço isolado recebe texto completo | Criar catálogo de mensagens completas, por serviço, sem resumir automaticamente. Preparo e pós-cuidados terão blocos separados. |
| Primeira vez (8.1.6) | Recomendar bronze individual | Explicar opções individuais sem escolher modalidade ou garantir adequação clínica. Condicionado à validação de segurança dos serviços. |
| Recusa do sinal (8.2.3) | Não agenda sem sinal; pode consultar encaixe próximo ao horário | Manter IA explicando a regra, sem criar reserva confirmada nem prometer encaixe. O prompt atual encaminha recusa de sinal automaticamente e precisa mudar. |
| Nova reserva com reserva existente (8.2.7) | Encaminhar ao humano | Regra por tenant antes da criação; não remover globalmente o suporte a múltiplas reservas. |
| Falha de compreensão/agenda (8.2.9-10) | Encaminhar | Aviso único e bloqueio humano persistente, sem ciclos de repetição. |
| Encerramento (9.2.2) | “Obrigada pela preferência.” | Mensagem vinculada ao encerramento explícito; não inventar encerramento automático por inatividade. |
| Exclusão de contatos (10.1.1) | Não existem contatos somente humanos | Não importar para NB Bronze a lista de exclusão da Gênesis. Isso não elimina bloqueios humanos de conversas já encaminhadas. |

### Funcionamento informado

| Dia | Faixa |
|---|---|
| Segunda | 16h às 19h |
| Terça | 10h às 15h; interpretação de “10h 15h” a confirmar |
| Quarta | 15h às 19h |
| Quinta | 10h às 15h |
| Sexta | 14h às 19h |
| Sábado | 10h às 15h |
| Domingo e feriados | 8h às 11h |

Faixa de funcionamento não é grade de inícios disponíveis. A pergunta 4.1.1 ficou em branco. Não gerar novos horários a partir dessas faixas sem resolver duração, intervalos e horário máximo de término. Pedidos fora da grade e falta de vaga devem ir à equipe, conforme 1.2.4 e 4.1.5.

## 3. Catálogo a consolidar

Valores abaixo são respostas do PDF, não alterações já aplicadas. Manter IDs estáveis quando o serviço for o mesmo; mapear versões legadas antes de ativar/inativar itens. Não excluir registros ligados a reservas antigas.

| Serviço | Preço informado | Duração / agenda informada | Encaminhamento e pendências |
|---|---|---|---|
| Clássico | R$ 99,99 | Procedimento 40-80 min; permanência 90-150 min; bloco informado 15 min | Quatro reservas simultâneas. Texto cita sala para seis: capacidade física não é capacidade agendável. Resolver bloco e validação de equipamento. |
| Premium | R$ 149,99 | Procedimento 40-80 min; permanência 90-150 min; bloco 60 min | Uma cliente; frente e costas simultaneamente, sala individual. Resolver bloco menor que procedimento máximo. |
| Comfort | R$ 179,99 | Procedimento 40-80 min; bloco 90 min; permanência sem resposta | Uma cliente; deitada, sala individual. Confirmar preparo e pós-cuidados, não assumir respostas do Clássico. |
| Solar | R$ 99,99 | Avaliação define duração; manhã livre até 11h; bloco informado 15 min | Agenda humana; cinco clientes; bloqueia bronze de máquina. Inclui acompanhamento, ativador/bronzeador e café da manhã. Resolver duração e recursos compartilhados. |
| Jato na clínica | R$ 149,99 | Aplicação 20 min; permanência 45 min; bloco 30 min | Agenda humana; uma cliente; resultado até 15 dias conforme cuidados; 8-12h sem molhar. Limpeza incluída ainda indefinida. |
| Jato a domicílio | Texto cita R$ 200 de Monsuaba ao Pontal | Deslocamento e agenda indefinidos | A ficha oferece domicílio, mas 3.2.4 responde “na clínica”. Não remover nem confirmar modalidade sem esclarecer. |
| Jato no Bojo | R$ 49,99 | Não informada | Existência confirmada; faltam área atendida, descrição, preparo e agenda. |
| Banho de Lua Clássico | R$ 19,99 | Não informada | Reintroduzir versão após conferir cadastro; faltam etapas e duração. |
| Banho de Lua Premium | R$ 34,99 | Não informada | Mesmo tratamento acima. |
| Banho de Lua Comfort | R$ 69,99 | Não informada | Mesmo tratamento acima. |
| Detox / Mousse Clareador | R$ 49,99 | Não informada | Mesmo serviço segundo 3.3.3; unificar aliases, não duplicar cobrança. |
| Potência Bronze / Bronze Duplo | R$ 179,99 / R$ 229,99 / R$ 259,99 | Não informada | Mesmo produto; tabela fixa substitui “base + R$ 99,99”. Falta associar explicitamente cada valor à combinação e esclarecer Solar + Jato. |
| Clareamento de áreas | Não informado | Não informada | Serviço citado, sem ficha. Confirmar se é independente de Detox e quais áreas/preços; encaminhar enquanto incompleto. |

O cadastro local atual desativa as três versões do Banho de Lua e Jato no Bojo, mantém Banho de Lua único por R$ 60 e Jato a domicílio por R$ 200. Precisamos reconciliar esses itens com o LIVE e retirar descrições contraditórias do prompt. Não preservar automaticamente as durações fixas antigas de 60/90 minutos como duração real do procedimento.

## 4. Arquitetura proposta

### Configuração e mensagens

Usar `tenant_settings.settings` para identidade, horários, requisitos de coleta, políticas, mensagens e flags. Usar `tenant_service_catalog` para catálogo e preços. O prompt orienta linguagem e interpretação, não calcula disponibilidade, desconto ou confirmação financeira.

Criar suporte genérico, opt-in, a mensagens aprovadas identificadas por chave: apresentação geral, cada serviço, preparo, itens a levar, pós-cuidados, recusa de sinal, handoff e encerramento. O modelo seleciona a chave; o backend valida a chave e renderiza a versão cadastrada. A limpeza de Markdown/emojis não deve destruir um texto aprovado. Dividir mensagens longas em blocos ordenados com controle de entrega.

Atualizar os atalhos determinísticos existentes: catálogo completo, endereço, Pix e confirmação. Ajustar só o prompt não corrige mensagens que esses atalhos montam sem Gemini.

### Coleta e cadastro

Campos exigidos em 4.2.1: nome e sobrenome, data de nascimento e bairro. Serviço, data e horário continuam necessários para a reserva.

- Estender schema, evidências e validação do estado canônico; hoje ele coleta nome/serviço/data/hora/unidade.
- Cada campo deve vir de mensagem real da cliente; nome do perfil não substitui resposta.
- Validar data de nascimento real e não futura, sem inventar idade mínima. Não recitar o nascimento nas confirmações públicas.
- Pedir o bairro com contexto de cadastro; a heurística atual de localização reconhece “bairro” e não pode substituir essa pergunta pelo endereço da loja.
- Persistir perfil estruturado protegido por tenant/RLS e associá-lo à reserva. Conferir o modelo de contatos existente antes de criar tabela nova. Não usar CPF/documentos da capacidade comercial da Gênesis.
- Coletar só o necessário; restringir acesso a nascimento, fotos e relatos de saúde. Definir retenção e responsável por pedidos de privacidade antes de ampliar coleta.

### Agenda e capacidade

O código atual usa duração global de 90 min, grade semanal fixa e contagem por recurso/horário inicial. Não basta colocar 15/60/90 em JSON: durações variáveis e inícios sobrepostos exigem validação de ocupação por intervalo.

Proposta: separar duração do procedimento, permanência estimada, duração bloqueada, preparo/limpeza, intervalo de início, capacidade física e capacidade agendável. Confirmar quais tempos podem ocorrer paralelamente antes de calculá-los.

- Recurso por equipamento e recurso compartilhado quando houver dependência de equipe/sala.
- Disponibilidade e reserva usam o mesmo cálculo no banco, em transação, incluindo reservas manuais, bloqueios, feriados e capacidade por sobreposição.
- Bloquear os recursos necessários na mesma transação, com ordem estável de locks; evitar duas reservas concorrentes ocupando a última vaga.
- O Solar manual precisa bloquear as máquinas afetadas: “agenda humana” não dispensa registro da ocupação no sistema.
- Inserir exceções por data para feriados, manutenção e ajustes de Núbia. Não inferir feriado sem calendário oficial cadastrado.
- Introduzir antecedência mínima configurável; 2h é interpretação provável de 4.1.3, mas máximo não foi respondido e requer confirmação.
- Sem vaga: handoff, não oferecer indefinidamente alternativas contra a preferência registrada.
- Não alterar reservas existentes silenciosamente. Simular conflitos antes de ativar nova grade/duração e encaminhar conflitos à equipe.
- Prazo de pré-reserva e liberação por não pagamento estão sem resposta: não ativar expiração automática até definição.

### Pagamento e confirmação

Fatos confirmados: sinal 50%; Pix 21966353026, Silvana Marques, CLOUDWALKIP LTDA; sinal também por link de crédito; restante no procedimento, dinheiro ou aproximação. Não divulgar parcelamento/taxas sem autorização.

- Modelo de valores em centavos: preço-base, desconto autorizado, sinal, adicional separado e saldo. O adicional NÃO integra o sinal, conforme 5.2.3. Arredondamento de meio centavo deve ser explicitado e testado.
- R$ 10 após 17h, domingo e feriado. Acumulação está indefinida; não calcular total nesses casos sem regra.
- Promoção de 15% ao trazer amiga no Clássico: falta definir beneficiária, número mínimo, mesma data, incidência sobre sinal, acumulação e vigência. Até lá, informar existência e encaminhar cálculo à equipe.
- Qualquer aviso afirmativo de pagamento inicia conferência. Distinguir “paguei” de “não paguei”, “vou pagar” e “como pago?”. Comprovante sem texto requer decisão explícita, sem confirmar autenticidade por imagem.
- Associar aviso à reserva correta; nenhuma ou várias candidatas implicam análise humana. Registrar `payment_reported`, mover para conferência e silenciar IA após um único aviso.
- Núbia confirma por ação autenticada e autorizada; verificação da pessoa deve usar associação de usuário, não nome textual. Link de pagamento precisa de emissor definido; a IA não gera URL fictícia.
- Após confirmação humana: mensagem de confirmação + endereço + preparo/itens/pós-cuidados do serviço reservado, conforme 5.2.7 e 8.1.5. Perguntas explícitas de preparo antes do pagamento também devem poder ser respondidas com segurança; validar essa interpretação.
- Expandir o envio atual, que usa uma mensagem estática. Usar registro de entrega por parte, idempotência e tratamento de timeout incerto; não reenviar toda a sequência cegamente.
- Não prometer “reserva confirmada” antes da persistência/autorização; diferenciar pré-reserva, aviso de pagamento e pagamento conferido.

### Handoff, Kanban e sessões

Reutilizar colunas atuais após inventário LIVE. Proposta de mapeamento, não nomes novos aprovados: coleta em Conversas IA; reserva pendente em Aguardando sinal; aviso em Verificar Sinal; conferência concluída em Agendamento confirmado; exceções em Atendimento humano.

Todas as transições devem atualizar a conversa e a representação no Kanban de forma consistente. Registrar motivo e resumo sem pedir que a cliente repita dados. Handoff persiste mesmo com mensagens posteriores ou comandos de reset. Encerramento não cancela reservas; retorno à IA depende de operador autorizado.

Handoff para Solar/Jato, falta de vaga, horário especial, erro de áudio/agenda, cancelamento/remarcação/atraso, divergência de pagamento, foto da pele, reação/dor/queimadura, resultado insatisfatório, consulta de terceiros e nova reserva com reserva existente. Restrições de saúde citadas são motivo de encaminhamento, não diagnóstico ou autorização automática.

Conflitos: 8.2.5 marca reembolso como “continuar com IA”, mas 6.1.8 exige humano para cancelamentos. 4.2.6 proíbe reservar para terceiros, enquanto 4.2.7 prevê grupos com nomes e sinais individuais. Manter esses caminhos com humano até decisão, sem apresentar essa escolha provisória como resposta aprovada.

### Lembretes e retomadas

Separar dois tipos de job, mesmo que usem o mesmo scheduler e transporte compartilhados:

1. Lembrete de reserva: `starts_at - 8h`, ligado a appointment e versão da data; proposta de elegibilidade apenas para reserva confirmada. Cancelar/recalcular na remarcação ou cancelamento. Conferir estado antes do envio. Regra para reserva feita com menos de 8h e envio noturno ainda indefinida.
2. Retomada comercial: após uma semana de abandono, não a sequência padrão local 3h/24h/15d. Confirmar marco inicial, tentativas, janela horária, consentimento e opt-out. Não enviar para quem já reservou, respondeu, pediu interrupção ou está com humano.

O dispatcher atual cancela follow-up quando há reserva futura, portanto NÃO pode ser reutilizado sem distinguir os tipos. Silêncio humano é obrigatório, mas lembrete após confirmação pode conflitar com esse bloqueio: confirmar exceção transacional explícita ou suprimir até liberação humana. Não tratar lembrete como retomada da IA.

Sem disparos retroativos em massa na ativação. Jobs antigos incompatíveis devem ser inventariados e cancelados por escopo/versão; nunca apagar o histórico de entregas. Cancelamento concorrente, lease, deduplicação e entrega incerta precisam de testes.

## 5. Segurança dos conteúdos

O PDF inclui referência a nistatina/óxido de zinco e intervalo de novas sessões. Não publicar recomendação automática de medicamento, avaliação de pele ou garantia de segurança. Encaminhar dúvidas individuais a profissional habilitado e submeter textos técnicos à validação responsável.

Também é necessário identificar a tecnologia das máquinas. A Anvisa informa que equipamentos de bronzeamento estético por radiação UV são proibidos. O PDF não identifica a tecnologia; não presumir que os equipamentos sejam UV nem que sejam regulares. Validar esse ponto antes de ampliar divulgação/agendamento dessas modalidades. [Fonte oficial da Anvisa](https://www.gov.br/anvisa/pt-br/comunicacao/campanhas/estetica/camaras-de-bronzeamento-artificial)

Regras de sinal não reembolsável, perda por atraso e cancelamento pela própria empresa precisam de revisão adequada antes de virar resposta categórica sobre direitos. A IA não decide disputas ou nega reembolso autonomamente. “Sem resposta” sobre homens, menores, gestantes e lactantes não autoriza atendimento irrestrito.

## 6. Decisões pendentes para Núbia

1. Clássico: os 15 minutos são preparo, intervalo de entrada ou ocupação total? Qual bloco total correto?
2. Premium: como acomodar até 80 minutos de procedimento em 60 de agenda? Qual tempo realmente ocupa a máquina?
3. Solar: significado dos 15 minutos, duração de bloqueio, dias disponíveis e quais máquinas ficam impedidas? Pode coexistir com Jato?
4. Jato: continua a domicílio? R$ 200 é valor total para a faixa Monsuaba-Pontal? A limpeza está incluída? Os 45 minutos no local cabem em 30 de recurso?
5. Confirmar grade de início, término máximo, mínimo de 2h, horizonte máximo e terça 10h-15h. Horário após 18h não significa autorização para terminar após fechamento.
6. Confirmar associação dos três preços de combo; detalhar Banhos de Lua, Detox, Bojo e clareamento, inclusive durações e possibilidade de agenda automática.
7. Promoção de amiga: quem recebe 15%, em quais condições e como afeta o sinal? Acumula com outros benefícios?
8. Adicionais simultâneos acumulam? Como arredondar sinal de preços terminados em R$ 0,99?
9. Remarcação: 8h como regra ou 24h com exceção de 8h? Confirmar limite de uma remarcação e tratamento do reembolso.
10. Grupos são exceção à proibição de agendar para outra pessoa? Como cada participante fornece dados e confirma sua vaga?
11. Quanto tempo segurar vaga sem pagamento? Ao vencer, liberar, avisar ou chamar equipe? Múltiplas reservas futuras continuam humanas?
12. Quem gera o link de cartão? Quais textos de pré-reserva, aviso de conferência e encaminhamento devem ser aprovados? Comprovante sem texto inicia conferência?
13. Lembrete de 8h pode sair de madrugada e durante bloqueio humano? O que fazer com reserva confirmada a menos de 8h? Qual limite de retomadas após uma semana?
14. Confirmar compartilhamento dos cuidados do Clássico com Premium/Comfort; validar textos técnicos, tecnologia dos equipamentos, públicos atendidos e protocolo fora do horário para relatos de reação.
15. Quem recebe casos humanos, quem pode devolver para IA, quais dias atende 9h-20h e quem responde por privacidade? Núbia aprova o conjunto final?

## 7. Componentes e implantação planejada

| Componente | Trabalho previsto |
|---|---|
| Supabase: cadastro/configuração NB Bronze | Patch incremental com verificação de versão atual; identidade, horário, catálogo, políticas, textos, coleta e flags. Preservar alterações LIVE não relacionadas. |
| Supabase: agenda | Migração aditiva/opt-in para duração por serviço, recursos por intervalo, bloqueios e calendário. Não alterar sem compatibilidade as RPCs dos demais tenants. |
| Supabase: perfil e pagamentos | Persistência protegida dos campos novos, valores e autorização/idempotência de confirmação. Revisar modelo existente antes de adicionar tabelas. |
| Supabase: jobs | Tipos/estado para lembretes separados de follow-up, versão de reserva, opt-out e cancelamento. |
| CORE e EXT de serviços | Schema, evidências, roteamento por serviço, coleta, mensagens aprovadas, pagamento, agenda e bloqueios. |
| Comandos do CORE | Confirmação humana com pacote do serviço, autorização, fechamento e consistência de estado e entrega. |
| Follow-ups do CORE | Separar retomada comercial de lembrete, respeitar consentimento e pausa humana e evitar envios duplicados. |
| Painel | Exibir novos dados com permissões, motivo de handoff, valores/sinal/adicional, bloqueios de agenda e estado das entregas. Não confundir histórico visível com memória da sessão da IA. |

Não criar workflow por cliente. Recursos novos serão genéricos e desativados por padrão; ativação da NB Bronze será específica. Não prever novas variáveis no Easypanel sem necessidade identificada; infraestrutura e credenciais atuais serão verificadas no pré-voo.

### Ordem de execução após aprovação

1. Inventário LIVE somente leitura: configurações, catálogo, colunas, roles, reservas futuras, políticas/jobs e versões dos workflows. Exportar snapshot privado para rollback; não armazenar credenciais no plano.
2. Resolver pendências impeditivas e aprovar textos. Separar um primeiro lote de identidade/endereço/catálogo não ambíguo, sem ativar regras ainda incompletas.
3. Implementar em branch de trabalho derivada da `prod` atual, com banco de teste isolado. Localhost conectado ao LIVE não é homologação segura para reservas ou mensagens.
4. Migrar esquema de forma compatível, mantendo flags desligadas; publicar código compartilhado compatível sem ativar políticas novas de outros tenants.
5. Validar reservas futuras e ensaiar mudança. Aplicar configuração somente do tenant com transação, versão esperada e auditoria. A ativação operacional é a última etapa.
6. Homologar uma conversa controlada de ponta a ponta e acompanhar erros, duplicações, ocupação e Egress. Ativar lembretes/retomadas separadamente e sem passivo retroativo.
7. Rollback por flags/configuração e versão compatível de código; preservar dados, comprovantes, reservas novas e entregas. Não restaurar snapshot inteiro por cima de atividade real.

### Critérios de aceite

- Nome NB Bronze em abertura, catálogo, localização e mensagens operacionais; primeira pergunta específica respondida e nome não solicitado novamente.
- Preços/textos por modalidade consistentes; nome antigo, Banho de Lua único e fórmula de combo antiga não ressurgem.
- Nome/sobrenome, nascimento e bairro coletados com evidência; nome de perfil e dados ausentes não completam reserva.
- Bairro de cadastro não aciona resposta indevida de localização.
- Disponibilidade considera duração, sobreposição, recursos compartilhados, feriados, bloqueios e antecedência; concorrência não excede capacidade.
- Dados de clientes e configurações de outros tenants permanecem isolados; regressão da Gênesis e dos caminhos legados passa.
- Avisos de pagamento afirmativos são reconhecidos; negação/intenção futura não confirma nem bloqueia indevidamente; só Núbia/autorizados conferem.
- Endereço e cuidados corretos saem após conferência, uma vez; timeout não dispara duplicação cega.
- Handoff deixa Kanban e conversa coerentes e silencia respostas automáticas, inclusive após reset ou novas mensagens.
- Nova reserva existente, terceiros, remarcação, reembolso, foto da pele e erro de agenda seguem destino aprovado.
- Lembrete e retomada respeitam data, consentimento/opt-out, cancelamento, pausa, limite, janela e idempotência.
- Conversas antigas no painel e fronteiras de sessão são testadas separadamente; falha da janela global de histórico deve ser tratada como tarefa própria, sem carregar todo o histórico a cada atualização.

## 8. Estado dos entregáveis

- Concluído: leitura das respostas, comparação com arquivos da `prod`, matriz de mudanças e identificação das pendências.
- Planejado: snapshot LIVE, decisões da Núbia, mensagens finais, migrações, configuração versionada, testes e runbook de publicação.
- Não realizado nesta etapa: consulta ao banco LIVE, alteração de workflow, SQL operacional, publicação ou envio de mensagens.
