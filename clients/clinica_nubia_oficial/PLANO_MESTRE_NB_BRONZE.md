# Plano mestre de adequação da NB Bronze

Data da revisão: 03/10/2026.

**Status: especificação para implementação e aprovação. Este documento não aplica SQL, não publica workflows, não altera configurações LIVE e não autoriza disparos.**

Tenant de destino: `clinica_nubia_oficial`. Nome comercial: **NB Bronze**. Núbia é a responsável, não o nome comercial.

## 1. Objetivo e definição de conclusão

Adequar o atendimento completo da NB Bronze às respostas de Beatriz no questionário de 02/10/2026, preservando o isolamento dos demais clientes. Resolver a causa estrutural de informações divergentes, coleta incompleta, decisões inadequadas, agendamento inconsistente, transferência humana e perda aparente de histórico. Não limitar a entrega a uma resposta sobre o Bronze a Jato.

O trabalho só estará concluído quando:

- [ ] Catálogo, fatos, textos aprovados e comportamento estiverem coerentes entre si.
- [ ] Perguntas informativas forem respondidas sem iniciar operações indevidas.
- [ ] A IA coletar e persistir os dados exigidos, sem inventar nem repetir dados disponíveis.
- [ ] Disponibilidade e reserva respeitarem recursos, capacidade, duração e concorrência.
- [ ] Pré-reserva, aviso de pagamento e confirmação financeira forem diferenciados.
- [ ] A transferência humana silenciar a IA e aparecer consistentemente no painel e no Kanban.
- [ ] O histórico completo puder ser consultado sem depender de uma janela global de eventos.
- [ ] Mensagens operacionais, lembretes e retomadas tiverem deduplicação, elegibilidade e rastreabilidade.
- [ ] Configurações novas estiverem limitadas à NB Bronze e regressões dos outros tenants passarem.
- [ ] Núbia ou a pessoa formalmente autorizada aprovar textos, regras pendentes e testes de ponta a ponta.

Ausência de resposta no questionário não significa autorização para inventar, apagar uma regra vigente ou ampliar os poderes da IA.

## 2. Fontes, versões e limites da análise

### 2.1 Fontes de negócio

1. [Questionário respondido](questionario-clinica-nubia-beatriz-2026-10-02.pdf): 17 páginas, responsável Beatriz, data 02/10/2026, Núbia indicada como aprovadora. O campo final de aprovação não foi preenchido.
2. [Plano anterior](PLANO_QUESTIONARIO_2026-10-02.md): análise inicial e pendências. Este plano mestre consolida e detalha a execução; o plano anterior fica preservado como registro.
3. Solicitações explícitas do responsável no histórico: nome NB Bronze, isolamento entre tenants, textos completos e identificação do fluxo sempre que for indicada alteração de nó.
4. Documentos anteriores, como `Movvy_Agendamento_Servicos.docx` e o `NB.docx` mencionado no histórico: referências legadas a reconciliar, não autoridades automáticas acima do questionário novo. `NB.docx` não foi localizado entre os arquivos listados nesta revisão; obter a versão vigente antes de usá-lo como fonte literal.

### 2.2 Fontes técnicas

- Diretório verificado na branch `prod`, acompanhando `origin/prod`; commit-base identificado na investigação: `7dc217d`. Revalidar o HEAD antes da implementação.
- Workflow enviado em 03/10, anexo `b0386dfb-a0ea-4e6a-baab-ef81d89d62aa/Pasted text.txt`.
- Configuração NB Bronze enviada em 03/10, anexo `85e7e169-8786-4c3c-9c17-25516c2e2afc/Pasted text.txt`.
- Configuração Gênesis enviada em 03/10, anexo `9382f9fa-981d-446d-9ab1-bc999c291667/Pasted text.txt`, usada somente para proteger compatibilidade e isolamento.
- Arquivos fonte de `n8n/code`, builders de `scripts`, migrações de `supabase/migrations` e frontend de `app/src`.

Os anexos estavam em `C:/Users/wever/.codex/attachments/`. Esses caminhos são referências locais da investigação, não dependências de implantação. Preservar cópias privadas e hashes no inventário de release.

**Não foi feita consulta LIVE ao banco nesta elaboração.** Configuração anexada não comprova o estado atual de todas as tabelas, funções, permissões ou execuções.

### 2.3 Divergência entre código publicado e repositório

O Core do workflow anexado difere do Core local, sobretudo na lógica comercial da Gênesis. Os outros nós de código comparados na investigação anterior coincidiam. Antes de regenerar o workflow, reconciliar as diferenças do Core com os módulos fonte.

Não publicar o Core gerado localmente por cima do anexo sem esse trabalho: isso pode remover comportamento comercial já publicado, mesmo que a tarefa seja da NB Bronze.

Também existem alterações locais anteriores em arquivos da Núbia. Preservar essas alterações, não executar checkout/reset destrutivo e não trocar de branch sobre trabalho não protegido.

### 2.4 Regras de autoridade

| Tipo de informação | Fonte de verdade pretendida |
|---|---|
| Nome, endereço, horários e políticas aprovadas | Configuração versionada do tenant |
| Serviço, preço e características | Catálogo normalizado do tenant |
| Texto obrigatório | Biblioteca de mensagens aprovadas com revisão e origem |
| Disponibilidade | Consulta transacional da agenda, não texto do prompt |
| Reserva existente | Registro persistido de agendamento |
| Pagamento confirmado | Ação autenticada da pessoa autorizada ou integração financeira aprovada |
| Controle humano | Estado persistido da conversa, não intenção inferida pelo modelo |
| Resultado da entrega | Registro do provedor e estado local de envio |

O prompt interpreta e orienta a conversa. Ele não substitui validação de dados, autorização, persistência, capacidade nem confirmação financeira.

## 3. Diagnóstico consolidado

| ID | Situação observada | Efeito possível | Tratamento |
|---|---|---|---|
| R01 | Fatos e prompt não incorporam integralmente o PDF | Informação antiga e encaminhamentos por aparente ausência de dados | Reconciliar catálogo, fatos e prompt com rastreabilidade |
| R02 | Jato tem tempos no PDF, mas não nos fatos anexados; catálogo LIVE não verificado | IA pode não responder duração | Conferir catálogo e publicar campos separados |
| R03 | `schedulingValidateAction()` interpreta padrões na resposta gerada como intenção de agenda | Texto como `1h` vira consulta de horário | Despacho por ação estruturada validada |
| R04 | Encaminhamento tem mensagem genérica e diagnóstico insuficiente | Difícil distinguir falta de fato, política e falha técnica | Motivos estruturados e auditoria |
| R05 | Coleta canônica não contempla todo o cadastro pedido | Reserva sem nascimento ou bairro | Ampliar contrato, validação, persistência e UI |
| R06 | Agenda legada trabalha com bloco global e grade fixa | Durações variáveis e recursos compartilhados podem gerar conflito | Motor por intervalos, opt-in e transacional |
| R07 | Textos montados pelo código podem divergir do prompt | Atualizar só o prompt não muda todas as respostas | Inventariar e unificar renderizadores |
| R08 | `/reset` é tratado antes do bloqueio humano no runtime inspecionado | Cliente pode reabrir resposta automática por comando | Controle autorizado e bloqueio prioritário |
| R09 | UI reconstrói dados a partir de janela global de eventos | Conversas somem ou começam incompletas | Resumos paginados e histórico por conversa |
| R10 | Follow-up comercial e lembrete de reserva têm elegibilidade diferente | Envio indevido ou lembrete nunca enviado | Separar tipos de job e regras |
| R11 | Código anexado e módulos locais estão divergentes | Build pode reverter funcionalidade de outro tenant | Baseline reproduzível antes das mudanças |
| R12 | PDF possui campos vazios, contradições e texto extraído com falhas | Automatização de suposições ou mensagens corrompidas | Registro de decisões e revisão visual |

O texto do print corresponde ao caminho `action=handoff` de `groundingValidateResponse()`. Não corresponde à frase de limite de histórico. A causa da decisão naquela execução depende de evento, catálogo e entrada efetiva do modelo; não está comprovada apenas pelo print.

## 4. Inventário obrigatório antes de implementar

### 4.1 Banco e configurações

- [ ] Resolver o UUID de `clinica_nubia_oficial` e confirmar status, canal e instância corretos.
- [ ] Exportar configuração atual de `tenant_settings`, incluindo revisão, flags, modelo e limites.
- [ ] Exportar catálogo ativo e inativo, IDs, preços, descrições, metadados e vínculos com reservas.
- [ ] Levantar prompts legados ativos e todos os caminhos que ainda os utilizam.
- [ ] Exportar quadros, colunas, ordem e significado operacional de cada etapa.
- [ ] Identificar membros autorizados a confirmar pagamento, reservar, cancelar, encerrar e devolver à IA.
- [ ] Inventariar reservas futuras, pendentes de sinal, duplicidades e reservas manuais.
- [ ] Levantar bloqueios, feriados, capacidade configurada e regras de ocupação existentes.
- [ ] Levantar políticas e jobs de follow-up, inclusive pendentes, cancelados e com entrega incerta.
- [ ] Inspecionar tabelas de contatos existentes antes de propor tabela nova para cadastro.
- [ ] Verificar RPCs realmente instaladas, assinaturas, segurança, grants e RLS.
- [ ] Identificar versão efetiva das migrações; há prefixos numéricos repetidos no repositório. Não escolher o próximo número apenas por contagem de arquivos.

