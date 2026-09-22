/* ============================================================
   Buscador global
   ------------------------------------------------------------
   Un solo campo que atraviesa conversaciones, mensajes y
   pacientes. Se abre con Ctrl/⌘+K, se navega con flechas.
   ============================================================ */

import { listarConversaciones, estadoEfectivo } from './bus.js';
import { icono } from './iconos.js';

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const normalizar = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Resalta el fragmento buscado dentro de un texto ya escapado. */
function resaltar(texto, q) {
  if (!q) return esc(texto);
  const plano = normalizar(texto);
  const i = plano.indexOf(normalizar(q));
  if (i < 0) return esc(texto);
  return esc(texto.slice(0, i)) + '<mark>' + esc(texto.slice(i, i + q.length)) + '</mark>' + esc(texto.slice(i + q.length));
}

/** Recorta un mensaje largo alrededor de la coincidencia. */
function fragmento(texto, q, radio = 40) {
  const plano = normalizar(texto);
  const i = plano.indexOf(normalizar(q));
  if (i < 0) return texto.slice(0, radio * 2);
  const desde = Math.max(0, i - radio);
  const hasta = Math.min(texto.length, i + q.length + radio);
  return (desde ? '…' : '') + texto.slice(desde, hasta) + (hasta < texto.length ? '…' : '');
}

export function buscar(q, limite = 12) {
  const consulta = q.trim();
  if (consulta.length < 2) return [];
  const n = normalizar(consulta);
  const resultados = [];
  const vistos = new Set();

  for (const c of listarConversaciones()) {
    const nombre = c.crm?.contacto?.paciente_nombre || c.contacto?.nombre || 'Paciente sin identificar';
    const cedula = c.crm?.contacto?.paciente_cedula || '';
    const tel = c.contacto?.telefono || '';
    const estudio = c.crm?.conversacion?.estudio_solicitado || '';
    const cita = c.crm?.conversacion?.cita_id || '';

    // Paciente: nombre, cédula o teléfono
    if ([nombre, cedula, tel].some(v => normalizar(v).includes(n))) {
      const clave = 'p:' + c.id;
      if (!vistos.has(clave)) {
        vistos.add(clave);
        resultados.push({
          tipo: 'paciente', icono: 'pacientes', idConversacion: c.id,
          titulo: resaltar(nombre, consulta),
          detalle: [cedula, tel].filter(Boolean).join(' · ') || 'sin identificar'
        });
      }
    }

    // Conversación: estudio, label o número de cita
    if ([estudio, cita, ...(c.crm?.labels || [])].some(v => normalizar(v).includes(n))) {
      resultados.push({
        tipo: 'conversación', icono: 'mensajes', idConversacion: c.id,
        titulo: resaltar(estudio || 'Consulta', consulta),
        detalle: `${nombre} · ${estadoEfectivo(c)}${cita ? ' · ' + cita : ''}`
      });
    }

    // Mensajes del hilo
    for (const m of c.mensajes || []) {
      if (!m.texto || !normalizar(m.texto).includes(n)) continue;
      resultados.push({
        tipo: m.privado ? 'nota' : 'mensaje',
        icono: m.privado ? 'nota' : 'mensajes',
        idConversacion: c.id,
        titulo: resaltar(fragmento(m.texto, consulta), consulta),
        detalle: `${nombre} · ${m.autor === 'paciente' ? 'paciente' : m.autor === 'bot' ? 'agente virtual' : 'agente'}`
      });
      break;   // un resultado por conversación basta para no inundar
    }

    if (resultados.length >= limite) break;
  }
  return resultados.slice(0, limite);
}

export function renderResultados(contenedor, q, activo) {
  const res = buscar(q);
  if (!res.length) {
    contenedor.innerHTML = q.trim().length < 2
      ? '<div class="buscador-pista">Escribe al menos dos caracteres. Busca en pacientes, conversaciones y mensajes.</div>'
      : `<div class="buscador-pista">Nada coincide con «${esc(q)}».</div>`;
    return [];
  }
  contenedor.innerHTML = res.map((r, i) => `
    <button class="resultado${i === activo ? ' activo' : ''}" type="button" data-i="${i}">
      <span class="resultado-ico">${icono(r.icono, { size: 15 })}</span>
      <span class="resultado-txt">
        <span class="resultado-titulo">${r.titulo}</span>
        <span class="resultado-detalle">${esc(r.detalle)}</span>
      </span>
      <span class="resultado-tipo">${esc(r.tipo)}</span>
    </button>`).join('');
  return res;
}
