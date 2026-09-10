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

test('whisky escoces coincide por keywords con licores y calcula', async () => {
  const r = await clasificar('200 cajas de whisky escoces');
  assert.equal(r.metodo, 'keywords');
  assert.equal(r.clasificacion.categoria_id, 'licores');
  assert.equal(r.disponible, true);
});

test('cajetillas de cigarrillos coincide por keywords con cigarrillos y calcula', async () => {
  const r = await clasificar('cajetillas de cigarrillos');
  assert.equal(r.metodo, 'keywords');
  assert.equal(r.clasificacion.categoria_id, 'cigarrillos');
  assert.equal(r.disponible, true);
});

test('camisetas de algodon coincide por keywords con camisetas y calcula', async () => {
  const r = await clasificar('500 camisetas de algodon');
  assert.equal(r.metodo, 'keywords');
  assert.equal(r.clasificacion.categoria_id, 'camisetas');
  assert.equal(r.disponible, true);
});

test('una botella de whiskey coincide por keywords con licores y calcula', async () => {
  const r = await clasificar('una botella de whiskey');
  assert.equal(r.metodo, 'keywords');
  assert.equal(r.clasificacion.categoria_id, 'licores');
  assert.equal(r.disponible, true);
});

// A partir de aca: casos que deben bloquear el calculo (disponible: false),
// sin importar el motivo tecnico exacto por el que se bloquean. Reproducen
// la tabla de la segunda revision de Codex.

test('camisetas de poliester no calcula (material no coincide)', async () => {
  const r = await clasificar('camisetas de poliester');
  assert.equal(r.disponible, false);
});

test('camisetas de seda no calcula (material fuera de la lista de exclusion original, ahora cubierto)', async () => {
  const r = await clasificar('camisetas de seda');
  assert.equal(r.disponible, false);
});

test('rollos de algodon no calcula (materia prima, no prenda)', async () => {
  const r = await clasificar('rollos de algodon');
  assert.equal(r.disponible, false);
});

test('pantalones de algodon no calcula (algodon solo no basta sin prenda)', async () => {
  const r = await clasificar('pantalones de algodon');
  assert.equal(r.disponible, false);
});

test('camisetas sin algodon no calcula (se niega el material requerido)', async () => {
  const r = await clasificar('camisetas sin algodon');
  assert.equal(r.disponible, false);
});

test('no son camisetas, son zapatos no calcula (negacion + coma)', async () => {
  const r = await clasificar('no son camisetas, son zapatos');
  assert.equal(r.disponible, false);
});

test('camisetas y zapatos no calcula (posible carga mixta)', async () => {
  const r = await clasificar('camisetas y zapatos');
  assert.equal(r.disponible, false);
});

test('camisetas, zapatos no calcula (coma como separador)', async () => {
  const r = await clasificar('camisetas, zapatos');
  assert.equal(r.disponible, false);
});

test('camisetas + zapatos no calcula ("+" como separador)', async () => {
  const r = await clasificar('camisetas + zapatos');
  assert.equal(r.disponible, false);
});

test('camisetas; zapatos no calcula (";" como separador)', async () => {
  const r = await clasificar('camisetas; zapatos');
  assert.equal(r.disponible, false);
});

test('camisetas y zapatos en lineas separadas no calcula (salto de linea como separador)', async () => {
  const r = await clasificar('camisetas\nzapatos');
  assert.equal(r.disponible, false);
});

// Limite conocido y aceptado: una palabra usada en sentido no literal
// ("funda PARA camisetas") no tiene una guarda generica segura sin arriesgar
// falsos positivos sobre descripciones validas ("camisetas para hombre").
// Este test documenta el comportamiento actual, no lo aprueba.
test('fundas para camisetas todavia se clasifica como camisetas (limite conocido, no resuelto)', async () => {
  const r = await clasificar('fundas para camisetas');
  assert.equal(r.metodo, 'keywords');
  assert.equal(r.disponible, true);
});
