/* ============================================================
   Suite del loop agéntico · transporte simulado
   ------------------------------------------------------------
   Ejercita el loop REAL (manejarTurno → loopAgentico → ejecutor)
   sustituyendo solo la llamada HTTP a la API. Así se verifican sin
   gastar tokens: parseo de tool_use, ejecución, tool_result en un
   único mensaje, precondiciones de servidor, triage pre-LLM,
   refusal, guardrails de salida y recorte de historial.

   Ejecutar: node server/tests-loop.mjs
   ============================================================ */

import { manejarTurno, reiniciarSesion, obtenerSesion, _internos } from './agent-ai.js';
import { resetEstadoHerramientas } from '../demo/src/tools.js';
import { validarEsquemas, TOOL_SCHEMAS } from './tool-schemas.js';

let fallos = 0, n = 0;
function ok(cond, nombre, detalle) {
  n++;
  console.log((cond ? '✅' : '❌') + ' ' + nombre);
  if (!cond) { fallos++; if (detalle) console.log('   →', typeof detalle === 'string' ? detalle : JSON.stringify(detalle).slice(0, 400)); }
}

/* --- Cliente falso: devuelve guiones de respuesta preprogramados --- */
function clienteFalso(guion) {
  const llamadas = [];
  let i = 0;
  return {
    llamadas,
    beta: { messages: { create: async (params) => {
      llamadas.push(params);
      const paso = guion[Math.min(i++, guion.length - 1)];
      return typeof paso === 'function' ? paso(params) : paso;
    } } }
  };
}

const texto = (t, stop = 'end_turn') => ({
  id: 'msg_x', model: 'claude-opus-5', stop_reason: stop, stop_details: null,
  content: [{ type: 'text', text: t }], usage: { input_tokens: 800, output_tokens: 40, cache_read_input_tokens: 700 }
});
const usoTool = (llamadas, textoPrevio) => ({
  id: 'msg_x', model: 'claude-opus-5', stop_reason: 'tool_use', stop_details: null,
  content: [
    ...(textoPrevio ? [{ type: 'text', text: textoPrevio }] : []),
    ...llamadas.map((c, k) => ({ type: 'tool_use', id: `tu_${k}_${Math.random().toString(36).slice(2, 7)}`, name: c.name, input: c.input }))
  ],
  usage: { input_tokens: 900, output_tokens: 90, cache_read_input_tokens: 700 }
});

function nuevaSesion(id) { resetEstadoHerramientas(); reiniciarSesion(id); return id; }

/* ============================================================ */
console.log('\n── Esquemas ──');
const errs = validarEsquemas();
ok(errs.length === 0, `${TOOL_SCHEMAS.length} esquemas válidos para strict:true`, errs.join(' | '));

console.log('\n── Loop y ejecución de herramientas ──');

// 1 · encadenar dos herramientas y devolver texto
{
  const s = nuevaSesion('t1');
  const c = clienteFalso([
    usoTool([{ name: 'consultar_catalogo', input: { consulta: 'resonancia de columna lumbar' } }]),
    usoTool([{ name: 'cotizar_estudio', input: { estudio_id: 'rm-columna-lum', con_contraste: false, tipo_paciente: 'privado' } }]),
    texto('La *Resonancia de columna lumbar* cuesta US$380 y dura 25 minutos. ¿Te agendo?')
  ]);
  const r = await manejarTurno(c, s, { text: '¿Cuánto cuesta una resonancia de columna lumbar?' });
  ok(r.trace.tools.length === 2, 'encadena consultar_catalogo → cotizar_estudio', r.trace.tools.map(t => t.nombre));
  ok(r.trace.tools[1].resultado.total === 380, 'el precio viene de la herramienta, no del modelo', r.trace.tools[1].resultado);
  ok(r.trace.iteraciones === 3, 'tres iteraciones del loop', r.trace.iteraciones);
  ok(r.trace.uso.input > 0 && r.trace.uso.cache_read > 0, 'acumula uso de tokens y lecturas de caché', r.trace.uso);
  ok(/anclada/.test(r.trace.guardrails.find(g => g.nombre === 'anclaje_a_herramientas').resultado),
     'guardrail de anclaje: precio respaldado por cotizar_estudio');
}

