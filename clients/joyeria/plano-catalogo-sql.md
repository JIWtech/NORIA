# Plano técnico — catálogo próprio da JOYERÍA

**Versão:** 20/11/2026. **Situação:** proposta para revisão de João e Claude; nenhum schema, tenant, bucket ou dado foi criado por este plano. Decisão solicitada: catálogo em estrutura própria para a JOYERÍA, sem usar o cache do WhatsApp ou a tabela automotiva como fonte. A tabela dedicada não garante isolamento, integridade, disponibilidade nem ausência de falhas por si só: os controles e testes abaixo são obrigatórios.

Este documento trata de um caminho de implementação e pontos de revisão; não é uma promessa de infalibilidade. [Plano geral](plano-implementacao.md) continua sendo a fonte das regras comerciais. [Diagnóstico do banco](diagnostico-supabase-proposta.md) registra a consulta de 20/11/2026; verificar estado novamente antes de escrever qualquer migration ou aplicar alteração.

## 1. Evidências e decisão arquitetural

A consulta de metadados ao `NORIA-prod` em 20/11 encontrou `tenant_service_catalog`, `whatsapp_catalog_products`, `genesis_inventory_vehicle_images` e buckets `product-catalog` e `channel-media`. O catálogo de serviços tem um preço e não devolve imagem no contrato atual; o CORE local carrega até 100 itens. O inventário público da JOYERÍA contém 191 fichas e o PDF contém 16 variações com 32 imagens extraídas. `whatsapp_catalog_products` é cache sincronizado por instância e a tabela de imagens Gênesis é específica de veículos. Nenhuma é automaticamente adequada como catálogo fonte da JOYERÍA.

**Proposta:** conjunto próprio, inicialmente destinado à JOYERÍA: uma tabela de produtos/variantes e uma tabela filha de imagens. Nomes abaixo são *propostos*, sujeitos à revisão do responsável: `joyeria_products` e `joyeria_product_images`. A primeira é a fonte comercial; a segunda liga cada imagem à variante exata. Elas mantêm `tenant_id` e verificações de autorização, mesmo que inicialmente recebam só JOYERÍA. Não criar uma tabela SQL por produto, por usuário ou por novo tenant automaticamente. Se outra joalheria chegar, reavaliar generalização sem copiar dados ou alterar a semântica deste tenant por nome.

O usuário solicitou a estrutura dedicada; **detalhes de schema, permissões e migração ainda precisam de revisão do responsável**, conforme o AGENTS.md do projeto. Este plano não cria SQL de produção.

## 2. Modelo lógico proposto

### Produto/variante — `joyeria_products`

Uma linha corresponde a um item comercial identificável e ofertável, com largura e apresentação claras; para as 16 páginas do PDF, cada variação de largura é uma linha por **par**. Produtos do site podem representar uma peça, um par ou um conjunto. Não pressupor que todas as joias sigam o modelo de alianças.

| Grupo | Campos lógicos propostos | Regra de aceite |
| --- | --- | --- |
| Identidade | `id` UUID, `tenant_id`, código interno estável e estado | FK para tenant; unicidade por tenant e código. Habilitar consulta apenas ao tenant autorizado. IDs PDF página e site são identificadores de origem, não identidade universal. |
| Produto | nome, descrição, categoria, linha, tipo, largura e outras variantes, unidade de venda | Largura numérica em mm quando aplicável; preservar linha, distinção por par/unidade/conjunto e produto com nome igual mas ID diferente. Campos desconhecidos ficam nulos, não valores fictícios. |
| Composição | material da base, material/acabamento e classificação de alto padrão com evidência | Ouro maciço e materiais mais nobres entram em alto padrão; banhado/revestido/encapado não por esse critério. Blend direciona Joyce por política própria. Composição desconhecida permanece desconhecida; não inferir do texto “ouro 18k”. |
| Preço | valor em centavos inteiro não negativo, moeda `BRL`, unidade e estado de revisão | Definir moeda, conversão exata sem ponto flutuante e política de preço. Valores aprovados: abaulada 2 mm R$ 980/par; Elegance 6 mm R$ 1.885/par. Zero e ausência são distintos; não usar zero como “sob consulta”. |
| Origem | fonte, ID externo, página, data de extração, validade e versão/revisão | Manter trilha PDF/site, inclusive anúncio do site desatualizado de R$ 1.185 para Elegance; João confirmou identidade e valor correto R$ 1.885. Não sobrescrever correção aprovada pelo dado antigo do site. |
| Disponibilidade | estado desconhecido/disponível/indisponível/sob encomenda e data da evidência | `InStock` do HTML não comprova estoque ou numeração. Produto ativo não implica disponibilidade; variantes e dados vencidos não autorizam prometer estoque. |
| Link | URL do produto no site, quando houver associação confirmada | Não presumir equivalência apenas por nome ou largura. Aplicar regras de host/URL e validade. |

