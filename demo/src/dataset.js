/* ============================================================
   Conjunto de entrenamiento
   ------------------------------------------------------------
   Si el plan es afinar un modelo y hacer aprendizaje por
   refuerzo, esta es la pieza que tiene que existir antes que
   ninguna otra: el dato. Un entrenador se cambia en una tarde;
   tres años de conversaciones anotadas, no.

   Tres formatos, porque son tres etapas distintas:

     SFT          conversación → respuesta correcta
                  (lo que escribió la persona que corrigió)

     Preferencias prompt → elegida vs rechazada
                  (CADA corrección ya es un par de preferencia:
                   lo que dijo el agente es la rechazada, lo que
                   debió decir es la elegida. No hay que anotar
                   nada aparte: el CRM lleva semanas haciéndolo)

     Recompensa   caso → 1 o 0, según el banco de evaluaciones
                  (recompensa verificable: no hace falta un modelo
                   de recompensa entrenado, porque la conducta
                   correcta es comprobable por código)

   Y una regla que no es negociable: nada sale de aquí con datos
   del paciente. La anonimización va ANTES del formato, no
   después, y tiene pruebas propias.
   ============================================================ */

/* ------------------------------------------------------------
   Anonimización
   ------------------------------------------------------------
   Ley 81 de 2019: los datos de salud son sensibles. Un modelo
   afinado sobre ellos los convierte en pesos que no se pueden
   borrar, así que el derecho de supresión deja de poder
   atenderse. La única salida es que el dato personal no entre.
   ------------------------------------------------------------ */

/* Cédulas panameñas: 8-745-1123, PE-12-345, E-8-12345,
   N-19-1234, 4-PI-12-3456, 8-NT-1-234 */
const RE_CEDULA = /\b(?:\d{1,2}|PE|E|N|AV)-(?:[A-Z]{1,2}-)?\d{1,4}-\d{1,6}\b|\b\d{1,2}-[A-Z]{2}-\d{1,4}-\d{1,6}\b/gi;
/* Teléfonos panameños. Dos formas, y hacen falta las dos:
   móvil de 8 dígitos (6480-0336, 62345678) y fijo de 7 (226-2332).
   El de 7 exige separador a propósito: sin él, siete dígitos
   seguidos son casi siempre otra cosa. */
const RE_TELEFONO = /(?:\+?507[\s-]?)?\b[2-9]\d{3}[\s-]?\d{4}\b|\b[2-5]\d{2}[\s-]\d{4}\b/g;
const RE_EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b/g;
/* Fechas de nacimiento completas: 12/04/1987, 1987-04-12 */
const RE_FECHA = /\b(?:\d{1,2}[/-]\d{1,2}[/-](?:19|20)\d{2}|(?:19|20)\d{2}[/-]\d{1,2}[/-]\d{1,2})\b/g;

/* ------------------------------------------------------------
   Nombres que nadie registró
   ------------------------------------------------------------
   Quitar por coincidencia exacta solo funciona si alguien capturó
   el nombre en un campo. Y muchas veces no: el paciente lo escribe
   suelto en medio de una frase, antes de que el agente llegue a
   pedirlo. Eso se vio en una prueba de extremo a extremo, con el
   nombre saliendo intacto en el JSONL.

   Dos defensas, y la segunda es la que importa:

     1. Buscar nombres tras las fórmulas con las que la gente se
        presenta. Alta precisión, cobertura limitada.
     2. Una verja final: si queda algo CON FORMA de nombre, el
        ejemplo no sale. Perder un ejemplo no cuesta nada; filtrar
        el nombre de un paciente a los pesos de un modelo, sí.
   ------------------------------------------------------------ */
const PRESENTACION = /(?:\bsoy\b|\bme llamo\b|\bmi nombre es\b|\bpaciente\b|\bpara\b|\ba nombre de\b)[:\s]+/gi;
/* Dos o más palabras capitalizadas seguidas, con partículas. */
const RE_CAPITALIZADAS = /\b[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}(?:\s+(?:de|del|la|las|los|y)\s+|\s+)[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,})*/g;

