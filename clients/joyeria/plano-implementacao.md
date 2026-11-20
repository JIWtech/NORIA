# Plano de implementação — JOYERÍA no NORIA

**Atualização:** 20/11/2026. Este é o plano consolidado; decisões posteriores às fontes comerciais prevalecem sobre textos anteriores. Escopo imediato: WhatsApp via Evolution. Instagram fica para uma etapa posterior. A implementação, cadastro do tenant, carga em banco, integração e publicação ainda não foram realizados ou comprovados.

## 1. Resultado esperado

A JOYERÍA terá atendimento consultivo no WhatsApp da loja, com catálogo, fotos e descrições; identificação contextual da necessidade; direcionamento à Joyce ou continuação da compra no site; e atendimento humano no painel quando necessário. A IA não executa compra ou pagamento em nome do cliente. Instagram terá estrutura de integração prevista, sem escolha ou ativação de provedor nesta fase.

Fontes: [levantamento e histórico](levantamento-comercial.md), [persona original](fontes/persona-google-docs.txt), [catálogo PDF](fontes/catalogo-aliancas-joyeria-2026.pdf), [inventário do site](inventario-produtos-site.md), [manifesto do PDF](catalogo_pdf/manifesto-produtos.json) e imagens recebidas em `fontes/`. O levantamento conserva histórico de divergências; esta consolidação identifica a decisão mais recente.

## 2. Canais e operação

- WhatsApp da loja/IA: **+55 22 99923-7824**, por Evolution API. Associar instância, canal e tenant de forma validada. O número foi informado por João; a conexão real não foi verificada.
- WhatsApp pessoal para notificações à Joyce: **+55 22 99796-3611**. Guardar como configuração do tenant, não em código genérico. Conectar ou verificar o canal de origem da notificação na homologação, sem presumir que o número pessoal esteja conectado à Evolution.
- Instagram informado: **@joyeria_br**. Canal posterior; projetar fronteira genérica de adaptador, com identidade e eventos por canal. João pediu investigar alternativa não oficial, sem escolha de fornecedor. Não afirmar que a API Meta oficial será necessariamente usada, nem implantar conexão fictícia.
- Slug local `joyeria` é provisório; confirmar disponibilidade e identidade antes do cadastro. Não associar automaticamente contatos entre canais ou supor telefone para identificador Instagram.

## 3. Política comercial da IA

### Encaminhamento para Joyce

Encaminhar o atendimento para Joyce quando o assunto for **aliança blend**, **joia de alto padrão** ou quando o cliente **já chegar sabendo o que deseja**. Interpretar a conversa e suas mudanças de contexto; não exigir que modelo, numeração ou outros dados estejam completos antes de avisar Joyce. Informações que faltarem devem constar como não informadas.

Alto padrão: **joias de ouro maciço ou materiais mais nobres**. Identificar pela composição confiável do cadastro, não por valor de corte ou apenas pela expressão “ouro 18k”. Peças banhadas, revestidas ou encapadas não entram nessa definição por material; **alianças blend são encaminhadas pela regra própria**. Se a composição não for conhecida, não inventar nem classificar automaticamente como ouro maciço; encaminhar para avaliação humana quando necessário.

### Cliente que precisa de orientação

Quando a pessoa ainda não souber o que quer e não houver condição de encaminhamento à Joyce, a IA identifica necessidade, ocasião e preferências, apresenta peças existentes com fotos, descrição e preço conhecido e, quando entender o interesse, envia o **link do produto no site** para a pessoa finalizar a compra. Reavaliar se surgir intenção de blend ou joia de alto padrão durante a conversa; o enquadramento inicial não é permanente. Não presumir que todas as demais categorias ou toda pessoa interessada no site sejam encaminhadas à Joyce.

O documento da persona orienta não conduzir ao site, mas a instrução posterior de João estabelece o link para o fluxo de cliente indeciso descrito acima. A IA responde perguntas diretamente, mantém tom elegante, acolhedor, objetivo e consultivo; mensagens curtas, sem emojis conforme a persona. Evitar roteiros rígidos, informações inventadas e repetir perguntas respondidas. Dúvidas de interpretação não devem virar afirmações comerciais; tratar pedidos de humano e exceções pelo fluxo apropriado.

