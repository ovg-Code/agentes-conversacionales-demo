/* ============================================================
   Datos operativos del CRM
   ------------------------------------------------------------
   Agentes, equipos, catálogo de labels y respuestas rápidas.
   En producción esto viene de la base de datos; aquí son
   constantes para que la demo funcione sin backend.
   ============================================================ */

/** El agente que tiene la sesión abierta. */
export const YO = 'ag-carla';

export const AGENTES = [
  { id: 'ag-carla',  nombre: 'Carla Méndez',   rol: 'Coordinadora de agenda', equipos: ['agenda', 'general'],        color: '#0E7C7B' },
  { id: 'ag-luis',   nombre: 'Luis Barría',    rol: 'Tecnólogo de resonancia', equipos: ['tecnologia_rm'],           color: '#7A4FE0' },
  { id: 'ag-ana',    nombre: 'Ana Quintero',   rol: 'Convenios y seguros',    equipos: ['seguros', 'general'],       color: '#B26A00' },
  { id: 'ag-jose',   nombre: 'José Him',       rol: 'Atención al paciente',   equipos: ['agenda', 'general'],        color: '#1268B0' }
];

export const EQUIPOS = [
  { id: 'agenda',        nombre: 'Agenda',            descripcion: 'Citas, reprogramaciones y cancelaciones' },
  { id: 'seguros',       nombre: 'Convenios',         descripcion: 'Cobertura y autorizaciones previas' },
  { id: 'tecnologia_rm', nombre: 'Tecnología RM',     descripcion: 'Screening de seguridad y contraindicaciones' },
  { id: 'general',       nombre: 'General',            descripcion: 'Todo lo demás' }
];

export const PRIORIDADES = [
  { id: 'urgent', nombre: 'Urgente', tono: 'danger', orden: 0 },
  { id: 'high',   nombre: 'Alta',    tono: 'warn',   orden: 1 },
  { id: 'medium', nombre: 'Media',   tono: 'info',   orden: 2 },
  { id: 'low',    nombre: 'Baja',    tono: 'muted',  orden: 3 }
];

/** Catálogo de labels: el agente elige de aquí, no escribe libre. */
export const LABELS = [
  { id: 'agendamiento',       tono: 'info' },
  { id: 'cotizacion',         tono: 'info' },
  { id: 'seguro',             tono: 'info' },
  { id: 'preparacion',        tono: 'info' },
  { id: 'resultados',         tono: 'info' },
  { id: 'urgente',            tono: 'danger' },
  { id: 'screening-bloqueado',tono: 'warn' },
  { id: 'escalado-humano',    tono: 'warn' },
  { id: 'resuelto-por-bot',   tono: 'ok' },
  { id: 'no-show-riesgo',     tono: 'warn' },
  { id: 'requiere-orden',     tono: 'warn' },
  { id: 'paciente-recurrente',tono: 'ok' }
];

/**
 * Respuestas rápidas. El agente escribe "/" en el composer y filtra.
 * Los marcadores {nombre}, {estudio}, {fecha}, {sede} se sustituyen con
 * los datos de la conversación antes de insertar el texto.
 */
export const RESPUESTAS_RAPIDAS = [
  {
    atajo: 'saludo',
    titulo: 'Saludo de agente',
    texto: 'Hola {nombre}, soy {agente} del equipo de Open Side. Tomo tu conversación desde aquí para ayudarte.'
  },
  {
    atajo: 'preparacion-ayuno',
    titulo: 'Preparación con ayuno',
    texto: 'Para tu {estudio} necesitas ayuno de 4 a 6 horas. Puedes tomar agua y tus medicamentos habituales.\n\nLlega 20 minutos antes y trae tu orden médica y cédula.'
  },
  {
    atajo: 'orden-medica',
    titulo: 'Falta orden médica',
    texto: 'Para realizar el estudio necesitamos la orden médica de tu doctor. Puedes enviarnos una foto por aquí o traerla impresa el día de la cita.'
  },
  {
    atajo: 'autorizacion',
    titulo: 'Autorización del seguro',
    texto: 'Tu aseguradora requiere autorización previa para este estudio. Gestiónala con ellos usando tu orden médica y, cuando la tengas, avísanos por aquí para confirmar la cita.'
  },
  {
    atajo: 'confirmar-cita',
    titulo: 'Confirmación de cita',
    texto: 'Tu cita quedó confirmada.\n\nEstudio: {estudio}\nFecha: {fecha}\nLugar: {sede}\n\nLlega 20 minutos antes con tu orden médica y cédula. Si necesitas cambiarla, escríbenos por aquí.'
  },
  {
    atajo: 'resultados-tiempo',
    titulo: 'Tiempo de resultados',
    texto: 'El informe lo firma el radiólogo en 24 a 48 horas hábiles. Te avisamos por aquí en cuanto esté disponible en el portal.'
  },
  {
    atajo: 'claustrofobia',
    titulo: 'Claustrofobia',
    texto: 'Entiendo tu preocupación. El equipo te acompaña durante todo el estudio y puedes comunicarte con nosotros en cualquier momento.\n\nComéntalo con tu médico: puede indicarte un sedante suave antes del estudio.'
  },
  {
    atajo: 'fuera-horario',
    titulo: 'Fuera de horario',
    texto: 'Gracias por escribirnos. Nuestro horario es de lunes a viernes de 7:00 a.m. a 8:00 p.m. y sábados de 7:00 a.m. a 2:00 p.m.\n\nTe respondemos apenas abramos.'
  },
  {
    atajo: 'despedida',
    titulo: 'Cierre',
    texto: '¿Hay algo más en lo que te pueda ayudar? Si no, te deseo un buen día. Aquí estamos para lo que necesites.'
  }
];