### 4.2 n8n e transporte

- [ ] Exportar workflows publicados, IDs, estado de ativação e referências entre eles.
- [ ] Comparar cada nó com o anexo e os arquivos locais, preservando credenciais por referência.
- [ ] Identificar rota Core e eventuais rotas legadas usadas pelo tenant.
- [ ] Conferir webhook de produção, normalização, deduplicação, fila, recuperação e envio.
- [ ] Verificar retenção de execuções suficiente para investigar incidentes, sem ampliar retenção indiscriminadamente.
- [ ] Documentar timeout, retry e comportamento de entrega incerta da Evolution.
- [ ] Verificar como o comando de confirmação de sinal passa pelo Command Router e pelo código de confirmação.

### 4.3 Snapshot e isolamento

- [ ] Guardar snapshot privado de configurações e versões, com data, tenant, hash e responsável.
- [ ] Não incluir tokens, dados de saúde, telefones ou documentos em arquivos públicos do repositório.
- [ ] Usar banco de teste isolado e transporte falso para testes automáticos.
- [ ] Não considerar localhost com credenciais LIVE como ambiente isolado.
- [ ] Obter baseline de comportamento da Gênesis e demais caminhos compartilhados, sem corrigir regras comerciais desses clientes nesta entrega.

## 5. Matriz de negócio: identidade, atendimento e funcionamento

| Fonte PDF | Resposta | Implementação |
|---|---|---|
| P. 1, 1.1.1 | NB Bronze | Alinhar nome do tenant, fatos, mensagens e UI; manter slug/IDs |
| P. 1, 1.1.2 | Recepcionista do espaço NB Bronze | Apresentar papel sem se passar pela Núbia |
| P. 1, 1.1.3 | “Qual seu nome ?” | Perguntar nome ausente; não repetir nome informado |
| P. 1, 1.1.4 | Responder e apresentar na mesma mensagem | Dúvida inicial não pode ser ignorada por saudação rígida |
| P. 1, 1.1.5 | Acolhedor, descontraído | Ajustar estilo por tenant; não introduzir intimidade não aprovada |
| P. 1, 1.1.7 | Emojis quando necessário | Tornar política compatível com textos aprovados; preservar sobriedade em incidentes |
| P. 1, 1.1.8 | “Sim” quando perguntarem sobre IA | Responder com transparência |
| P. 1, 1.2.2 | Av. Itaguaí, 200, Nova Angra, casa verde de 3 andares, portão branco | Atualizar localização determinística; não inventar link |
| P. 2, 1.2.7 | Humano das 9h às 20h | Separar de funcionamento e confirmar dias da semana |
| P. 16, 9.2.2 | “Obrigada pela preferência.” | Vincular ao encerramento explícito e deduplicar |

Exclusividade de atendimento em Angra não foi respondida no novo PDF. Não cadastrar outra unidade nem anunciar encerramento de unidade com base em silêncio. Preservar escopo atual até confirmação.

### 5.1 Horários informados

| Dia | Funcionamento informado | Observação |
|---|---|---|
| Segunda | 16h às 19h | Não define inícios de sessão |
| Terça | “10h 15h” | Confirmar interpretação como 10h às 15h |
| Quarta | 15h às 19h | Não define inícios de sessão |
| Quinta | 10h às 15h | Não define inícios de sessão |
| Sexta | 14h às 19h | Não define inícios de sessão |
| Sábado | 10h às 15h | Não define inícios de sessão |
| Domingo | 8h às 11h | Regras de adicional aplicáveis |
| Feriado | 8h às 11h | Exige calendário oficial cadastrado |

Horário de abertura não é vaga disponível, nem autorização para iniciar um procedimento que termine depois do fechamento. A grade de inícios ficou sem resposta em 4.1.1. Confirmar término máximo, intervalos e exceções antes de alterar a grade.

## 6. Catálogo: plano por serviço

### 6.1 Modelo comum

Cada serviço deverá ter dados distintos para:

- ID estável, nome oficial, categoria, aliases e situação de oferta.
- Preço em centavos na lógica de cálculo; adaptar o campo monetário existente sem perda de precisão.
- Descrição aprovada, itens incluídos, adicionais e observações ainda não definidas.
- Duração de procedimento fixa ou intervalo mínimo/máximo; não reduzir faixa a um número arbitrário.
- Permanência orientada à cliente, que pode ser diferente da ocupação do recurso.
- Ocupação de sala, máquina e profissional, com preparo/limpeza explicitados.
- Capacidade física e capacidade de agendamento, sem assumir que são iguais.
- Modalidade/local, dias especiais, dependência de clima e agendamento automático ou humano.
- Preparo, itens a levar, cuidados posteriores e questões que exigem equipe.
- Origem documental, revisão, data de vigência e aprovador.

Um campo ausente deve continuar ausente e identificado como pendência. `null` não significa zero minutos, gratuidade ou ausência de restrição.

### 6.2 Bronze Clássico

Fonte: páginas 2 a 4 e 9 a 10.

- Preço confirmado: R$ 99,99.
- Máquina em pé; primeiro frente, depois costas; sala compartilhada.
- Ativador e bronzeador no corpo todo.
- Procedimento informado: 40 a 80 minutos, conforme avaliação presencial.
- Permanência: 1h30 a 2h30.
- Capacidade física mencionada: até 6 clientes; capacidade agendável confirmada: 4.
- Bloqueio informado: 15 minutos. Não ativar como ocupação total sem esclarecer a divergência.
- Não impede outros serviços, segundo a ficha; ainda verificar dependência real de equipe e recursos compartilhados.
- Catalogar separadamente os textos de descrição, preparo, itens e pós-cuidados.
- Não manter “dura sempre 1 hora” como regra depois da atualização.
- Não prometer resultado imediato; essa proibição consta da página 14.

### 6.3 Bronze Premium

Fonte: páginas 4 e 5.

- Preço: R$ 149,99; máquina dupla, frente e costas simultaneamente, sala individual.
- Inclui ativador e bronzeador no corpo todo.
- Procedimento: 40 a 80 minutos; permanência: 1h30 a 2h30.
- Capacidade: 1 cliente; bloco informado: 1 hora.
- Resolver como um procedimento de até 80 minutos se relaciona com 60 minutos de agenda.
- Não copiar automaticamente preparo e pós-cuidados do Clássico: essas respostas ficaram em branco nesta ficha.
- Revisar alegações comparativas de potência/resultado com a responsável técnica antes da publicação literal.

### 6.4 Bronze Comfort

Fonte: páginas 5 e 6.

- Preço: R$ 179,99; máquina deitada e sala individual.
- Inclui bronzeador e ativador no corpo todo.
- Procedimento: 40 a 80 minutos; bloco informado: 90 minutos; capacidade: 1 cliente.
- Permanência, preparo e pós-cuidados não foram preenchidos; não apresentar os 90 minutos de agenda como permanência confirmada.
- Confirmar quais orientações podem ser compartilhadas com outros bronzes de máquina.

### 6.5 Bronze a Jato na clínica

Fonte: páginas 6, 7 e 10.

| Campo | Valor informado |
|---|---|
| Preço | R$ 149,99 |
| Aplicação | 20 minutos |
| Permanência no espaço | 45 minutos |
| Bloqueio de agenda | 30 minutos |
| Capacidade | 1 cliente |
| Resultado | Até 15 dias, dependendo dos cuidados |
| Período sem molhar | 8 a 12 horas |
| Agendamento | Equipe humana |
| Limpeza incluída | Ainda não definido |

Implementar explicitamente a diferença entre os três tempos. Os 45 minutos constam da resposta 2.2.6, página 6. Não perguntar novamente esse dado à responsável como se estivesse ausente.

Para pergunta genérica sobre tempo, informar aplicação e permanência. Para pergunta sobre durabilidade, informar duração do resultado. Para pergunta sobre banho, usar o período de cuidados, não o tempo do atendimento.

Texto de teste, não substituto automático do texto aprovado: “A aplicação do Bronze a Jato dura cerca de 20 minutos. Para o atendimento completo, reserve aproximadamente 45 minutos no espaço.”

Não publicar “inclui limpeza corporal” enquanto o questionário registrar essa condição como indefinida. Não manter R$ 150 como preço oficial depois da adoção desta revisão.

Registrar os 30 minutos como informação declarada de agenda, mas esclarecer quais recursos ficam ocupados durante os 45 minutos de permanência antes de automatizar qualquer reserva. O agendamento continuará humano conforme a resposta expressa.

### 6.6 Jato a domicílio

A descrição da página 6 oferece domicílio de Monsuaba ao Pontal por R$ 200 e consulta para outras regiões. A resposta 3.2.4 da página 10 informa “Na clínica”.

Não concluir unilateralmente que o domicílio foi abolido, nem oferecê-lo como modalidade plenamente confirmada. Confirmar se coexistem duas modalidades, região, preço total, deslocamento, preparo do local e disponibilidade.

Se confirmadas duas modalidades, ter IDs/variantes explícitos ou vínculo claro entre serviço e local. Não converter o registro histórico de domicílio em Jato na clínica mantendo o mesmo significado de ID.

