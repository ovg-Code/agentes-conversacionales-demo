/* ============================================================
   Filtros avanzados y vistas guardadas
   ------------------------------------------------------------
   La gramática es la de Chatwoot: una lista de condiciones
   {atributo, operador, valor} unidas por Y / O. Cada atributo
   declara su tipo de dato, y el tipo decide qué operadores
   admite — así la interfaz nunca ofrece una combinación
   imposible como "prioridad contiene".
   ============================================================ */

import { estadoEfectivo, sinLeer } from './bus.js';
import { AGENTES, EQUIPOS, PRIORIDADES, LABELS } from './crm-data.js';

/* ---------- Operadores por tipo de dato ---------- */
export const OPERADORES = {
  lista:   [['es', 'es'], ['no_es', 'no es']],
  texto:   [['contiene', 'contiene'], ['no_contiene', 'no contiene'],
            ['existe', 'tiene valor'], ['no_existe', 'está vacío']],
  numero:  [['mayor_que', 'es mayor que'], ['menor_que', 'es menor que'], ['es', 'es igual a']],
  booleano:[['es', 'es']],
  fecha:   [['hace_mas_de', 'hace más de (días)'], ['hace_menos_de', 'hace menos de (días)']]
};

/* ---------- Atributos filtrables ---------- */
export const ATRIBUTOS = [
  { clave: 'estado',        nombre: 'Estado',            tipo: 'lista',
    opciones: () => [['pending', 'Agente virtual'], ['open', 'Con una persona'], ['snoozed', 'Pospuesta'], ['resolved', 'Resuelta']],
    leer: c => estadoEfectivo(c) },

  { clave: 'asignado',      nombre: 'Asignada a',        tipo: 'lista',
    opciones: () => [['', 'Sin asignar'], ...AGENTES.map(a => [a.id, a.nombre])],
    leer: c => c.asignadoA || '' },

  { clave: 'equipo',        nombre: 'Equipo',            tipo: 'lista',
    opciones: () => [['', 'Sin equipo'], ...EQUIPOS.map(e => [e.id, e.nombre])],
    leer: c => c.equipo || '' },

  { clave: 'prioridad',     nombre: 'Prioridad',         tipo: 'lista',
    opciones: () => [['', 'Sin definir'], ...PRIORIDADES.map(p => [p.id, p.nombre])],
    leer: c => c.prioridad || '' },

  { clave: 'label',         nombre: 'Label',             tipo: 'lista',
    opciones: () => LABELS.map(l => [l.id, l.id]),
    // Una conversación "es" un label si lo lleva entre los suyos.
    leer: c => c.crm?.labels || [], multiple: true },

  { clave: 'estudio',       nombre: 'Estudio',           tipo: 'texto',
    leer: c => c.crm?.conversacion?.estudio_solicitado || '' },

  { clave: 'aseguradora',   nombre: 'Aseguradora',       tipo: 'texto',
    leer: c => c.crm?.contacto?.aseguradora || '' },

  { clave: 'paciente',      nombre: 'Paciente',          tipo: 'texto',
    leer: c => c.crm?.contacto?.paciente_nombre || c.contacto?.nombre || '' },

  { clave: 'cedula',        nombre: 'Cédula',            tipo: 'texto',
    leer: c => c.crm?.contacto?.paciente_cedula || '' },

  { clave: 'screening',     nombre: 'Screening RM',      tipo: 'lista',
    opciones: () => [['pendiente', 'Pendiente'], ['aprobado', 'Aprobado'],
                     ['requiere_revision', 'Requiere revisión'], ['bloqueado', 'Bloqueado']],
    leer: c => c.crm?.conversacion?.screening_rm_estado || 'pendiente' },

  { clave: 'consentimiento', nombre: 'Consentimiento',   tipo: 'booleano',
    opciones: () => [['si', 'Otorgado'], ['no', 'No otorgado']],
    leer: c => (c.crm?.contacto?.consentimiento_datos ? 'si' : 'no') },

  { clave: 'cita',          nombre: 'Tiene cita',        tipo: 'booleano',
    opciones: () => [['si', 'Sí'], ['no', 'No']],
    leer: c => (c.crm?.conversacion?.cita_id ? 'si' : 'no') },

  { clave: 'espera',        nombre: 'Minutos esperando', tipo: 'numero',
    leer: c => c.esperaDesde ? Math.floor((Date.now() - c.esperaDesde) / 60000) : 0 },

  { clave: 'sin_leer',      nombre: 'Mensajes sin leer', tipo: 'numero',
    leer: c => sinLeer(c) },

  { clave: 'actividad',     nombre: 'Última actividad',  tipo: 'fecha',
    leer: c => c.actualizado || 0 }
];

