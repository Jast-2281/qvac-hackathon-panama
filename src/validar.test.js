import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarEntrada } from './validar.js';

const base = { descripcion: 'camisetas', valor: 100, tipoValor: 'CIF', regimen: 'reexportacion' };

test('acepta una entrada valida', () => {
  assert.equal(validarEntrada(base), null);
});

test('rechaza cuerpo no objeto', () => {
  assert.ok(validarEntrada(null));
  assert.ok(validarEntrada('texto'));
});

test('rechaza descripcion vacia', () => {
  assert.ok(validarEntrada({ ...base, descripcion: '' }));
});

test('rechaza descripcion no textual', () => {
  assert.ok(validarEntrada({ ...base, descripcion: 42 }));
});

test('rechaza tipoValor invalido', () => {
  assert.ok(validarEntrada({ ...base, tipoValor: 'EXW' }));
});

test('rechaza valor negativo o no numerico', () => {
  assert.ok(validarEntrada({ ...base, valor: -1 }));
  assert.ok(validarEntrada({ ...base, valor: 'mil' }));
});

test('rechaza gastosFijos negativo', () => {
  assert.ok(validarEntrada({ ...base, gastosFijos: -1 }));
});

test('rechaza regimen invalido', () => {
  assert.ok(validarEntrada({ ...base, regimen: 'transito' }));
});
