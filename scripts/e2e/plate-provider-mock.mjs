#!/usr/bin/env node
/**
 * ⚠ PROVEEDOR SIMULADO — SOLO PARA PRUEBAS AUTOMÁTICAS.
 *
 * Imita la forma de la API "Spanish Car Check" de Openapi (GET /ES-car/{matrícula}
 * con "Authorization: Bearer …") para probar el cliente real sin gastar
 * consultas ni usar credenciales. Sus datos NO son reales y nunca se usa
 * fuera de scripts/test-e2e.sh.
 *
 *   5776CNS → ejemplo publicado por el proveedor (Audi A3)
 *   0000BBB → 404 (no encontrada)      2222BBB → respuesta que no es JSON
 *   3333BBB → 429 (límite)             4444BBB → 401 (credenciales)
 *   1111BBB → tarda más que el tiempo máximo del cliente
 *   cualquier otra → datos inventados de prueba (SEAT IBIZA)
 *   GET /__calls?plate=X → cuántas veces se ha consultado X
 *
 * Uso: node plate-provider-mock.mjs <puerto> <token>
 */
import { createServer } from 'node:http';

const [port = '4999', token = 'token-de-pruebas'] = process.argv.slice(2);
const calls = new Map();

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const send = (status, body, type = 'application/json') => {
    res.writeHead(status, { 'content-type': type });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  if (url.pathname === '/__calls') return send(200, { calls: calls.get(url.searchParams.get('plate') ?? '') ?? 0 });

  const m = /^\/ES-car\/([A-Z0-9]+)$/.exec(url.pathname);
  if (!m || req.method !== 'GET') return send(404, { success: false, message: 'Not found', error: 404, data: null });
  const plate = m[1];
  calls.set(plate, (calls.get(plate) ?? 0) + 1);
  if (req.headers.authorization !== `Bearer ${token}`) return send(401, { success: false, message: 'Unauthorized', error: 401, data: null });

  switch (plate) {
    case '0000BBB': return send(404, { success: false, message: 'Plate not found', error: 404, data: null });
    case '2222BBB': return send(200, '<html>Mantenimiento</html>', 'text/html');
    case '3333BBB': return send(429, { success: false, message: 'Too many requests', error: 429, data: null });
    case '4444BBB': return send(401, { success: false, message: 'Invalid token', error: 401, data: null });
    case '1111BBB': return setTimeout(() => send(200, { success: true, data: { CarMake: 'TARDE' } }), 6000);
    case '5776CNS': return send(200, { success: true, message: '', error: null, data: {
      CarMake: 'AUDI', CarModel: 'A3', Variation: '1.6 ATTRACTION', RegistrationDate: '17/11/2003', Fuel: 'Gasolina',
      DynamicPower: '102.0', EngineSize: '1595', Doors: '3', VehicleIdentificationNumber: null } });
    default: return send(200, { success: true, message: '', error: null, data: {
      CarMake: 'SEAT', CarModel: 'IBIZA', Variation: '1.0 TSI STYLE', RegistrationDate: '01/02/2015', Fuel: 'Diésel', DynamicPower: '95' } });
  }
}).listen(Number(port), '127.0.0.1');
