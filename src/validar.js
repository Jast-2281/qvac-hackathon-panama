/**
 * validar.js — validacion de entrada del endpoint /api/estimar.
 * Separado de server.js para poder probarlo sin levantar el servidor ni el modelo.
 */
export function validarEntrada(cuerpo) {
  if (typeof cuerpo !== 'object' || cuerpo === null) {
    return 'el cuerpo debe ser un objeto JSON';
  }

  const { descripcion, valor, tipoValor, regimen, gastosFijos = 0, categoriaConfirmada, descripcionConfirmada } = cuerpo;

  if (categoriaConfirmada !== undefined && typeof categoriaConfirmada !== 'string') {
    return 'categoriaConfirmada debe ser un texto';
  }
  if (descripcionConfirmada !== undefined && typeof descripcionConfirmada !== 'string') {
    return 'descripcionConfirmada debe ser un texto';
  }

  if (typeof descripcion !== 'string' || descripcion.trim() === '') {
    return 'la descripción debe ser un texto no vacío';
  }
  if (descripcion.length > 500) {
    return 'la descripción no puede superar 500 caracteres';
  }
  if (tipoValor !== 'CIF' && tipoValor !== 'FOB') {
    return 'tipoValor debe ser "CIF" o "FOB"';
  }
  if (!Number.isFinite(valor) || valor <= 0) {
    return 'el valor debe ser un número mayor a cero';
  }
  if (!Number.isFinite(gastosFijos) || gastosFijos < 0) {
    return 'gastosFijos debe ser un número mayor o igual a cero';
  }
  if (regimen !== 'nacionalizacion' && regimen !== 'reexportacion') {
    return 'el régimen debe ser "nacionalizacion" o "reexportacion"';
  }
  return null;
}