### 6.7 Bronze Solar

Fonte: páginas 7 a 10.

- Preço: R$ 99,99; inclui acompanhamento, ativador/bronzeador e café da manhã conforme ficha.
- Realizado pela manhã em dia de sol; duração depende de avaliação.
- Permanência: reservar a manhã livre até 11h.
- Capacidade: 5 clientes; agendamento exclusivamente humano.
- Bloqueio informado: 15 minutos, ainda incompatível com assumir ocupação total até 11h.
- Impede bronze de máquina: identificar quais equipamentos/profissionais precisam ser bloqueados.
- Quando clima impedir, a equipe pode tratar alternativas de máquina/Jato; não trocar serviço ou preço sem consentimento.
- Registrar o atendimento manual no mesmo mecanismo de recursos, para a IA não oferecer máquina indevidamente.
- Não prometer resultado imediato.

### 6.8 Banhos de Lua

Fonte: página 10, 3.3.1 e 3.3.2.

- Clássico: R$ 19,99.
- Premium: R$ 34,99.
- Comfort: R$ 69,99.
- Retirar do novo atendimento a regra textual “serviço único, sem versões”.
- Reconciliar registros ativos/inativos e reservas antigas; não excluir o serviço legado de R$ 60 nem reescrever reservas históricas.
- Obter etapas, diferença entre versões, duração, preparo, recursos e modalidade de agendamento.
- Não reutilizar automaticamente os 40 minutos do Banho de Lua único em todas as versões.

### 6.9 Outros itens

| Item | Confirmado no PDF | A fazer |
|---|---|---|
| Jato no Bojo | Existe, R$ 49,99 | Área atendida, descrição, duração, recursos e preparo |
| Detox/Mousse Clareador | Mesmo serviço, R$ 49,99 | Consolidar aliases, evitar duplicidade, completar ficha |
| Potência Bronze/Bronze Duplo | Mesmo produto; tabela R$ 179,99 / R$ 229,99 / R$ 259,99 | Vincular cada preço à combinação exata; não inferir ordem |
| Clareamento de áreas | Citado como serviço disponível | Confirmar se é independente do Detox, áreas, preços e ficha |
| Desconto de amiga | 15% no Clássico | Beneficiária, quantidade, data, vigência e incidência financeira |

Não manter simultaneamente a tabela fixa de combo e a fórmula antiga “bronze + R$ 99,99”. Até definição do mapeamento, a equipe confirma o valor específico.

## 7. Biblioteca de mensagens e estilo

### 7.1 Inventário de saídas

Levantar todos os lugares que geram texto: Gemini, respostas diretas, catálogo completo, localização, Pix, coleta, falha de consulta, reserva criada, sinal reportado, confirmação humana, encerramento e follow-up.

Uma mudança de prompt não alcança necessariamente textos montados no backend. Toda mensagem comercial deverá apontar para a mesma versão dos fatos.

### 7.2 Chaves propostas

As chaves abaixo são especificação, não campos já implementados:

| Grupo | Mensagens necessárias |
|---|---|
| Recepção | Apresentação, pedido de nome ausente, transparência sobre IA |
| Catálogo | Lista geral, comparação de bronzes, apresentação de cada serviço/variante |
| Orientações | Preparo, itens a levar, cuidados posteriores por modalidade |
| Reserva | Coleta faltante, resumo, pré-reserva persistida, horário indisponível |
| Pagamento | Dados Pix, pedido de link, aviso de conferência, confirmação, divergência |
| Exceções | Recusa de sinal, horário especial, remarcação, cancelamento, atraso |
| Humano | Aviso único de transferência, indisponibilidade da equipe, retomada autorizada |
| Ciclo | Encerramento, lembrete, retomada comercial, opt-out |

Cada mensagem terá chave, revisão, texto, parâmetros permitidos, condições de uso, prioridade e fonte. Não deixar o modelo inventar a chave ou o conteúdo de parâmetro financeiro.

### 7.3 Regras de renderização

- Pedido de todos os serviços: apresentar o catálogo completo aprovado, não apenas três opções arbitrárias.
- Pedido somente de preço: enviar apresentação completa do serviço, conforme 8.1.4.
- Pergunta específica sobre tempo: responder diretamente; não é necessário despejar o catálogo.
- Não reenviar blocos longos a cada fragmento; usar o histórico da sessão e pedidos explícitos de reenvio.
- Preservar acentos, ordem, emojis e quebras de linha aprovados. Normalização de busca não altera o texto exibido.
- Revisar visualmente o PDF: a extração apresentou caracteres corrompidos e trechos truncados, especialmente em linhas com emojis. Não reconstruir trechos ausentes por adivinhação.
- Compatibilizar limpeza de Markdown e política de emojis com blocos literais; não alterar globalmente os outros tenants.
- Se houver divisão por tamanho, usar limites reais do canal, partes ordenadas e registro de envio por parte.
- Placeholders só podem usar valores validados, como serviço, data, hora, preço e saldo. Não recitar nascimento em confirmação pública.
- Definir comportamento quando o nome não foi informado e quando a primeira mensagem já contém uma dúvida.

## 8. Contrato de decisão da IA

### 8.1 Separar informação de ação

O modelo identifica intenção e extrai fatos com evidências. O backend valida e executa ações. Não tomar decisões operacionais pela aparência da frase gerada.

Classes necessárias: informação sobre serviço, catálogo, localização, pagamento, consulta de agenda, escolha de horário, criação de reserva, referência anterior e encaminhamento.

Manter compatibilidade com o schema existente ou introduzir versão opt-in. Nomes novos de ações/campos serão definidos na implementação e não devem ser presumidos já aceitos pelo runtime.

### 8.2 Correção de `schedulingValidateAction()`

- [ ] Remover gatilhos de agenda baseados em regex sobre `generated.text`, inclusive números seguidos de `h`.
- [ ] Consultar vagas apenas quando a ação estruturada validada exigir disponibilidade.
- [ ] Exigir serviço/data e unidade conhecida antes da consulta; unidade padrão continua fato do tenant.
- [ ] Preservar resposta informativa mesmo quando a conversa já contém uma data ou intenção anterior de agendar.
- [ ] Distinguir nova consulta de vaga, seleção entre opções e consentimento para criar reserva.
- [ ] Revalidar vaga no ato da reserva; oferta anterior não é garantia.
- [ ] Responder informações de Jato/Solar; encaminhar somente a operação de agendamento ou outra razão válida.
- [ ] Impedir que uma simples pergunta sobre preço gere reserva, cobrança ou bloqueio humano.

### 8.3 Falta de dados e encaminhamento

Separar dados que faltam à cliente de fatos que faltam ao cadastro. Falta de nome/data/horário pode gerar coleta; falta de preço, regra de segurança ou condição comercial não pode ser resolvida inventando.

Registrar motivo estruturado do encaminhamento, por exemplo: agenda humana do serviço, ausência de fato, falta de vaga, pedido de pessoa, pagamento, alteração, incidente ou falha técnica. São motivos operacionais verificáveis, não raciocínio interno do modelo.

Uma pergunta respondível com dados cadastrados não deve virar humano só porque a modalidade não possui agenda automática. O motivo informado pelo modelo deve ser validado contra o estado e a política.

## 9. Estado de conversa, contexto e coleta

### 9.1 Dados necessários

| Campo | Origem/validação | Persistência |
|---|---|---|
| Nome e sobrenome | Mensagem da cliente, sem usar nome do perfil como prova | Contato e snapshot da reserva |
| Nascimento | Data real, não futura, ambiguidade esclarecida; sem idade mínima inventada | Cadastro protegido |
| Bairro | Resposta da cliente, sem inferir por DDD/localização | Cadastro protegido |
| Serviço/variante | ID válido e modalidade inequívoca | Estado e reserva |
| Data/hora | Evidência textual e fuso do tenant | Estado e reserva |
| Unidade | Configuração oficial; não repetir pergunta desnecessária | Estado e reserva |
| Evidências | IDs reais da sessão e correções posteriores | Auditoria mínima necessária |

Não rejeitar automaticamente nomes legítimos por uma regra simplista de quantidade de palavras; nome incompleto ou duvidoso deve ser esclarecido sem constrangimento. Não adicionar CPF/CNH ao fluxo clínico por reaproveitar a capacidade comercial.

### 9.2 Continuidade

- Interpretar mensagens fragmentadas como um turno agrupado, incluindo transcrição autorizada.
- Respeitar correção explícita mais recente, inclusive remoção de um dado anteriormente informado.
- Diferenciar campo omitido de campo explicitamente apagado; não restaurar valor antigo automaticamente.
- Ao trocar serviço, invalidar dependências: preço, horário oferecido, duração, recursos e orientações anteriores.
- Ao trocar data, invalidar disponibilidade antiga; não perder nome/bairro sem motivo.
- Ao responder uma dúvida intermediária, manter o progresso de coleta.
- Não inferir que todo “15” é horário: considerar pergunta anterior e confirmar ambiguidade relevante.
- Resolver hoje/amanhã a partir do horário da mensagem e fuso `America/Sao_Paulo`, inclusive virada de dia.
- Pedido de bairro de cadastro não pode acionar a resposta determinística de endereço da clínica.

### 9.3 Sessões e memória