### Preços, pagamento e produtos

- Usar valores do catálogo e descontos conhecidos/autorizados. Até **20 parcelas sem juros no cartão**, com quantidade variável conforme o valor do produto. O site consultado exibiu teto de 12x; sua regra atual não comprova cálculo para 20x. Não implementar algoritmo de preço, desconto, juros, parcela mínima ou parcelamento específico sem dados validados; informar o teto quando aplicável e encaminhar condições não previstas.
- Valores confirmados por João: abaulada 2 mm **R$ 980 o par**; Elegance com friso 6 mm **R$ 1.885 o par**. João confirmou que o anúncio de R$ 1.185 no site corresponde à mesma Elegance de 6 mm e confirmou o valor correto de R$ 1.885. A correção no site não foi realizada. Não sobrescrever silenciosamente fontes divergentes.
- Entrada conforme persona: **50% do pedido ou pagamento integral**. Não presumir quando o saldo vence ou quando o preço fica fixado. A IA não fecha venda ou efetua cobrança; encaminhar exceções à equipe.
- A imagem anuncia 10% à vista e o site tem cupom de primeira compra; aplicar apenas condições conhecidas no escopo aprovado. Não deduzir um desconto geral do Pix a partir de exemplos isolados.
- Só oferecer produtos efetivamente presentes em catálogo/site; não inventar preço, variante, disponibilidade ou condição. Em informação ausente, não prometer resultado e encaminhar quando necessário.
- Blend: base em aço 316L e ouro 18k conforme materiais, sem qualificá-la como ouro maciço. Nome e data gravados estão incluídos nas fontes. Evitar extrapolar cobertura da garantia ou promessas além dos fatos disponíveis.
- Cuidados da persona: flanela macia e seca; evitar abrasivos, álcool, detergente, pasta de dente, limpa-prata e produtos químicos; a peça pode riscar e exigir polimento. A persona informa uso cotidiano, banho, academia e lavagem de louça. Preservar a redação e contexto específicos do material; não estender cuidados indiscriminadamente a outras joias.
- Carta e selo de qualidade foram informados por João como itens entregues ao cliente, com base na reunião. O conteúdo da carta e as condições da garantia não foram disponibilizados; não inventar detalhes.

### Trocas, horários e visitas

- Trocas: a IA coleta contexto necessário e encaminha a um humano no NORIA, sem gerenciar troca ou prometer elegibilidade/resultado.
- Alianças sob encomenda: **prazo máximo de 10 dias**, e as fontes anteriores descrevem **10 dias úteis**. Não iniciar a contagem sem medidas; não presumir se inclui frete ou qual marco de pagamento a inicia.
- Sem entregas às sextas, conforme catálogo e confirmação de João. Frete grátis nacional também se aplica aos atendimentos nos canais, conforme informado. Não inventar restrições ou prazos de transporte.
- Funcionamento da **loja**: 9h–17h. Feriados e datas comemorativas seguem padrão de horário da loja e mantêm atendimento personalizado. Isso não deve limitar automaticamente o funcionamento da IA. A persona cita segunda a sexta; não inferir abertura aos sábados ou domingos.
- Showroom com agendamento: utilizar o endereço informado no site, Avenida Pelinca, 257, Campos dos Goytacazes/RJ, conforme decisão de João. Documento e perfil trazem endereço anterior/diferente; não tratar isso como dúvida operacional vigente.
- Visita domiciliar: coletar localidade e necessidade; encaminhar para avaliação humana. Não impor limite geográfico automático nem prometer visita ou custo. Joyce avalia inclusive localidades distantes caso o cliente assuma custos.

## 4. Joyce, assunção e atendimento humano

Para os casos encaminhados à Joyce:

