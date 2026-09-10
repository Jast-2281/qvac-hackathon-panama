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
const modeloNombre = MODELOS[process.env.ZARPE_MODELO] ? process.env.ZARPE_MODELO : 'LLAMA_3_2_1B_INST_Q4_0';
const modeloSrc = MODELOS[modeloNombre];

export const modeloActivo = () => modeloNombre;

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

function normalizar(s) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function escaparRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const NEGACIONES = ['no', 'sin', 'nunca', 'tampoco', 'excepto'];

function precedeNegacion(texto, indice) {
  const antes = texto.slice(0, indice).trim().split(/\s+/).filter(Boolean);
  return NEGACIONES.includes(antes.at(-1)) || NEGACIONES.includes(antes.at(-2));
}

// Coincide como palabra completa (no subcadena, ej. "ron" en "drones") y
// descarta la coincidencia si el keyword esta negado justo antes (ej. "no son camisetas").
function contieneKeyword(textoNormalizado, keyword) {
  const k = escaparRegex(normalizar(keyword));
  const re = new RegExp(`(?<![a-z0-9])${k}(?![a-z0-9])`, 'g');
  let m;
  while ((m = re.exec(textoNormalizado))) {
    if (!precedeNegacion(textoNormalizado, m.index)) return true;
  }
  return false;
}

function materialNegado(textoNormalizado, material) {
  const k = escaparRegex(normalizar(material));
  const re = new RegExp(`(?<![a-z0-9])${k}(?![a-z0-9])`, 'g');
  let m;
  while ((m = re.exec(textoNormalizado))) {
    if (precedeNegacion(textoNormalizado, m.index)) return true;
  }
  return false;
}

// Una categoria queda "contradicha" por el texto si aparece alguna de sus
// palabras de exclusion (material o forma que no corresponde a la fraccion,
// ej. "poliester" o "seda" para camisetas de algodon) o si se niega
// explicitamente el material que la categoria requiere (ej. "camisetas sin
// algodon"). Esto se usa tanto para descartar el atajo por keywords como,
// mas abajo, como control posterior sobre la categoria que haya elegido el
// modelo: detectar la contradiccion no sirve de nada si no bloquea el calculo.
function categoriaContradicha(textoNormalizado, categoria) {
  const excluye = categoria.excluye ?? [];
  if (excluye.some((k) => contieneKeyword(textoNormalizado, k))) return true;
  if (categoria.materialRequerido && materialNegado(textoNormalizado, categoria.materialRequerido)) return true;
  return false;
}

function categoriaCoincide(textoNormalizado, categoria) {
  if (categoriaContradicha(textoNormalizado, categoria)) return false;
  return categoria.keywords.some((k) => contieneKeyword(textoNormalizado, k));
}

// Una coma, un "+"/";"/salto de linea, o un "y" suelto sugieren que la
// descripcion junta mas de un producto (ej. "camisetas y zapatos",
// "camisetas; zapatos"). En ese caso no confiamos en el atajo por keywords
// aunque solo una categoria haya coincidido por palabra: mejor que decida el
// modelo, que tiene el umbral de confianza como defensa.
function pareceMultiproducto(textoNormalizado) {
  return /[,;+\n]/.test(textoNormalizado) || /(?<![a-z0-9])y(?![a-z0-9])/.test(textoNormalizado);
}

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
 * @param {string} [p.categoriaConfirmada]  Id de categoria que el usuario ya
 *   confirmo en una vuelta anterior (ver `cat.confirmar`). Solo se acepta si
 *   la descripcion ACTUAL sigue coincidiendo con esa categoria: una
 *   confirmacion vieja no se puede reutilizar sobre una descripcion editada
 *   despues de pedirla (ej. confirmar "camisetas" y luego cambiar el texto
 *   a "drones" antes de enviar).
 */