Separar histórico visível no painel, sessão de atendimento, cadastro do contato e reservas. Encerrar a conversa não apaga cadastro nem cancela agendamentos.

A política de reutilizar preferências ao iniciar outro atendimento ficou indefinida em 9.2.3. Preservar a política vigente até decisão e não reutilizar silenciosamente serviço/dia/horário de sessão encerrada.

Consulta de reserva anterior só usa registros verificados e permissões corretas. Referência a outro número ou outra pessoa segue equipe humana; não expor dados com base apenas em nome.

Monitorar tamanho de contexto sem truncar silenciosamente evidências. Se houver limite, registrar motivo e encaminhar com resumo seguro. Uma futura compactação de estado precisa ser testada, não implantada como resumo livre que vira fonte de fatos.

## 10. Agenda e recursos

### 10.1 Modelo alvo

Separar calendário de funcionamento, grade de inícios, recurso, capacidade, ocupação, bloqueio e reserva. O cálculo deve usar intervalos de ocupação, não apenas igualdade de horário inicial.

Para cada reserva: início, fim, serviço/revisão, recursos, unidades de capacidade, estado, sessão de origem, preço vigente e autor da operação. Para etapas que usam recursos em momentos diferentes, representar intervalos por recurso quando necessário; não bloquear ou liberar tudo pelo mesmo tempo sem validação operacional.

Usar limites de intervalo consistentes, como início incluído/fim excluído, para permitir uma sessão começar exatamente quando outra termina, desde que limpeza/preparo já estejam contemplados.

### 10.2 Consulta e reserva

- Consulta e criação devem compartilhar a mesma regra de elegibilidade no banco.
- Capacidade deve considerar todos os atendimentos que se sobrepõem, inclusive manuais e pendentes que efetivamente seguram vaga.
- Reservar múltiplos recursos atomicamente, com ordem consistente de locks.
- Concorrência entre duas clientes pela última vaga deve resultar em uma reserva válida, nunca duas.
- Aplicar idempotência por pedido/turno e rejeitar respostas antigas do modelo após mudança de sessão/controle.
- Não permitir que a UI reserve por um caminho menos restritivo do que a IA.
- Alteração autorizada deve trocar ocupação atomicamente, sem perder a reserva original se a nova vaga falhar.
- Liberar ocupação apenas por estado autorizado, sem confundir falha no envio com cancelamento.

### 10.3 Políticas específicas

- Clássico: quatro vagas agendáveis; seis é capacidade física descrita.
- Premium/Comfort: uma cliente por recurso.
- Solar: humano, cinco clientes declaradas, dependência de clima e bloqueio das máquinas a detalhar.
- Jato: humano; informar tempos não implica oferecer vaga automaticamente.
- Sem vaga ou horário fora da grade: encaminhar à equipe, não insistir em alternativas contra a regra respondida.
- Profissional não é escolhida pela cliente, conforme 4.1.7; alocação interna deve continuar possível.
- Bloqueios e exceções são atualizados pela Núbia, com identidade autenticada e permissão.
- Mesma data e encaixe são admitidos no PDF, mas dependem de disponibilidade e regra de antecedência.
- “2 horas” em 4.1.3 não responde separadamente mínimo e máximo: confirmar antes de automatizar.
- Feriados exigem calendário explícito; não inferir por modelo ou pelo nome do dia.

### 10.4 Pré-reserva e migração

O questionário não define prazo de retenção de vaga nem ação após vencimento. Não ativar expiração automática arbitrária. Inventariar comportamento atual, levar proposta à aprovação e manter a política vigente identificada até decisão.

Antes de mudar duração/grade, simular todas as reservas futuras. Não deslocar, reduzir, cancelar ou reprificar reservas existentes automaticamente. Gerar lista de conflitos para tratamento humano e manter versão da regra associada às reservas.

## 11. Pagamento e sinal

### 11.1 Dados declarados

Fonte: páginas 11 e 12.

- Pix: chave `21966353026`, favorecida Silvana Marques, instituição CLOUDWALKIP LTDA. Reconfirmar no snapshot antes da publicação.
- Sinal: 50%.
- Sinal aceito por Pix ou link de cartão de crédito; definir quem emite o link.
- Restante: no procedimento, dinheiro ou aproximação no espaço.
- Nenhuma condição de cartão/parcelamento autorizada para divulgação.
- Adicional: R$ 10 após 17h, domingos e feriados; não entra no cálculo do sinal.
- Acúmulo de adicionais: ainda não definido.
- Qualquer aviso de pagamento inicia conferência; confirmação é feita pela Núbia.

### 11.2 Cálculo

Manter preço-base, desconto autorizado, preço do serviço após desconto, adicional, sinal esperado, pagamentos e saldo separados. Não embutir adicional no sinal se a regra aprovada o exclui.

Definir arredondamento explícito de 50% de valores terminados em 99 centavos. Usar centavos inteiros na lógica financeira e testes; não deixar o modelo fazer contas ou formatar valor não validado.

O desconto de amiga foi autorizado em princípio, mas falta determinar quem recebe e condições. Não ativar cálculo automático antes de fechar essas perguntas. Não divulgar promoção sem prazo/condições definidos como se fosse incondicional.

### 11.3 Fluxo financeiro

1. Registrar pré-reserva válida, quando a modalidade permitir automação.
2. Enviar dados e valor de sinal calculado conforme regras aprovadas.
3. Ao receber afirmação de pagamento, associar à reserva correta e marcar pagamento reportado.
4. Enviar um único aviso de conferência, mover estado/coluna e silenciar IA.
5. Núbia ou pessoa formalmente autorizada confere e confirma por comando autenticado.
6. Persistir confirmação antes de anunciar que houve pagamento conferido.
7. Enviar confirmação, endereço e orientações específicas do serviço.
8. Registrar entrega e agendar lembrete apenas se elegível.

“Não paguei”, “vou pagar” e “como pago?” não são afirmações de pagamento. Comprovante sozinho precisa de política explícita; imagem não autentica transferência. Reserva inexistente, múltiplas candidatas ou valor divergente devem ir para conferência sem atualização arbitrária da última reserva.

### 11.4 Falhas e concorrência

- Duplo clique em confirmar não pode duplicar registro nem mensagens.
- Confirmar pagamento e cancelar reserva em paralelo exige controle de versão e decisão consistente.
- Erro no envio não desfaz pagamento já conferido.
- Timeout da Evolution pode representar envio aceito; manter entrega incerta e não reenviar cegamente.
- Nova mensagem da cliente enquanto aguarda não pode disparar outra cobrança ou confirmação automática.
- O texto de confirmação só pode ser usado após a operação correspondente, nunca porque o modelo disse que confirmou.

## 12. Estados, atendimento humano e Kanban

### 12.1 Estados independentes

| Dimensão | Estados conceituais |
|---|---|
| Conversa | IA ativa, aguardando humano, humano atendendo, encerrada |
| Reserva | Em coleta, pré-reservada, confirmada, cancelada, concluída; expiração depende de regra |
| Pagamento | Não reportado, reportado, em conferência, confirmado, divergente |
| Mensagem | Pendente, em envio, aceita pelo provedor, entregue quando verificável, falha, incerta |
| Job | Agendado, reivindicado, concluído, cancelado, falha/incerto |

Esses nomes são modelo conceitual. Mapear para schema existente antes de criar novos enums ou colunas. Kanban é representação operacional, não substituto de todos os estados.

### 12.2 Transições obrigatórias

| Evento | Resultado esperado |
|---|---|
| Cliente pede atendente | Aviso único, estado humano, cartão coerente, IA bloqueada |
| Pedido de agenda de Jato/Solar | Responder dados conhecidos e transferir a operação de agenda |
| Pagamento reportado | Conferência, aviso único, IA bloqueada |
| Confirmação autorizada | Atualizar pagamento/reserva e enviar pacote aprovado |
| Mensagem com conversa humana | Registrar inbound e manter silêncio automático |
| Operador devolve à IA | Validar permissão/revisão e retomar contexto permitido |
| Encerramento | Encerrar sessão e enviar mensagem aprovada uma vez; não cancelar reserva |
| Cliente manda `/reset` durante humano | Não remover bloqueio nem autorizar IA |

Proposta de colunas a validar no LIVE: Conversas IA, Aguardando sinal, Verificar Sinal, Agendamento confirmado e Atendimento humano. Não criar colunas duplicadas nem trocar IDs usados por automações.

### 12.3 Encaminhamentos previstos

Agendamento de Solar/Jato; sem vaga; horário especial; cancelamento/remarcação/atraso; divergência de pagamento; erro real de agenda/entendimento; foto da pele; relato de dor/queimadura/reação; insatisfação com resultado; consulta de reserva de terceiros; pedido explícito de pessoa; nova reserva quando já existe outra.

Recusa de sinal tem orientação própria no PDF e não deve ser encaminhada automaticamente só por recusar. Explicar a regra e possibilidade de consultar encaixe, sem confirmar vaga.

### 12.4 Persistência e responsabilidade

Transferência deve gravar controle antes do envio e da execução de novos turnos. Revalidar controle antes de toda saída ou operação após espera/modelo. Descrever motivo, dados já coletados e próximo passo, sem exigir que a cliente repita tudo.

