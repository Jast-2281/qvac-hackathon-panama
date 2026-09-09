import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularImportacion, estimarCIF, CategoriaNoVerificada } from './calculo.js';

test('rechaza valorCIF negativo', () => {
  assert.throws(() => calcularImportacion({ valorCIF: -1, regimen: 'reexportacion' }));
});

test('rechaza valorCIF no numerico', () => {
  assert.throws(() => calcularImportacion({ valorCIF: 'mil', regimen: 'reexportacion' }));
});

test('rechaza gastosFijos negativo', () => {
  assert.throws(() => calcularImportacion({ valorCIF: 100, regimen: 'reexportacion', gastosFijos: -5 }));
});

test('rechaza regimen invalido', () => {
  assert.throws(() => calcularImportacion({ valorCIF: 100, regimen: 'transito' }));
});

test('reexportacion no causa arancel ni itbms', () => {
  const r = calcularImportacion({ valorCIF: 1000, regimen: 'reexportacion', tasaArancelPct: 15, itbmsPct: 10 });
  assert.equal(r.dai, 0);
  assert.equal(r.itbms, 0);
});

test('nacionalizacion aplica dai e itbms sobre cif+dai', () => {
  const r = calcularImportacion({ valorCIF: 1000, regimen: 'nacionalizacion', tasaArancelPct: 10, itbmsPct: 10 });
  assert.equal(r.dai, 100);
  assert.equal(r.itbms, 110);
});

test('categoria no verificada lanza CategoriaNoVerificada', () => {
  assert.throws(
    () => calcularImportacion({ valorCIF: 1000, regimen: 'nacionalizacion', tasaArancelPct: null, itbmsPct: null }),
    CategoriaNoVerificada,
  );
});

test('estimarCIF aplica flete y seguro', () => {
  const cif = estimarCIF(1000, { flete_pct: 10, seguro_pct: 5 });
  assert.ok(Math.abs(cif - 1150) < 1e-9);
});
