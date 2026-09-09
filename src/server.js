/**
 * server.js — servidor local de Zarpe. Sin dependencias.
 * Solo sirve la interfaz y expone el nucleo. Ninguna llamada de red sale de aqui.
 *
 *   QVAC_CONFIG_PATH=./qvac.config.json node src/server.js
 *   node src/server.js --mock     (interfaz sin cargar el modelo)
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const MOCK = process.argv.includes('--mock');
const PUERTO = 4173;

const nucleo = await import('./nucleo.js');

console.log(MOCK ? '▸ modo mock: sin modelo' : '▸ cargando modelo QVAC…');
const estado = await nucleo.iniciar({
  mock: MOCK,
  onProgress: (p) => process.stderr.write(`\r▸ descargando ${p.percentage.toFixed(0)}%`),
});
console.log(`\n▸ listo. ${estado.verificadas} categorias verificadas.`);

const html = await readFile(new URL('../public/index.html', import.meta.url));

createServer(async (req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(html);
  }

  if (req.method === 'GET' && req.url === '/api/estado') {
    return json(res, 200, {
      mock: MOCK,
      modelo: MOCK ? 'mock' : 'LLAMA_3_2_1B_INST_Q4_0',
      msCarga: estado.msCarga,
      categorias: nucleo.verificadas().map((c) => ({ id: c.id, nombre: c.nombre, fraccion: c.fraccion })),
      alcance: nucleo.meta().alcance_declarado,
    });
  }

  if (req.method === 'POST' && req.url === '/api/estimar') {
    try {
      const cuerpo = JSON.parse(await leer(req));
      const errorEntrada = validarEntrada(cuerpo);
      if (errorEntrada) return json(res, 400, { error: errorEntrada });
      const r = await nucleo.estimar({ ...cuerpo, mock: MOCK });
      return json(res, 200, r);
    } catch (e) {
      return json(res, 500, { error: String(e.message || e) });
    }
  }

  res.writeHead(404).end('no encontrado');
}).listen(PUERTO, '127.0.0.1', () => console.log(`▸ Zarpe en http://localhost:${PUERTO}`));

function validarEntrada({ valor, gastosFijos = 0, regimen }) {
  if (!Number.isFinite(valor) || valor < 0) return 'valor debe ser un numero positivo';
  if (!Number.isFinite(gastosFijos) || gastosFijos < 0) return 'gastosFijos debe ser un numero positivo';
  if (regimen !== 'nacionalizacion' && regimen !== 'reexportacion') {
    return 'regimen debe ser "nacionalizacion" o "reexportacion"';
  }
  return null;
}

function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function leer(req) {
  return new Promise((ok, no) => {
    let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => ok(d)); req.on('error', no);
  });
}
