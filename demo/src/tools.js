/* ============================================================
   Herramientas deterministas
   ------------------------------------------------------------
   Estas funciones son la ÚNICA fuente de verdad de precios,
   cupos, coberturas y decisiones de seguridad. El modelo de
   lenguaje nunca inventa estos datos: los solicita aquí.
   En producción, cada función llama al RIS / agenda / API real.
   ============================================================ */

import {
  ESTUDIOS, ASEGURADORAS, SEDES, PREPARACIONES, RECARGO_CONTRASTE,
  estudioPorId, normalizar
} from './kb.js';

/* Latencia simulada para que el inspector muestre tiempos realistas */
const lat = (min, max) => Math.round(min + Math.random() * (max - min));

let _seqCita = 4870;
const _cupos = new Map();   // cupo_id -> cupo (TTL simulado)
const _citas = new Map();   // cita_id -> cita
const _idempotencia = new Set();

/* ---------------------------------------------------------- */
/* cotizar_estudio                                            */
/* ---------------------------------------------------------- */
export function cotizar_estudio({ estudio_id, con_contraste = false, tipo_paciente = 'privado' }) {
  const e = estudioPorId(estudio_id);
  if (!e) {
    return { ok: false, error: 'ESTUDIO_NO_ENCONTRADO', _latencia: lat(40, 90) };
  }
  const base = tipo_paciente === 'asegurado' ? e.precioAsegurado : e.precioPrivado;
  const recargo = con_contraste ? RECARGO_CONTRASTE : 0;
  return {
    ok: true,
    estudio: e.nombre,
    estudio_id: e.id,
    modalidad: e.modalidad,
    con_contraste,
    tipo_paciente,
    moneda: 'USD',
    precio_base: base,
    recargo_contraste: recargo,
    total: base + recargo,
    duracion_min: e.duracion,
    aviso: 'PRECIO DE DEMOSTRACIÓN — pendiente de lista oficial de Open Side.',
    _latencia: lat(90, 220)
  };
}

/* ---------------------------------------------------------- */
/* verificar_seguro                                           */
/* ---------------------------------------------------------- */
export function verificar_seguro({ aseguradora, estudio_id }) {
  const a = ASEGURADORAS.find(x => x.id === aseguradora || normalizar(x.nombre) === normalizar(aseguradora));
  const e = estudioPorId(estudio_id);
  if (!a) {
    return {
      ok: true, convenio: false, aseguradora,
      mensaje: 'No encontré esa aseguradora en la lista de convenios. Un asesor puede verificarlo.',
      requiere_revision_humana: true,
      _latencia: lat(150, 380)
    };
  }
  return {
    ok: true,
    aseguradora: a.nombre,
    convenio: a.convenio,
    autorizacion_previa: a.autorizacionPrevia,
    coaseguro_tipico: a.coaseguroTipico,
    estudio: e ? e.nombre : null,
    requiere_revision_humana: !a.convenio,
    aviso: 'CONVENIOS DE DEMOSTRACIÓN — confirmar con administración de Open Side.',
    nota: a.autorizacionPrevia
      ? 'En Panamá la radiología ambulatoria suele requerir autorización previa de la aseguradora.'
      : null,
    _latencia: lat(250, 600)
  };
}

/* ---------------------------------------------------------- */
/* screening_rm — decisión de seguridad, 100% determinista     */
/* ---------------------------------------------------------- */
export function screening_rm(respuestas = {}) {
  const r = k => respuestas[k] === true;
  const motivos = [];
  let estado = 'aprobado';

  const bloqueantes = [
    ['marcapasos_o_dai',         'Marcapasos o desfibrilador implantado (DAI)'],
    ['implante_coclear',         'Implante coclear'],
    ['clips_aneurisma',          'Clips por aneurisma cerebral'],
    ['neuroestimulador_o_bomba', 'Neuroestimulador o bomba de infusión implantada']
  ];
  for (const [k, texto] of bloqueantes) {
    if (r(k)) { estado = 'bloqueado'; motivos.push(texto); }
  }

  if (estado !== 'bloqueado') {
    const revisables = [
      ['fragmentos_metalicos',  'Fragmentos metálicos en el cuerpo'],
      ['cirugia_reciente_90d',  'Cirugía en los últimos 90 días'],
      ['embarazo_o_sospecha',   'Embarazo o posibilidad de embarazo']
    ];
    for (const [k, texto] of revisables) {
      if (r(k)) { estado = 'requiere_revision'; motivos.push(texto); }
    }
  }

  // Contraste con gadolinio: riesgoso en enfermedad renal / diálisis
  if (respuestas.requiere_contraste === true) {
    if (r('enfermedad_renal') || r('enfermedad_renal_o_dialisis')) {
      estado = 'bloqueado';
      motivos.push('Enfermedad renal o diálisis + contraste con gadolinio');
    }
    if (r('alergia_contraste_previa') && estado !== 'bloqueado') {
      estado = 'requiere_revision';
      motivos.push('Reacción alérgica previa a medio de contraste');
    }
  }

  const notas = [];
  if (r('claustrofobia')) {
    notas.push('Claustrofobia declarada: evaluar sedación suave indicada por su médico.');
  }

  return {
    ok: true,
    estado,                                  // aprobado | requiere_revision | bloqueado
    motivos,
    notas,
    puede_agendar: estado === 'aprobado',
    equipo_destino: estado === 'aprobado' ? null : 'tecnologia_rm',
    aviso: 'CUESTIONARIO DE DEMOSTRACIÓN — debe validarse con el radiólogo de Open Side.',
    _latencia: lat(20, 60)
  };
}