**Origens múltiplas:** um produto pode existir no PDF e no site. A implementação deve preservar ambas as referências e seu estado de conciliação. Avaliar, na revisão, se serão representadas por uma tabela filha de identificadores/fontes ou estrutura equivalente; não armazenar IDs de origens distintas em um único campo sem capacidade de auditoria. A escolha da modelagem definitiva não está validada.

**Não confundir preço com regra de parcela:** até 20x sem juros e parcelas variam pelo preço, mas a fórmula/faixa específica não foi fornecida. A IA usa valores e condições conhecidas, sem inventar algoritmo, juros ou desconto. As condições globais de atendimento pertencem à política/configuração do tenant, não repetidas como verdades por produto sem fonte.

### Imagens — `joyeria_product_images`

Uma linha por imagem/variante, com `tenant_id`, `product_id`, bucket/caminho, hash SHA-256, MIME real, tamanho, ordem, indicação de principal, origem e estado de revisão. As 32 imagens extraídas do PDF estão em `catalogo_pdf/imagens/` com SHA-256 e página em `catalogo_pdf/manifesto-produtos.json`; são arquivos locais, ainda não objetos no Supabase.

- Chave referencial composta `(tenant_id, product_id)` para produto correspondente, apoiada por chave única/primária compatível; produto de outro tenant deve falhar mesmo que alguém conheça seu UUID. Não depender apenas de filtro no frontend. O PostgreSQL exige que a FK referencie colunas únicas/primárias compatíveis. [PostgreSQL 17 — constraints](https://www.postgresql.org/docs/17/ddl-constraints.html)
- Unicidade por caminho dentro do tenant e regra clara para principal/ordem. Sem definir exclusão em cascata automática de dados comerciais antes de revisar histórico/rollback. Índices devem seguir consultas reais; FK não cria automaticamente índice na tabela filha.
- Antes de apresentar ao cliente, conferir que item e imagem pertencem ao mesmo tenant e à variante. Armazenar URL separada de caminho canônico se necessário; não aceitar links arbitrários como imagem autorizada e não fazer fetch irrestrito de URLs fornecidas em mensagens.
- O banco armazena metadados e vínculos; os arquivos ficam no Storage adequado, não precisam virar bytes em cada linha SQL. Upload e remoção de objetos devem usar a API de Storage; não editar diretamente suas tabelas internas. [Supabase Storage — schema](https://supabase.com/docs/guides/storage/schema/design)

### Acesso às fotos

Na consulta anterior `product-catalog` era público e `channel-media` privado. Bucket público permite recuperar objetos a quem possui a URL; não fornece privacidade por tenant na leitura do arquivo. Decidir explicitamente se as imagens comerciais podem ser públicas. Para privado, avaliar URL assinada temporária ou download autenticado; validar que a Evolution consegue buscar a imagem dentro da validade, sem expor segredos. Não armazenar mensagens pessoais, documentos ou dados de clientes em bucket público. [Supabase — buckets públicos e privados](https://supabase.com/docs/guides/storage/buckets/fundamentals)

Não presumir que o fluxo automotivo atual de fotos aceite PNG, URLs ou provas de outro domínio. Projetar um contrato genérico para selecionar imagem exata e entregar à Evolution; preservar arquivos originais e transformar para JPEG somente se necessário, com hash e teste correspondentes. Sem a fonte correta ou prova de imagem, encaminhar/explicar indisponibilidade, jamais enviar imagem de outra variante.

## 3. Isolamento, privilégios e banco

- RLS para todas as tabelas expostas e políticas específicas para `SELECT`, `INSERT`, `UPDATE` e `DELETE` conforme funções reais de usuários do tenant; `USING` e `WITH CHECK` impedem leitura e reatribuição indevidas. Não disponibilizar secret/service role ao cliente público; workers privilegiados também devem validar tenant e origem.
- Conferir os grants e a configuração da Data API no projeto alvo. RLS e privilégio de acesso à tabela são coisas diferentes; novas tabelas podem precisar de grants explícitos para os papéis necessários. O projeto não deve receber grants amplos ou acesso `anon` sem necessidade aprovada. [Supabase — RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) e [mudança de exposição à API](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically).
- Na inspeção anterior, `channels` e catálogo tinham múltiplas políticas permissivas; elas combinam por **OR**. Revisar o conjunto e os helpers efetivos, não supor que uma política adicional restrinja outra. Não copiar helpers ou políticas de outro tenant sem testar. [PostgreSQL 17 — CREATE POLICY](https://www.postgresql.org/docs/17/sql-createpolicy.html)
- Conferir `SECURITY DEFINER`, `search_path`, autorizações e comportamento da chave de serviço; índices com `tenant_id` e filtros adequados aos padrões reais. Testar com papéis autenticados, anônimo e serviço; não validar segurança apenas como administrador.

## 4. Catálogo, IA e fluxo de atendimento

1. Importação local primeiro: 16 produtos PDF com descrições, preços por par e duas imagens cada, e inventário público de 191 produtos do site como fonte separada. Total não é necessariamente 207 produtos: existem sobreposições. Conciliar por identificação comprovada; não duplicar blend.
2. Reconciliar João/arquivo/site por produto e propriedade: preservar proveniência, data e versão; aceitar preço confirmado de R$ 1.885 para Elegance sobre o site desatualizado até correção. Identificar itens sem composição, preço, foto ou link; manter sem aprovação ou para avaliação humana, conforme campo. A tabela não define automaticamente um produto disponível.
3. Projetar busca filtrada por `tenant_id`, categoria, intenção, linha e variante. A IA não deve carregar apenas os primeiros 100 ou as 191 fichas de uma vez. Pesquisar itens relevantes e retornar ID, nome, descrição, preço, moeda, unidade, material comprovado, estado, imagens e links autorizados; validar contratos e tamanho do retorno. A associação imagem-preço-produto deve ser comprovada na etapa de envio.
4. **EXT da JOYERÍA** aplica a regra comercial: conversa sobre blend, joia de ouro maciço ou material mais nobre, ou cliente que já chega sabendo o que quer → Joyce; cliente perdido → IA orienta e, quando identificar necessidade, envia link para finalizar no site. Reavaliar mudanças no contexto. Compra e pagamento continuam fora da IA. Troca vai a humano; sem nomear pessoa ao cliente.
5. **CORE** recebe decisão estruturada e executa passos genéricos; adaptador Evolution envia foto correta na conversa da loja, sem usar rota de mídia automotiva como se fosse genérica. Instagram fica apenas previsto para depois, sem escolher API agora.
6. Quando for caso de Joyce, enviar para **+55 22 99796-3611** uma mensagem WhatsApp com contexto e contato do cliente; IA permanece ativa até Joyce marcar **Assumir** no NORIA. Notificar e assumir são estados diferentes. Definir mecanismo idempotente, identificar sucesso, falha e timeout incerto, proteger duplicação e concorrência. Não presumir que uma tabela de catálogo resolva esse fluxo.

## 5. Desenvolvimento local incremental

**Etapa A — inspeção e especificação:** revisar com Claude a proposta, schema real e o workspace; inventariar políticas, consumidores e dependências. Aprovar desenho de schema, fotos e decisão de duplicar/generalizar antes de escrever migrations. Nenhuma mudança de schema foi executada nesta etapa.

**Etapa B — modelo local e isolamento:** após decisão, criar migration com ferramenta Supabase adequada e em ambiente local, conforme `--help`, com constraints, índices e privilégios mínimos; preparar rollback. Adicionar testes de RLS e FK composta usando dois tenants e usuários com papéis distintos. Sem modificar dados de clientes atuais.

**Etapa C — carga e reconciliação:** importador idempotente de `manifesto-produtos.json` e imagens; simular repetição, alteração parcial e interrupção. Não gerar nomes/URLs públicos sem upload autorizado. Tratar produto já cadastrado, preço alterado, marcação de revisão e equivalência PDF/site; processar outras 191 fichas sem sobrescrever o catálogo PDF de maneira cega.

**Etapa D — busca e mídia:** integrar consulta paginada/filtrada por tenant ao contrato EXT/CORE; criar envio de mídia com validação de produto, autorização, deduplicação e prova de origem. Regenerar artefatos n8n pelo gerador canônico e preservar os outros tenants.

**Etapa E — aviso e assunção:** integrar decisão comercial com notificação separada; testar a IA ativa enquanto aguarda Joyce e bloqueio após Assumir. Erros incertos requerem reconciliação e não disparam reenvio cego.

**Etapa F — homologação:** testes isolados e revisão do Claude, revisão de RLS e diff, regressões de outros tenants, testes n8n e front-end afetados; preparar instrução de publicação e rollback. Antes de qualquer banco de produção, migration, workflow publicado ou mensagem real, obter a autorização explícita requerida pelo projeto.

## 6. Matriz de testes e riscos

| Cenário | Resultado obrigatório |
| --- | --- |
| Tenant B tenta ler ou alterar produto/imagem de A | Nenhum acesso ou gravação, inclusive IDs conhecidos, acesso direto API/Storage e mudança de `tenant_id`. |
| Imagem filha tenta referenciar produto de outro tenant | Banco rejeita pelo vínculo composto; serviço falha fechado. |
| Duas variações da mesma linha, ou títulos iguais | IDs e imagens corretos; dados nunca associados apenas pelo nome. |
| 191+ itens / produto posterior ao 100º | Busca correta, paginada e filtrada; seleção e evidências comprovadas. |
| Produto inativo, estoque desconhecido ou dado vencido | Não afirmar disponibilidade nem enviar preço como válido sem regra autorizada. |
| Elegance 6 mm e abaulada 2 mm | Usar R$ 1.885 e R$ 980 aprovados por João, registrar divergências das fontes e evitar downgrade por sincronização. |
| Imagem ausente, arquivo inválido, URL vencida, PNG/JPEG | Não enviar imagem errada; tratar falha com mensagem/humano apropriado e observabilidade. |
| Mensagens recebidas repetidas, concorrentes ou timeout | Um aviso por transição/destinatário; resultado incerto não provoca reenvio cego nem falsa confirmação. |
| Joyce notificada, depois Assume | IA continua até assumir; pausa sem corrida ou duplicidade e somente na conversa/tenant corretos. |
| Blend, ouro maciço, banho de ouro, cliente decidido/perdido | Decisão contextual conforme política, sem classificar tudo que contenha “ouro 18k” como maciço. |
| Reimportação e rollback | Mudanças repetidas sem duplicatas; rollback delimitado preserva histórico e dados de outros tenants. |

Medir performance com dataset representativo e `EXPLAIN`, sem prometer latência arbitrária; testar políticas e consultas conforme padrões reais. Usar testes significativos de contrato, segurança e E2E com dados fictícios, sem disparos reais sem autorização.

## 6a. Decisões e ajustes após a auditoria — 20/11/2026

- **Bucket público** para as fotos do catálogo, em caminho próprio do tenant (por exemplo `product-catalog/joyeria/...`). O CORE já aceita fotos com origem na URL do Supabase, hash SHA-256 e prova de vínculo tenant/produto (`noria_product_images_v1`), mas hoje só no fluxo de veículos e só para JPEG; generalizar faz parte do perfil novo.
- **Perfil novo** de venda consultiva de produtos no CORE (opção A). Nomes de tabela genéricos (por exemplo `product_catalog_items` e `product_catalog_images`, sempre com `tenant_id`) evitam uma tabela por cliente; a escolha final dos nomes continua com o responsável.
- **Grants:** no NORIA-prod, os privilégios padrão do schema `public` concedem ALL a `anon` e `authenticated` em toda tabela nova. A migration deve fazer `REVOKE ALL ... FROM anon` e conceder a `authenticated` apenas o necessário, com uma única política por comando (evitar políticas permissivas somadas por OR).
- **Composição tipada:** `material_class` com valores como `ouro_macico`, `nobre`, `blend`, `banhado_revestido`, `prata`, `aco` e `desconhecido`, mais a evidência da classificação. Fonte: site e PDF.
- **Preço:** `price_cents` inteiro e nulo quando desconhecido; os 16 preços do PDF são a fonte aprovada.
- **Prisma 5 mm e 6 mm:** duas variações com a mesma imagem; o vínculo de imagem deve permitir uma foto compartilhada por mais de uma variante sem duplicar o arquivo.

## 7. Pontos ainda não resolvidos

- Aprovação do responsável e revisão do Claude para os nomes/estrutura, estratégia de origem múltipla, RLS/grants e eventual schema adicional; este plano não é migration executável.
- Definição de composição comprovada e vínculo entre cada item do site e a versão PDF; classificação de materiais mais nobres deve ser baseada em fatos do cadastro, não lista inventada.
- Fonte de verdade para estoque, atualização e vigência, autorização e política de uso das fotos, escolha pública/privada do bucket e operação de mídia Evolution.
- Valores de parcelas aplicáveis conforme preço para teto de 20x, descontos e data de validade; preço aprovado da Elegance não é dúvida, mas anúncio do site ainda não foi corrigido.
- Endereço já definido como Avenida Pelinca, 257; detalhes de garantia, carta, prazo de transporte e calendário operacional permanecem no plano geral para coleta posterior.
- Arquitetura de notificação/assunção e controle de falhas: comportamento solicitado está definido, estrutura e implementação precisam ser aprovadas e testadas.

## 8. Implantação, monitoramento e reversão

Antes de produção, conferir backup/recuperação, projeto e tenant exatos, migrations pendentes, permissões e capacidade. Implantar schema e aplicação em etapas compatíveis com versões anteriores; carga por lote revisável e marcador de origem, sem apagar itens de outros tenants. Subir fotos por API e registrar apenas após sucesso verificado; uploads órfãos devem ser inventariados e reconciliados, sem exclusão indiscriminada.

Monitorar falhas de leitura, imagem ausente, preço vencido, classificação indevida, notificação pendente/incerta e tempo até assunção, sem registrar credenciais. Rollback deve desativar somente caminhos JOYERÍA afetados, preservar históricos/avisos e reverter artefatos conforme dependências; não executar DROP ou apagar objetos automaticamente. Registrar responsável, evidência dos testes e procedimento de reconciliação.

## Referências consultadas

- [Supabase — isolamento multitenant](https://supabase.com/kb/faqs/database/multi-tenant-isolation)
- [Supabase — Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase — segurança de acesso ao Storage](https://supabase.com/docs/guides/storage/security/access-control)
- [Supabase — buckets públicos e privados](https://supabase.com/docs/guides/storage/buckets/fundamentals)
- [Supabase — exposição de tabelas à API](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)
- [PostgreSQL 17 — constraints](https://www.postgresql.org/docs/17/ddl-constraints.html)
- [PostgreSQL 17 — políticas permissivas](https://www.postgresql.org/docs/17/sql-createpolicy.html)