Definir destinatário e prioridade por motivo. “Atendimento humano” sem responsável pode ser permitido provisoriamente, mas deve aparecer em uma fila monitorada; não tratar transferência como resolução automática do caso.

## 13. Cancelamento, remarcação, grupos e exceções

- PDF exige equipe para cancelamento, remarcação e atraso; IA não executa essas operações sozinha.
- Tolerância informada: cinco minutos. Confirmar referência do horário para não confundir com chegada antecipada.
- Limite informado de remarcação: uma vez por sinal.
- Texto contém 8 horas e também 24 horas com exceção de 8; manter decisão humana até política inequívoca.
- Reembolso aparece como continuidade com IA em 8.2.5, mas cancelamentos são humanos em 6.1.8. A IA pode acolher e informar que haverá análise, sem negar ou prometer devolução autonomamente.
- Cancelamento pela clínica tem remarcação indicada, mas não autoriza apagar reserva ou decidir disputa financeira sem análise.
- Reserva para outra pessoa foi respondida “Não”; reserva de grupos admite nomes e 50% individuais. Confirmar a exceção e coleta/autorização de cada participante.
- Múltiplas reservas futuras estão indefinidas; pedido de nova reserva com uma existente foi explicitamente direcionado para humano.
- Alteração de serviço exige verificar valor, recursos, duração e cuidados; não reutilizar reserva antiga silenciosamente.

## 14. Preparo, resultados e segurança dos conteúdos

### 14.1 Conteúdo operacional

- Chegada com 15 minutos de antecedência informada para todos os serviços.
- Crianças, acompanhantes e bicicletas não são permitidos segundo o PDF; definir tratamento humano para necessidades especiais, sem inventar exceção automática.
- Não misturar orientações de máquina, Solar e Jato, inclusive prazos de depilação diferentes presentes nas fichas.
- Enviar pacote de preparo/cuidados após conferência de sinal, conforme interpretação operacional proposta; confirmar se a responsável quis aviso de pagamento ou efetiva conferência.
- Perguntas explícitas de preparo antes do pagamento devem poder receber informação aprovada; confirmar que a regra de envio não significa esconder orientações necessárias.

### 14.2 Limites

O PDF contém orientações técnicas e menção a medicamentos. Não transformar essas passagens em recomendação clínica individual automática. Submeter textos à responsável técnica, definir mensagem segura e encaminhar relatos individuais à equipe.

Identificar a tecnologia dos equipamentos e validar conteúdo técnico e conformidade com profissional responsável antes de ampliar divulgação ou automação. Não assumir tecnologia, regularidade ou segurança a partir dos nomes Clássico/Premium/Comfort.

Não prometer resultado imediato para máquina/Solar. Não prometer ausência de reação, resultado garantido, duração exata ou adequação individual. Foto da pele não deve ser diagnosticada pela IA.

Definir prioridade, responsável e conduta fora do horário para relatos de reação, dor ou queimadura. Revisar políticas de sinal/reembolso com responsável adequado antes de publicar negativas categóricas sobre direitos. Esta especificação não é parecer clínico ou jurídico.

## 15. Áudio, imagens e transporte

- Manter áudio funcional, com transcrição limitada ao tenant e ao atendimento correto.
- Não transcrever nem chamar modelo quando a conversa estiver bloqueada para humano, salvo função explicitamente aprovada para apoio interno.
- Preservar vínculo entre mídia, mensagem e transcrição; não associar áudio de outro contato por falha de normalização.
- Em mídia ilegível ou transcrição indisponível, seguir o encaminhamento definido; não fabricar conteúdo.
- Classificar comprovante, foto da pele e outras imagens antes de qualquer ação; nenhuma imagem confirma pagamento ou condição de saúde.
- Não usar pipeline de documentos comerciais da Gênesis para coletar documentos da clínica.
- Deduplicar webhook, mídia e resposta; mensagens agrupadas geram uma resposta ao turno, não uma resposta por fragmento.
- Não reagir como cliente a mensagens enviadas pela própria instância.
- Preservar fencing de turno/sessão: modelo atrasado não pode responder depois de cancelamento, encerramento ou intervenção humana.
- Testar reconexão, timeout, fila recuperada e entrega incerta sem duplicação.

## 16. Painel, histórico e custo de leitura

### 16.1 Estado constatado nesta branch

Por determinação do responsável, o carregamento principal em `app/src/dataService.js` deve usar `.limit(1000)` para eventos do tenant. O código local foi ajustado de 150 para 1.000 eventos. A consulta de avatares também possui limite de 1.000, mas é uma consulta independente.

O limite de 1.000 é global por tenant, não por conversa. Ele amplia a janela inicial, mas não resolve históricos fora dela. Manter a paginação por conversa prevista neste plano e verificar a versão efetivamente publicada antes de afirmar o limite LIVE. O ajuste local não constitui publicação.

### 16.2 Arquitetura alvo

- Listagem de conversas paginada por conversa/última atividade, não derivada apenas dos últimos eventos globais.
- Histórico carregado por `tenant_id`, canal e identificador da conversa, com cursor estável por `created_at` e `id`.
- Opção de carregar mensagens anteriores sem limite global que corte outras conversas.
- Separar mensagens visíveis de eventos operacionais; manter auditoria consultável sem poluir o chat.
- Realtime acrescenta/atualiza eventos por ID; recarga não apaga páginas já carregadas por trocar o estado inteiro.
- Filtros, abas e polling não podem transformar uma conversa completa em parcial silenciosamente.
- Preservar ordenação, âncora de rolagem, estado de carregamento, erro recuperável e indicação de mais histórico.
- Assinaturas devem respeitar tenant e ser encerradas ao trocar usuário/tenant; não acumular listeners.
- Exibir motivo de humano, responsável, dados de cadastro permitidos, reserva, sinal e entregas.

### 16.3 Egress e observabilidade

- Selecionar apenas colunas necessárias para listagem; buscar payload técnico e mídia sob demanda.
- Evitar `select('*')` com payloads grandes em atualizações repetidas.
- Usar paginação, índices adequados e atualização incremental; medir plano de consulta antes de adicionar índices redundantes.
- Não baixar todo histórico de todos os contatos a cada cinco minutos para corrigir o corte.
- Medir bytes por carregamento, chamadas por conversa e reconexões; comparar antes/depois.
- Não apagar mensagens, comprovantes ou logs indiscriminadamente como solução para tráfego acumulado.

Esta parte afeta infraestrutura compartilhada. Implementar com testes de todos os tenants e rollout próprio, sem misturar identidade/catálogo de clientes.

## 17. Lembretes e retomadas

### 17.1 Lembrete de agendamento

PDF: oito horas antes. Proposta: somente reserva confirmada, vinculada ao ID e à revisão da data.

- Calcular a partir do início da reserva, com fuso correto.
- Remarcação cancela job antigo e gera novo; cancelamento remove elegibilidade.
- Antes de enviar, verificar novamente status, data, controle humano, autorização e opt-out aplicável.
- Definir regra para confirmação a menos de oito horas e para horário noturno.
- Confirmar se lembrete transacional pode sair durante bloqueio humano; não abrir a IA ao enviar lembrete.
- Texto deve usar serviço/endereço atuais aprovados e dados da reserva persistida.
- Idempotência por reserva, versão e tipo de lembrete.

### 17.2 Retomada comercial

PDF: uma semana. O limite de tentativas não foi informado.

- Definir marco inicial: última mensagem da cliente, última resposta ou encerramento; não escolher implicitamente.
- Definir máximo de tentativas, janela permitida, elegibilidade, autorização e interrupção.
- Não retomar cliente com humano, reclamação, pagamento em conferência, pedido de não contato ou reserva já realizada.
- Resposta nova cancela/recalcula job; job vencido não autoriza contato se o estado mudou.
- Não manter simultaneamente política antiga de 3h/24h/15d para a mesma finalidade sem decisão explícita.

### 17.3 Dispatcher

O dispatcher atual cancela follow-up quando existe reserva futura. Logo, não serve para lembrete de reserva sem distinguir tipos. Reaproveitar scheduler/transporte, não a mesma regra de negócio indistinta.

Versionar jobs, limitar lote, controlar reivindicação/lease, retries e entrega incerta. Na ativação, não disparar passivo retroativo em massa. Inventariar e cancelar jobs incompatíveis por escopo, preservando histórico de entregas.

## 18. Dados, permissões e proteção entre tenants

- Toda leitura/escrita operacional deve ser limitada ao UUID do tenant e às permissões do ator.
- Slug recebido de cliente ou payload externo não é autorização.
- RLS/grants devem proteger contato, nascimento, anexos e reservas; não ampliar acesso anônimo para viabilizar UI.
- Credenciais administrativas só no backend; não incluir em frontend, SQL compartilhado ou snapshots públicos.
- Revisar RPCs privilegiadas, escopo de tenant e validação de ator antes de dar novas capacidades.
- Guardar nascimento em campo apropriado; não em coluna de observação pública por conveniência.
- Definir acesso/retencão de imagens, relatos, comprovantes, logs e snapshots com responsável.
- Não enviar documentos ou relatos completos a monitoramento quando IDs e códigos forem suficientes.
- Auditar operador, data, antes/depois e motivo nas mudanças críticas.
- Manter flags novas desligadas por padrão; ausência de chave não ativa política NB Bronze em outro cliente.
- Não alterar Gênesis, contatos excluídos, modelo, cota, canal ou credenciais por efeito colateral.