// 2 · tool_result de llamadas paralelas van en UN solo mensaje de usuario
{
  const s = nuevaSesion('t2');
  const c = clienteFalso([
    usoTool([
      { name: 'consultar_sedes', input: {} },
      { name: 'consultar_catalogo', input: { consulta: 'tomografía de tórax' } }
    ]),
    texto('Listo.')
  ]);
  await manejarTurno(c, s, { text: '¿Dónde quedan y hacen tac de tórax?' });
  const st = obtenerSesion(s);
  const msgsResultado = st.messages.filter(m => Array.isArray(m.content) && m.content.some(b => b.type === 'tool_result'));
  ok(msgsResultado.length === 1, 'los tool_result paralelos van en un único mensaje', msgsResultado.length);
  ok(msgsResultado[0].content.length === 2, 'ese mensaje lleva los dos tool_result', msgsResultado[0].content.length);
}

console.log('\n── Precondiciones de servidor (lo que el modelo no puede saltarse) ──');

// 3 · agendar sin consentimiento
{
  const s = nuevaSesion('t3');
  const c = clienteFalso([
    usoTool([{ name: 'agendar_cita', input: { cupo_id: 'CUPO-X', estudio_id: 'tc-torax', nombre: 'Ana Ruiz', cedula: '8-1-1', aseguradora: 'Privado' } }]),
    texto('Necesito tu autorización primero.')
  ]);
  const r = await manejarTurno(c, s, { text: 'agéndame ya' });
  const res = r.trace.tools[0].resultado;
  ok(res.ok === false && res.error === 'SIN_CONSENTIMIENTO', 'agendar sin consentimiento: RECHAZADO', res);
  ok(r.trace.guardrails.some(g => /SIN_CONSENTIMIENTO/.test(g.resultado)), 'el bloqueo queda en la traza');
  ok(obtenerSesion(s).cita === null, 'no se creó ninguna cita');
}

// 4 · resonancia sin screening aprobado
{
  const s = nuevaSesion('t4');
  const c = clienteFalso([
    usoTool([{ name: 'registrar_consentimiento', input: { otorgado: true, texto_mostrado: 'Ley 81…' } }]),
    usoTool([{ name: 'buscar_cupos', input: { estudio_id: 'rm-rodilla', sede: 'cualquiera', preferencia_horario: 'cualquiera' } }]),
    f => {
      const cupo = obtenerSesion('t4').cupos[0].cupo_id;
      return usoTool([{ name: 'agendar_cita', input: { cupo_id: cupo, estudio_id: 'rm-rodilla', nombre: 'Ana Ruiz', cedula: '8-1-1', aseguradora: 'Privado' } }]);
    },
    texto('Antes debo hacerte unas preguntas de seguridad.')
  ]);
  const r = await manejarTurno(c, s, { text: 'quiero resonancia de rodilla, sí autorizo' });
  const intento = r.trace.tools.find(t => t.nombre === 'agendar_cita');
  ok(intento.resultado.error === 'SCREENING_NO_APROBADO', 'RM sin screening aprobado: RECHAZADO', intento.resultado);
  ok(obtenerSesion(s).cita === null, 'no se creó la cita de resonancia');
}

// 5 · cupo inventado por el modelo
{
  const s = nuevaSesion('t5');
  const c = clienteFalso([
    usoTool([{ name: 'registrar_consentimiento', input: { otorgado: true, texto_mostrado: 'Ley 81…' } }]),
    usoTool([{ name: 'agendar_cita', input: { cupo_id: 'CUPO-2026-10-01-900-75E', estudio_id: 'tc-torax', nombre: 'Ana Ruiz', cedula: '8-1-1', aseguradora: 'Privado' } }]),
    texto('Déjame consultar la agenda.')
  ]);
  const r = await manejarTurno(c, s, { text: 'agéndame el 1 de octubre a las 9' });
  const intento = r.trace.tools.find(t => t.nombre === 'agendar_cita');
  ok(intento.resultado.error === 'CUPO_DESCONOCIDO', 'cupo que no salió de buscar_cupos: RECHAZADO', intento.resultado);
}

