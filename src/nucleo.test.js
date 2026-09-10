import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import * as nucleo from './nucleo.js';

before(async () => { await nucleo.iniciar({ mock: true }); });

function clasificar(descripcion) {
  return nucleo.estimar({ descripcion, valor: 1000, tipoValor: 'CIF', regimen: 'reexportacion', mock: true });
}

test('drones no coincide con licores por subcadena de "ron"', async () => {
  const r = await clasificar('drones');
  assert.notEqual(r.clasificacion.categoria_id, 'licores');
});

test('botellas de agua no coincide con licores', async () => {
  const r = await clasificar('botellas de agua');
  assert.notEqual(r.clasificacion.categoria_id, 'licores');
});

test('ronda de negocios no coincide con licores por subcadena de "ron"', async () => {
  const r = await clasificar('ronda de negocios');
  assert.notEqual(r.clasificacion.categoria_id, 'licores');
});

test('whisky escoces coincide por keywords con licores', async () => {
  const r = await clasificar('200 cajas de whisky escoces');
  assert.equal(r.metodo, 'keywords');
  assert.equal(r.clasificacion.categoria_id, 'licores');
});

test('cajetillas de cigarrillos coincide por keywords con cigarrillos', async () => {
  const r = await clasificar('cajetillas de cigarrillos');
  assert.equal(r.metodo, 'keywords');
  assert.equal(r.clasificacion.categoria_id, 'cigarrillos');
});

test('camisetas de algodon coincide por keywords con camisetas', async () => {
  const r = await clasificar('500 camisetas de algodon');
  assert.equal(r.metodo, 'keywords');
  assert.equal(r.clasificacion.categoria_id, 'camisetas');
});

test('camisetas de poliester no usa el atajo de keywords (material no coincide)', async () => {
  const r = await clasificar('camisetas de poliester');
  assert.notEqual(r.metodo, 'keywords');
});

test('rollos de algodon no usa el atajo de keywords (materia prima, no prenda)', async () => {
  const r = await clasificar('rollos de algodon');
  assert.notEqual(r.metodo, 'keywords');
});

test('la negacion evita clasificar como camisetas', async () => {
  const r = await clasificar('no son camisetas, son zapatos');
  assert.notEqual(r.metodo, 'keywords');
});

test('una coma o "y" suelta evita el atajo por keywords (posible carga mixta)', async () => {
  const conY = await clasificar('camisetas y zapatos');
  const conComa = await clasificar('camisetas, zapatos');
  assert.notEqual(conY.metodo, 'keywords');
  assert.notEqual(conComa.metodo, 'keywords');
});

test('un "y" dentro de una palabra (whiskey) no dispara la guarda de multiproducto', async () => {
  const r = await clasificar('una botella de whiskey');
  assert.equal(r.metodo, 'keywords');
  assert.equal(r.clasificacion.categoria_id, 'licores');
});