## 19. Auditoria e diagnóstico de ponta a ponta

### 19.1 Campos necessários

Correlacionar evento, mensagem externa, turno, sessão, conversa, tenant, reserva, comando e envio. Registrar:

- Versão do Core, prompt, fatos, catálogo e política aplicada.
- Ação solicitada pelo modelo e ação efetivamente executada.
- Motivo validado de handoff e campo oficial ausente, quando houver.
- Resultado da consulta de disponibilidade e motivo de rejeição da reserva.
- Latências de fila, transcrição, modelo, banco e provedor.
- Uso de modelo e limite, sem confundir limite de contexto com falta de catálogo.
- Código de erro preservado e sanitizado, distinguindo falha técnica de conflito concorrente esperado.
- Estado de envio: não tentado, aceito, confirmado quando disponível, falha ou incerto.

Não é necessário salvar raciocínio interno do modelo. Salvar evidência operacional suficiente, minimizando dados pessoais.

### 19.2 Procedimento para um incidente

1. Identificar tenant, conversa, horário local e mensagem problemática.
2. Consultar eventos nesse escopo e obter revisão/ação/erro.
3. Localizar a execução correspondente no n8n; não usar reexecução como ferramenta de inspeção.
4. Verificar dados efetivamente enviados ao modelo, ou reconstruir com ressalva quando não houver snapshot.
5. Distinguir decisão do modelo, substituição determinística do texto, erro de persistência e falha de envio.
6. Conferir catálogo e configuração daquela revisão; configuração atual não prova configuração histórica.
7. Reproduzir em fixture anonimizada com banco/transporte falsos.
8. Adicionar teste de regressão antes da correção.

### 19.3 Consultas somente leitura de referência

Usar o SQL Editor autorizado. Ajustar datas e restringir a conversa quando conhecida; não exportar o tenant inteiro sem necessidade.

```sql
select created_at, contact_name, external_conversation_id,
       message_text, response_text, ai_provider, ai_error,
       raw_payload->'grounding' as grounding
from public.channel_events
where tenant_id = (
  select id from public.tenants where slug = 'clinica_nubia_oficial'
)
  and channel_type = 'whatsapp'
  and created_at >= timestamptz '2026-10-03 15:40:00-03'
  and created_at <  timestamptz '2026-10-03 15:55:00-03'
order by created_at, id;

select external_id, name, description, price, estimated_hours,
       notes, metadata, active
from public.tenant_service_catalog
where tenant_id = (
  select id from public.tenants where slug = 'clinica_nubia_oficial'
)
  and (name ilike '%jato%' or external_id ilike '%jato%');
```

Os resultados podem conter dados pessoais. Guardar privadamente e compartilhar apenas o necessário. Estas consultas não foram executadas no LIVE nesta tarefa.

## 20. Registro de decisões pendentes

Responsável de negócio proposto: Núbia, com Beatriz para esclarecimentos operacionais. Registrar resposta, data e aprovador para cada item. Não apresentar a solução provisória como resposta aprovada.

| ID | Pergunta/decisão | Dependência | Conduta até resolução |
|---|---|---|---|
| D01 | Os 15 min do Clássico são intervalo de entrada, preparo ou ocupação? | Agenda nova | Não aplicar bloco de 15 min como ocupação total |
| D02 | Qual ocupação real do Premium diante de procedimento até 80 min? | Agenda nova | Preservar regra vigente identificada, sem reduzir automaticamente |
| D03 | Quanto tempo e quais máquinas/equipe o Solar bloqueia? | Agenda manual integrada | Equipe confirma; não presumir coexistência |
| D04 | Jato continua também a domicílio? Quais valores/regiões? | Catálogo domiciliar | Não prometer modalidade indefinida |
| D05 | Limpeza está incluída no Jato? | Apresentação comercial | Informar que a equipe confirma, sem afirmar inclusão |
| D06 | Como os 30 min de recurso do Jato se relacionam com 45 min no espaço? | Ocupação manual | Não confundir permanência com bloco |
| D07 | Quais inícios, intervalos, término máximo, horizonte e significado das 2h? | Nova grade | Não derivar grade da faixa de funcionamento |
| D08 | Terça é 10h às 15h? Quais dias de humano 9h–20h? | Horários/mensagens | Registrar incerteza, não prometer dia não confirmado |
| D09 | Etapas/durações/recursos de Lua, Detox, Bojo e clareamento? | Oferta detalhada e agenda | Divulgar somente fatos confirmados |
| D10 | Qual combo corresponde a cada preço fixo? | Catálogo financeiro | Valor específico confirmado pela equipe |
| D11 | Quem recebe desconto de amiga, em que condição e até quando? | Cálculo automático | Não conceder por inferência |
| D12 | Adicionais acumulam? Qual arredondamento do sinal? | Total financeiro | Não calcular casos ambíguos automaticamente |
| D13 | Prazo de pré-reserva, aviso, expiração e pagamento atrasado? | Liberação de vaga | Não criar prazo novo sem decisão |
| D14 | Comprovante sem texto inicia conferência? Quem emite link? | Pagamento | Não validar comprovante nem gerar link fictício |
| D15 | O envio de cuidados ocorre após aviso ou após confirmação humana? | Pacote pós-pagamento | Proposta é após conferência; validar |
| D16 | Remarcação 8h ou 24h com exceção? Como tratar reembolso? | Política de exceção | Equipe humana, sem negativa automática |
| D17 | Grupos são exceção a reserva para terceiros? | Múltiplos participantes | Equipe organiza dados e sinais individuais |
| D18 | Quem recebe cada handoff, assume casos e libera IA? | Operação diária | Fila humana monitorada e permissões explícitas |
| D19 | Lembrete noturno, confirmação com menos de 8h e bloqueio humano? | Lembretes | Não ativar cenários sem regra |
| D20 | Marco, tentativas, janela e autorização da retomada semanal? | Follow-up | Não ativar disparos em massa |
| D21 | Quais cuidados são comuns entre modalidades e quais textos técnicos foram aprovados? | Conteúdo | Não copiar cuidados ou recomendações individuais |
| D22 | Públicos atendidos, tecnologia dos equipamentos e protocolo de incidentes? | Segurança | Não ampliar autorização automática |
| D23 | Pode reutilizar dados/preferências após encerramento? | Memória | Preservar política vigente e consulta verificada |
| D24 | Textos finais ainda vazios: resumo, pré-reserva, handoff e falhas? | Mensagens literais | Elaborar propostas e obter aprovação |
| D25 | Quem responde por privacidade e define retenção? | Cadastro ampliado | Não ampliar exposição/retenção sem responsável |
| D26 | Encerramento automático existe? Em quais condições? | Ciclo | Não inventar timeout de encerramento |

Cada pendência bloqueia seu módulo, não necessariamente toda a entrega. Informações claras como os tempos do Jato podem ser corrigidas antes da nova agenda.

## 21. Componentes, arquivos e workflows

### 21.1 Fontes e configuração

| Arquivo/local | Trabalho previsto |
|---|---|
| `clients/clinica_nubia_oficial/business_facts_v2.json` | Fatos revisados, tempos separados, horários, políticas e origem |
| `clients/clinica_nubia_oficial/prompt_canonico_v2.txt` | Remover regras contraditórias; orientar interpretação e continuidade |
| `clients/clinica_nubia_oficial/catalog_document_update.json` | Reconciliar versões, preços, descrição e metadados por serviço |
| `clients/clinica_nubia_oficial/scheduling.json` | Novos parâmetros apenas após fechar pendências de agenda |
| `clients/clinica_nubia_oficial/payment_update.json` | Regras financeiras aprovadas e mensagens |
| Novo patch incremental do tenant | Atualização transacional, versão esperada e preservação de chaves não relacionadas |
| `supabase/migrations` | Evoluções aditivas de schema/RPC/RLS quando necessárias |

Não definir número/nome final de migração antes do inventário. Não reaplicar `01` a `06` para atualizar produção: esses pacotes podem sobrescrever decisões posteriores.

### 21.2 Fluxos e nós

| Área | Escopo |
| --- | --- |
| CORE compartilhado | Entrada, fila, roteamento, recuperação e idempotência |
| EXT de serviços | Coleta, fatos, mensagens, agenda e pagamento |
| Comandos do CORE | Autorização, confirmação humana e encerramento |
| Follow-ups do CORE | Elegibilidade, agendamento e transporte idempotente |