/* Lo que parece un nombre y no lo es. Sin esta lista, «Resonancia
   de Columna Lumbar» y «Ciudad de Panamá» se irían por el desagüe
   junto con los ejemplos que los contienen. */
export const NO_SON_NOMBRES = [
  'resonancia', 'tomografia', 'tomografía', 'ecografia', 'ecografía', 'angiorresonancia',
  'defecorresonancia', 'enterorresonancia', 'columna', 'lumbar', 'cervical', 'dorsal',
  'cerebro', 'rodilla', 'hombro', 'abdomen', 'pelvis', 'torax', 'tórax', 'contraste',
  'open', 'side', 'sofia', 'sofía', 'panama', 'panamá', 'ciudad', 'sede', 'calle',
  'cubo', 'vidrio', 'san', 'francisco', 'lunes', 'martes', 'miercoles', 'miércoles',
  'jueves', 'viernes', 'sabado', 'sábado', 'domingo', 'enero', 'febrero', 'marzo',
  'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre',
  'diciembre', 'assa', 'palig', 'mapfre', 'internacional', 'seguros', 'privado',
  'nota', 'privada', 'whatsapp', 'google', 'calendar', 'preparacion', 'preparación',
  'ayuno', 'cita', 'agenda', 'estudio', 'informe', 'portal', 'equipo', 'urgencias'
];

const sinAcentos = s => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const esFraseConocida = (frase, denegados) =>
  sinAcentos(frase).split(/\s+/).every(p => denegados.has(sinAcentos(p)) || p.length <= 3);

/** Candidatos a nombre en un texto, por cómo la gente se presenta. */
export function nombresProbables(texto, denegados = NO_SON_NOMBRES) {
  const deny = new Set(denegados.map(sinAcentos));
  const t = String(texto ?? '');
  const out = new Set();
  for (const m of t.matchAll(PRESENTACION)) {
    const resto = t.slice(m.index + m[0].length);
    const cand = resto.match(/^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}){0,3}/);
    if (cand && !esFraseConocida(cand[0], deny)) out.add(cand[0]);
  }
  return [...out];
}

/** Escapa un literal para meterlo en una expresión regular. */
const escaparRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Sustituye datos personales por marcadores estables.
 * @param texto    lo que se va a anonimizar
 * @param nombres  nombres conocidos de esta conversación; se quitan
 *                 por coincidencia exacta, que es lo único fiable —
 *                 adivinar nombres por mayúsculas destroza el texto
 *                 («Resonancia de Columna» no es una persona).
 */
export function anonimizar(texto, nombres = []) {
  let t = String(texto ?? '');
  const quitados = { nombre: 0, cedula: 0, telefono: 0, email: 0, fecha: 0 };

  /* A los nombres conocidos se suman los que el texto presenta por
     sí mismo: «soy Ana Sofía Vargas» no necesita que nadie lo haya
     guardado en un campo. */
  const todos = [...new Set([...nombres, ...nombresProbables(t)].filter(Boolean))];

  /* Los nombres primero: una cédula dentro de un nombre no existe,
     pero un nombre junto a su cédula sí, y conviene no partirlo. */
  for (const n of todos) {
    if (!n || String(n).trim().length < 3) continue;
    const completo = String(n).trim();
    // El nombre completo y también cada parte suelta de al menos 3 letras.
    const piezas = [completo, ...completo.split(/\s+/).filter(p => p.length >= 3)];
    for (const p of [...new Set(piezas)].sort((a, b) => b.length - a.length)) {
      const re = new RegExp(`\\b${escaparRe(p)}\\b`, 'gi');
      t = t.replace(re, () => { quitados.nombre++; return '[NOMBRE]'; });
    }
  }

  t = t.replace(RE_EMAIL,    () => { quitados.email++;    return '[EMAIL]'; });
  t = t.replace(RE_CEDULA,   () => { quitados.cedula++;   return '[CEDULA]'; });
  t = t.replace(RE_FECHA,    () => { quitados.fecha++;    return '[FECHA]'; });
  t = t.replace(RE_TELEFONO, () => { quitados.telefono++; return '[TELEFONO]'; });

  return { texto: t, quitados, total: Object.values(quitados).reduce((a, b) => a + b, 0) };
}

