# Ativar Wesley no ambiente compartilhado

> Registro histórico da ativação inicial de sales_v1. Para intervenções, consulte o [guia da Gênesis](README.md) e confirme a configuração ativa.

## Estado

Implementacao local de `sales_v1`, sem novo projeto ou workflow por cliente.
O responsavel informou que cadastro, credenciais e webhook ja foram preparados.
Esta entrega NAO aplicou SQL nem publicou workflow/painel em producao.
O teste real de WhatsApp precisa acontecer apos os passos abaixo.

Tenant `wesley_automoveis`, owner `8fb2bc06-94d5-4abe-83b2-1aed41a346ae`,
instancia `wesley-carros`, numero `5521992923139`.
Nao executar SQLs da Nubia nem trocar variaveis globais de tenant.

## 1. Conferir preparacao e guardar backup

- Execute `02_verificacoes.sql` no SQL Editor do Supabase atual. Antes de ativar,
  espere tenant ativo, owner correto, IA false e canal `wesley-carros` pending.
- `01_cadastro_inativo.sql` e `03_dados_confirmados.sql` ja aplicados nao precisam
  ser repetidos. O 03 aborta deliberadamente se a IA ja estiver ligada.
- Exporte o workflow WhatsApp instalado e guarde a versao atual do painel.
  Guarde os settings do Wesley em local restrito para comparacao/reversao.
- Confirme a fila compartilhada das migrations 017/019 instalada e funcional.
  Nao reaplique todas as migrations anteriores indiscriminadamente.

## 2. Supabase: instalar capacidade comercial

Execute integralmente `supabase/migrations/025_sales_capability.sql` no SQL Editor.
Adiciona tabelas/RLS/RPCs comerciais e metadados de quadro. Nao altera settings,
reservas, catalogos ou usuarios de outros tenants. O gatilho de controle humano
nao altera dados de tenants sem `sales_v1`. Ainda nao ativa o Wesley.

## 3. Referência de publicação

Para alterações no ambiente atual, siga o [checklist de publicação](../../docs/operations/production_deploy_checklist.md).

## 4. Easypanel e painel

Conferir estas variaveis nos executores n8n/worker/Command Router que atendem o
tenant. Se ja adicionadas, nao precisa repetir nem substituir as dos outros:

```dotenv
EVOLUTION_API_URL_WESLEY_AUTOMOVEIS=https://BASE-DA-EVOLUTION
EVOLUTION_API_KEY_WESLEY_AUTOMOVEIS=CHAVE-AUTORIZADA
EVOLUTION_INSTANCE_WESLEY_AUTOMOVEIS=wesley-carros
```

Manter `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_ENABLED=true` e
`GEMINI_API_KEY` funcionais. Nao mudar `WHATSAPP_TENANT_SLUG` ou
`DEFAULT_TENANT_SLUG`. Aplicar mudancas de ambiente em janela controlada quando
exigirem reinicio do servico compartilhado. Nao reiniciar Evolution sem necessidade.

**Publique o frontend atualizado de `app/` pelo processo ja utilizado.**
Build local: `cd app`, depois `npm run build`. O painel interpreta metadados do
quadro comercial e usa RPC autenticada para mover/encerrar oportunidades. Sem essa
atualizacao, o Kanban antigo nao e compativel com as novas etapas.
Nunca usar service_role no frontend: manter URL/anon key e login obrigatorio.

O estoque usa a planilha publica, sem Google OAuth ou novo cron.
OCR usa Gemini e Evolution ja configurados, sem nova credencial.

## 5. Supabase: ativar somente Wesley

Com banco, workflow e painel publicados, execute integralmente
`clients/wesley_automoveis/04_ativar_sales.sql` no SQL Editor.
Verifica owner/canal/colisoes, configura prompt/quadro e ativa IA/canal Wesley.
Se encontrar quadro anterior nao comercial, aborta para revisao. Nao apague o
quadro nem retire a protecao sem investigar.

Inicialmente: `gemini-3.5-flash-lite`, 80 chamadas/dia, audio e OCR habilitados.
Transcricao/OCR tambem consomem chamadas. Nao muda modelo/limite de outros tenants.
Limite atingido encaminha para humano, sem impedir atendimento manual.

Execute `05_validar_ativacao.sql`: espere `sales_v1`, `conversation_core_v1`,
`canonical_v2`, IA true, canal active, prompt `wesley-sales-v1-2026-09-30`, oito
colunas e nenhum prompt legado ativo. A consulta nao retorna CPF/CNH.

Na Evolution, restaure/habilite apenas o webhook de `wesley-carros` para a URL
compartilhada de producao e evento `MESSAGES_UPSERT`. Confirme numero conectado.

## 6. Homologacao com numero controlado