/* ---------------------------------------------------------- */
/* buscar_cupos                                               */
/* ---------------------------------------------------------- */
export function buscar_cupos({ estudio_id, sede = 'cualquiera', desde, preferencia_horario = 'cualquiera', limite = 3 }) {
  const e = estudioPorId(estudio_id);
  if (!e) return { ok: false, error: 'ESTUDIO_NO_ENCONTRADO', _latencia: lat(60, 120) };

  const base = desde ? new Date(desde) : new Date();
  const cupos = [];
  const horasManana = [7, 8, 9, 10, 11];
  const horasTarde  = [13, 14, 15, 16, 17, 18];
  let pool = preferencia_horario === 'manana' ? horasManana
           : preferencia_horario === 'tarde'  ? horasTarde
           : [...horasManana, ...horasTarde];

  let cursor = new Date(base);
  cursor.setHours(0, 0, 0, 0);
  let intentos = 0;

  while (cupos.length < limite && intentos < 21) {
    cursor.setDate(cursor.getDate() + 1);
    intentos++;
    const dow = cursor.getDay();
    if (dow === 0) continue;                             // domingo cerrado
    const tope = dow === 6 ? 14 : 20;                    // sábado hasta 14:00
    const horas = pool.filter(h => h < tope);
    // Disponibilidad pseudo-aleatoria pero estable por día
    const semilla = (cursor.getDate() * 7 + dow * 3 + estudio_id.length) % horas.length;
    const elegidas = [horas[semilla], horas[(semilla + 2) % horas.length]];
    for (const h of elegidas) {
      if (cupos.length >= limite) break;
      if (h === undefined) continue;
      const minutos = (h + cursor.getDate()) % 2 === 0 ? 0 : 30;
      const inicio = new Date(cursor);
      inicio.setHours(h, minutos, 0, 0);
      const sedeAsignada = sede === 'cualquiera' ? (cupos.length % 2 === 0 ? '75E' : '76E') : sede;
      const id = `CUPO-${inicio.toISOString().slice(0, 10)}-${h}${minutos}-${sedeAsignada}`;
      if (cupos.some(c => c.cupo_id === id)) continue;
      const cupo = {
        cupo_id: id,
        inicio: inicio.toISOString(),
        etiqueta: formatoFechaHora(inicio),
        sede: sedeAsignada,
        sede_nombre: SEDES[sedeAsignada].nombre,
        duracion_min: e.duracion,
        expira_en_min: 10
      };
      _cupos.set(id, { ...cupo, creado: Date.now() });
      cupos.push(cupo);
    }
  }

  return {
    ok: true,
    estudio: e.nombre,
    cupos,
    ttl_min: 10,
    aviso: 'AGENDA SIMULADA — en producción se consulta el RIS de Open Side.',
    _latencia: lat(280, 700)
  };
}

/* ---------------------------------------------------------- */
/* agendar_cita — con precondiciones de seguridad              */
/* ---------------------------------------------------------- */
export function agendar_cita({ cupo_id, paciente, estudio_id, aseguradora, idempotency_key, _contexto = {} }) {
  // Precondición 1: idempotencia
  if (idempotency_key && _idempotencia.has(idempotency_key)) {
    return { ok: false, error: 'DUPLICADO', mensaje: 'Esta cita ya fue creada.', _latencia: lat(30, 60) };
  }
  // Precondición 2: consentimiento (Ley 81 de 2019)
  if (_contexto.consentimiento !== true) {
    return { ok: false, error: 'SIN_CONSENTIMIENTO', bloqueo: 'guardrail',
             mensaje: 'No se puede registrar datos del paciente sin consentimiento expreso.', _latencia: lat(10, 25) };
  }
  // Precondición 3: screening de RM aprobado
  const e = estudioPorId(estudio_id);
  if (e && e.modalidad === 'RM' && _contexto.screening_estado !== 'aprobado') {
    return { ok: false, error: 'SCREENING_NO_APROBADO', bloqueo: 'guardrail',
             mensaje: 'No se agenda una resonancia sin screening de seguridad aprobado.', _latencia: lat(10, 25) };
  }
  // Precondición 4: cupo vigente
  const cupo = _cupos.get(cupo_id);
  if (!cupo) {
    return { ok: false, error: 'CUPO_NO_VIGENTE', mensaje: 'Ese horario ya no está disponible.', _latencia: lat(60, 140) };
  }

  const cita_id = `OS-${new Date().getFullYear()}-0${++_seqCita}`;
  const cita = {
    cita_id,
    estudio: e ? e.nombre : estudio_id,
    estudio_id,
    inicio: cupo.inicio,
    etiqueta: cupo.etiqueta,
    sede: cupo.sede,
    sede_nombre: SEDES[cupo.sede].nombre,
    direccion: SEDES[cupo.sede].direccion,
    duracion_min: cupo.duracion_min,
    paciente: paciente || null,
    aseguradora: aseguradora || 'Privado',
    estado: 'confirmada'
  };
  _citas.set(cita_id, cita);
  if (idempotency_key) _idempotencia.add(idempotency_key);
  _cupos.delete(cupo_id);

  return { ok: true, ...cita, _latencia: lat(400, 900) };
}

