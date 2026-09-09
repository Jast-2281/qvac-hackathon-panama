/**
 * nucleo.js — la unica parte de Zarpe que toca QVAC.
 *
 * Regla de diseno: el modelo clasifica, no calcula.
 * Su salida esta acotada por un enum construido desde la tabla local, asi que
 * estructuralmente no puede inventar una categoria que no exista. El SDK
 * convierte el json_schema a gramatica GBNF de llama.cpp.
 *
 * Firmas verificadas en QVAC-API.md. No se usa nada no verificado.
 */

import { readFile } from 'node:fs/promises';
import { loadModel, LLAMA_3_2_1B_INST_Q4_0, QWEN3_600M_INST_Q4, completion, unloadModel } from '@qvac/sdk';
import { calcularImportacion, estimarCIF, CategoriaNoVerificada } from './calculo.js';

const MODELOS = { LLAMA_3_2_1B_INST_Q4_0, QWEN3_600M_INST_Q4 };
const modeloSrc = MODELOS[process.env.ZARPE_MODELO] ?? LLAMA_3_2_1B_INST_Q4_0;

let modelId = null;
let tabla = null;

export async function iniciar({ onProgress, mock = false } = {}) {
  tabla = JSON.parse(await readFile(new URL('../data/aranceles.json', import.meta.url), 'utf8'));
  if (mock) return { modelId: 'mock', msCarga: 0, verificadas: verificadas().length };

  const t0 = Date.now();
  modelId = await loadModel({ modelSrc: modeloSrc, onProgress });
  return { modelId, msCarga: Date.now() - t0, verificadas: verificadas().length };
}

export async function detener() {
  if (modelId) { await unloadModel({ modelId }); modelId = null; }
}

export const meta = () => tabla._meta;
export const verificadas = () => tabla.categorias.filter((c) => c.verificado);

function schema() {
  return {
    type: 'json_schema',
    json_schema: {
      name: 'clasificacion_producto',
      schema: {
        type: 'object',
        properties: {
          producto_normalizado: { type: 'string', description: 'El producto descrito, normalizado en una frase corta.' },
          categoria_id: { type: 'string', enum: tabla.categorias.map((c) => c.id), description: 'El id de la categoria asignada, de la lista enumerada. Si el producto no corresponde claramente a ninguna categoria de la lista, DEBE ser "otros".' },
          confianza: { type: 'number', description: 'numero entre 0 y 1' },
        },
        required: ['producto_normalizado', 'categoria_id', 'confianza'],
      },
      strict: true,
    },
  };
}

function sistema() {
  const lista = tabla.categorias
    .map((c) => `- ${c.id}: ${c.nombre}${c.keywords.length ? ` (${c.keywords.join(', ')})` : ''}`)
    .join('\n');
  return [
    'You are a customs tariff classifier for Panama and the Colon Free Zone.',
    'Assign the described product to ONE of these categories:',
    lista,
    'NEVER estimate rates, taxes, or costs.',
    'If the product does NOT clearly and confidently match one of the categories listed above, you MUST respond with categoria_id "otros" and a low confianza value. Do not force it into the closest-sounding category just to give a specific answer.',
  ].join('\n');
}

/**
 * @param {object} p
 * @param {string} p.descripcion
 * @param {number} p.valor          Valor declarado.
 * @param {'CIF'|'FOB'} p.tipoValor
 * @param {'nacionalizacion'|'reexportacion'} p.regimen
 * @param {number} [p.gastosFijos]
 */
export async function estimar({ descripcion, valor, tipoValor, regimen, gastosFijos = 0, mock = false }) {
  const m = tabla._meta;
  const valorCIF = tipoValor === 'FOB' ? estimarCIF(valor, m.estimacion_cif_desde_fob) : valor;

  let clasificacion, rendimiento, metodo;

  const t = descripcion.toLowerCase();
  const coincidencias = tabla.categorias.filter((c) => c.keywords.some((k) => t.includes(k)));

  if (coincidencias.length === 1) {
    const cat0 = coincidencias[0];
    clasificacion = { producto_normalizado: descripcion, categoria_id: cat0.id, confianza: 1 };
    rendimiento = { ttft_ms: null, tokens: null, ms_total: null, tokens_por_seg: null, mock: false };
    metodo = 'keywords';
  } else if (mock) {
    const hit = tabla.categorias.find((c) => c.keywords.some((k) => t.includes(k)));
    clasificacion = { producto_normalizado: descripcion, categoria_id: hit ? hit.id : 'otros', confianza: hit ? 0.9 : 0.2 };
    rendimiento = { ttft_ms: null, tokens: null, ms_total: null, tokens_por_seg: null, mock: true };
    metodo = 'mock';
  } else {
    if (!modelId) throw new Error('Llama a iniciar() antes de estimar()');
    const t0 = Date.now();
    let ttft = null, tokens = 0, bruto = '';
    const run = completion({
      modelId,
      history: [
        { role: 'system', content: sistema() },
        { role: 'user', content: `Producto a importar: ${descripcion}` },
      ],
      stream: true,
      responseFormat: schema(),
    });
    for await (const tok of run.tokenStream) {
      if (ttft === null) ttft = Date.now() - t0;
      tokens += 1; bruto += tok;
    }
    const ms = Date.now() - t0;
    clasificacion = JSON.parse(bruto);
    rendimiento = { ttft_ms: ttft, tokens, ms_total: ms, tokens_por_seg: +(tokens / (ms / 1000)).toFixed(1) };
    metodo = 'modelo';
  }

  if (clasificacion.confianza > 1) clasificacion.confianza /= 100;

  const cat = tabla.categorias.find((c) => c.id === clasificacion.categoria_id)
    ?? tabla.categorias.find((c) => c.id === 'otros');

  const base = {
    clasificacion,
    categoria: { id: cat.id, nombre: cat.nombre, fraccion: cat.fraccion, verificado: cat.verificado },
    rendimiento,
    valorCIF: Math.round(valorCIF * 100) / 100,
    tipoValor,
    metodo,
    confianza: clasificacion.confianza,
  };

  if (metodo === 'modelo' && clasificacion.confianza < 0.6) {
    return { ...base, disponible: false, motivo: 'confianza insuficiente' };
  }

  if (!cat.verificado) {
    return { ...base, disponible: false, motivo: 'Zarpe no tiene tributos verificados para esta categoria y no responde con datos sin verificar.' };
  }

  const args = {
    valorCIF, tasaArancelPct: cat.dai_pct, itbmsPct: cat.itbms_pct,
    iscPct: cat.isc_pct, iccdpPct: cat.iccdp_pct, gastosFijos,
    deMinimisCIF: m.de_minimis_cif_usd,
  };

  try {
    // Se calculan los dos regimenes: el elegido y el contrafactual.
    // Esa comparacion es el corazon del producto.
    const elegido = calcularImportacion({ ...args, regimen });
    const otro = calcularImportacion({
      ...args,
      regimen: regimen === 'reexportacion' ? 'nacionalizacion' : 'reexportacion',
    });
    return {
      ...base, disponible: true,
      tributos: { dai_pct: cat.dai_pct, itbms_pct: cat.itbms_pct, isc_pct: cat.isc_pct, iccdp_pct: cat.iccdp_pct },
      calculo: elegido,
      contrafactual: otro,
      aviso: 'Estimacion orientativa contra el Arancel Nacional. No es un dictamen oficial de clasificacion.',
    };
  } catch (e) {
    if (e instanceof CategoriaNoVerificada) {
      return { ...base, disponible: false, motivo: e.message };
    }
    throw e;
  }
}
