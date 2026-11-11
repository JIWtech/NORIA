# Qualificacao de financiamento - Genesis

> Registro histórico. Os nomes de workflows e comandos de publicação desta fase foram substituídos. Consulte o [índice atual](../../docs/INDEX.md) para localizar os exports do NORIA.

## Regra confirmada

Lead quente exige simultaneamente:

1. Interesse de compra em um veiculo identificado no estoque.
2. Entrada informada maior ou igual a 30% do preco desse veiculo.
3. CPF, data de nascimento e CNH recebidos para financiamento.

Documentos recebidos nao significam documentos autenticados, credito aprovado ou simulacao bancaria realizada. A equipe continua responsavel pela conferencia. Nao se trata do documento do carro.

Exemplo: veiculo de R$ 42.980,00 exige entrada de R$ 12.894,00. R$ 12.893,99 nao atinge 30%. Se o calculo resultar em fracao de centavo, o minimo e arredondado para cima.

## Causas encontradas no codigo

- `magia_sales_save` calculava `hot` somente pela entrada, sem exigir documentos.
- A mudanca para `sales_hot` dependia de `register_interest` escolhido pelo modelo. Com `reply` ou `handoff`, a classificacao nao promovia o lead automaticamente.
- `salesReadMedia` tratava fotos comuns como fotos de veiculos; uma CNH enviada como imagem nao era extraida.
- A data de nascimento escrita no chat nao era incorporada aos documentos privados nem ao indicador `document_status`.
- O frontend prioriza `sales_leads.stage_key`. Corrigir apenas o texto da mensagem ou o campo `hot` nao muda a coluna.

Diagnostico baseado no codigo da branch prod e no workflow anteriormente fornecido, nao em uma consulta LIVE das conversas afetadas.

## Alteracoes limitadas

- Regra habilitada por `sales.hot_lead_rule=deposit_30_and_financing_documents_v1`, exclusivamente na Genesis pelo SQL 17.
- Banco calcula o resultado usando a entrada, o produto e documentos do mesmo lead/sessao, incluindo os recebidos no turno atual.
- Entrada suficiente + documentos completos move para a etapa quente mesmo sem `register_interest`. A etapa bloqueia a IA e entrega para atendimento humano.
- So entrada, so documentos ou entrada abaixo de 30% nao geram lead quente.
- O valor real da entrada, inclusive zero, permanece salvo. Nao e substituido pelos 30%.
- Cards existentes exibem resumo: entrada nao informada, entrada abaixo de 30%, documentacao pendente ou requisitos recebidos, com entrada e minimo em reais.
- Nao sao criadas novas colunas. A qualificacao incompleta permanece na etapa de qualificacao, salvo os encaminhamentos humanos ja existentes.
- CPF, nascimento e CNH nao aparecem no resumo do card. O armazenamento privado de documentos e as permissoes existentes sao preservados.
- Fotos passam por OCR de documentos apenas com a regra ativa e contexto de compra/documentacao. Fotos de veiculos nao comprovam CNH.
- Intencao de compra ja registrada nao e descartada por uma resposta posterior desconhecida do modelo.
- A reconsulta de estoque antes de concluir a qualificacao evita usar um produto/preco desatualizado.

## Referência de publicação

Para alterações no ambiente atual, siga o [checklist de publicação](../../docs/operations/production_deploy_checklist.md).

## Validacao

- Entrada de 30%, sem documentos: sem lead quente; documentacao pendente.
- Documentos completos, sem entrada: sem lead quente; entrada nao informada.
- Documentos completos, entrada zero ou abaixo de 30%: sem lead quente; preservar o valor informado.
- Entrada de 30% + documentos completos: `hot=true`, `stage_key=sales_hot`, `ai_locked=true`.
- Documentos enviados antes ou depois da entrada: combinar os dados da mesma sessao.
- CPF/CNH sem nascimento: documentacao incompleta.
- Foto de veiculo, documento ilegivel ou falha de OCR: nunca considerar documentacao completa por presuncao.
- Veiculo diferente/preco alterado: recalcular sobre o veiculo atual, sem herdar o minimo do anterior.
- Atendimento humano, contato excluido, pos-venda, venda de veiculo para a loja e outros tenants: preservar seus controles existentes.

## Conversas anteriores

Nao ha reclassificacao em massa neste pacote. Conversas ja bloqueadas para atendimento humano permanecem em silencio e nao recebem nova analise automatica de anexos. Isso evita responder por cima da equipe ou mudar etapas manuais.

O diagnostico permite encontrar leads cujo cadastro ja contem os dois requisitos, mas cuja etapa antiga nao corresponde. A equipe pode mover esses cards pelo Kanban. Se os documentos nao foram extraidos anteriormente, a migracao nao inventa nem recupera esses dados automaticamente.

Para continuar a qualificacao automatica de uma conversa ativa, a equipe precisa devolver explicitamente o atendimento para a IA. Nao usar reset em massa, pois as sessoes isolam o contexto e os documentos.
