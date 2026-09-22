/* ============================================================
   Base de conocimiento · Open Side
   ------------------------------------------------------------
   ⚠ DATOS DE DEMOSTRACIÓN.
   Sedes, horarios y catálogo provienen del sitio público de Open Side.
   PRECIOS, DURACIONES, PREPARACIONES Y CONVENIOS SON FICTICIOS:
   marcadores de posición hasta recibir la información real.
   ============================================================ */

export const SEDES = {
  '75E': {
    id: '75E',
    nombre: 'Sede Calle 75E',
    direccion: 'San Francisco, Calle 75E, Ciudad de Panamá',
    telefonos: ['226-2332', '302-0309'],
    email: 'resonancia@open-side.com',
    nota: 'Ideal para estudios neurológicos, musculoesqueléticos y diagnóstico general.'
  },
  '76E': {
    id: '76E',
    nombre: 'Sede Calle 76E · Cubo de Vidrio',
    direccion: 'San Francisco, Calle 76, Cubo de Vidrio, Ciudad de Panamá',
    telefonos: ['388-2313', '388-0413'],
    email: 'resonanciasucursal2@open-side.com',
    nota: 'Segunda sede, mismo equipo médico.'
  }
};

export const HORARIO = {
  texto: 'Lunes a viernes de 7:00 a.m. a 8:00 p.m. · Sábados de 7:00 a.m. a 2:00 p.m.',
  dias: { 1: [7, 20], 2: [7, 20], 3: [7, 20], 4: [7, 20], 5: [7, 20], 6: [7, 14], 0: null },
  whatsapp: '6480-0336'
};

/* --- Catálogo. precioPrivado/precioAsegurado son FICTICIOS --- */
export const ESTUDIOS = [
  { id: 'rm-cerebro',      modalidad: 'RM',  nombre: 'Resonancia de cerebro',            alias: ['cerebro','craneo','cráneo','cabeza','encefalo','encéfalo'], precioPrivado: 395, precioAsegurado: 480, duracion: 30, ayuno: false, contrasteFrecuente: true },
  { id: 'rm-columna-lum',  modalidad: 'RM',  nombre: 'Resonancia de columna lumbar',     alias: ['lumbar','columna lumbar','espalda baja','cintura'], precioPrivado: 380, precioAsegurado: 460, duracion: 25, ayuno: false, contrasteFrecuente: false },
  { id: 'rm-columna-cer',  modalidad: 'RM',  nombre: 'Resonancia de columna cervical',   alias: ['cervical','cuello','columna cervical'], precioPrivado: 380, precioAsegurado: 460, duracion: 25, ayuno: false, contrasteFrecuente: false },
  { id: 'rm-columna-dor',  modalidad: 'RM',  nombre: 'Resonancia de columna dorsal',     alias: ['dorsal','toracica','torácica','columna dorsal'], precioPrivado: 380, precioAsegurado: 460, duracion: 25, ayuno: false, contrasteFrecuente: false },
  { id: 'rm-rodilla',      modalidad: 'RM',  nombre: 'Resonancia de rodilla',            alias: ['rodilla','menisco','ligamento cruzado'], precioPrivado: 350, precioAsegurado: 420, duracion: 25, ayuno: false, contrasteFrecuente: false },
  { id: 'rm-hombro',       modalidad: 'RM',  nombre: 'Resonancia de hombro',             alias: ['hombro','manguito rotador'], precioPrivado: 350, precioAsegurado: 420, duracion: 25, ayuno: false, contrasteFrecuente: false },
  { id: 'rm-abdomen',      modalidad: 'RM',  nombre: 'Resonancia de abdomen',            alias: ['abdomen','higado','hígado','vesicula','vesícula'], precioPrivado: 460, precioAsegurado: 550, duracion: 40, ayuno: true,  contrasteFrecuente: true },
  { id: 'rm-pelvis',       modalidad: 'RM',  nombre: 'Resonancia de pelvis',             alias: ['pelvis','pelvica','pélvica','utero','útero'], precioPrivado: 460, precioAsegurado: 550, duracion: 40, ayuno: true,  contrasteFrecuente: true },
  { id: 'rm-mama',         modalidad: 'RM',  nombre: 'Resonancia de mama',               alias: ['mama','mamas','seno','senos','pecho'], precioPrivado: 520, precioAsegurado: 620, duracion: 45, ayuno: false, contrasteFrecuente: true },
  { id: 'rm-prostata',     modalidad: 'RM',  nombre: 'Resonancia de próstata',           alias: ['prostata','próstata'], precioPrivado: 520, precioAsegurado: 620, duracion: 45, ayuno: true,  contrasteFrecuente: true },
  { id: 'rm-angio',        modalidad: 'RM',  nombre: 'Angiorresonancia',                 alias: ['angiorresonancia','angio','vasos','arterias'], precioPrivado: 540, precioAsegurado: 640, duracion: 45, ayuno: false, contrasteFrecuente: true },
  { id: 'rm-entero',       modalidad: 'RM',  nombre: 'Enterorresonancia',                alias: ['enterorresonancia','intestino','crohn'], precioPrivado: 620, precioAsegurado: 740, duracion: 60, ayuno: true,  contrasteFrecuente: true },
  { id: 'rm-defeco',       modalidad: 'RM',  nombre: 'Defecorresonancia',                alias: ['defecorresonancia','defecografia','defecografía'], precioPrivado: 620, precioAsegurado: 740, duracion: 50, ayuno: true,  contrasteFrecuente: false },
  { id: 'tc-cerebro',      modalidad: 'TC',  nombre: 'Tomografía de cerebro',            alias: ['tac cerebro','tomografia cerebro','tomografía de cabeza'], precioPrivado: 180, precioAsegurado: 230, duracion: 10, ayuno: false, contrasteFrecuente: false },
  { id: 'tc-torax',        modalidad: 'TC',  nombre: 'Tomografía de tórax',              alias: ['tac torax','tórax','pulmon','pulmón','pulmones'], precioPrivado: 220, precioAsegurado: 280, duracion: 15, ayuno: false, contrasteFrecuente: true },
  { id: 'tc-abdomen',      modalidad: 'TC',  nombre: 'Tomografía de abdomen y pelvis',   alias: ['tac abdomen','abdomen y pelvis'], precioPrivado: 280, precioAsegurado: 350, duracion: 20, ayuno: true,  contrasteFrecuente: true },
  { id: 'tc-senos-par',    modalidad: 'TC',  nombre: 'Tomografía de senos paranasales',  alias: ['senos paranasales','sinusitis','paranasales'], precioPrivado: 170, precioAsegurado: 215, duracion: 10, ayuno: false, contrasteFrecuente: false },
  { id: 'tc-columna',      modalidad: 'TC',  nombre: 'Tomografía de columna',            alias: ['tac columna'], precioPrivado: 230, precioAsegurado: 290, duracion: 15, ayuno: false, contrasteFrecuente: false }
];

