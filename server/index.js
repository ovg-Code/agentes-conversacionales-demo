/* ============================================================
   Servidor: estáticos de demo/ + API del agente
   ------------------------------------------------------------
   npm start            → http://localhost:3000
   ANTHROPIC_API_KEY=…  → modo IA (Claude con tool-calling)
   sin clave            → el frontend cae al motor de reglas local
   ============================================================ */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { manejarTurno, reiniciarSesion, MODELO, EFFORT } from './agent-ai.js';
import { resetEstadoHerramientas } from '../demo/src/tools.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const RAIZ_ESTATICA = path.join(aqui, '..', 'demo');
const PUERTO = Number(process.env.PORT) || 3000;

// El SDK resuelve credenciales del entorno (ANTHROPIC_API_KEY,
// ANTHROPIC_AUTH_TOKEN o un perfil de `ant auth login`).
const hayCredencial = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const client = hayCredencial ? new Anthropic() : null;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8'
};

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/health') return json(res, 200, {
    ia: hayCredencial, modelo: hayCredencial ? MODELO : null, effort: hayCredencial ? EFFORT : null
  });

  if (url.pathname === '/api/chat' && req.method === 'POST') {
    if (!client) return json(res, 503, { error: 'SIN_CREDENCIAL', mensaje: 'Define ANTHROPIC_API_KEY para usar el modo IA.' });
    try {
      const cuerpo = await leerJSON(req);
      if (!cuerpo.sessionId) return json(res, 400, { error: 'FALTA_SESSION_ID' });
      const entrada = { text: String(cuerpo.text || '').slice(0, 2000) };
      const r = await manejarTurno(client, cuerpo.sessionId, entrada);
      return json(res, 200, r);
    } catch (err) {
      console.error('[api/chat]', err);
      return json(res, 500, { error: 'ERROR_INTERNO', mensaje: err.message });
    }
  }

  if (url.pathname === '/api/reset' && req.method === 'POST') {
    const cuerpo = await leerJSON(req).catch(() => ({}));
    if (cuerpo.sessionId) reiniciarSesion(cuerpo.sessionId);
    resetEstadoHerramientas();
    return json(res, 200, { ok: true });
  }

  // Estáticos, confinados a demo/
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const destino = path.resolve(RAIZ_ESTATICA, rel);
  if (!destino.startsWith(path.resolve(RAIZ_ESTATICA))) { res.writeHead(403); return res.end('Prohibido'); }
  fs.readFile(destino, (err, datos) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('No encontrado'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(destino)] || 'application/octet-stream' });
    res.end(datos);
  });
});

function json(res, code, cuerpo) {
  const s = JSON.stringify(cuerpo);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(s) });
  res.end(s);
}

function leerJSON(req) {
  return new Promise((resolver, rechazar) => {
    let datos = '';
    req.on('data', c => {
      datos += c;
      if (datos.length > 1e6) { rechazar(new Error('Cuerpo demasiado grande')); req.destroy(); }
    });
    req.on('end', () => { try { resolver(datos ? JSON.parse(datos) : {}); } catch (e) { rechazar(e); } });
    req.on('error', rechazar);
  });
}

servidor.listen(PUERTO, () => {
  console.log(`\n  Open Side · agente conversacional`);
  console.log(`  http://localhost:${PUERTO}\n`);
  console.log(hayCredencial
    ? `  Modo IA activo · ${MODELO} · effort ${EFFORT}\n`
    : `  Sin ANTHROPIC_API_KEY: la página usará el motor de reglas local.\n  Para activar el agente de IA:  export ANTHROPIC_API_KEY=sk-ant-...\n`);
});