/** ¿Queda algo que parezca un dato personal? Segunda pasada, por si acaso. */
export function residuo(texto, denegados = NO_SON_NOMBRES) {
  const t = String(texto ?? '');
  const hallazgos = [];
  for (const [nombre, re] of [['cedula', RE_CEDULA], ['telefono', RE_TELEFONO], ['email', RE_EMAIL], ['fecha', RE_FECHA]]) {
    const m = t.match(re);
    if (m) hallazgos.push({ tipo: nombre, ejemplos: m.slice(0, 3) });
  }
  /* La verja final: cualquier cosa con forma de nombre propio que
     no esté en la lista de lo que parece y no es. Ante la duda se
     descarta el ejemplo, que no cuesta nada. */
  const deny = new Set(denegados.map(sinAcentos));
  const sospechosos = [...new Set((t.match(RE_CAPITALIZADAS) || []).filter(f => !esFraseConocida(f, deny)))];
  if (sospechosos.length) hallazgos.push({ tipo: 'nombre_probable', ejemplos: sospechosos.slice(0, 3) });
  return hallazgos;
}

/* ------------------------------------------------------------
   Elegibilidad
   ------------------------------------------------------------
   El consentimiento que el paciente dio es para ATENDERLE. No es
   consentimiento para entrenar un modelo: son finalidades
   distintas y la Ley 81 las trata como tales. Hasta que exista
   una casilla aparte, ninguna conversación es elegible, y este
   módulo lo dice en vez de disimularlo.
   ------------------------------------------------------------ */
export const FINALIDAD_ENTRENAMIENTO = 'consentimiento_entrenamiento';

export function elegibilidad(conversacion) {
  const crm = conversacion?.crm || {};
  const atencion = crm.contacto?.consentimiento_datos === true;
  const entrenamiento = crm.contacto?.[FINALIDAD_ENTRENAMIENTO] === true;
  if (!atencion) return { elegible: false, motivo: 'sin_consentimiento_de_atencion' };
  if (!entrenamiento) return { elegible: false, motivo: 'sin_consentimiento_de_entrenamiento' };
  return { elegible: true, motivo: null };
}

/* ------------------------------------------------------------
   Los tres formatos
   ------------------------------------------------------------ */

/** SFT: la conversación hasta el fallo, y la respuesta correcta. */
export function ejemploSFT(correccion, contexto = {}) {
  const nombres = contexto.nombres || [];
  const previo = (contexto.previos || []).map(m => ({
    role: m.autor === 'paciente' ? 'user' : 'assistant',
    content: anonimizar(m.texto, nombres).texto
  }));
  return {
    messages: [
      ...previo,
      { role: 'assistant', content: anonimizar(correccion.correccion, nombres).texto }
    ],
    meta: { motivo: correccion.motivo, origen: correccion.id }
  };
}

/** Preferencia (DPO): lo que dijo vs lo que debió decir. */
export function parPreferencia(correccion, contexto = {}) {
  if (!correccion.correccion || !correccion.correccion.trim()) return null;
  const nombres = contexto.nombres || [];
  const previo = (contexto.previos || []).map(m => ({
    role: m.autor === 'paciente' ? 'user' : 'assistant',
    content: anonimizar(m.texto, nombres).texto
  }));
  return {
    prompt: previo,
    chosen: anonimizar(correccion.correccion, nombres).texto,
    rejected: anonimizar(correccion.textoBot, nombres).texto,
    meta: { motivo: correccion.motivo, origen: correccion.id }
  };
}

/** Recompensa verificable: la sale del banco, no de un juez. */
export function ejemploRecompensa(caso, resultado) {
  return {
    id: caso.id,
    entrada: caso.pasos.map(p => (typeof p === 'string' ? p : p.text)),
    recompensa: resultado.ok ? 1 : 0,
    gravedad: caso.gravedad,
    /* El peso hace que un fallo bloqueante cueste lo que cuesta.
       Sin él, la política aprende que da igual matar a alguien
       mientras acierte en los precios. */
    peso: caso.gravedad === 'bloqueante' ? 10 : caso.gravedad === 'alta' ? 3 : 1,
    fallos: resultado.fallos
  };
}