/* Recargo FICTICIO por contraste */
export const RECARGO_CONTRASTE = 85;

/* Convenios FICTICIOS */
export const ASEGURADORAS = [
  { id: 'assa',          nombre: 'ASSA',                      convenio: true,  autorizacionPrevia: true,  coaseguroTipico: '20%' },
  { id: 'palig',         nombre: 'PALIG',                     convenio: true,  autorizacionPrevia: true,  coaseguroTipico: '15%' },
  { id: 'mapfre',        nombre: 'MAPFRE',                    convenio: true,  autorizacionPrevia: true,  coaseguroTipico: '20%' },
  { id: 'internacional', nombre: 'Internacional de Seguros',  convenio: true,  autorizacionPrevia: true,  coaseguroTipico: '20%' },
  { id: 'otra',          nombre: 'Otra aseguradora',          convenio: false, autorizacionPrevia: true,  coaseguroTipico: null }
];

/* Preparaciones — redacción genérica basada en guías públicas de RM/TC.
   Debe sustituirse por el protocolo oficial de Open Side. */
export const PREPARACIONES = {
  general: [
    'Llega 20 minutos antes de tu cita.',
    'Trae tu orden médica y cédula.',
    'Usa ropa cómoda, sin cierres, botones ni broches metálicos.',
    'Retira joyas, reloj, hebillas y objetos metálicos antes del estudio.'
  ],
  ayuno: 'Ayuno de 4 a 6 horas antes del estudio (puedes tomar agua y tus medicamentos habituales).',
  contraste: 'Se usará medio de contraste intravenoso. Avísanos si tienes enfermedad renal, estás en diálisis o has tenido reacción alérgica a un contraste.',
  claustrofobia: 'Si sufres de claustrofobia, coméntalo con tu médico antes del estudio: puede indicarte un sedante suave. Nuestro equipo te acompaña durante todo el procedimiento.'
};

/* Preguntas de screening de seguridad de RM.
   Debe ser validado y reemplazado por el cuestionario oficial del radiólogo. */