export async function estimar({ descripcion, valor, tipoValor, regimen, gastosFijos = 0, mock = false, categoriaConfirmada = null }) {
  const m = tabla._meta;
  const valorCIF = tipoValor === 'FOB' ? estimarCIF(valor, m.estimacion_cif_desde_fob) : valor;
  const t = normalizar(descripcion);

  // Si la descripcion junta mas de un producto no vale la pena invocar el
  // modelo ni respetar ninguna confirmacion previa: ya sabemos que se va a
  // rechazar, asi que se corta aqui en vez de esperar una inferencia inutil.
  if (pareceMultiproducto(t)) {
    const otros = tabla.categorias.find((c) => c.id === 'otros');
    return {
      clasificacion: { producto_normalizado: descripcion, categoria_id: otros.id, confianza: null },
      categoria: { id: otros.id, nombre: otros.nombre, fraccion: otros.fraccion, verificado: otros.verificado },
      rendimiento: { ttft_ms: null, tokens: null, ms_total: null, tokens_por_seg: null, mock: false },
      valorCIF: Math.round(valorCIF * 100) / 100,
      tipoValor,
      supuestoFOB: tipoValor === 'FOB' ? m.estimacion_cif_desde_fob : null,
      metodo: 'bloqueado',
      confianza: null,
      disponible: false,
      motivo: 'Tu descripcion parece tener mas de un producto (una coma, "+", ";", salto de linea o "y"). Zarpe solo admite un producto por consulta: si es un solo producto (ej. una talla o un destinatario), quita el separador; si son varios, calcula cada uno por separado.',
    };
  }

  let clasificacion, rendimiento, metodo;

  const coincidencias = tabla.categorias.filter((c) => categoriaCoincide(t, c));

  if (categoriaConfirmada && tabla.categorias.some((c) => c.id === categoriaConfirmada && categoriaCoincide(t, c))) {
    const catConfirmada = tabla.categorias.find((c) => c.id === categoriaConfirmada);
    clasificacion = { producto_normalizado: descripcion, categoria_id: catConfirmada.id, confianza: null };
    rendimiento = { ttft_ms: null, tokens: null, ms_total: null, tokens_por_seg: null, mock: false };
    metodo = 'confirmado';
  } else if (coincidencias.length === 1) {
    const cat0 = coincidencias[0];
    clasificacion = { producto_normalizado: descripcion, categoria_id: cat0.id, confianza: null };
    rendimiento = { ttft_ms: null, tokens: null, ms_total: null, tokens_por_seg: null, mock: false };
    metodo = 'keywords';
  } else if (mock) {
    const hit = coincidencias[0];
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
    supuestoFOB: tipoValor === 'FOB' ? m.estimacion_cif_desde_fob : null,
    metodo,
    confianza: clasificacion.confianza,
  };

  // Control posterior a la clasificacion, sin importar si la categoria vino del
  // atajo por keywords, del modelo o de una confirmacion: detectar una
  // contradiccion de material no sirve de nada si no bloquea el calculo aqui
  // tambien (la carga mixta ya se descarto antes, mas arriba).
  if (categoriaContradicha(t, cat)) {
    return {
      ...base, disponible: false,
      motivo: 'La descripcion contradice la categoria elegida. Aclara la descripcion.',
    };
  }

  if (metodo === 'modelo' && clasificacion.confianza < 0.6) {
    return { ...base, disponible: false, motivo: 'confianza insuficiente' };
  }

  if (!cat.verificado) {
    return { ...base, disponible: false, motivo: 'Zarpe no tiene tributos verificados para esta categoria y no responde con datos sin verificar.' };
  }

  // Algunas categorias no se identifican solo con palabras: requieren que el
  // usuario confirme un atributo que ni el atajo por keywords ni el modelo
  // pueden verificar con certeza (ej. que "camisetas" sea realmente la
  // prenda, no un accesorio como "fundas para camisetas"). Se pregunta una
  // vez; si ya viene confirmado (metodo "confirmado") se calcula de una vez.
  if (cat.confirmar && metodo !== 'confirmado') {
    return {
      ...base, disponible: false,
      motivo: 'requiere confirmacion',
      requiereConfirmacion: { categoriaId: cat.id, pregunta: cat.confirmar },
    };
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
      aviso: 'Estimacion orientativa contra el Arancel Nacional (solo tasas NMF, sin tratado preferencial). No es un dictamen oficial de clasificacion. Supuesto sin confirmar: el ISC no se incluye en la base del ITBMS.',
    };
  } catch (e) {
    if (e instanceof CategoriaNoVerificada) {
      return { ...base, disponible: false, motivo: e.message };
    }
    throw e;
  }
}