Consulte as [referências do n8n](../../docs/INDEX.md#workflows-n8n) para identificar as fontes e os exports atuais.

### 21.3 Módulos de código

- `n8n/code/whatsapp_grounded_reply.js`: schema canônico, fatos fornecidos, validação, textos e auditoria.
- `n8n/code/whatsapp_scheduling.js`: ações de agenda e reserva.
- `n8n/code/whatsapp_core_runtime.js`: ordem de controle, execução, handoff e efeitos.
- `n8n/code/whatsapp_core_overrides.js` e `whatsapp_core_header.js`: helpers e sobrescritas pertinentes, sem duplicar regra comercial.
- `n8n/code/whatsapp_session.js`: limites e referências a atendimentos anteriores.
- `n8n/code/whatsapp_audio.js`: preservar comportamento; alterar só se exigido pelo contrato.
- `n8n/code/whatsapp_confirm_signal.js` e `command_router.js`: confirmação e entrega operacional.
- `n8n/code/whatsapp_follow_up_dispatch.js`: lembretes e retomadas separados.
- `n8n/code/whatsapp_sales.js`: reconciliar baseline do anexo e manter regressão; não aplicar regras clínicas.
- `app/src/dataService.js`, `conversationEvents.js`, `conversationLifecycle.js`, `main.jsx`: leitura, representação de estados e controles operacionais.

`whatsapp_conversation_core.generated.js` é artefato gerado. Editar fontes, reconciliar a baseline, executar builder e revisar diff. O builder usa funções de uma base Telegram legada, além dos módulos atuais; validar que nenhum fallback legado reintroduz texto ou regra antiga.

### 21.4 Easypanel e infraestrutura

Nenhuma nova variável ou serviço é exigido apenas por mudar preço, descrição ou nome. Antes de prescrever adições, identificar dependência real.

Conferir no pré-voo: credenciais existentes por tenant, conexão Supabase, Evolution/instância, Gemini, Redis/fila, acesso do scheduler e versão do n8n. Não trocar chaves globais nem reiniciar indiscriminadamente serviços de outros clientes.

Só publicar frontend se houver mudança de interface; só alterar scheduler se o novo modelo de jobs exigir. Documentar comandos e variáveis sem valores secretos.

## 22. Backlog executável e dependências

Todas as tarefas abaixo estão **a fazer**. A criação deste documento não significa implementação.

| ID | Entrega | Depende de | Critério objetivo |
|---|---|---|---|
| T01 | Inventário LIVE e snapshot privado | Acesso autorizado | Versões, schema, catálogo, reservas e jobs identificados |
| T02 | Baseline reproduzível do Core publicado | T01 | Build não remove mudanças já publicadas da Gênesis |
| T03 | Matriz final de fatos e decisões | PDF + T01 | Cada campo com fonte e situação; pendências sem inferência |
| T04 | Catálogo e fatos revisados | T03 | Preços/tempos/modalidades coerentes, IDs históricos preservados |
| T05 | Biblioteca de mensagens | T03/T04 | Textos revisados visualmente e aprovados por chave |
| T06 | Contrato de ações e auditoria | T02 | Informação não dispara agenda; motivo de handoff observável |
| T07 | Coleta/cadastro de nascimento e bairro | T03/T06 | Evidência, validação, persistência e RLS testadas |
| T08 | Controle humano e sessões | T02/T06 | Reset e concorrência não removem bloqueio |
| T09 | Especificação final de recursos/grade | D01-D03/D06-D08 | Tempos, capacidades e conflitos sem ambiguidade |
| T10 | Agenda transacional por intervalos | T09 | Concorrência/ocupação manual/recursos testados |
| T11 | Financeiro e regras do sinal | D11-D16 + T03 | Valores determinísticos e autorização correta |
| T12 | Confirmação e pacote pós-pagamento | T05/T08/T11 | Uma confirmação e entregas rastreáveis |
| T13 | Interface de operação clínica | T07/T08/T10/T11 | Operador vê e controla os estados com permissões |
| T14 | Histórico paginado e lista de conversas | T01/T02 | Conversa completa após refresh, sem carga global ilimitada |
| T15 | Lembretes | D19 + T10/T12 | Data/revisão/cancelamento/entrega testados |
| T16 | Retomada semanal | D20 + T08 | Elegibilidade, opt-out e limite testados |
| T17 | Observabilidade e alertas | T06/T10-T16 | Erros correlacionados e sem exposição desnecessária |
| T18 | Regressão multi-tenant | T02 e módulos alterados | Gênesis e caminhos legados preservados |
| T19 | Homologação operacional | T04-T18 aplicáveis | Núbia aprova cenários e pendências impeditivas fechadas |
| T20 | Release progressiva e monitoramento | T19 | Rollout controlado e reversão ensaiada |
| T21 | Documentação de operação/manutenção | T20 | Donos, rotina de atualização e resposta a incidentes definidos |

## 23. Testes e critérios de aceite

Executar testes determinísticos com banco/transporte falsos, integração em banco isolado, casos de modelo em ambiente controlado e homologação humana. Nenhum teste deve enviar mensagem a cliente real por padrão.

### 23.1 Catálogo e mensagens

| ID | Caso | Resultado esperado |
|---|---|---|
| C01 | “Quanto custa o Jato?” | R$149,99 e apresentação completa aprovada |
| C02 | “Jato leva quanto tempo?” | 20 min aplicação / 45 min permanência |
| C03 | “Quanto dura o resultado?” | Até 15 dias, conforme cuidados; sem confundir com agenda |
| C04 | “Quando posso molhar?” | Texto aprovado de 8–12h, sem extrapolação |
| C05 | “A limpeza está incluída?” | Não afirmar inclusão indefinida |
| C06 | Pergunta sobre domicílio | Não transformar contradição em promessa |
| C07 | “Quais serviços vocês têm?” | Catálogo aprovado completo, sem serviços suspensos |
| C08 | Banho de Lua | Três versões/preços, sem ressuscitar serviço único |
| C09 | Detox/Mousse | Mesmo serviço, sem cobrança duplicada |
| C10 | Combo sem preço mapeado | Não inferir valor pela ordem da tabela |
| C11 | Nome antigo no histórico | Responder NB Bronze |
| C12 | Mensagem longa | Partes ordenadas, sem truncar ou remover elementos aprovados |

### 23.2 Conversa e coleta

| ID | Caso | Resultado esperado |
|---|---|---|
| V01 | Primeira mensagem com dúvida | Responde e se apresenta; nome só se ausente |
| V02 | Duração “1h” com data conhecida | Não consulta agenda por regex |
| V03 | Serviço, data e nome em mensagens separadas | Consolida sem repetir coleta |
| V04 | “Já falei o horário” | Recupera evidência válida ou esclarece ambiguidade real |
| V05 | Corrige/apaga serviço ou data | Não restaura valor antigo; invalida dependências |
| V06 | “15” fora de contexto de horário | Não preenche hora arbitrariamente |
| V07 | Bairro informado | Não responde endereço da clínica indevidamente |
| V08 | Nascimento inválido/futuro/ambíguo | Não persiste data inventada |
| V09 | Amanhã antes e depois da meia-noite | Mantém referência temporal da mensagem |
| V10 | Pergunta intermediária durante coleta | Responde e preserva progresso |
| V11 | Áudio agrupado com texto | Um turno coerente, sem duplicação |
| V12 | Contexto acima do limite | Erro/motivo explícito; não perde dados silenciosamente |

### 23.3 Agenda

| ID | Caso | Resultado esperado |
|---|---|---|
| A01 | Quatro reservas simultâneas do Clássico | Quinta rejeitada pela capacidade correta |
| A02 | Premium e Comfort ocupados | Não oferecer recurso individual já ocupado |
| A03 | Inícios diferentes com sobreposição | Capacidade calculada por intervalo |
| A04 | Última vaga disputada por dois turnos | Apenas uma reserva persistida |
| A05 | Reserva manual de Solar | Máquinas afetadas indisponíveis durante ocupação |
| A06 | Consulta informativa de Jato/Solar | Responde; não transfere só por não ter agenda automática |
| A07 | Pedido efetivo de reserva Jato/Solar | Encaminha à equipe sem inventar vaga |
| A08 | Feriado/bloqueio/manutenção | Respeita exceção cadastrada |
| A09 | Horário depois do fechamento/antecedência inválida | Não oferece nem grava |
| A10 | Retry do mesmo pedido | Não duplica reserva |
| A11 | Mudança de sessão durante geração | Não grava ação obsoleta |
| A12 | Migração com reservas futuras | Preserva horários/valores históricos e aponta conflitos |

### 23.4 Pagamento e operação humana

| ID | Caso | Resultado esperado |
|---|---|---|
| P01 | Sinal com preço de centavos ímpares | Arredondamento aprovado e saldo consistente |
| P02 | Adicional após 17h | Separado do sinal, sem acumulação inventada |
| P03 | “Paguei”, “não paguei”, “vou pagar” | Só afirmação positiva inicia conferência |
| P04 | Aviso sem reserva ou com várias | Não marca reserva arbitrária |
| P05 | Comprovante | Não confirma autenticidade por imagem |
| P06 | Clique duplo de confirmação | Uma transição e um pacote de mensagens |
| P07 | Operador sem permissão | Comando negado sem alteração |
| P08 | Timeout de envio após confirmação | Pagamento preservado; entrega incerta sem retry cego |
| P09 | Nova mensagem durante humano | Inbound registrado; nenhuma resposta de IA |
| P10 | `/reset` durante humano | Bloqueio preservado |
| P11 | Cancelamento simultâneo à confirmação | Conflito controlado por revisão/transação |
| P12 | Encerramento | Não cancela reserva; mensagem de encerramento deduplicada |

### 23.5 Painel, jobs e isolamento

| ID | Caso | Resultado esperado |
|---|---|---|
| I01 | Conversa antiga fora dos últimos 1.000 eventos | Listada e histórico acessível pela paginação prevista |
| I02 | Refresh/aba/polling após Realtime | Mensagens não desaparecem |
| I03 | Eventos com mesmo timestamp | Paginação estável por ID |
| I04 | Troca de tenant | Cache/assinatura/dados isolados |
| I05 | Remarcação após job criado | Job antigo cancelado, novo horário correto |
| I06 | Resposta/opt-out antes da retomada | Não dispara mensagem comercial |
| I07 | Reserva futura e lembrete | Lembrete não cancelado como se fosse follow-up comercial |
| I08 | Confirmação a menos de 8h/noite | Aplica política aprovada, não regra improvisada |
| I09 | Ativação de automações | Nenhum passivo retroativo não autorizado |
| I10 | Fluxo Gênesis e tenant sem flags novas | Comportamento baseline preservado |
| I11 | Acesso cruzado por RPC/REST | Negado sem vazamento de dados |
| I12 | Egress comparativo | Carga paginada, sem consultas globais ilimitadas |

### 23.6 Suítes existentes a aproveitar

Inspecionar dependências e efeitos antes de executar. A lista é referência de trabalho, não declaração de execução nesta tarefa:

- `scripts/test_whatsapp_core.cjs`: conversa e runtime.
- `scripts/test_whatsapp_turn_queue.cjs`: agrupamento/fila/concorrência.
- `scripts/test_appointment_capacity.cjs`: agenda, com dependência PGlite.
- `scripts/test_confirm_payment_core.cjs`: confirmação/idempotência.
- `scripts/test_follow_up_access.cjs`: acesso a follow-ups.
- `scripts/test_whatsapp_media.cjs`: mídia.
- `scripts/test_nubia_brand.cjs`: identidade; arquivo local preexistente deve ser preservado.
- `scripts/test_whatsapp_sales.cjs`, `test_sales_database.cjs` e `test_sales_ui.cjs`: regressão da Gênesis.
- Testes de `app/src` para dados, ciclo, eventos, acesso e Kanban.

Criar testes específicos para os cenários novos; nomes finais ficam a cargo da implementação. Executar build do frontend quando ele for alterado. Teste de modelo real não substitui testes determinísticos de efeitos.

## 24. Implantação por lotes

### Lote 0: preparar e proteger

1. Confirmar branch/commit, proteger alterações locais e criar branch de trabalho a partir da `prod` atual.
2. Executar inventário e snapshot privado.
3. Reconciliar Core anexado com fontes e criar baseline reproduzível.
4. Preparar banco isolado, fixtures anonimizadas e transporte falso.
5. Fechar decisões necessárias ao primeiro lote.

### Lote 1: informações e roteamento

1. Publicar campos/fatos/textos não ambíguos, com migração aditiva se necessária.
2. Remover decisões de agenda por regex de resposta e separar pergunta informativa de operação.
3. Atualizar catálogo, apresentações e prompt de forma coordenada para não haver duas fontes contraditórias.
4. Adicionar auditoria de ação/motivo e endurecer bloqueio humano.
5. Homologar perguntas de todos os serviços, não apenas a conversa do print.

Configuração só pode habilitar campos/ações depois que a versão compatível de código estiver publicada. Usar flags para evitar estado intermediário incompatível.

### Lote 2: cadastro e operação financeira

1. Migrar cadastro/permissões e ampliar contrato de coleta.
2. Ajustar painel, validações e resumo de reserva.
3. Implementar sinal/adicionais conforme regras aprovadas.
4. Ajustar Command Router e pacote pós-confirmação.
5. Homologar com operador autorizado, cancelamento concorrente e entrega incerta.

### Lote 3: agenda

1. Fechar tempos, grade e recursos pendentes.
2. Implementar motor por intervalos sem mudar caminhos de outros tenants.
3. Simular reservas futuras e tratar conflitos manualmente.
4. Publicar com feature flag desligada, testar e ativar apenas NB Bronze.
5. Verificar reservas manuais, Solar e concorrência real controlada.

### Lote 4: histórico e acompanhamento

1. Publicar paginação de conversas/histórico com regressão multi-tenant.
2. Medir custo de leitura e estabilidade de Realtime.
3. Ativar lembrete e retomada em etapas distintas, após políticas fechadas.
4. Cancelar jobs legados incompatíveis por versão/escopo, sem apagar histórico.
5. Monitorar volumes e erros; manter automações desligáveis separadamente.

Não esperar toda a agenda estar redefinida para corrigir fatos inequívocos. Também não ativar agenda nova só porque o novo prompt já foi publicado.

## 25. Runbook de publicação e rollback

### 25.1 Pré-publicação

- [ ] Diff revisado; nenhum arquivo/tenant não relacionado alterado sem necessidade.
- [ ] Snapshot e versão de retorno disponíveis.
- [ ] Migrações idempotentes, transacionais quando aplicável e com verificação de schema/revisão.
- [ ] Patch de tenant exige exatamente o destino esperado e não sobrescreve chaves alheias.
- [ ] Mudanças de schema compatíveis com código antigo durante transição.
- [ ] Builders produzem arquivos válidos e não removem mudanças publicadas.
- [ ] Testes passam; dependências de teste não são adicionadas à produção sem motivo.
- [ ] Aprovações e pendências do lote registradas.
- [ ] Operador disponível para acompanhar homologação.

### 25.2 Publicação

1. Aplicar schema compatível, mantendo recursos novos desativados.
2. Publicar versões compatíveis dos workflows afetados, preservando IDs/credenciais/webhooks.
3. Publicar frontend quando necessário.
4. Aplicar patch incremental exclusivamente de `clinica_nubia_oficial`, com conferência de revisão.
5. Validar configuração efetiva com consultas somente leitura.
6. Ativar a flag do lote e executar conversa de homologação autorizada.
7. Conferir evento, mensagem, reserva, pagamento, Kanban e estado humano de ponta a ponta.
8. Acompanhar fila, erros e entregas antes do próximo lote.

### 25.3 Gatilhos de reversão

Resposta indevida durante humano; duplicação de reserva/pagamento/mensagem; acesso cruzado; preço contraditório; capacidade excedida; regressão comercial de outro tenant; aumento anormal de falhas ou tráfego; perda de histórico no painel.

### 25.4 Como reverter

- Desabilitar primeiro a funcionalidade/automação nova por tenant, preservando atendimento humano.
- Interromper novos jobs incompatíveis e tratar os já reivindicados, evitando corrida de envio.
- Restaurar configuração/versionamento por patch limitado às chaves da release, não snapshot integral sobre atividade recente.
- Retornar código compatível somente após conferir schema e dados novos.
- Não desfazer migração destrutivamente nem apagar reservas, pagamentos, mensagens ou cadastros produzidos durante a release.
- Reconciliar operações em andamento/entrega incerta antes de reenviar ou reabrir IA.
- Registrar incidente, correção e nova condição de ativação.

## 26. Monitoramento e manutenção

### 26.1 Indicadores

Monitorar handoff por motivo/serviço, perguntas repetidas, erro de cadastro, reserva recusada por conflito, falha de consulta, tempo até humano assumir, tempo de conferência, mensagens incertas, jobs cancelados/enviados, custo de modelo e bytes consultados.

Não estabelecer meta de “zero handoff”: Jato/Solar e diversas exceções são humanos por decisão do negócio. O objetivo é eliminar transferências indevidas e tornar as necessárias operáveis.

### 26.2 Rotina

- Após cada lote: revisar conversas controladas e primeiros casos reais autorizados, sem expor dados desnecessários.
- Na primeira semana: revisão diária de erros, duplicações, bloqueios, catálogo e jobs.
- Após estabilização: revisão periódica com Núbia/Beatriz e amostra de dúvidas frequentes.
- Alteração de preço/texto: aprovação, revisão, vigência, patch incremental e teste de mensagem.
- Alteração de duração/capacidade: simulação de reservas futuras e homologação de concorrência.
- Alteração de política financeira/humana: revisar comandos, permissões, textos e jobs relacionados.

## 27. Entregáveis finais

- [ ] Inventário técnico e snapshots privados com hashes.
- [ ] Registro de decisões respondido/aprovado.
- [ ] Catálogo/fatos/prompt e biblioteca de mensagens revisados, com origem por campo.
- [ ] Migrações aditivas e patches específicos de tenant, com verificações pós-aplicação.
- [ ] Core e workflows gerados a partir de fontes reconciliadas e versionadas.
- [ ] Cadastro, agenda e financeiro com contratos e permissões documentados.
- [ ] Painel com histórico completo paginado e estados operacionais consistentes.
- [ ] Lembretes/retomadas com políticas e interruptores independentes.
- [ ] Suíte automatizada e evidências de homologação aprovadas.
- [ ] Runbook de publicação, rollback e atendimento de incidentes.
- [ ] Guia curto de operação para a equipe: confirmar sinal, assumir/devolver IA, bloquear agenda, tratar remarcação e atualizar informações.

**Estado ao finalizar este documento:** planejamento detalhado concluído; consulta LIVE, correções de código, migrações, publicação e homologação operacional ainda não executadas.

**Atualização posterior em 03/10/2026:** limite inicial do frontend ajustado localmente para 1.000 eventos por solicitação do responsável. As demais implementações deste plano continuam pendentes; nenhuma publicação foi realizada por esse ajuste.
