import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import * as nucleo from './nucleo.js';

before(async () => { await nucleo.iniciar({ mock: true }); });

function clasificar(descripcion, categoriaConfirmada = null) {
  return nucleo.estimar({ descripcion, valor: 1000, tipoValor: 'CIF', regimen: 'reexportacion', mock: true, categoriaConfirmada });
}

// Clasifica y, si pide confirmacion, confirma con la misma descripcion y
// devuelve el resultado final (para probar el camino feliz completo).
async function clasificarYConfirmar(descripcion) {
  const r1 = await clasificar(descripcion);
  if (!r1.requiereConfirmacion) return r1;
  return clasificar(descripcion, r1.requiereConfirmacion.categoriaId);
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

test('whisky escoces coincide por keywords, pide confirmar y calcula', async () => {
  const r1 = await clasificar('200 cajas de whisky escoces');
  assert.equal(r1.metodo, 'keywords');
  assert.equal(r1.clasificacion.categoria_id, 'licores');
  assert.equal(r1.disponible, false);
  assert.equal(r1.requiereConfirmacion.categoriaId, 'licores');

  const r2 = await clasificarYConfirmar('200 cajas de whisky escoces');
  assert.equal(r2.metodo, 'confirmado');
  assert.equal(r2.disponible, true);
});

test('cajetillas de cigarrillos coincide por keywords, pide confirmar y calcula', async () => {
  const r1 = await clasificar('cajetillas de cigarrillos');
  assert.equal(r1.metodo, 'keywords');
  assert.equal(r1.clasificacion.categoria_id, 'cigarrillos');
  assert.equal(r1.disponible, false);
  assert.equal(r1.requiereConfirmacion.categoriaId, 'cigarrillos');

  const r2 = await clasificarYConfirmar('cajetillas de cigarrillos');
  assert.equal(r2.metodo, 'confirmado');
  assert.equal(r2.disponible, true);
});

test('camisetas de algodon coincide por keywords pero pide confirmar antes de calcular', async () => {
  const r = await clasificar('500 camisetas de algodon');
  assert.equal(r.metodo, 'keywords');
  assert.equal(r.clasificacion.categoria_id, 'camisetas');
  assert.equal(r.disponible, false);
  assert.equal(r.requiereConfirmacion.categoriaId, 'camisetas');
});

test('camisetas de algodon calcula una vez confirmada la categoria', async () => {
  const r = await clasificar('500 camisetas de algodon', 'camisetas');
  assert.equal(r.metodo, 'confirmado');
  assert.equal(r.disponible, true);
});

test('una botella de whiskey coincide por keywords, pide confirmar y calcula', async () => {
  const r = await clasificarYConfirmar('una botella de whiskey');
  assert.equal(r.metodo, 'confirmado');
  assert.equal(r.clasificacion.categoria_id, 'licores');
  assert.equal(r.disponible, true);
});

// La confirmacion ya no es exclusiva de camisetas: el mismo riesgo de
// contexto (accesorio, ingrediente, mera mencion) aplica a cigarrillos y
// licores. Reproduce la tabla de la tercera revision de Codex.
test('fundas para cigarrillos pide confirmar en vez de calcular directo', async () => {
  const r = await clasificar('fundas para cigarrillos');
  assert.equal(r.disponible, false);
  assert.equal(r.requiereConfirmacion?.categoriaId, 'cigarrillos');
});

test('vasos para whisky pide confirmar en vez de calcular directo', async () => {
  const r = await clasificar('vasos para whisky');
  assert.equal(r.disponible, false);
  assert.equal(r.requiereConfirmacion?.categoriaId, 'licores');
});

test('esencia de ron para reposteria pide confirmar en vez de calcular directo', async () => {
  const r = await clasificar('esencia de ron para reposteria');
  assert.equal(r.disponible, false);
  assert.equal(r.requiereConfirmacion?.categoriaId, 'licores');
});

// Una confirmacion no se puede reutilizar sobre una descripcion distinta a
// la que la genero (ej. confirmar "camisetas" y luego, sin volver a pedir
// confirmacion, enviar "drones" con esa misma categoriaConfirmada).
test('una categoriaConfirmada no aplica si el texto actual no la respalda', async () => {
  const r = await clasificar('drones', 'camisetas');
  assert.notEqual(r.metodo, 'confirmado');
  assert.equal(r.disponible, false);
});

// A partir de aca: casos que deben bloquear el calculo (disponible: false),
// sin importar el motivo tecnico exacto por el que se bloquean.

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

// La carga mixta ahora se corta antes de clasificar (metodo "bloqueado"):
// no vale la pena invocar el modelo si ya se sabe que se va a rechazar.
test('no son camisetas, son zapatos no calcula (negacion + coma)', async () => {
  const r = await clasificar('no son camisetas, son zapatos');
  assert.equal(r.metodo, 'bloqueado');
  assert.equal(r.disponible, false);
});

test('camisetas y zapatos no calcula (posible carga mixta)', async () => {
  const r = await clasificar('camisetas y zapatos');
  assert.equal(r.metodo, 'bloqueado');
  assert.equal(r.disponible, false);
});

test('camisetas, zapatos no calcula (coma como separador)', async () => {
  const r = await clasificar('camisetas, zapatos');
  assert.equal(r.metodo, 'bloqueado');
  assert.equal(r.disponible, false);
});

test('camisetas + zapatos no calcula ("+" como separador)', async () => {
  const r = await clasificar('camisetas + zapatos');
  assert.equal(r.metodo, 'bloqueado');
  assert.equal(r.disponible, false);
});

test('camisetas; zapatos no calcula (";" como separador)', async () => {
  const r = await clasificar('camisetas; zapatos');
  assert.equal(r.metodo, 'bloqueado');
  assert.equal(r.disponible, false);
});

test('camisetas y zapatos en lineas separadas no calcula (salto de linea como separador)', async () => {
  const r = await clasificar('camisetas\nzapatos');
  assert.equal(r.metodo, 'bloqueado');
  assert.equal(r.disponible, false);
});

// Una confirmacion previa tampoco puede saltarse el bloqueo por carga mixta:
// se corta antes de siquiera mirar categoriaConfirmada.
test('una categoriaConfirmada no salta el bloqueo por carga mixta', async () => {
  const r = await clasificar('camisetas + zapatos', 'camisetas');
  assert.equal(r.metodo, 'bloqueado');
  assert.equal(r.disponible, false);
});

// "funda PARA camisetas" ya no tiene una guarda generica segura por keywords
// (una regla para ese caso rompería "camisetas para hombre"). Lo que sí
// cierra el hueco es exigir confirmacion humana antes de calcular: aqui se
// pide confirmar el producto y el material en vez de asumirlo.
test('fundas para camisetas pide confirmar en vez de calcular directo', async () => {
  const r = await clasificar('fundas para camisetas');
  assert.equal(r.metodo, 'keywords');
  assert.equal(r.disponible, false);
  assert.equal(r.requiereConfirmacion.categoriaId, 'camisetas');
});
