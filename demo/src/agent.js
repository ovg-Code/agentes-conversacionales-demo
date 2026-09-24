/* ============================================================
   Orquestador del agente "Sofía"
   ------------------------------------------------------------
   Esta demo implementa la MISMA arquitectura descrita en
   docs/02-arquitectura.md, con una diferencia: donde en
   producción va una llamada a Claude con tool-calling, aquí hay
   un motor de reglas. Lo que NO cambia entre demo y producción:

     · el triage determinista PRE-LLM
     · los guardrails de entrada y salida
     · las herramientas como única fuente de verdad
     · las precondiciones de seguridad
     · la política de escalamiento
     · el formato de la traza

   Al conectar el modelo real, se reemplaza `interpretar()` por
   la llamada al LLM. Todo lo demás se mantiene intacto.
   ============================================================ */

import {
  SCREENING_RM, ASEGURADORAS, SEDES, HORARIO,
  TERMINOS_EMERGENCIA, TERMINOS_HUMANO, TERMINOS_INTERPRETACION,
  TERMINOS_RECLAMO, TERMINOS_INYECCION,
  buscarEstudio, normalizar, estudioPorId, dentroDeHorario
} from './kb.js';
import { TOOLS, formatoCorto } from './tools.js';

const TEXTO_CONSENTIMIENTO =
  'Para agendar necesito algunos datos tuyos, incluidos datos de salud. ' +
  'Open Side los usa solo para tu atención, conforme a la Ley 81 de 2019 de Panamá. ' +
  '¿Me autorizas a registrarlos?';