1. Identificar critério e registrar a decisão no contexto da conversa.
2. Enviar ao WhatsApp pessoal de Joyce um resumo fiel e o **contato válido do lead**, usando a instância Evolution autorizada da loja. Incluir fatos disponíveis como nome, interesse, modelo, ocasião, data e estágio; não inventar dados ou transmitir documentos sem necessidade. Sem telefone válido, não fabricar contato e sinalizar pendência.
3. Manter IA ativa no número da loja enquanto Joyce não assumir.
4. Joyce marca **Assumir** no NORIA e continua o atendimento pelo WhatsApp pessoal; essa ação pausa a IA na conversa da loja. O envio do resumo, a aceitação pela Evolution e o clique no contato não são evidência de que Joyce assumiu.
5. A conversa entre Joyce e o lead no WhatsApp pessoal não aparece automaticamente no histórico da loja. Retomada da IA deve seguir mecanismo autorizado e testado do painel.

Para trocas, pedidos explícitos de humano e outros casos operacionais, a IA pode pedir um minuto e a equipe continua pelo próprio NORIA. **Não identificar um atendente nominalmente na resposta ao cliente.** Esse fluxo não deve ser confundido automaticamente com notificação ao número pessoal da Joyce.

O CORE local reconhece `handoff=true` e eventos humanos como bloqueio; a captura `fromMe` diz respeito à instância da loja, não à conversa no número pessoal. Assim, a implementação deve separar os estados **Joyce notificada/aguardando** e **assumido**, sem alterar a semântica dos outros tenants. A atribuição no painel existe em código, mas sua adequação e estado em produção ainda precisam ser verificados.

O aviso a Joyce deve ter estado de entrega independente e escopo por tenant/conversa/destinatário: deduplicação, proteção de concorrência, falhas observáveis e reconciliação de timeout antes de qualquer reenvio. Não usar a entrega do cliente trocando apenas o destinatário. A falha da notificação não pode ser apresentada como entrega confirmada.

## 5. Arquitetura e Supabase

- **Gemini:** entender intenção e contexto, inclusive mudança de assunto e cliente que sabe o que quer.
- **EXT/configuração JOYERÍA:** aplicar a política comercial e decidir se encaminha Joyce, orienta compra no site ou pede atendimento humano. Dados e condições pertencem ao tenant.
- **CORE:** validar e executar contratos genéricos, controlar estado, concorrência, idempotência e auditoria. Não inserir números, produtos ou regras da JOYERÍA no motor compartilhado.
- **Adaptador de canal:** receber e normalizar Evolution e, futuramente, Instagram; resolver tenant, identidade e origem antes de encaminhar ao CORE. Instagram é capacidade de canal, não regra comercial da EXT.

| Necessidade | Estrutura local existente a avaliar | Limitação conhecida |
| --- | --- | --- |
| Tenant e política | `tenants`, `tenant_settings`, `channels` | Validar contrato do roteador, estado ativo e acesso por tenant; manter segredos fora do cliente público. |
| Contatos e conversas | `contacts`, `conversations`, `messages`, `channel_events` | Verificar identidade, histórico, comandos do painel, RLS e Realtime; não misturar contatos de canais ou tenants. |
| Catálogo | `tenant_service_catalog` | Possui descrição, unidade e um preço por linha; confirmar semântica de produtos, variantes, vigência, canais e políticas. A busca e o CORE atuais não retornam metadados de imagem automaticamente. |
| Fotos | Storage e contratos existentes, após avaliação | O fluxo local conhecido de imagens é ligado ao inventário automotivo. Não há evidência de envio genérico de joias pronto. Definir armazenamento, vínculo por tenant, permissões e entrega de mídia. |
| Notificação/assunção | Eventos e controles existentes, após avaliação | Atribuição interna não prova envio ao número pessoal. Avaliar mecanismo de entrega independente, idempotência e estado aguardando/assumido. |

O catálogo PDF tem **16 variações e 32 imagens** extraídas com referência de página e hashes no manifesto; todas devem ser preparadas para cadastro com nome, descrição, preço, largura e imagens. O inventário público do site contém 191 produtos consultados; não prova estoque real ou cobre produtos privados. Planejar dados de origem, ID estável, categoria, composição, variantes, unidade/par, links, fotos, valores e validade. Confirmar correspondência entre fontes antes de mesclar produtos; suportar correção idempotente e revisão comercial.