1. Entre como Wesley. Veja somente seu tenant; leitura/escrita de outro tenant
   deve ser negada. Teste com sessao autenticada, nunca service_role.
2. Envie saudacao/audio curto. Espere resposta contextual e um card novo, sem
   duplicatas por retransmissao. Confira tenant/etapa com o SQL 05.
3. Peca estoque: carros/motos e precos atuais. Peca "PCX" e depois "2018":
   esclarecer/selecionar variante sem reiniciar a conversa.
4. Compra: modelo, nome e entrada em mensagens separadas. Forneca documento de
   teste autorizado. CNH/CPF extraidos aparecem em "Documentos para conferir",
   com revisao humana pendente. Nao usar documentos reais de terceiros em testes.
5. Sandero a R$42.980 com entrada R$12.894 e dados completos: registrar interesse
   em Leads quentes, nao venda/credito aprovado. R$12.893,99 vai a humano sem negar
   credito. Se preco da planilha mudar, recalcular esse exemplo.
6. Espere `sales_leads.interest_registered=true` e nenhum novo `appointments`.
   CPF/CNH faltante deve ser solicitado sem registrar interesse completo.
7. Venda a loja: marca/modelo/ano, fotos, manutencao, nome. Encaminhar avaliacao
   sem inventar preco. Peugeot/Citroen e ano anterior a 1995 nao devem ser captados.
8. Compra a vista, modelo ausente/documento ilegivel: humano com aviso curto.
   Defeito em veiculo comprado: Pos-venda com IA silenciosa.
9. Mova para etapa humana durante a conversa: mensagens/audio/`reset` nao
   destravam. Somente operador devolve para uma das duas etapas com IA.
10. Finalize. Nova mensagem abre outra sessao/oportunidade sem herdar veiculo,
    entrada ou documentos. Nao reabrir card encerrado: usar nova oportunidade.
11. Teste envio manual. Handoff gera card/estado humano no painel, NAO alerta
    para numero externo nem simulacao bancaria; essas integracoes nao foram criadas.
12. Regressao Nubia: saudacao, audio, consulta/selecao de horario, proximo dado,
    handoff e encerramento. Nao deve aparecer linguagem de veiculos.

Testes locais: banco PGlite, Core com provedores simulados e Playwright
desktop/mobile. Cinco cenarios de texto tambem foram executados com Gemini real
e a planilha publica, sem gravar no banco nem enviar WhatsApp. Audio/OCR ponta a
ponta na Evolution e permissoes da chave instalada no servidor ainda exigem teste.

Em 30/09/2026 a chave local retornou 404 para geracao com `gemini-2.5-flash`;
`gemini-3.5-flash-lite` passou nos cinco cenarios. A configuracao final altera
somente Wesley. O Google informa restricao de acesso dos modelos 2.5 a usuarios
anteriores: [documentacao oficial](https://ai.google.dev/gemini-api/docs/deprecations).
Nao presumir que a chave do servidor e igual a chave local. Smoke test opcional,
com chave do ambiente correto e consumo de quota:

```powershell
node --env-file=.env scripts/smoke_wesley_model.cjs --live
```

## 7. Limites operacionais

- Planilha atual com seis linhas: consulta renovada a cada turno e antes do
  registro. Falha/preco alterado exige equipe, nunca snapshot antigo.
- Recomendado adicionar `ID_VEICULO` e `STATUS`. Sem ID, usa marca/modelo/ano/cor;
  duplicatas bloqueiam. STATUS: disponivel/reservado/vendido/indisponivel. Sem
  coluna, significa apenas listado. Precos devem ser celulas numericas.
  Documentos pessoais nunca devem ser colocados na planilha publica.
- PDF/JPEG/PNG/WebP: ate 5 MiB, dois arquivos por lote. Extracao nao autentica
  identidade nem valida CNH; operador confere antes de simulacao.
- Campos extraidos em `sales_documents` com RLS. Binarios nao sao arquivados por
  esta implementacao; permanecem sujeitos aos sistemas de origem. Mensagens e
  CPF digitado tambem permanecem no historico autorizado.
- Definir responsavel, aviso de privacidade acessivel e retencao/descarte para
  banco, Evolution, Gemini, execucoes n8n e backups. Nao exportar documentos para
  logs publicos. Nao foi criado expurgo automatico nem bucket de CNHs.
- Endereco/09h-18h confirmados. Dias de funcionamento ainda nao informados.

## 8. Pausar somente Wesley

Se houver falha, execute `06_pausar_sales.sql`. Desliga apenas sua IA e preserva
canal ativo para atendimento humano, registros e outros tenants. O Core revalida
ai_enabled antes do envio; mensagem ja aceita pela Evolution nao pode ser recolhida.
Para reativar, corrija a causa, homologue e execute o 04 novamente. Conversas
humanas continuam bloqueadas ate retorno manual autorizado.