// 6 · ciclo completo válido sí crea la cita
{
  const s = nuevaSesion('t6');
  const c = clienteFalso([
    usoTool([{ name: 'registrar_consentimiento', input: { otorgado: true, texto_mostrado: 'Ley 81…' } }]),
    usoTool([{ name: 'evaluar_screening_rm', input: {
      marcapasos_o_dai: false, implante_coclear: false, clips_aneurisma: false,
      neuroestimulador_o_bomba: false, fragmentos_metalicos: false, embarazo_o_sospecha: false,
      enfermedad_renal: false, alergia_contraste_previa: false, claustrofobia: false, requiere_contraste: false } }]),
    usoTool([{ name: 'buscar_cupos', input: { estudio_id: 'rm-columna-lum', sede: 'cualquiera', preferencia_horario: 'manana' } }]),
    () => usoTool([{ name: 'agendar_cita', input: {
      cupo_id: obtenerSesion('t6').cupos[0].cupo_id, estudio_id: 'rm-columna-lum',
      nombre: 'María Elena Pérez', cedula: '8-745-1123', aseguradora: 'Privado' } }]),
    texto('¡Listo! Tu cita quedó confirmada ✅')
  ]);
  const r = await manejarTurno(c, s, { text: 'quiero agendar resonancia lumbar, autorizo, no tengo implantes' });
  const st = obtenerSesion(s);
  ok(st.screening === 'aprobado', 'screening evaluado por la herramienta → aprobado', st.screening);
  ok(st.cita && /^OS-/.test(st.cita.cita_id), 'cita creada de punta a punta', st.cita && st.cita.cita_id);
  ok(r.crm.status === 'resolved', 'CRM pasa a resolved', r.crm.status);
}

// 7 · marcapasos → bloqueado
{
  const s = nuevaSesion('t7');
  const c = clienteFalso([
    usoTool([{ name: 'evaluar_screening_rm', input: {
      marcapasos_o_dai: true, implante_coclear: false, clips_aneurisma: false,
      neuroestimulador_o_bomba: false, fragmentos_metalicos: false, embarazo_o_sospecha: false,
      enfermedad_renal: false, alergia_contraste_previa: false, claustrofobia: false, requiere_contraste: false } }]),
    usoTool([{ name: 'escalar_humano', input: { motivo: 'screening_no_aprobado', prioridad: 'high', equipo: 'tecnologia_rm', resumen: 'Marcapasos.' } }]),
    texto('Tu caso necesita la evaluación de nuestro tecnólogo.')
  ]);
  const r = await manejarTurno(c, s, { text: 'tengo marcapasos' });
  ok(obtenerSesion(s).screening === 'bloqueado', 'screening con marcapasos → bloqueado');
  ok(r.trace.escalamiento && r.trace.escalamiento.equipo === 'tecnologia_rm', 'escala a tecnología RM', r.trace.escalamiento);
  ok(r.crm.status === 'open' && r.crm.nota_privada, 'CRM open + nota privada para el humano');
}

console.log('\n── Triage determinista: el modelo nunca ve estos turnos ──');

// 8 · emergencia
{
  const s = nuevaSesion('t8');
  const c = clienteFalso([texto('NO DEBERÍA LLAMARSE')]);
  const r = await manejarTurno(c, s, { text: 'me duele el pecho desde hace una hora' });
  ok(c.llamadas.length === 0, 'emergencia: CERO llamadas a la API', c.llamadas.length);
  ok(r.trace.triage.tipo === 'emergencia' && r.trace.escalamiento.prioridad === 'urgent', 'escala urgente');
  ok(/911/.test(r.mensajes.map(m => m.text).join(' ')), 'entrega el guion de emergencia');
}

// 9 · pedir humano y pedir interpretación
for (const [txt, tipo] of [['quiero hablar con una persona', 'pedir_humano'],
                           ['qué significa hiperintensidad en T2 en mi informe', 'interpretar_resultado']]) {
  const s = nuevaSesion('t9' + tipo);
  const c = clienteFalso([texto('NO DEBERÍA LLAMARSE')]);
  const r = await manejarTurno(c, s, { text: txt });
  ok(c.llamadas.length === 0 && r.trace.triage.tipo === tipo, `triage "${tipo}": sin pasar por el modelo`);
}

console.log('\n── Guardrails de entrada y salida ──');

// 10 · PII enmascarada antes de llegar al modelo
{
  const s = nuevaSesion('t10');
  const c = clienteFalso([texto('Reviso tus resultados.')]);
  const r = await manejarTurno(c, s, { text: 'mi cédula es 8-123-4567 y mi correo ana@mail.com' });
  const enviado = JSON.stringify(c.llamadas[0].messages);
  ok(!/8-123-4567/.test(enviado) && /CEDULA_1/.test(enviado), 'la cédula nunca llega al modelo', enviado.slice(0, 200));
  ok(!/ana@mail\.com/.test(enviado) && /EMAIL_1/.test(enviado), 'el correo nunca llega al modelo');
  ok(obtenerSesion(s).slots.cedula === '8-123-4567', 'el valor real se conserva en el servidor');
}