Analisar se as tabelas existentes bastam antes de propor alterações. Novas tabelas, mudanças de schema, dependências ou decisões arquiteturais exigem consulta ao responsável. Não alterar Supabase de produção, aplicar migrações, publicar workflows ou enviar mensagens reais sem autorização explícita. O estado do banco e dos workflows em produção não foi verificado nesta análise.

## 6. Etapas de implementação

1. **Reconciliação técnica:** verificar estado atual do repositório, alterações locais, instância Evolution, contratos, schema e paridade dos ambientes em leitura; preservar alterações de outras tarefas. Definir destino de imagens e estrutura de notificação antes de propor mudança arquitetural.
2. **Dados e catálogo:** revisar as 16 variantes do PDF e as 32 imagens, mapear as joias do site e as descrições, imagens, preços, identificação, classificação e links às estruturas adequadas. Tratar versões e divergências; preparar carga segura e reversível sem executar em produção.
3. **Política JOYERÍA:** implementar fonte canônica da EXT/configuração e prompt com regras deste plano, usando dados do tenant. Separar cliente que precisa de orientação, produto de alto padrão, blend, cliente que já sabe o que quer e humano genérico. Testar alterações de intenção e falta de fatos.
4. **WhatsApp e aviso à Joyce:** conectar adaptador e roteamento por tenant, preparar notificação ao número correto e controle de estado independente. Projetar o botão Assumir, pausa e retomada, com limites de concorrência e auditoria; não supor detecção da conversa pessoal.
5. **Mídia e link:** consultar produto correto, entregar as imagens e descrição aprovadas, respeitar capacidades e privacidade; enviar link do site no fluxo aplicável. Gerenciar dados ausentes sem inventar ou enviar foto de outra variante.
6. **Painel e operação:** verificar comportamento de atribuição, assunção, estado, falha de notificação, histórico, mensagens manuais e permissões; preservar controle de outros tenants.
7. **Instagram posterior:** manter somente previsão do contrato de canal; avaliar gateway não oficial pedido por João, segurança, manutenção e autorização, sem escolher ou conectar nesta etapa.
8. **Homologação e publicação:** executar testes, revisão de diff, isolamento, evidências e procedimento de rollback; solicitar as autorizações explicitamente necessárias antes de gravação em produção, migração, publicação ou envio real. Ativar apenas após aceite e monitorar resultado.

## 7. Testes e aceite

- Fluxos: blend, ouro maciço, peça banhada, cliente que sabe o que quer, cliente perdido, mudança de intenção, preço direto, produto inexistente, pedido de humano e troca. Validar que o link do site e aviso à Joyce seguem o filtro correto.
- Catálogo: 16 variantes PDF com descrições, imagens corretas, preços confirmados e unidade por par; divergência Elegance; nome igual com IDs distintos, produto ausente, dados desatualizados e fotos trocadas. Verificar vínculo e leitura das imagens reais.
- Canal e isolamento: diferentes tenants e instâncias, origem inválida, destinatário ausente/incorreto, identidade e mensagens cruzadas; garantir RLS/permissões e escopo de dados e mídia.
- Notificação e controle: aviso único em decisão repetida/concorrente; erro, timeout e reconciliação; IA ativa após aviso e pausada após Assumir; corrida entre resposta e assunção; retomada controlada; contato inexistente. Não enviar mensagens reais nas fixtures.
- Conteúdo: cuidado e garantia conforme fonte; 50%/integral sem inventar vencimento; 20x como teto sem cálculo fictício; máximo de prazo sem iniciar antes da medida; sexta, frete, horário da loja e visita domiciliar.
- Regressões selecionadas dos roteadores, EXT, CORE, fila, mídia, envio manual e tenants existentes; executar `node scripts/audit_anti_hardcode.cjs` em alterações de diálogo, gerar workflows via `scripts/build_noria_workflows.cjs`, revisar artefatos e diff. Para frontend/serviços, executar `npm test` em `app/`.

