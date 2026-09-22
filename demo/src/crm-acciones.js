/* ============================================================
   Ejecutor de macros y acciones en bloque
   ------------------------------------------------------------
   Una macro es una lista de acciones tipadas que se ejecutan en
   orden sobre una conversación — el modelo de Chatwoot. Lo mismo
   sirve para aplicar una acción suelta a varias conversaciones.
   ============================================================ */

import {
  obtenerConversacion, publicarMensaje, cambiarEstado, agregarNota,
  actualizarCampos, posponer, alternarLabel
} from './bus.js';
import { YO, agentePorId, equipoPorId, MACROS } from './crm-data.js';

/**
 * Ejecuta una acción sobre una conversación.
 * Devuelve una línea de registro para la nota de auditoría.
 */
export function ejecutarAccion(idConversacion, accion) {
  const conv = obtenerConversacion(idConversacion);
  if (!conv) return null;

  switch (accion.tipo) {
    case 'asignar_agente': {
      const a = agentePorId(accion.valor);
      actualizarCampos(idConversacion, { asignadoA: accion.valor });
      if ((conv.crm?.status || 'pending') === 'pending') cambiarEstado(idConversacion, 'open', accion.valor);
      return `asignada a ${a ? a.nombre : accion.valor}`;
    }
    case 'asignar_equipo': {
      const e = equipoPorId(accion.valor);
      actualizarCampos(idConversacion, { equipo: accion.valor });
      if ((conv.crm?.status || 'pending') === 'pending') cambiarEstado(idConversacion, 'open', YO);
      return `derivada al equipo ${e ? e.nombre : accion.valor}`;
    }
    case 'quitar_asignacion':
      actualizarCampos(idConversacion, { asignadoA: null });
      return 'asignación retirada';

    case 'anadir_label':
      if (!(conv.crm?.labels || []).includes(accion.valor)) alternarLabel(idConversacion, accion.valor);
      return `label «${accion.valor}»`;

    case 'quitar_label':
      if ((conv.crm?.labels || []).includes(accion.valor)) alternarLabel(idConversacion, accion.valor);
      return `label «${accion.valor}» retirado`;

    case 'prioridad':
      actualizarCampos(idConversacion, { prioridad: accion.valor });
      return `prioridad ${accion.valor}`;

    case 'responder': {
      const estado = conv.crm?.status || 'pending';
      if (estado === 'pending' || estado === 'snoozed') {
        cambiarEstado(idConversacion, 'open', YO);
        actualizarCampos(idConversacion, { asignadoA: conv.asignadoA || YO, pospuestoHasta: null });
      }
      publicarMensaje(idConversacion, { autor: 'humano', texto: accion.valor, privado: false });
      return 'respuesta enviada';
    }
    case 'nota':
      agregarNota(idConversacion, accion.valor, 'humano');
      return 'nota añadida';

    case 'posponer':
      posponer(idConversacion, Date.now() + (accion.valor || 60) * 60000);
      return `pospuesta ${duracionLegible(accion.valor || 60)}`;

    case 'resolver':
      cambiarEstado(idConversacion, 'resolved');
      return 'resuelta';

    case 'devolver_bot':
      cambiarEstado(idConversacion, 'pending');
      actualizarCampos(idConversacion, { asignadoA: null, pospuestoHasta: null });
      return 'devuelta al agente virtual';

    default:
      return null;
  }
}

/**
 * Aplica una macro completa y deja una nota con lo que hizo,
 * para que quede rastro de por qué la conversación cambió.
 */
export function ejecutarMacro(idConversacion, idMacro) {
  const macro = MACROS.find(m => m.id === idMacro);
  if (!macro) return null;

  const hechos = [];
  for (const accion of macro.acciones) {
    // La nota de registro va al final, después de las acciones.
    if (accion.tipo === 'nota') { hechos.push('nota añadida'); continue; }
    const linea = ejecutarAccion(idConversacion, accion);
    if (linea) hechos.push(linea);
  }
  const notasPropias = macro.acciones.filter(a => a.tipo === 'nota');
  for (const n of notasPropias) agregarNota(idConversacion, n.valor, 'humano');

  agregarNota(idConversacion,
    `Macro «${macro.nombre}» aplicada por ${agentePorId(YO)?.nombre}: ${hechos.join(' · ')}.`,
    'sistema');
  return { macro, hechos };
}

/** "1440" no dice nada a nadie: el registro se lee en horas o días. */
function duracionLegible(minutos) {
  if (minutos < 60) return `${minutos} min`;
  if (minutos < 1440) { const h = minutos / 60; return `${h % 1 ? h.toFixed(1) : h} ${h === 1 ? 'hora' : 'horas'}`; }
  const d = minutos / 1440;
  return `${d % 1 ? d.toFixed(1) : d} ${d === 1 ? 'día' : 'días'}`;
}

/** Aplica una acción suelta a varias conversaciones. */
export function ejecutarEnBloque(ids, accion) {
  const resultados = [];
  for (const id of ids) {
    const linea = ejecutarAccion(id, accion);
    if (linea) resultados.push({ id, linea });
  }
  return resultados;
}