// 11 · filtro anti-diagnóstico
{
  const s = nuevaSesion('t11');
  const c = clienteFalso([texto('Tu resultado indica que es benigno, no te preocupes.')]);
  const r = await manejarTurno(c, s, { text: 'y eso qué tal se ve' });
  ok(!/benigno/.test(r.mensajes.map(m => m.text).join(' ')), 'respuesta con diagnóstico: BLOQUEADA', r.mensajes);
  ok(r.trace.guardrails.some(g => g.nombre === 'filtro_anti_diagnostico' && /BLOQUEÓ/.test(g.resultado)), 'queda registrado en la traza');
}

// 12 · alerta de anclaje cuando el modelo inventa un precio
{
  const s = nuevaSesion('t12');
  const c = clienteFalso([texto('Eso cuesta US$250 más o menos.')]);
  const r = await manejarTurno(c, s, { text: 'cuánto sale' });
  ok(/ALERTA · precio sin herramienta/.test(r.trace.guardrails.find(g => g.nombre === 'anclaje_a_herramientas').resultado),
     'precio sin cotizar_estudio: ALERTA de anclaje');
}

console.log('\n── Casos del protocolo de la API ──');

// 13 · refusal (HTTP 200 con stop_reason refusal)
{
  const s = nuevaSesion('t13');
  const c = clienteFalso([{
    id: 'msg_x', model: 'claude-opus-5', stop_reason: 'refusal',
    stop_details: { type: 'refusal', category: 'cyber' }, content: [], usage: { input_tokens: 50, output_tokens: 0 }
  }]);
  const r = await manejarTurno(c, s, { text: 'algo raro' });
  ok(r.trace.guardrails.some(g => g.nombre === 'refusal'), 'stop_reason refusal detectado antes de leer content');
  ok(r.trace.escalamiento && obtenerSesion(s).escalado, 'refusal escala a humano');
}

// 14 · pause_turn se reanuda
{
  const s = nuevaSesion('t14');
  const c = clienteFalso([
    { id: 'm', model: 'claude-opus-5', stop_reason: 'pause_turn', stop_details: null,
      content: [{ type: 'text', text: 'un momento' }], usage: { input_tokens: 10, output_tokens: 5 } },
    texto('Listo, aquí está.')
  ]);
  const r = await manejarTurno(c, s, { text: 'hola' });
  ok(c.llamadas.length === 2, 'pause_turn reanuda con otra llamada', c.llamadas.length);
  ok(/aquí está/.test(r.mensajes.map(m => m.text).join(' ')), 'entrega la respuesta final');
}

// 15 · error de la API escala en vez de romper
{
  const s = nuevaSesion('t15');
  const c = { llamadas: [], beta: { messages: { create: async () => { const e = new Error('overloaded'); e.name = 'APIStatusError'; throw e; } } } };
  const r = await manejarTurno(c, s, { text: 'hola' });
  ok(r.trace.escalamiento && r.trace.escalamiento.motivo === 'fallo_herramienta', 'error de API → escala con contexto');
  ok(r.mensajes[0].text.includes('problema técnico'), 'el paciente recibe un mensaje útil, no un stack trace');
}

// 16 · límite de iteraciones
{
  const s = nuevaSesion('t16');
  const c = clienteFalso([usoTool([{ name: 'consultar_sedes', input: {} }])]); // bucle infinito
  const r = await manejarTurno(c, s, { text: 'hola' });
  ok(r.trace.iteraciones <= 6, 'el loop corta en el límite de iteraciones', r.trace.iteraciones);
  ok(r.trace.escalamiento && r.trace.escalamiento.motivo === 'baja_confianza', 'al cortar, escala a humano');
}

// 17 · el recorte de historial no rompe pares tool_use/tool_result
{
  const st = { messages: [] };
  for (let k = 0; k < 30; k++) {
    st.messages.push({ role: 'user', content: 'pregunta ' + k });
    st.messages.push({ role: 'assistant', content: [{ type: 'tool_use', id: 'tu' + k, name: 'consultar_sedes', input: {} }] });
    st.messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu' + k, content: '{}' }] });
  }
  _internos.recortarHistorial(st, 20);
  const primero = st.messages[0];
  const empiezaEnResultadoHuerfano = primero.role === 'user' && Array.isArray(primero.content)
    && primero.content.some(b => b.type === 'tool_result');
  ok(!empiezaEnResultadoHuerfano, 'el historial recortado no empieza con un tool_result huérfano', primero);
  ok(st.messages.length <= 22, 'el historial queda acotado', st.messages.length);
}

console.log(fallos === 0 ? `\n🟢 ${n} comprobaciones, todas pasan\n` : `\n🔴 ${fallos} de ${n} fallan\n`);
process.exit(fallos ? 1 : 0);