## 8. Pendências a coletar ou decidir posteriormente

1. **Correção do site:** o valor da Elegance 6 mm já está confirmado em R$ 1.885; o anúncio consultado exibia R$ 1.185 e ainda precisa ser alinhado quando autorizado.
2. **Instância Evolution:** a instância `joyeria` existe no Evolution Manager, mas estava **desconectada e sem número pareado** em 20/11/2026. Parear o +55 22 99923-7824 e configurar as variáveis `EVOLUTION_*_JOYERIA` no n8n antes da homologação.
3. **Parcelamento:** regras de valor mínimo, quantidade elegível e arredondamento para até 20x; o site consultado usa até 12x. Não fazer algoritmo para situações não previstas.
4. **Descontos:** quais condições conhecidas de 10% à vista/Pix e cupom se aplicam e se acumulam; cadastro e vigência.
5. **Entrada/saldo:** quando o saldo é pago e quando o preço é fixado; não repetir como dúvida a entrada de 50% ou integral já informada.
6. **Prazo:** confirmar se os 10 dias são úteis e se abrangem o transporte; medidas são pré-requisito para contagem.
7. **Garantia/carta:** texto da carta, cobertura, exclusões e procedimento; qualificação do selo informada em reunião, sem repedir como se não existisse.
8. **Calendário da loja:** dias efetivos de abertura em fins de semana e interpretação operacional do padrão em feriados; horário informado de 9h–17h não limita a IA.
9. **Catálogo e operação:** o critério de alto padrão está definido: ouro maciço ou material mais nobre, com blend encaminhada por regra própria. Ainda falta cadastrar a composição comprovada de cada produto quando ausente, verificar disponibilidade real e definir atualização/sincronização dos dados. As fotos do PDF devem ser enviadas na própria conversa, vinculadas à variante correta. O cadastro no banco e a entrega de mídia ainda não foram implementados.
10. **Implementação técnica:** o mecanismo funcional está definido: enviar à Joyce, via WhatsApp, resumo fiel do contexto e contato do lead; IA ativa até Joyce assumir no NORIA. Ainda é necessário implementar e testar a entrega pela Evolution, identificar a instância, tratar falhas/duplicidade, validar permissões e controle de assunção e decidir eventuais alterações de schema. Isso é trabalho técnico pendente, não regra comercial em aberto.
11. **Instagram futuro:** provedor não oficial a avaliar, permissões, autenticação e manutenção. Não bloqueia o planejamento da fase WhatsApp, salvo dependência técnica demonstrada.

## 9. Reversão e status

Preparar rollback antes de qualquer ativação: desabilitar somente o roteamento/canal afetado da JOYERÍA, suspender avisos e restaurar versões anteriores de configuração e workflow com controle de concorrência, preservando histórico e dados de clientes. Migrações e carga devem ter plano próprio de reversão e reconciliação.

**Estado atual:** documentos, inventário local e manifesto preparados; sem criação comprovada do tenant, sem carga no Supabase, sem workflow da JOYERÍA publicado, sem testes de implementação ou envio real. A implementação e a decisão de Instagram seguem pendentes.

## Correções confirmadas por João — decisões vigentes

- O anúncio do site a R$ 1.185 é da mesma Elegance 6 mm; o valor correto é R$ 1.885. O site não foi alterado nesta etapa.
- Usar endereço do site: Avenida Pelinca, 257, Campos dos Goytacazes/RJ.
- Alto padrão já está definido como joia de ouro maciço e materiais mais nobres; blend segue à Joyce pela regra própria. Cadastrar composição de cada item é implementação do critério, não uma decisão comercial pendente.
- A IA deve enviar as imagens do PDF associadas aos respectivos itens diretamente na conversa do WhatsApp, com descrição e preço aplicáveis; não enviar apenas um link ou o PDF inteiro em substituição. Suportar os demais produtos e canais conforme disponibilidade do cadastro. As 32 imagens locais estão preparadas, mas o cadastro e o envio ainda não foram implementados.
- O aviso para Joyce é uma mensagem no WhatsApp pessoal com resumo do contexto e contato do lead; a regra está definida. A IA continua até Joyce assumir no NORIA. O transporte, deduplicação e testes são tarefas técnicas, não decisões comerciais em aberto.

