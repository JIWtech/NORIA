'use strict';
// Projeção de n8n/sources/noria_retail.js numa região marcada de n8n/sources/noria_core.js.
// A região é sempre reescrita a partir da fonte: editar o trecho dentro do motor não tem efeito duradouro.

const START = '// >>> retail_v1: projeção de n8n/sources/noria_retail.js (gerada por scripts/build_noria_workflows.cjs; não editar aqui)';
const END = '// <<< retail_v1';
const SOURCE_END = '// === fim das funções do retail_v1 projetadas no motor';
// Âncora de inserção na primeira geração: logo após a declaração dos campos do pipeline em fases.
const ANCHOR = /^const TURN_PIPELINE_FIELDS = .*;$/m;

function retailRegionBody(retailSource) {
  const source = String(retailSource).replace(/\r\n/g, '\n');
  const cut = source.indexOf(SOURCE_END);
  if (cut < 0) throw new Error('RETAIL_SOURCE_END_MARKER_MISSING');
  const body = source.slice(0, cut).trimEnd();
  if (/module\.exports|require\(/.test(body)) throw new Error('RETAIL_SOURCE_NOT_PURE');
  return body;
}

function syncRetailRegion(coreCode, retailSource) {
  const region = START + '\n' + retailRegionBody(retailSource) + '\n' + END;
  const starts = coreCode.split(START).length - 1, ends = coreCode.split(END).length - 1;
  if (starts !== ends || starts > 1) throw new Error('RETAIL_REGION_MARKERS_INVALID');
  if (starts === 1) {
    const i = coreCode.indexOf(START), j = coreCode.indexOf(END, i);
    if (j < i) throw new Error('RETAIL_REGION_MARKERS_INVALID');
    return coreCode.slice(0, i) + region + coreCode.slice(j + END.length);
  }
  const match = ANCHOR.exec(coreCode);
  if (!match) throw new Error('RETAIL_REGION_ANCHOR_MISSING');
  const at = match.index + match[0].length;
  return coreCode.slice(0, at) + '\n\n' + region + coreCode.slice(at);
}

function extractRetailRegion(coreCode) {
  const i = coreCode.indexOf(START), j = coreCode.indexOf(END, i);
  if (i < 0 || j < 0) return null;
  return coreCode.slice(i + START.length + 1, j - 1);
}

module.exports = { syncRetailRegion, extractRetailRegion, retailRegionBody, START, END };