/* ---------------------------------------------------------- */
/* consultar_preparacion                                      */
/* ---------------------------------------------------------- */
export function consultar_preparacion({ estudio_id, con_contraste = false }) {
  const e = estudioPorId(estudio_id);
  if (!e) return { ok: false, error: 'ESTUDIO_NO_ENCONTRADO', _latencia: lat(30, 70) };
  const pasos = [...PREPARACIONES.general];
  if (e.ayuno) pasos.unshift(PREPARACIONES.ayuno);
  if (con_contraste || e.contrasteFrecuente) pasos.push(PREPARACIONES.contraste);
  if (e.modalidad === 'RM') pasos.push(PREPARACIONES.claustrofobia);
  return {
    ok: true,
    estudio: e.nombre,
    requiere_ayuno: e.ayuno,
    pasos,
    aviso: 'PREPARACIÓN GENÉRICA DE DEMOSTRACIÓN — sustituir por el protocolo de Open Side.',
    _latencia: lat(60, 160)
  };
}

/* ---------------------------------------------------------- */
/* consultar_sedes                                            */
/* ---------------------------------------------------------- */
export function consultar_sedes() {
  return { ok: true, sedes: Object.values(SEDES), _latencia: lat(20, 50) };
}

/* ---------------------------------------------------------- */
/* estado_resultados                                          */
/* ---------------------------------------------------------- */
export function estado_resultados({ cedula, cita_id }) {
  // Simulación: listo si el identificador termina en dígito par
  const ref = String(cita_id || cedula || '');
  const listo = /[02468]$/.test(ref);
  return {
    ok: true,
    listo,
    entrega: listo ? 'portal_seguro' : null,
    url_portal: listo ? 'https://www.open-side.com/resultados' : null,
    mensaje: listo
      ? 'El informe ya fue firmado por el radiólogo y está disponible en el portal.'
      : 'El estudio aún está en lectura. El tiempo habitual es de 24 a 48 horas hábiles.',
    politica: 'El informe nunca se envía por chat. Solo se comparte el enlace al portal seguro.',
    _latencia: lat(200, 500)
  };
}

/* ---------------------------------------------------------- */
/* registrar_consentimiento — Ley 81 de 2019 (Panamá)          */
/* ---------------------------------------------------------- */
export function registrar_consentimiento({ otorgado, texto_mostrado, canal = 'whatsapp' }) {
  return {
    ok: true,
    otorgado: !!otorgado,
    timestamp: new Date().toISOString(),
    canal,
    texto_hash: 'sha256:' + hashSimple(texto_mostrado || ''),
    base_legal: 'Ley 81 de 2019 (Panamá) · Decreto Ejecutivo 285 de 2021',
    trazable: true,
    _latencia: lat(30, 80)
  };
}

/* ---------------------------------------------------------- */
/* escalar_humano — Chatwoot: pending -> open                  */
/* ---------------------------------------------------------- */
export function escalar_humano({ motivo, prioridad = 'medium', equipo = 'general', resumen, datos_recolectados = {} }) {
  return {
    ok: true,
    motivo, prioridad, equipo, resumen,
    chatwoot: {
      accion: 'PATCH /api/v1/accounts/{id}/conversations/{id}/toggle_status',
      status_anterior: 'pending',
      status_nuevo: 'open',
      nota_privada: true,
      labels: ['escalado-humano', motivo.replace(/_/g, '-')],
      assignee_team: equipo
    },
    datos_recolectados,
    _latencia: lat(120, 300)
  };
}

/* ---------------------------------------------------------- */
/* Utilidades                                                 */
/* ---------------------------------------------------------- */
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

export function formatoFechaHora(d) {
  const h24 = d.getHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const ampm = h24 < 12 ? 'a.m.' : 'p.m.';
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}, ${h12}:${min} ${ampm}`;
}

export function formatoCorto(d) {
  const h24 = d.getHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const ampm = h24 < 12 ? 'a.m.' : 'p.m.';
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${DIAS[d.getDay()].slice(0, 3)} ${d.getDate()} · ${h12}:${min}${ampm === 'a.m.' ? 'am' : 'pm'}`;
}

function hashSimple(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function resetEstadoHerramientas() {
  _cupos.clear(); _citas.clear(); _idempotencia.clear(); _seqCita = 4870;
}

export const TOOLS = {
  cotizar_estudio, verificar_seguro, screening_rm, buscar_cupos, agendar_cita,
  consultar_preparacion, consultar_sedes, estado_resultados,
  registrar_consentimiento, escalar_humano
};