## Decisões após a auditoria — 20/11/2026

Estas decisões prevalecem sobre trechos anteriores deste plano e do levantamento. Detalhes e evidências em [auditoria do plano](auditoria-plano-2026-11-20.md).

- **Blend:** o aviso à Joyce ocorre quando houver **interesse comercial** em aliança blend (compra, modelo, preço, medida, prazo). Dúvida isolada sobre cuidados ou garantia não gera aviso; se o interesse comercial surgir depois, a política reavalia.
- **Cliente decidido:** conta como "já sabe o que quer" tanto quem chega decidido quanto quem **se decide durante a conversa** com a IA. Nos dois casos, Joyce é avisada.
- **Link do site:** como as 16 variações do PDF são todas alianças blend, o fluxo de orientação com link do site se aplica, na prática, a semijoias, prata 925, aço e aço IPG, quando não surgir critério de Joyce.
- **Prisma 5 mm e 6 mm:** o próprio PDF usa a mesma foto nas páginas 19 e 20; mudam largura, preço e informações. Cadastrar as duas variações com a foto compartilhada e sempre informar a largura no texto que acompanha a imagem.
- **Composição:** fonte = site e PDF. As 16 do PDF são blend (PDF p. 3). Os textos do site permitem classificar banhado/revestido, prata 925, aço e aço IPG; nenhum dos 191 itens consultados é de ouro maciço. Item sem material claro fica como `desconhecido` e não entra como alto padrão. Pedido de ouro maciço na conversa gera aviso à Joyce mesmo sem produto cadastrado para mostrar.
- **Fotos:** armazenar as imagens de catálogo em bucket **público** (como as fotos do site e as da Gênesis), em caminho próprio do tenant. Nunca guardar dados de clientes nesse bucket.
- **Arquitetura:** criar um **perfil comercial novo e genérico** de venda consultiva de produtos no CORE (opção A), em vez de adaptar o perfil de serviços usado por I&C Salon, NORIA e Núbia ou o perfil de veículos.
- **Frase ao cliente quando Joyce é avisada:** "Uma especialista irá entrar em contato". Dita uma vez, no turno do aviso; a IA continua atendendo até Joyce marcar Assumir. Texto guardado na configuração do tenant.
- **Persona:** o documento do Google Docs define o comportamento da IA e será a base do prompt. A cópia local foi conferida com o documento publicado em 20/11/2026 e tem o mesmo conteúdo. Onde a persona diverge das decisões de João acima (endereço, preço de R$ 880, parcelamento em 10x, não enviar link do site), valem as decisões de João.

### Pré-requisitos técnicos identificados na auditoria

1. Perfil novo na lista de perfis aceitos pelo CORE (`n8n/sources/noria_core.js`, `allowedBusinessProfiles`) e política `noria_client_policy` da JOYERÍA no caminho `saas_dynamic` do roteador.
2. Envio de fotos de produto como capacidade genérica do CORE: hoje só funciona no fluxo de veículos (`vehicle_sales_v1`), aceita apenas JPEG e nomeia o arquivo como `veiculo-catalogo.jpg`. Dez das imagens do PDF são PNG.
3. Contrato novo de aviso à Joyce: o CORE e o roteador de comandos só enviam ao chat do lead. O destino vem da configuração do tenant, com recusa se coincidir com o lead, chave de idempotência e reconciliação de resultado desconhecido.
4. Correção no painel: hoje a atribuição ("Assumir") aparece como feita antes de o servidor confirmar, e a falha fica apenas no console (`app/src/app/App.jsx`).
5. Tabelas novas devem revogar explicitamente os privilégios de `anon`: no NORIA-prod, os privilégios padrão do schema `public` concedem tudo a `anon` e `authenticated`.