/* ------------------------------------------------------------
   Construcción del conjunto
   ------------------------------------------------------------ */
export function construir({ correcciones = [], conversaciones = [], resultadosEvals = [], casos = [] } = {}) {
  const porId = new Map(conversaciones.map(c => [c.id, c]));

  const sft = [], preferencias = [], descartes = [];
  let pii = 0;

  for (const c of correcciones) {
    if (c.estado === 'descartada') { descartes.push({ id: c.id, motivo: 'descartada_por_el_equipo' }); continue; }

    const conv = c.idConversacion ? porId.get(c.idConversacion) : null;
    /* Sin conversación no hay forma de comprobar el consentimiento,
       y sin poder comprobarlo la respuesta es no. */
    const eleg = conv ? elegibilidad(conv) : { elegible: false, motivo: 'conversacion_no_encontrada' };
    if (!eleg.elegible) { descartes.push({ id: c.id, motivo: eleg.motivo }); continue; }

    const nombres = [conv.crm?.contacto?.paciente_nombre, conv.contacto?.nombre].filter(Boolean);
    const previos = (conv.mensajes || []).filter(m => !m.privado).slice(-6);
    const contexto = { nombres, previos };

    /* Se cuenta sobre TODO lo que entra —el histórico incluido—, no
       solo sobre la corrección: el dato personal casi siempre está
       en lo que escribió el paciente, no en lo que anotó el agente. */
    for (const m of previos) pii += anonimizar(m.texto, nombres).total;
    pii += anonimizar(c.textoBot, nombres).total + anonimizar(c.correccion, nombres).total;

    const ej = ejemploSFT(c, contexto);
    const par = parPreferencia(c, contexto);

    /* Última verja: si tras anonimizar sigue habiendo algo que
       parece un dato personal, el ejemplo no sale. */
    const serializado = JSON.stringify(ej);
    if (residuo(serializado).length) { descartes.push({ id: c.id, motivo: 'residuo_de_datos_personales' }); continue; }

    sft.push(ej);
    if (par) preferencias.push(par);
  }

  const porCaso = new Map(resultadosEvals.map(r => [r.id, r]));
  const recompensas = casos
    .filter(c => porCaso.has(c.id))
    .map(c => ejemploRecompensa(c, porCaso.get(c.id)));

  return {
    sft, preferencias, recompensas, descartes,
    resumen: {
      correcciones: correcciones.length,
      sft: sft.length,
      preferencias: preferencias.length,
      recompensas: recompensas.length,
      descartados: descartes.length,
      datosPersonalesRetirados: pii,
      motivosDeDescarte: descartes.reduce((m, d) => ({ ...m, [d.motivo]: (m[d.motivo] || 0) + 1 }), {})
    }
  };
}

/* ------------------------------------------------------------
   Exportación
   ------------------------------------------------------------ */
export function aJSONL(filas) {
  return filas.map(f => JSON.stringify(f)).join('\n') + (filas.length ? '\n' : '');
}

/* ------------------------------------------------------------
   Cuánto falta
   ------------------------------------------------------------
   El número que nadie quiere mirar. Un DPO decente empieza a
   notarse hacia los mil pares; por debajo de unos cientos, el
   ruido manda. Si el centro produce tres correcciones al día,
   eso es un año largo, y conviene saberlo antes de presupuestar
   GPUs y no después.
   ------------------------------------------------------------ */
export const UMBRALES = { minimo: 200, util: 1000, comodo: 5000 };

export function proyeccion(pares, porDia) {
  const ritmo = Number(porDia) || 0;
  const faltan = Math.max(0, UMBRALES.util - pares);
  return {
    pares,
    umbral: UMBRALES.util,
    faltan,
    listo: pares >= UMBRALES.util,
    diasEstimados: ritmo > 0 ? Math.ceil(faltan / ritmo) : null,
    etapa: pares >= UMBRALES.comodo ? 'comodo'
         : pares >= UMBRALES.util ? 'util'
         : pares >= UMBRALES.minimo ? 'minimo' : 'insuficiente'
  };
}
