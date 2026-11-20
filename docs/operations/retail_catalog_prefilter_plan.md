# Plano — pré-filtro do catálogo na interpretação (retail_v1)

Status: proposta, 2026-11-20. Nada implementado.

## Problema

A cada mensagem, o motor envia ao Gemini **todos** os candidatos do tenant (até `candidate_limit`, hoje 250).
Com os ~190 produtos do site da JOYERÍA:

- a interpretação usa ~16 mil tokens de entrada por mensagem (antes, com poucos itens, ~2,2 mil);
- a lista fechada de `item_id` no esquema estoura o limite do Gemini ("too many states"). A correção atual
  (`RETAIL_ENUM_LIMIT = 40`, campo livre acima disso + `retailKnownProducts`) evita o erro, mas tira a garantia do esquema.

## Onde fica

No **motor** (módulo genérico `n8n/sources/noria_retail.js`, função pura, projetada no CORE). Não na EXT: escolher quais
itens o Gemini enxerga acontece antes da interpretação e não é decisão comercial. A EXT continua recebendo a
interpretação e decidindo sobre itens do tenant, como hoje.

## Abordagem (sem migration)

O motor já carrega os candidatos do tenant numa consulta leve (só nome, categoria, linha, modelo e largura). O recorte
é feito em JavaScript sobre essa lista:

1. **Texto de busca:** mensagens do cliente no turno atual e as da sessão (as últimas, com mais peso para as atuais)
   e as últimas respostas da IA.
2. **Normalização:** minúsculas, sem acento, números com vírgula ou ponto ("3,5 mm" = "3.5mm").
3. **Pontuação por item:** palavras do texto que casam com nome, modelo, linha e categoria. Tolera erro de digitação
   (distância de edição 1 para palavras de 4 a 7 letras e 2 a partir de 8: "Eleganci", "Prizma", "abalada"). A largura
   conta quando o número citado coincide com `width_mm`.
4. **Recorte:** os 30 itens de maior pontuação, mais os já apresentados na sessão (fotos e produtos citados), sem
   repetir. Variações com o mesmo nome entram juntas.
5. **Sem nenhum acerto** (mensagem vaga: "quero ver alianças", "qual a mais barata?"): envia um recorte por categoria
   citada; se nem categoria houver, envia o catálogo compacto completo (comportamento de hoje). O cliente nunca fica
   sem resposta.
6. **Códigos curtos:** o Gemini recebe `c1…c30` em vez do UUID (menos tokens e lista fechada sempre válida). O motor
   traduz de volta para o `item_id` antes de entregar à EXT; código desconhecido é descartado.
7. `catalog_complete` passa a dizer se o recorte cobre o catálogo inteiro. Item fora do recorte segue a regra que já
   existe: nunca afirmar que não tem; dizer que vai verificar.

Configuração por tenant (opcional, com padrão): `retail_policy.prefilter_limit` (padrão 30).

## Efeito esperado

| | Hoje | Com recorte |
| --- | --- | --- |
| Itens enviados ao Gemini | ~190 | até ~30 |
| Entrada da interpretação por mensagem | ~16 mil tokens | ~3 a 5 mil tokens |
| Lista fechada de itens no esquema | não (acima de 40) | sim |

## Passos (TDD)

1. Testes unitários da função de recorte em `scripts/test_noria_retail.cjs`: erro de digitação, largura, variações
   do mesmo nome, itens da sessão, mensagem vaga (fallback), catálogo pequeno (sem recorte), isolamento por tenant
   (nada de outro tenant entra) e tradução dos códigos curtos, incluindo código inventado.
2. Implementar `retailCatalogShortlist` e a tradução dos códigos em `noria_retail.js`. Ligar no prepare do CORE.
3. Regenerar os artefatos e rodar a bateria do retail.
4. Simulador: rodar as rodadas 1 a 3 com o catálogo do site e comparar acertos de produto e tokens com o reteste atual.
5. Commit no `dev`.

## Quando usar o banco

Para catálogos acima de ~500 itens (limite atual do `candidate_limit`), carregar tudo a cada mensagem deixa de valer a
pena. Aí a busca passa para o Postgres: extensão `pg_trgm` (disponível no projeto, **não instalada**) com índice de
trigramas em nome e modelo, e uma função de busca com `security invoker`. Isso exige migration e autorização para
instalar a extensão em produção. Não é necessário para a JOYERÍA.

## Riscos

- Item certo fora do recorte: mitigado pelos itens da sessão, pela tolerância a erro e pelo fallback.
- Tolerância alta demais traz itens parecidos: limite de distância por tamanho da palavra e testes com nomes reais.
- Rollback: `prefilter_limit: 0` desliga o recorte e volta ao comportamento atual, sem deploy de banco.