export function atributoPorClave(clave) { return ATRIBUTOS.find(a => a.clave === clave) || null; }

/* ---------- Evaluación ---------- */
const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function cumpleCondicion(conv, cond) {
  const attr = atributoPorClave(cond.atributo);
  if (!attr) return true;
  const valor = attr.leer(conv);

  switch (cond.operador) {
    case 'es':
      if (attr.multiple) return (valor || []).includes(cond.valor);
      if (attr.tipo === 'numero') return Number(valor) === Number(cond.valor);
      return String(valor) === String(cond.valor);

    case 'no_es':
      if (attr.multiple) return !(valor || []).includes(cond.valor);
      return String(valor) !== String(cond.valor);

    case 'contiene':      return norm(valor).includes(norm(cond.valor));
    case 'no_contiene':   return !norm(valor).includes(norm(cond.valor));
    case 'existe':        return String(valor || '').trim() !== '';
    case 'no_existe':     return String(valor || '').trim() === '';
    case 'mayor_que':     return Number(valor) > Number(cond.valor);
    case 'menor_que':     return Number(valor) < Number(cond.valor);

    case 'hace_mas_de':   return (Date.now() - Number(valor)) > Number(cond.valor) * 86400000;
    case 'hace_menos_de': return (Date.now() - Number(valor)) < Number(cond.valor) * 86400000;

    default: return true;
  }
}

/**
 * Evalúa el conjunto. `union` decide si hace falta que se cumplan
 * todas (Y) o al menos una (O).
 */
export function cumple(conv, condiciones, union = 'y') {
  const validas = (condiciones || []).filter(c => c.atributo && c.operador);
  if (!validas.length) return true;
  return union === 'o'
    ? validas.some(c => cumpleCondicion(conv, c))
    : validas.every(c => cumpleCondicion(conv, c));
}

/** Frase legible para enseñar el filtro sin leer JSON. */
export function describir(condiciones, union = 'y') {
  const validas = (condiciones || []).filter(c => c.atributo && c.operador);
  if (!validas.length) return 'sin condiciones';
  return validas.map(c => {
    const attr = atributoPorClave(c.atributo);
    const op = (OPERADORES[attr?.tipo] || []).find(([k]) => k === c.operador);
    let v = c.valor;
    if (attr?.opciones) {
      const opt = attr.opciones().find(([k]) => String(k) === String(c.valor));
      if (opt) v = opt[1];
    }
    const sinValor = c.operador === 'existe' || c.operador === 'no_existe';
    return `${attr?.nombre || c.atributo} ${op ? op[1] : c.operador}${sinValor ? '' : ' ' + v}`;
  }).join(union === 'o' ? '  o  ' : '  y  ');
}

/* ============================================================
   Vistas guardadas
   ============================================================ */
const CLAVE_VISTAS = 'openside:vistas:v1';

export function listarVistas() {
  try { return JSON.parse(localStorage.getItem(CLAVE_VISTAS) || '[]'); }
  catch (e) { return []; }
}

function escribirVistas(v) {
  try { localStorage.setItem(CLAVE_VISTAS, JSON.stringify(v)); } catch (e) { /* sin persistencia */ }
}

export function guardarVista(nombre, condiciones, union) {
  const vistas = listarVistas();
  const id = 'v' + Date.now().toString(36);
  vistas.push({ id, nombre, condiciones, union, creada: Date.now() });
  escribirVistas(vistas);
  return id;
}

export function borrarVista(id) {
  escribirVistas(listarVistas().filter(v => v.id !== id));
}

export function vistaPorId(id) { return listarVistas().find(v => v.id === id) || null; }