/**
 * Macros: secuencias de acciones que se aplican de una vez.
 * El modelo es el de Chatwoot — una lista de acciones tipadas que se
 * ejecutan en orden — con los tipos que tienen sentido aquí.
 *
 * Tipos: asignar_agente · asignar_equipo · anadir_label · quitar_label
 *        prioridad · responder · nota · posponer · resolver · devolver_bot
 */
export const MACROS = [
  {
    id: 'derivar-rm',
    nombre: 'Derivar a tecnología RM',
    descripcion: 'Screening con hallazgos: etiqueta, sube prioridad y pasa al tecnólogo.',
    acciones: [
      { tipo: 'anadir_label', valor: 'screening-bloqueado' },
      { tipo: 'prioridad', valor: 'high' },
      { tipo: 'asignar_equipo', valor: 'tecnologia_rm' },
      { tipo: 'nota', valor: 'Derivada a tecnología RM por hallazgo en el screening de seguridad.' }
    ]
  },
  {
    id: 'gestionar-autorizacion',
    nombre: 'Pedir autorización al seguro',
    descripcion: 'Explica la autorización previa, etiqueta y pasa a convenios.',
    acciones: [
      { tipo: 'anadir_label', valor: 'seguro' },
      { tipo: 'responder', valor: 'Tu aseguradora requiere autorización previa para este estudio. Gestiónala con ellos usando tu orden médica y avísanos por aquí cuando la tengas.' },
      { tipo: 'asignar_equipo', valor: 'seguros' },
      { tipo: 'posponer', valor: 1440 }
    ]
  },
  {
    id: 'falta-orden',
    nombre: 'Falta orden médica',
    descripcion: 'Pide la orden, etiqueta y pospone un día.',
    acciones: [
      { tipo: 'anadir_label', valor: 'requiere-orden' },
      { tipo: 'responder', valor: 'Para realizar el estudio necesitamos la orden médica de tu doctor. Puedes enviarnos una foto por aquí o traerla impresa el día de la cita.' },
      { tipo: 'posponer', valor: 1440 }
    ]
  },
  {
    id: 'cerrar-resuelta',
    nombre: 'Cerrar como resuelta',
    descripcion: 'Despide, quita la asignación y resuelve.',
    acciones: [
      { tipo: 'responder', valor: '¿Hay algo más en lo que te pueda ayudar? Si no, quedamos atentos por aquí cuando lo necesites.' },
      { tipo: 'resolver' }
    ]
  },
  {
    id: 'devolver-al-bot',
    nombre: 'Devolver al agente virtual',
    descripcion: 'Quita la asignación y deja que el bot retome.',
    acciones: [
      { tipo: 'nota', valor: 'Devuelta al agente virtual tras la intervención humana.' },
      { tipo: 'devolver_bot' }
    ]
  }
];

/** Opciones de posponer, en minutos. */
export const POSPONER = [
  { id: '1h',      nombre: '1 hora',          minutos: 60 },
  { id: '3h',      nombre: '3 horas',         minutos: 180 },
  { id: 'manana',  nombre: 'Mañana',          minutos: 60 * 20 },
  { id: 'semana',  nombre: 'Próxima semana',  minutos: 60 * 24 * 7 }
];

/* ============================================================
   Ajustes editables
   ------------------------------------------------------------
   Viven en localStorage para que la demo los conserve. En
   producción serían de la cuenta, como las políticas de SLA de
   Chatwoot.
   ============================================================ */
const CLAVE_AJUSTES = 'openside:ajustes:v1';

export const AJUSTES_POR_DEFECTO = {
  sla: { aviso: 5, critico: 15 },        // minutos de espera
  adjuntoMaxKB: 400                       // límite real de localStorage
};

export function leerAjustes() {
  try {
    const guardado = JSON.parse(localStorage.getItem(CLAVE_AJUSTES) || '{}');
    return { ...AJUSTES_POR_DEFECTO, ...guardado, sla: { ...AJUSTES_POR_DEFECTO.sla, ...(guardado.sla || {}) } };
  } catch (e) {
    return { ...AJUSTES_POR_DEFECTO };
  }
}

export function guardarAjustes(parcial) {
  const nuevos = { ...leerAjustes(), ...parcial };
  try { localStorage.setItem(CLAVE_AJUSTES, JSON.stringify(nuevos)); } catch (e) { /* sin persistencia */ }
  return nuevos;
}

export function agentePorId(id) { return AGENTES.find(a => a.id === id) || null; }
export function equipoPorId(id) { return EQUIPOS.find(e => e.id === id) || null; }
export function prioridadPorId(id) { return PRIORIDADES.find(p => p.id === id) || null; }
export function tonoLabel(id) { return (LABELS.find(l => l.id === id) || {}).tono || 'info'; }

/** Sustituye los marcadores de una respuesta rápida con datos reales. */
export function rellenar(texto, conv) {
  const c = conv || {};
  const crm = c.crm || {};
  // Sin nombre se deja vacío y se limpia la puntuación: "Hola {nombre}," → "Hola,"
  const nombre = (crm.contacto?.paciente_nombre || c.contacto?.nombre || '').split(' ')[0] || '';
  const agente = (agentePorId(YO)?.nombre || '').split(' ')[0];
  return texto
    .replace(/\{nombre\}/g, nombre)
    .replace(/\{agente\}/g, agente)
    .replace(/\{estudio\}/g, crm.conversacion?.estudio_solicitado || 'estudio')
    .replace(/\{fecha\}/g,  crm.conversacion?.cita_fecha || 'la fecha acordada')
    .replace(/\{sede\}/g,   crm.conversacion?.sede_preferida ? `sede ${crm.conversacion.sede_preferida}` : 'nuestra sede')
    .replace(/[ \t]+([,.])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ');
}