export function createAgent() {
  const st = estadoInicial();
  let turno = 0;

  function estadoInicial() {
    return {
      fase: 'saludo',
      saludado: false,
      consentimiento: false,
      consentimientoTs: null,
      slots: {
        estudio: null, con_contraste: null, sede: null,
        aseguradora: null, tipo_paciente: null,
        nombre: null, cedula: null, telefono: null
      },
      screening: { idx: 0, respuestas: {}, estado: 'pendiente', activo: false },
      cupos: [], cupoElegido: null, cita: null,
      cotizacion: null, seguro: null,
      sinEntender: 0,
      inyecciones: 0,
      escalado: false,
      labels: new Set(),
      historial: []
    };
  }

  /* ========================================================
     Punto de entrada de un turno
     ======================================================== */
  function handle(entrada) {
    turno++;
    const texto = typeof entrada === 'string' ? entrada : entrada.text;
    const payload = typeof entrada === 'string' ? null : entrada.payload;

    const trace = {
      turno,
      entrada: texto,
      payload,
      triage: null,
      intencion: null,
      confianza: 0,
      fase_antes: st.fase,
      fase_despues: null,
      guardrails: [],
      tools: [],
      escalamiento: null,
      slots: null
    };

    st.historial.push({ rol: 'paciente', texto });

    // ---- PASO 1 · TRIAGE DETERMINISTA PRE-LLM ----
    const tri = triage(texto, payload);
    trace.triage = tri;
    if (tri.disparo) {
      trace.guardrails.push({ nombre: 'triage_pre_llm', resultado: 'disparó', detalle: tri.tipo });
      const r = manejarTriage(tri, trace);
      return finalizar(r, trace);
    }
    trace.guardrails.push({ nombre: 'triage_pre_llm', resultado: 'sin disparo' });

    // ---- PASO 3 · GUARDRAILS DE ENTRADA ----
    const pii = detectarPII(texto);
    trace.guardrails.push({
      nombre: 'pii_scrubbing',
      resultado: pii.encontrados.length ? `enmascarados: ${pii.encontrados.join(', ')}` : 'sin PII detectada',
      texto_saneado: pii.texto
    });

    // ---- PASO 4 · INTERPRETACIÓN (aquí iría el LLM) ----
    const nlu = interpretar(texto, payload);
    trace.intencion = nlu.intencion;
    trace.confianza = nlu.confianza;

    // ---- PASO 5-7 · Enrutamiento por fase + herramientas ----
    const r = enrutar(nlu, texto, payload, trace);
    return finalizar(r, trace);
  }

  function finalizar(respuesta, trace) {
    trace.fase_despues = st.fase;
    trace.slots = { ...st.slots, consentimiento: st.consentimiento, screening: st.screening.estado };
    const mensajes = Array.isArray(respuesta) ? respuesta : [respuesta];
    for (const m of mensajes) if (m && m.text) st.historial.push({ rol: 'agente', texto: m.text });

    // Guardrail de salida: nada de interpretación clínica
    for (const m of mensajes) {
      if (m && m.text && /probablemente (tienes|sea)|tu resultado (indica|muestra)|es benigno|es maligno/i.test(m.text)) {
        trace.guardrails.push({ nombre: 'filtro_anti_diagnostico', resultado: 'BLOQUEÓ respuesta' });
        return { mensajes: [{ text: 'Prefiero que un miembro del equipo te ayude con eso. Te comunico ahora mismo.' }], trace, crm: snapshotCRM() };
      }
    }
    trace.guardrails.push({ nombre: 'filtro_anti_diagnostico', resultado: 'limpio' });
    trace.guardrails.push({ nombre: 'anclaje_a_herramientas', resultado: verificarAnclaje(mensajes, trace) });

    return { mensajes, trace, crm: snapshotCRM() };
  }

  /* ========================================================
     PASO 1 · Triage determinista (nunca llega al modelo)
     ======================================================== */
  function triage(texto, payload) {
    const t = normalizar(texto);
    if (!t && !payload) return { disparo: true, tipo: 'vacio' };
    if (contiene(t, TERMINOS_EMERGENCIA))     return { disparo: true, tipo: 'emergencia' };
    if (contiene(t, TERMINOS_HUMANO))         return { disparo: true, tipo: 'pedir_humano' };
    if (contiene(t, TERMINOS_INTERPRETACION)) return { disparo: true, tipo: 'interpretar_resultado' };
    if (contiene(t, TERMINOS_RECLAMO))        return { disparo: true, tipo: 'reclamo' };
    if (contiene(t, TERMINOS_INYECCION))      return { disparo: true, tipo: 'inyeccion_prompt' };
    return { disparo: false, tipo: null };
  }

  function manejarTriage(tri, trace) {
    switch (tri.tipo) {
      case 'emergencia': {
        st.labels.add('urgente');
        const esc = callTool('escalar_humano', {
          motivo: 'emergencia', prioridad: 'urgent', equipo: 'general',
          resumen: 'Posible emergencia médica detectada por triage determinista. No se procesó con el modelo.',
          datos_recolectados: { ...st.slots }
        }, trace);
        st.fase = 'escalado'; st.escalado = true;
        trace.escalamiento = esc;
        return [{
          text: '⚠ Si estás presentando una emergencia médica, no esperes por este chat. Llama al *911* o acude al cuarto de urgencias más cercano de inmediato.',
          critico: true
        }, {
          text: 'Te estoy comunicando con una persona de nuestro equipo ahora mismo.'
        }];
      }
      case 'pedir_humano': {
        const esc = callTool('escalar_humano', {
          motivo: 'peticion_paciente', prioridad: 'high', equipo: equipoSegunContexto(),
          resumen: resumenParaHumano('El paciente pidió hablar con una persona.'),
          datos_recolectados: { ...st.slots }
        }, trace);
        st.fase = 'escalado'; st.escalado = true; st.labels.add('escalado-humano');
        trace.escalamiento = esc;
        return [{ text: mensajeHandoff() }];
      }
      case 'interpretar_resultado': {
        st.labels.add('resultados');
        const esc = callTool('escalar_humano', {
          motivo: 'fuera_de_alcance', prioridad: 'medium', equipo: 'general',
          resumen: 'El paciente pidió interpretación de un resultado. Política: solo el médico tratante interpreta.',
          datos_recolectados: { ...st.slots }
        }, trace);
        st.fase = 'escalado'; st.escalado = true;
        trace.escalamiento = esc;
        return [{
          text: 'No puedo interpretar estudios ni informes: solo tu médico tratante puede hacerlo, porque conoce tu historia clínica completa.'
        }, {
          text: 'Lo que sí puedo hacer es darte una copia de tu informe o comunicarte con nuestro equipo. Ya le avisé a una persona para que te atienda.'
        }];
      }
      case 'reclamo': {
        const esc = callTool('escalar_humano', {
          motivo: 'reclamo', prioridad: 'high', equipo: 'general',
          resumen: resumenParaHumano('Paciente expresó insatisfacción o reclamo. Atender con prioridad.'),
          datos_recolectados: { ...st.slots }
        }, trace);
        st.fase = 'escalado'; st.escalado = true; st.labels.add('escalado-humano');
        trace.escalamiento = esc;
        return [{ text: 'Lamento mucho la experiencia. Esto lo debe ver una persona del equipo, no yo.' },
                { text: 'Te estoy transfiriendo con un asesor con prioridad alta. ' + expectativaTiempo() }];
      }
      case 'inyeccion_prompt': {
        /* Un intento aislado se neutraliza y se reconduce: escalar
           cada uno inundaría la cola y le daría al atacante lo que
           busca, la atención de una persona. La insistencia sí. */
        st.inyecciones = (st.inyecciones || 0) + 1;
        st.labels.add('intento-inyeccion');
        trace.guardrails.push({ nombre: 'anti_inyeccion', resultado: `intento neutralizado (${st.inyecciones})` });
        if (st.inyecciones >= 3) {
          const esc = callTool('escalar_humano', {
            motivo: 'abuso', prioridad: 'medium', equipo: 'general',
            resumen: 'Tercer intento de manipular las instrucciones del agente en la misma conversación.'
          }, trace);
          st.fase = 'escalado'; st.escalado = true;
          trace.escalamiento = esc;
          return [{ text: 'Prefiero que continúes con una persona del equipo. Ya le avisé.' }];
        }
        return [{
          text: 'Soy Sofía, la asistente virtual de Open Side 🤖 Solo puedo ayudarte con citas, precios, preparaciones y resultados. ¿Con cuál de esos te ayudo?',
          buttons: [
            { label: 'Agendar cita', payload: 'agendar' },
            { label: 'Ver precios', payload: 'cotizar' },
            { label: 'Hablar con asesor', payload: 'humano' }
          ]
        }];
      }
      default:
        return [{ text: 'No recibí texto. ¿Me cuentas en qué te ayudo?' }];
    }
  }

  /* ========================================================
     PASO 4 · Interpretación (reemplazable por el LLM)
     ======================================================== */
  function interpretar(texto, payload) {
    const t = normalizar(texto);

    if (payload) {
      const mapa = {
        agendar: 'agendar_cita', cotizar: 'cotizar', preparacion: 'preparacion',
        seguro: 'seguro', resultados: 'resultados', humano: 'pedir_humano',
        ubicacion: 'ubicacion_horario'
      };
      if (mapa[payload]) return { intencion: mapa[payload], confianza: 1.0, via: 'payload' };
      return { intencion: 'respuesta_estructurada', confianza: 1.0, via: 'payload' };
    }

    // Si hay un flujo abierto, la respuesta pertenece a ese flujo
    if (st.screening.activo)             return { intencion: 'respuesta_screening', confianza: .95, via: 'estado' };
    if (st.fase === 'consentimiento')    return { intencion: 'respuesta_consentimiento', confianza: .95, via: 'estado' };
    if (st.fase === 'datos_paciente')    return { intencion: 'respuesta_datos', confianza: .9, via: 'estado' };
    if (st.fase === 'cupos')             return { intencion: 'respuesta_cupo', confianza: .85, via: 'estado' };

    const reglas = [
      { i: 'saludo',            re: /^(hola|buenas|buenos dias|buenas tardes|buenas noches|hey|hi|saludos)\b/, c: .96 },
      { i: 'agendar_cita',      re: /\b(agendar|agenda|cita|reservar|sacar|separar|programar|quiero una|necesito una|hacerme)\b/, c: .9 },
      { i: 'cotizar',           re: /\b(cuanto|costo|precio|vale|valor|cotizar|cotizacion|tarifa)\b/, c: .93 },
      { i: 'seguro',            re: /\b(seguro|aseguradora|poliza|assa|palig|mapfre|internacional|cobertura|cubre|autorizacion)\b/, c: .9 },
      { i: 'preparacion',       re: /\b(preparacion|preparar|ayuno|ayunas|comer|antes del estudio|que llevo|que traigo|contraste)\b/, c: .88 },
      { i: 'ubicacion_horario', re: /\b(donde|direccion|ubicacion|horario|a que hora|abren|cierran|sede|sucursal|llegar)\b/, c: .9 },
      { i: 'resultados',        re: /\b(resultado|resultados|informe|entrega|listo|ya estan|descargar)\b/, c: .9 },
      { i: 'reprogramar',       re: /\b(cambiar|reprogramar|mover|posponer|otro dia|otra fecha)\b/, c: .87 },
      { i: 'cancelar',          re: /\b(cancelar|anular|ya no puedo|dar de baja)\b/, c: .9 }
    ];
    for (const r of reglas) if (r.re.test(t)) return { intencion: r.i, confianza: r.c, via: 'reglas' };

    if (buscarEstudio(texto)) return { intencion: 'agendar_cita', confianza: .72, via: 'catalogo' };
    if (/^(si|sí|ok|dale|claro|correcto|va)\b/.test(t)) return { intencion: 'afirmacion', confianza: .8, via: 'reglas' };
    if (/^(no|nop|negativo)\b/.test(t)) return { intencion: 'negacion', confianza: .8, via: 'reglas' };
    if (/\bgracias\b/.test(t)) return { intencion: 'agradecimiento', confianza: .9, via: 'reglas' };

    return { intencion: 'desconocido', confianza: .28, via: 'reglas' };
  }

  /* ========================================================
     PASO 5-7 · Enrutamiento
     ======================================================== */
  function enrutar(nlu, texto, payload, trace) {
    const i = nlu.intencion;

    // Baja confianza sostenida -> escalar
    if (i === 'desconocido') {
      st.sinEntender++;
      if (st.sinEntender >= 2) {
        const esc = callTool('escalar_humano', {
          motivo: 'baja_confianza', prioridad: 'medium', equipo: equipoSegunContexto(),
          resumen: resumenParaHumano('El agente no comprendió al paciente en dos turnos consecutivos.'),
          datos_recolectados: { ...st.slots }
        }, trace);
        st.fase = 'escalado'; st.escalado = true; st.labels.add('escalado-humano');
        trace.escalamiento = esc;
        return [{ text: 'Prefiero no hacerte perder tiempo adivinando. Te comunico con una persona del equipo. ' + expectativaTiempo() }];
      }
      return [{
        text: 'No estoy segura de haberte entendido. ¿Cuál de estas opciones se acerca?',
        buttons: [
          { label: 'Agendar cita', payload: 'agendar' },
          { label: 'Precios', payload: 'cotizar' },
          { label: 'Hablar con asesor', payload: 'humano' }
        ]
      }];
    }
    st.sinEntender = 0;

    switch (i) {
      case 'saludo':                    return saludar();
      case 'agendar_cita':              return flujoAgendar(texto, trace);
      case 'cotizar':                   return flujoCotizar(texto, trace);
      case 'seguro':                    return flujoSeguro(texto, trace);
      case 'preparacion':               return flujoPreparacion(texto, trace);
      case 'ubicacion_horario':         return flujoSedes(trace);
      case 'resultados':                return flujoResultados(texto, trace);
      case 'reprogramar':
      case 'cancelar':                  return flujoModificar(i, trace);
      case 'respuesta_consentimiento':  return manejarConsentimiento(texto, payload, trace);
      case 'respuesta_screening':       return manejarScreening(texto, payload, trace);
      case 'respuesta_datos':           return manejarDatos(texto, trace);
      case 'respuesta_cupo':            return manejarCupo(texto, payload, trace);
      case 'respuesta_estructurada':    return manejarPayload(payload, texto, trace);
      case 'afirmacion':                return manejarAfirmacion(trace);
      case 'negacion':                  return [{ text: 'Entendido. ¿Hay algo más en que te pueda ayudar?' }];
      case 'agradecimiento':            return [{ text: '¡Con gusto! Si necesitas algo más, aquí estoy. 📍 ' + HORARIO.texto }];
      default:                          return [{ text: '¿En qué te ayudo?' }];
    }
  }

  /* ---------------- Saludo ---------------- */
  function saludar() {
    st.saludado = true;
    st.fase = 'descubrimiento';
    return [{
      text: 'Hola, soy *Sofía*, la asistente virtual de Open Side 🤖\nTe ayudo a agendar estudios, consultar precios y preparaciones.\n\nEn cualquier momento escribe *asesor* para hablar con una persona.',
      buttons: [
        { label: 'Agendar cita', payload: 'agendar' },
        { label: 'Precios', payload: 'cotizar' },
        { label: 'Resultados', payload: 'resultados' }
      ]
    }];
  }

  function prefijoSaludo() {
    if (st.saludado) return '';
    st.saludado = true;
    return 'Hola, soy *Sofía*, la asistente virtual de Open Side 🤖\n\n';
  }

  /* ---------------- Agendar ---------------- */
  function flujoAgendar(texto, trace) {
    st.labels.add('agendamiento');
    const e = buscarEstudio(texto) || st.slots.estudio;
    if (!e) {
      st.fase = 'descubrimiento';
      return [{
        text: prefijoSaludo() + '¡Con gusto te agendo! ¿Qué estudio necesitas?',
        buttons: [
          { label: 'Resonancia', payload: 'mod:RM' },
          { label: 'Tomografía', payload: 'mod:TC' },
          { label: 'No sé / tengo orden', payload: 'orden' }
        ]
      }];
    }
    st.slots.estudio = e;
    if (/contraste/.test(normalizar(texto))) st.slots.con_contraste = true;

    if (!st.consentimiento) return pedirConsentimiento(e);
    return siguientePasoAgenda(trace);
  }

  function pedirConsentimiento(e) {
    st.fase = 'consentimiento';
    return [{
      text: `Perfecto: *${e.nombre}*.\n\n${TEXTO_CONSENTIMIENTO}`,
      buttons: [
        { label: 'Sí, autorizo', payload: 'consent:si' },
        { label: 'No', payload: 'consent:no' },
        { label: 'Más información', payload: 'consent:info' }
      ],
      legal: true
    }];
  }

  function manejarConsentimiento(texto, payload, trace) {
    const t = normalizar(texto);
    const si = payload === 'consent:si' || /^(si|sí|autorizo|acepto|dale|ok|claro)\b/.test(t);
    const no = payload === 'consent:no' || /^(no|niego|rechazo)\b/.test(t);
    const info = payload === 'consent:info' || /informacion|mas info|por que|para que/.test(t);

    if (info) {
      return [{
        text: 'Usamos tus datos solo para agendar y realizar tu estudio, y para verificar seguridad antes de una resonancia. No los compartimos con terceros sin tu autorización.\n\nBase legal: Ley 81 de 2019 de Panamá.',
        buttons: [
          { label: 'Sí, autorizo', payload: 'consent:si' },
          { label: 'No', payload: 'consent:no' }
        ]
      }];
    }
    if (no) {
      st.fase = 'descubrimiento';
      return [{
        text: `Sin problema, no registro ningún dato. Puedes agendar por teléfono:\n📍 ${SEDES['75E'].telefonos.join(' / ')} (Calle 75E)\n📍 ${SEDES['76E'].telefonos.join(' / ')} (Calle 76E)\n\n${HORARIO.texto}`
      }];
    }
    if (si) {
      const res = callTool('registrar_consentimiento', { otorgado: true, texto_mostrado: TEXTO_CONSENTIMIENTO, canal: 'whatsapp' }, trace);
      st.consentimiento = true;
      st.consentimientoTs = res.timestamp;
      return siguientePasoAgenda(trace);
    }
    return [{
      text: 'Necesito un sí o un no para continuar. ¿Me autorizas a registrar tus datos?',
      buttons: [
        { label: 'Sí, autorizo', payload: 'consent:si' },
        { label: 'No', payload: 'consent:no' }
      ]
    }];
  }

  function siguientePasoAgenda(trace) {
    const e = st.slots.estudio;
    if (!e) { st.fase = 'descubrimiento'; return [{ text: '¿Qué estudio necesitas agendar?' }]; }

    // Resonancia: screening de seguridad obligatorio antes de ofrecer cupos
    if (e.modalidad === 'RM' && st.screening.estado !== 'aprobado') {
      return iniciarScreening();
    }
    if (!st.cupos.length) return ofrecerCupos(trace);
    return [{ text: 'Elige uno de los horarios disponibles.' }];
  }

  /* ---------------- Screening RM ---------------- */
  function iniciarScreening() {
    st.fase = 'screening';
    st.screening.activo = true;
    st.screening.idx = 0;
    const p = SCREENING_RM[0];
    return [{
      text: 'Antes de agendar una resonancia debo hacerte unas preguntas rápidas de seguridad. Son sí o no, y no toman más de un minuto.',
    }, {
      text: `1/${SCREENING_RM.length} · ${p.pregunta}`,
      buttons: [
        { label: 'No', payload: 'scr:no' },
        { label: 'Sí', payload: 'scr:si' },
        { label: 'No sé', payload: 'scr:duda' }
      ]
    }];
  }

  function manejarScreening(texto, payload, trace) {
    const t = normalizar(texto);
    const p = SCREENING_RM[st.screening.idx];
    let valor;
    if (payload === 'scr:si' || /^(si|sí|tengo|claro|afirmativo)\b/.test(t)) valor = true;
    else if (payload === 'scr:no' || /^(no|nop|ninguno|negativo)\b/.test(t)) valor = false;
    else if (payload === 'scr:duda' || /no se|no sé|creo que|tal vez|quiza|quizá/.test(t)) valor = 'duda';
    else {
      return [{
        text: `Necesito una respuesta clara para tu seguridad.\n\n${p.pregunta}`,
        buttons: [
          { label: 'No', payload: 'scr:no' },
          { label: 'Sí', payload: 'scr:si' },
          { label: 'No sé', payload: 'scr:duda' }
        ]
      }];
    }

    // Una duda en un punto bloqueante se trata como revisión humana
    if (valor === 'duda') {
      st.screening.respuestas[p.key] = false;
      st.screening.dudas = (st.screening.dudas || []).concat(p.pregunta);
    } else {
      st.screening.respuestas[p.key] = valor;
    }

    st.screening.idx++;
    if (st.screening.idx < SCREENING_RM.length) {
      const sig = SCREENING_RM[st.screening.idx];
      return [{
        text: `${st.screening.idx + 1}/${SCREENING_RM.length} · ${sig.pregunta}`,
        buttons: [
          { label: 'No', payload: 'scr:no' },
          { label: 'Sí', payload: 'scr:si' },
          { label: 'No sé', payload: 'scr:duda' }
        ]
      }];
    }

    // Evaluación determinista
    st.screening.activo = false;
    const entrada = {
      ...st.screening.respuestas,
      requiere_contraste: st.slots.con_contraste === true || (st.slots.estudio && st.slots.estudio.contrasteFrecuente)
    };
    const res = callTool('screening_rm', entrada, trace);
    st.screening.estado = res.estado;

    if (res.estado === 'bloqueado' || res.estado === 'requiere_revision' || (st.screening.dudas && st.screening.dudas.length)) {
      const motivo = res.estado === 'bloqueado' ? 'screening_no_aprobado' : 'screening_no_aprobado';
      st.labels.add('screening-bloqueado');
      const esc = callTool('escalar_humano', {
        motivo, prioridad: 'high', equipo: 'tecnologia_rm',
        resumen: resumenParaHumano(
          `Screening de RM: ${res.estado}. Motivos: ${[...res.motivos, ...(st.screening.dudas || []).map(d => 'Duda: ' + d)].join('; ') || 'ninguno registrado'}.`
        ),
        datos_recolectados: { ...st.slots, screening: st.screening.respuestas }
      }, trace);
      st.fase = 'escalado'; st.escalado = true;
      trace.escalamiento = esc;
      const detalle = res.motivos.length ? `\n\nMotivo: ${res.motivos.join(', ')}.` : '';
      return [{
        text: `Gracias. Por lo que me indicas, tu caso necesita la evaluación de nuestro tecnólogo antes de agendar la resonancia.${detalle}`,
      }, {
        text: 'No es un "no": en muchos casos hay alternativas o se puede realizar con precauciones. Ya te estoy comunicando con el equipo de resonancia. ' + expectativaTiempo()
      }];
    }

    const notas = res.notas.length ? `\n\n${res.notas[0]}` : '';
    return [{ text: `Listo, el screening de seguridad salió bien ✅${notas}` }, ...ofrecerCupos(trace)];
  }

  /* ---------------- Cupos ---------------- */
  function ofrecerCupos(trace) {
    const e = st.slots.estudio;
    if (!e) return [{ text: '¿Qué estudio necesitas?' }];
    const res = callTool('buscar_cupos', {
      estudio_id: e.id,
      sede: st.slots.sede || 'cualquiera',
      desde: new Date().toISOString().slice(0, 10),
      limite: 3
    }, trace);

    if (!res.ok || !res.cupos.length) {
      const esc = callTool('escalar_humano', {
        motivo: 'fallo_herramienta', prioridad: 'medium', equipo: 'agenda',
        resumen: resumenParaHumano('No se obtuvieron cupos de la agenda.'),
        datos_recolectados: { ...st.slots }
      }, trace);
      st.fase = 'escalado'; st.escalado = true;
      trace.escalamiento = esc;
      return [{ text: 'Tuve un problema consultando la agenda. Te comunico con una persona para que te dé horarios. ' + expectativaTiempo() }];
    }

    st.cupos = res.cupos;
    st.fase = 'cupos';
    const lista = res.cupos.map((c, n) =>
      `${n + 1}. ${c.etiqueta}\n    📍 ${c.sede_nombre}`
    ).join('\n');

    return [{
      text: `Tengo estos horarios para *${e.nombre}* (${e.duracion} min):\n\n${lista}\n\n¿Cuál te sirve?`,
      buttons: res.cupos.slice(0, 3).map((c, n) => ({
        label: formatoCorto(new Date(c.inicio)),
        payload: `cupo:${c.cupo_id}`
      }))
    }];
  }

  function manejarCupo(texto, payload, trace) {
    let cupo = null;
    if (payload && payload.startsWith('cupo:')) {
      cupo = st.cupos.find(c => c.cupo_id === payload.slice(5));
    } else {
      const t = normalizar(texto);
      const m = t.match(/\b([123])\b/);
      if (m) cupo = st.cupos[parseInt(m[1], 10) - 1];
      if (!cupo) cupo = st.cupos.find(c => t.includes(normalizar(c.etiqueta.split(',')[0])));
    }
    if (!cupo) {
      return [{
        text: 'No identifiqué el horario. Elige uno de estos:',
        buttons: st.cupos.slice(0, 3).map(c => ({ label: formatoCorto(new Date(c.inicio)), payload: `cupo:${c.cupo_id}` }))
      }];
    }
    st.cupoElegido = cupo;
    st.slots.sede = cupo.sede;
    st.fase = 'datos_paciente';
    return [{
      text: `Reservado provisionalmente: *${cupo.etiqueta}* en ${cupo.sede_nombre}.\n\nPara confirmar necesito tu *nombre completo* y *cédula*. Puedes enviarlos en un solo mensaje.`
    }];
  }

  /* ---------------- Datos del paciente ---------------- */
  function manejarDatos(texto, trace) {
    const ced = texto.match(/\b(\d{1,2}-\d{3,4}-\d{3,5}|[EeNn]-\d{1,2}-\d{3,5}|PE-\d{3,5}-\d{3,5})\b/);
    if (ced) st.slots.cedula = ced[1];
    const sinCedula = texto.replace(ced ? ced[0] : '', '').replace(/[,;]/g, ' ').trim();
    const posibleNombre = sinCedula.split(/\s+/).filter(w => /^[A-Za-zÁÉÍÓÚÑáéíóúñ'.-]{2,}$/.test(w));
    if (posibleNombre.length >= 2) st.slots.nombre = posibleNombre.slice(0, 4).join(' ');

    if (!st.slots.nombre) return [{ text: 'Me falta tu *nombre completo*. ¿Cómo te llamas?' }];
    if (!st.slots.cedula) return [{ text: `Gracias, ${st.slots.nombre.split(' ')[0]}. Ahora tu *cédula* (formato 8-123-4567).` }];

    return confirmarCita(trace);
  }

  function confirmarCita(trace) {
    const e = st.slots.estudio;
    const cot = callTool('cotizar_estudio', {
      estudio_id: e.id,
      con_contraste: st.slots.con_contraste === true,
      tipo_paciente: st.slots.aseguradora ? 'asegurado' : 'privado'
    }, trace);
    st.cotizacion = cot;

    const res = callTool('agendar_cita', {
      cupo_id: st.cupoElegido.cupo_id,
      estudio_id: e.id,
      paciente: { nombre: st.slots.nombre, cedula: st.slots.cedula, telefono: st.slots.telefono || '—' },
      aseguradora: st.slots.aseguradora ? st.slots.aseguradora.nombre : 'Privado',
      idempotency_key: `conv-${turno}-${st.cupoElegido.cupo_id}`,
      _contexto: { consentimiento: st.consentimiento, screening_estado: st.screening.estado }
    }, trace);

    if (!res.ok) {
      if (res.bloqueo === 'guardrail') {
        trace.guardrails.push({ nombre: 'precondicion_agendar', resultado: 'BLOQUEÓ · ' + res.error });
      }
      if (res.error === 'CUPO_NO_VIGENTE') {
        st.cupos = [];
        return [{ text: 'Ese horario acaba de ocuparse. Te busco opciones nuevas.' }, ...ofrecerCupos(trace)];
      }
      const esc = callTool('escalar_humano', {
        motivo: 'fallo_herramienta', prioridad: 'medium', equipo: 'agenda',
        resumen: resumenParaHumano('Falló la creación de la cita: ' + res.error),
        datos_recolectados: { ...st.slots }
      }, trace);
      st.fase = 'escalado'; st.escalado = true; trace.escalamiento = esc;
      return [{ text: 'No pude completar la reserva. Te comunico con una persona para asegurarnos de que quede bien. ' + expectativaTiempo() }];
    }

    st.cita = res;
    st.fase = 'cierre';
    st.labels.add('resuelto-por-bot');

    const prep = callTool('consultar_preparacion', {
      estudio_id: e.id,
      con_contraste: st.slots.con_contraste === true
    }, trace);

    const pasos = prep.ok ? prep.pasos.slice(0, 4).map(p => `• ${p}`).join('\n') : '';

    return [{
      text: `¡Listo! Tu cita quedó confirmada ✅`,
      card: {
        cita_id: res.cita_id,
        estudio: res.estudio,
        fecha: res.etiqueta,
        sede: res.sede_nombre,
        direccion: res.direccion,
        precio: `US$${cot.ok ? cot.total : '—'} (referencial)`
      }
    }, {
      text: `*Preparación:*\n${pasos}`
    }, {
      text: 'Te enviaré un recordatorio 24 horas antes. Si necesitas cambiarla, escríbeme *reprogramar*. ¿Algo más?'
    }];
  }

  /* ---------------- Cotizar ---------------- */
  function flujoCotizar(texto, trace) {
    st.labels.add('cotizacion');
    const e = buscarEstudio(texto) || st.slots.estudio;
    if (!e) {
      return [{
        text: prefijoSaludo() + '¿De qué estudio quieres el precio?',
        buttons: [
          { label: 'Resonancia', payload: 'mod:RM' },
          { label: 'Tomografía', payload: 'mod:TC' },
          { label: 'Hablar con asesor', payload: 'humano' }
        ]
      }];
    }
    st.slots.estudio = e;
    const conContraste = /contraste/.test(normalizar(texto));
    if (conContraste) st.slots.con_contraste = true;

    const res = callTool('cotizar_estudio', {
      estudio_id: e.id,
      con_contraste: conContraste,
      tipo_paciente: st.slots.aseguradora ? 'asegurado' : 'privado'
    }, trace);

    if (!res.ok) {
      return [{ text: 'No tengo el precio de ese estudio a mano. Te comunico con una persona del equipo.' }];
    }
    st.cotizacion = res;

    const extra = conContraste
      ? `\n(incluye US$${res.recargo_contraste} de medio de contraste)`
      : e.contrasteFrecuente ? '\n\nEste estudio a veces requiere contraste; si tu médico lo indica hay un costo adicional.' : '';

    return [{
      text: `${prefijoSaludo()}*${res.estudio}*\nPrecio paciente privado: *US$${res.total}*${extra}\nDuración aproximada: ${res.duracion_min} minutos.\n\n¿Te agendo?`,
      buttons: [
        { label: 'Sí, agendar', payload: 'agendar' },
        { label: 'Tengo seguro', payload: 'seguro' },
        { label: 'Preparación', payload: 'preparacion' }
      ]
    }];
  }

  /* ---------------- Seguro ---------------- */
  function flujoSeguro(texto, trace) {
    st.labels.add('seguro');
    const t = normalizar(texto);
    const a = ASEGURADORAS.find(x => t.includes(normalizar(x.nombre)) || t.includes(x.id));
    if (!a) {
      return [{
        text: prefijoSaludo() + '¿Con cuál aseguradora estás?',
        buttons: ASEGURADORAS.slice(0, 3).map(x => ({ label: x.nombre, payload: `seg:${x.id}` }))
      }];
    }
    st.slots.aseguradora = a;
    st.slots.tipo_paciente = 'asegurado';

    const e = st.slots.estudio;
    const res = callTool('verificar_seguro', { aseguradora: a.id, estudio_id: e ? e.id : null }, trace);

    if (!res.convenio || res.requiere_revision_humana) {
      const esc = callTool('escalar_humano', {
        motivo: 'seguro_complejo', prioridad: 'medium', equipo: 'seguros',
        resumen: resumenParaHumano(`Consulta de cobertura con ${a.nombre}: requiere verificación humana.`),
        datos_recolectados: { ...st.slots, aseguradora: a.nombre }
      }, trace);
      st.fase = 'escalado'; st.escalado = true; trace.escalamiento = esc;
      return [{ text: `Déjame verificarlo con el equipo de convenios para no darte información incorrecta. Te comunico ahora. ${expectativaTiempo()}` }];
    }

    const autoriz = res.autorizacion_previa
      ? '\n\n⚠ Tu aseguradora requiere *autorización previa*: pídela antes de la cita con tu orden médica.'
      : '';
    return [{
      text: `Sí, tenemos convenio con *${res.aseguradora}*.\nCoaseguro típico: ${res.coaseguro_tipico || 'según tu póliza'}.${autoriz}\n\n¿Te agendo la cita?`,
      buttons: [
        { label: 'Sí, agendar', payload: 'agendar' },
        { label: 'Ver precio privado', payload: 'cotizar' },
        { label: 'Hablar con asesor', payload: 'humano' }
      ]
    }];
  }

  /* ---------------- Preparación ---------------- */
  function flujoPreparacion(texto, trace) {
    st.labels.add('preparacion');
    const e = buscarEstudio(texto) || st.slots.estudio;
    if (!e) {
      return [{
        text: prefijoSaludo() + '¿Para qué estudio necesitas la preparación?',
        buttons: [
          { label: 'Resonancia', payload: 'mod:RM' },
          { label: 'Tomografía', payload: 'mod:TC' }
        ]
      }];
    }
    st.slots.estudio = e;
    const res = callTool('consultar_preparacion', { estudio_id: e.id, con_contraste: st.slots.con_contraste === true }, trace);
    if (!res.ok) return [{ text: 'No tengo esa preparación registrada. Te comunico con el equipo.' }];

    const ayuno = res.requiere_ayuno ? '⚠ *Requiere ayuno*\n\n' : '';
    return [{
      text: `${prefijoSaludo()}*Preparación · ${res.estudio}*\n\n${ayuno}${res.pasos.map(p => `• ${p}`).join('\n')}`,
      buttons: [
        { label: 'Agendar cita', payload: 'agendar' },
        { label: 'Ver precio', payload: 'cotizar' }
      ]
    }];
  }

  /* ---------------- Sedes ---------------- */
  function flujoSedes(trace) {
    const res = callTool('consultar_sedes', {}, trace);
    const txt = res.sedes.map(s => `📍 *${s.nombre}*\n${s.direccion}\nTel: ${s.telefonos.join(' / ')}`).join('\n\n');
    return [{
      text: `${prefijoSaludo()}${txt}\n\n🗓 ${HORARIO.texto}`,
      buttons: [
        { label: 'Agendar cita', payload: 'agendar' },
        { label: 'Hablar con asesor', payload: 'humano' }
      ]
    }];
  }

  /* ---------------- Resultados ---------------- */
  function flujoResultados(texto, trace) {
    st.labels.add('resultados');
    const ced = texto.match(/\b\d{1,2}-\d{3,4}-\d{3,5}\b/);
    if (!ced && !st.slots.cedula) {
      return [{ text: prefijoSaludo() + 'Con gusto lo reviso. ¿Me compartes tu *cédula* (formato 8-123-4567)?' }];
    }
    const cedula = ced ? ced[0] : st.slots.cedula;
    st.slots.cedula = cedula;
    const res = callTool('estado_resultados', { cedula }, trace);

    if (res.listo) {
      return [{
        text: `Tu informe ya está firmado por el radiólogo ✅\nPuedes descargarlo en el portal:\n${res.url_portal}\n\nPor seguridad nunca enviamos el informe por chat.`
      }];
    }
    return [{
      text: `Tu estudio aún está en lectura. El tiempo habitual es de *24 a 48 horas hábiles*.\n\nTe aviso por aquí apenas esté listo.`,
      buttons: [{ label: 'Hablar con asesor', payload: 'humano' }]
    }];
  }

  /* ---------------- Modificar cita ---------------- */
  function flujoModificar(tipo, trace) {
    st.labels.add('agendamiento');
    const esc = callTool('escalar_humano', {
      motivo: 'peticion_paciente', prioridad: 'medium', equipo: 'agenda',
      resumen: resumenParaHumano(`El paciente quiere ${tipo === 'cancelar' ? 'cancelar' : 'reprogramar'} una cita existente.`),
      datos_recolectados: { ...st.slots, cita: st.cita ? st.cita.cita_id : null }
    }, trace);
    st.fase = 'escalado'; st.escalado = true; trace.escalamiento = esc;
    return [{
      text: `Para ${tipo === 'cancelar' ? 'cancelar' : 'reprogramar'} tu cita necesito verificarla con el equipo de agenda. Te comunico ahora. ${expectativaTiempo()}`
    }];
  }

  /* ---------------- Payloads estructurados ---------------- */
  function manejarPayload(payload, texto, trace) {
    if (payload.startsWith('mod:')) {
      const modalidad = payload.slice(4);
      const ejemplos = modalidad === 'RM'
        ? 'cerebro, columna lumbar, rodilla, hombro, abdomen, mama, próstata'
        : 'cerebro, tórax, abdomen, senos paranasales, columna';
      return [{ text: `¿De qué zona? Por ejemplo: ${ejemplos}.` }];
    }
    if (payload.startsWith('seg:')) {
      const a = ASEGURADORAS.find(x => x.id === payload.slice(4));
      return flujoSeguro(a ? a.nombre : texto, trace);
    }
    if (payload.startsWith('cupo:')) return manejarCupo(texto, payload, trace);
    if (payload.startsWith('consent:')) return manejarConsentimiento(texto, payload, trace);
    if (payload.startsWith('scr:')) return manejarScreening(texto, payload, trace);
    if (payload === 'orden') {
      return [{ text: 'Sin problema. Escríbeme el nombre del estudio tal como aparece en tu orden médica y lo busco.' }];
    }
    return [{ text: '¿En qué te ayudo?' }];
  }

  function manejarAfirmacion(trace) {
    if (st.fase === 'cierre') return [{ text: 'Perfecto. ¿Qué más necesitas?' }];
    if (st.slots.estudio && !st.cita) return siguientePasoAgenda(trace);
    return [{ text: '¿Me confirmas qué estudio necesitas?' }];
  }

  /* ========================================================
     Utilidades internas
     ======================================================== */
  function callTool(nombre, args, trace) {
    const t0 = performance.now ? performance.now() : Date.now();
    const fn = TOOLS[nombre];
    if (!fn) {
      trace.tools.push({ nombre, args, resultado: { ok: false, error: 'TOOL_NO_DISPONIBLE' }, latencia: 0 });
      return { ok: false, error: 'TOOL_NO_DISPONIBLE' };
    }
    const res = fn(args);
    const real = Math.round((performance.now ? performance.now() : Date.now()) - t0);
    trace.tools.push({
      nombre, args: limpiar(args), resultado: limpiar(res),
      latencia: res._latencia != null ? res._latencia : real
    });
    return res;
  }

  function limpiar(o) {
    if (o == null || typeof o !== 'object') return o;
    const c = Array.isArray(o) ? [...o] : { ...o };
    delete c._latencia; delete c._contexto;
    return c;
  }

  function verificarAnclaje(mensajes, trace) {
    const texto = mensajes.map(m => m && m.text || '').join(' ');
    const afirmaPrecio = /US\$\s?\d/.test(texto);
    const afirmaCupo = /\b\d{1,2}:\d{2}\s?(a\.m\.|p\.m\.)/.test(texto);
    const tuvoCotizar = trace.tools.some(t => t.nombre === 'cotizar_estudio');
    const tuvoCupos = trace.tools.some(t => ['buscar_cupos', 'agendar_cita'].includes(t.nombre));
    if (afirmaPrecio && !tuvoCotizar) return 'ALERTA · precio sin herramienta';
    if (afirmaCupo && !tuvoCupos) return 'ALERTA · horario sin herramienta';
    return 'ok · toda afirmación transaccional anclada';
  }

  function detectarPII(texto) {
    const encontrados = [];
    let t = texto;
    t = t.replace(/\b\d{1,2}-\d{3,4}-\d{3,5}\b/g, () => { encontrados.push('cedula'); return '[CEDULA_1]'; });
    t = t.replace(/\b(\+?507[\s-]?)?\d{4}[\s-]?\d{4}\b/g, () => { encontrados.push('telefono'); return '[TEL_1]'; });
    t = t.replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, () => { encontrados.push('email'); return '[EMAIL_1]'; });
    return { texto: t, encontrados: [...new Set(encontrados)] };
  }

  function equipoSegunContexto() {
    if (st.screening.estado === 'bloqueado' || st.screening.estado === 'requiere_revision') return 'tecnologia_rm';
    if (st.slots.aseguradora) return 'seguros';
    if (st.slots.estudio) return 'agenda';
    return 'general';
  }

  function expectativaTiempo() {
    return dentroDeHorario()
      ? 'Normalmente responden en pocos minutos.'
      : `Ahora estamos fuera de horario (${HORARIO.texto}). Te responderán al abrir.`;
  }

  function mensajeHandoff() {
    return `Claro, te comunico con una persona del equipo. ${expectativaTiempo()}`;
  }

  function resumenParaHumano(encabezado) {
    const s = st.slots;
    const lineas = [
      encabezado,
      '',
      `Estudio: ${s.estudio ? s.estudio.nombre : '—'}`,
      `Sede: ${s.sede ? SEDES[s.sede].nombre : '—'}`,
      `Aseguradora: ${s.aseguradora ? s.aseguradora.nombre : '—'}`,
      `Paciente: ${s.nombre || '—'} · Cédula: ${s.cedula || '—'}`,
      `Consentimiento: ${st.consentimiento ? 'otorgado ' + (st.consentimientoTs || '') : 'no otorgado'}`,
      `Screening RM: ${st.screening.estado}`,
      `Cita: ${st.cita ? st.cita.cita_id + ' · ' + st.cita.etiqueta : '—'}`,
      `Turnos de conversación: ${turno}`
    ];
    return lineas.join('\n');
  }

  function snapshotCRM() {
    const s = st.slots;
    return {
      status: st.escalado ? 'open' : (st.fase === 'cierre' ? 'resolved' : 'pending'),
      contacto: {
        paciente_nombre: s.nombre,
        paciente_cedula: s.cedula,
        aseguradora: s.aseguradora ? s.aseguradora.nombre : null,
        consentimiento_datos: st.consentimiento,
        consentimiento_ts: st.consentimientoTs
      },
      conversacion: {
        estudio_solicitado: s.estudio ? s.estudio.nombre : null,
        sede_preferida: s.sede,
        requiere_contraste: s.con_contraste,
        screening_rm_estado: st.screening.estado,
        cita_id: st.cita ? st.cita.cita_id : null,
        cita_fecha: st.cita ? st.cita.etiqueta : null,
        // La etiqueta es para leer; la agenda necesita la marca real.
        cita_inicio: st.cita ? st.cita.inicio : null,
        cita_duracion: st.cita ? st.cita.duracion_min : null,
        cita_sede: st.cita ? st.cita.sede : null,
        cita_estudio_id: st.cita ? st.cita.estudio_id : null,
        autorizacion_seguro: s.aseguradora ? (s.aseguradora.autorizacionPrevia ? 'pendiente' : 'no_requiere') : null,
        fase: st.fase
      },
      labels: [...st.labels],
      nota_privada: st.escalado ? resumenParaHumano('Handoff del agente virtual.') : null
    };
  }

  function contiene(t, lista) {
    return lista.some(term => t.includes(normalizar(term)));
  }

  function reset() {
    Object.assign(st, estadoInicial());
    st.labels = new Set();
    turno = 0;
  }

  return { handle, reset, estado: () => st, snapshotCRM };
}
