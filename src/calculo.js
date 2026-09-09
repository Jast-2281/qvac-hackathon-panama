/**
 * calculo.js — aritmetica determinista de Zarpe.
 *
 * Aqui NO hay inteligencia artificial. El modelo ya hizo su unico trabajo
 * (elegir una categoria); lo que sigue son numeros que siempre dan lo mismo
 * con la misma entrada. Esa separacion es el argumento central del proyecto:
 * Zarpe no alucina impuestos.
 *
 * Reglas panamenas aplicadas (ver fuentes en data/aranceles.json):
 *  - ITBMS general 7%, licores 10%, tabaco 15%, medicamentos exentos.
 *  - Base del ITBMS en importacion: CIF + arancel y demas gravamenes aduaneros.
 *  - Regimen de reexportacion desde Zona Libre de Colon: no causa arancel ni ITBMS.
 *  - De minimis por valor CIF.
 */

/**
 * Estima el CIF cuando el usuario solo conoce el FOB.
 */
export function estimarCIF(valorFOB, { flete_pct, seguro_pct }) {
  return valorFOB * (1 + flete_pct / 100 + seguro_pct / 100);
}

/**
 * @param {object} p
 * @param {number} p.valorCIF
 * @param {'nacionalizacion'|'reexportacion'} p.regimen
 * @param {number|null} p.tasaArancelPct  null si la categoria no esta verificada.
 * @param {number|null} p.itbmsPct
 * @param {number} [p.gastosFijos]        Agente de aduana, manejo, almacenaje.
 * @param {number} [p.deMinimisCIF]
 */
export function calcularImportacion({
  valorCIF,
  regimen,
  tasaArancelPct,
  itbmsPct,
  iscPct = 0,
  iccdpPct = 0,
  gastosFijos = 0,
  deMinimisCIF = 0,
}) {
  if (!Number.isFinite(valorCIF) || valorCIF < 0) {
    throw new Error('valorCIF debe ser un numero positivo');
  }

  // Reexportacion: la mercancia entra a la Zona Libre con destino final el
  // extranjero. No causa arancel ni ITBMS panameno. Solo quedan los gastos.
  if (regimen === 'reexportacion') {
    return armar({
      valorCIF, arancel: 0, baseITBMS: 0, itbms: 0, gastosFijos,
      regimen,
      motivo: 'Reexportacion desde Zona Libre de Colon: no causa arancel ni ITBMS panameno.',
    });
  }

  if (valorCIF < deMinimisCIF) {
    return armar({
      valorCIF, arancel: 0, baseITBMS: 0, itbms: 0, gastosFijos,
      regimen,
      motivo: `Valor CIF por debajo del umbral de minimis (USD ${deMinimisCIF}).`,
    });
  }

  if (tasaArancelPct === null || itbmsPct === null) {
    throw new CategoriaNoVerificada();
  }

  const dai = valorCIF * (tasaArancelPct / 100);
  const isc = valorCIF * (iscPct / 100);
  const iccdp = valorCIF * (iccdpPct / 100);

  // SUPUESTO: el ISC se excluye de la base del ITBMS. Ver _meta.supuesto_pendiente.
  const baseITBMS = valorCIF + dai + iccdp;
  const itbms = baseITBMS * (itbmsPct / 100);

  return armar({ valorCIF, arancel: dai, isc, iccdp, baseITBMS, itbms, gastosFijos, regimen, motivo: null });
}

export class CategoriaNoVerificada extends Error {
  constructor() {
    super('Categoria sin tasa verificada: Zarpe no responde con datos no verificados.');
    this.name = 'CategoriaNoVerificada';
  }
}

function armar({ valorCIF, arancel, isc = 0, iccdp = 0, baseITBMS, itbms, gastosFijos, regimen, motivo }) {
  const impuestos = arancel + isc + iccdp + itbms;
  return {
    regimen,
    motivo,
    valorCIF: r(valorCIF),
    dai: r(arancel),
    isc: r(isc),
    iccdp: r(iccdp),
    baseITBMS: r(baseITBMS),
    itbms: r(itbms),
    gastosFijos: r(gastosFijos),
    impuestos: r(impuestos),
    costoTotal: r(valorCIF + impuestos + gastosFijos),
    sobrecostoPct: valorCIF > 0 ? r(((impuestos + gastosFijos) / valorCIF) * 100) : 0,
  };
}

const r = (n) => Math.round(n * 100) / 100;