export const SCREENING_RM = [
  { key: 'marcapasos_o_dai',        pregunta: '¿Tienes marcapasos o desfibrilador implantado (DAI)?',                 bloqueante: true },
  { key: 'implante_coclear',        pregunta: '¿Tienes implante coclear o prótesis auditiva implantada?',             bloqueante: true },
  { key: 'clips_aneurisma',         pregunta: '¿Tienes clips por aneurisma cerebral o stents recientes?',             bloqueante: true },
  { key: 'neuroestimulador_o_bomba',pregunta: '¿Usas neuroestimulador o bomba de infusión implantada?',               bloqueante: true },
  { key: 'fragmentos_metalicos',    pregunta: '¿Tienes fragmentos metálicos en el cuerpo (esquirlas, perdigones)?',   revision: true },
  { key: 'embarazo_o_sospecha',     pregunta: '¿Estás embarazada o existe posibilidad de embarazo?',                  revision: true },
  { key: 'enfermedad_renal',        pregunta: '¿Tienes enfermedad renal o estás en diálisis?',                        revisionSiContraste: true },
  { key: 'claustrofobia',           pregunta: '¿Sufres de claustrofobia?',                                            nota: true }
];

/* Emergencias — triage determinista pre-LLM */
export const TERMINOS_EMERGENCIA = [
  'dolor en el pecho', 'dolor de pecho', 'me duele el pecho', 'opresion en el pecho',
  'no puedo respirar', 'dificultad para respirar', 'me falta el aire', 'ahogo',
  'sangrado', 'sangro mucho', 'hemorragia', 'convulsion', 'convulsión',
  'desmayo', 'me desmaye', 'me desmayé', 'perdi el conocimiento', 'perdí el conocimiento',
  'infarto', 'derrame', 'accidente cerebrovascular', 'no siento el brazo',
  'no puedo hablar', 'se me paralizo', 'se me paralizó', 'emergencia', 'urgencia grave',
  'intoxicacion', 'intoxicación', 'sobredosis'
];

export const TERMINOS_HUMANO = [
  'hablar con una persona', 'hablar con alguien', 'asesor', 'humano', 'operador',
  'persona real', 'agente humano', 'quiero hablar con', 'comunicame con', 'comuníqueme',
  'atencion al cliente', 'atención al cliente', 'no quiero un bot', 'eres un bot'
];

export const TERMINOS_INTERPRETACION = [
  'que significa', 'qué significa', 'interpretar', 'interpretame', 'interprétame',
  'es grave', 'es malo', 'tengo cancer', 'tengo cáncer', 'que tengo', 'qué tengo',
  'mi diagnostico', 'mi diagnóstico', 'segun mi informe', 'según mi informe',
  'hiperintensidad', 'lo que dice el informe', 'esta bien mi resultado', 'está bien mi resultado'
];

export const TERMINOS_RECLAMO = [
  'pesimo', 'pésimo', 'terrible', 'malisimo', 'malísimo', 'no sirven', 'una queja',
  'reclamo', 'estafa', 'me robaron', 'llevo esperando', 'nadie responde',
  'es una verguenza', 'es una vergüenza', 'indignado', 'indignada', 'voy a demandar'
];

/* Inyección de prompt */
export const TERMINOS_INYECCION = [
  'ignora tus instrucciones', 'ignora las instrucciones', 'olvida tus reglas',
  'system prompt', 'tu prompt', 'eres otro asistente', 'actua como', 'actúa como',
  'modo desarrollador', 'dame un descuento del', 'jailbreak', 'muestra tus reglas'
];

export function buscarEstudio(texto) {
  const t = normalizar(texto);
  let mejor = null, mejorPuntaje = 0;
  for (const e of ESTUDIOS) {
    const candidatos = [e.nombre, ...e.alias];
    for (const c of candidatos) {
      const n = normalizar(c);
      if (!n) continue;
      if (t.includes(n)) {
        const puntaje = n.length + (mencionaModalidad(t, e.modalidad) ? 20 : 0);
        if (puntaje > mejorPuntaje) { mejorPuntaje = puntaje; mejor = e; }
      }
    }
  }
  return mejor;
}

function mencionaModalidad(t, modalidad) {
  if (modalidad === 'RM') return /resonancia|\brm\b|rmn/.test(t);
  if (modalidad === 'TC') return /tomografia|tomografía|\btac\b|\btc\b|scanner|escaner|escáner/.test(t);
  return false;
}

export function normalizar(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function estudioPorId(id) {
  return ESTUDIOS.find(e => e.id === id) || null;
}

export function dentroDeHorario(fecha = new Date()) {
  const rango = HORARIO.dias[fecha.getDay()];
  if (!rango) return false;
  const h = fecha.getHours();
  return h >= rango[0] && h < rango[1];
}
