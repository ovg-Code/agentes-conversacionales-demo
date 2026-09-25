/* ============================================================
   Entrenamiento del agente
   ------------------------------------------------------------
   "Entrenar" aquí NO es reajustar los pesos del modelo. Con un
   modelo de propósito general y herramientas deterministas, casi
   nada de lo que hay que arreglar se arregla con fine-tuning —y
   lo que sí, no compensa: cada versión nueva del modelo obligaría
   a repetirlo, y un modelo afinado sobre datos de pacientes es un
   problema de Ley 81 que nadie quiere firmar.

   Entrenar este agente son tres cosas, y son las tres pestañas:

     Correcciones   lo que el agente hizo mal, marcado por quien
                    atiende, clasificado por DÓNDE se arregla
     Evaluaciones   el banco de casos que dice si sigue bien
     Conocimiento   qué sabe y quién manda sobre cada dato

   El ciclo es: alguien marca una respuesta mala → se clasifica →
   se arregla donde toca → se convierte en caso de evaluación para
   que no vuelva. Eso es lo que hace que un agente mejore.
   ============================================================ */

import { icono } from './iconos.js';
import { CASOS, GRAVEDAD, correrSuite, resumir } from './evals.js';
import { ESTUDIOS, ASEGURADORAS, SEDES, HORARIO } from './kb.js';
import { listarConversaciones } from './bus.js';
import { construir, aJSONL, proyeccion, UMBRALES, anonimizar, FINALIDAD_ENTRENAMIENTO } from './dataset.js';

/* El texto del agente viene con el marcado de WhatsApp (*negrita*).
   Aquí estorba: se cita para leerlo, no para reproducirlo. */
const sinMarcado = t => String(t ?? '').replace(/\*([^*]+)\*/g, '$1');

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ============================================================
   Taxonomía de correcciones
   ------------------------------------------------------------
   Lo importante de esta tabla no es clasificar por clasificar: es
   que cada motivo apunta a un SITIO del código. Una corrección
   que no dice dónde se arregla es una queja.
   ============================================================ */
export const MOTIVOS = {
  dato_incorrecto: {
    nombre: 'Dato incorrecto',
    donde: 'La herramienta o el catálogo',
    detalle: 'Un precio, una duración, una cobertura. El modelo no inventó: le dieron mal el dato. Se corrige en kb.js o en la herramienta, nunca en el prompt.',
    tono: 'danger'
  },
  invento: {
    nombre: 'Se inventó algo',
    donde: 'Falta una precondición',
    detalle: 'Afirmó algo que ninguna herramienta le dijo. No se arregla pidiéndole en el prompt que no invente: se arregla haciendo que el ejecutor rechace lo que no salió de una herramienta.',
    tono: 'danger'
  },
  no_entendio: {
    nombre: 'No entendió',
    donde: 'Faltan alias en la base de conocimiento',
    detalle: 'El paciente lo dijo con sus palabras y el agente no las reconoció. Se añade el alias al estudio correspondiente.',
    tono: 'warn'
  },
  deberia_escalar: {
    nombre: 'Debió pasar a una persona',
    donde: 'La política de escalamiento',
    detalle: 'Siguió intentándolo cuando ya no debía. Se ajusta el triage o el límite de iteraciones.',
    tono: 'warn'
  },
  fuera_de_alcance: {
    nombre: 'Se salió de su alcance',
    donde: 'Un guardrail',
    detalle: 'Rozó un diagnóstico, una indicación médica o un dato que no le toca. Se corta en el guardrail de salida, no en el prompt.',
    tono: 'danger'
  },
  tono: {
    nombre: 'Tono o redacción',
    donde: 'El prompt del sistema',
    detalle: 'El único caso que de verdad se arregla escribiendo mejor el prompt. También el más fácil de sobreestimar.',
    tono: 'muted'
  }
};

/* ============================================================
   Almacén de correcciones
   ============================================================ */
const CLAVE = 'openside:correcciones:v1';

export function listarCorrecciones() {
  try { return JSON.parse(localStorage.getItem(CLAVE) || '[]'); }
  catch { return []; }
}

function guardar(lista) {
  try { localStorage.setItem(CLAVE, JSON.stringify(lista.slice(-200))); }
  catch { /* sin almacenamiento: la demo sigue, sin memoria */ }
}

export function anotarCorreccion({ idConversacion, textoBot, motivo, correccion, autor }) {
  const lista = listarCorrecciones();
  const c = {
    id: 'C-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    fecha: new Date().toISOString(),
    idConversacion: idConversacion || null,
    textoBot: String(textoBot || '').slice(0, 600),
    motivo: MOTIVOS[motivo] ? motivo : 'tono',
    correccion: String(correccion || '').slice(0, 600),
    autor: autor || null,
    estado: 'pendiente'
  };
  lista.push(c);
  guardar(lista);
  return c;
}

export function cambiarEstadoCorreccion(id, estado) {
  const lista = listarCorrecciones();
  const c = lista.find(x => x.id === id);
  if (c) { c.estado = estado; guardar(lista); }
  return c;
}

/** Cuántas hay por motivo: dice dónde está doliendo el sistema. */
export function porMotivo(lista = listarCorrecciones()) {
  const cuenta = {};
  for (const c of lista) cuenta[c.motivo] = (cuenta[c.motivo] || 0) + 1;
  return Object.entries(cuenta)
    .map(([motivo, n]) => ({ motivo, n, ...MOTIVOS[motivo] }))
    .sort((a, b) => b.n - a.n);
}

/* ============================================================
   Pintado
   ============================================================ */
let pestana = 'evaluaciones';
let ultimosResultados = null;

const tile = (n, etiqueta, nota, tono) => `
  <div class="ent-tile${tono ? ' ' + tono : ''}">
    <strong>${esc(n)}</strong>
    <span>${esc(etiqueta)}</span>
    ${nota ? `<small>${esc(nota)}</small>` : ''}
  </div>`;

export function renderEntrenamiento(cont, { crearAgente, alCambiar } = {}) {
  cont.innerHTML = `
    <div class="ent-cabecera">
      <div>
        <h2>Entrenamiento</h2>
        <p class="sh-muted">Cómo mejora el agente y quién decide qué es mejorar.</p>
      </div>
      <div class="tabs" role="tablist">
        <button class="tab" role="tab" data-ent="evaluaciones" aria-selected="${pestana === 'evaluaciones'}">Evaluaciones</button>
        <button class="tab" role="tab" data-ent="correcciones" aria-selected="${pestana === 'correcciones'}">Correcciones</button>
        <button class="tab" role="tab" data-ent="conocimiento" aria-selected="${pestana === 'conocimiento'}">Conocimiento</button>
        <button class="tab" role="tab" data-ent="dataset" aria-selected="${pestana === 'dataset'}">Dataset</button>
      </div>
    </div>
    <div class="ent-cuerpo" id="ent-cuerpo"></div>`;

  cont.querySelectorAll('[data-ent]').forEach(b =>
    b.addEventListener('click', () => { pestana = b.dataset.ent; renderEntrenamiento(cont, { crearAgente, alCambiar }); }));

  const cuerpo = cont.querySelector('#ent-cuerpo');
  if (pestana === 'evaluaciones') renderEvaluaciones(cuerpo, crearAgente);
  else if (pestana === 'correcciones') renderCorrecciones(cuerpo, alCambiar);
  else if (pestana === 'dataset') renderDataset(cuerpo, alCambiar);
  else renderConocimiento(cuerpo);
}

/* ---------- Evaluaciones ---------- */
function renderEvaluaciones(cont, crearAgente) {
  const r = ultimosResultados;
  const res = r ? resumir(r, CASOS) : null;
  const porId = new Map((r || []).map(x => [x.id, x]));

  cont.innerHTML = `
    <div class="sh-alert">
      ${icono('info', { size: 16 })}
      <div>
        <strong>Esto no es fine-tuning, y es a propósito.</strong>
        <p>Con herramientas deterministas, casi nada de lo que falla se arregla reajustando pesos:
        un precio malo es un dato malo, un horario inventado es una precondición que falta.
        Además, afinar un modelo sobre conversaciones de pacientes convierte datos sensibles en
        pesos que no se pueden borrar —y eso, bajo la Ley 81 de 2019, nadie lo quiere firmar.
        Lo que sí se hace es esto: fijar la conducta exigida y comprobarla antes de cada cambio.</p>
      </div>
    </div>

    <div class="ent-barra">
      <button class="btn primary" id="ent-correr" type="button">
        ${icono('chispa', { size: 15 })} Ejecutar las ${CASOS.length} evaluaciones
      </button>
      <span class="sh-muted" id="ent-estado">${r ? `Última ejecución: ${res.ms} ms` : 'Sin ejecutar en esta sesión.'}</span>
    </div>

    ${res ? `<div class="ent-tiles">
      ${tile(`${res.pasan}/${res.total}`, 'Pasan', null, res.fallan ? 'warn' : 'ok')}
      ${tile(res.bloqueantes, 'Bloqueantes en rojo', 'riesgo o incumplimiento', res.bloqueantes ? 'danger' : 'ok')}
      ${tile(res.desplegable ? 'Sí' : 'No', '¿Se puede desplegar?',
             res.desplegable ? 'ningún caso bloqueante falla' : 'un bloqueante en rojo no se compensa con verdes',
             res.desplegable ? 'ok' : 'danger')}
      ${tile(res.ms + ' ms', 'Duración', 'contra el motor de reglas local')}
    </div>` : ''}

    <div class="ent-casos">
      ${['bloqueante', 'alta', 'media'].map(g => {
        const casos = CASOS.filter(c => c.gravedad === g);
        if (!casos.length) return '';
        return `<div class="ent-grupo">
          <div class="sh-group-label">${esc(GRAVEDAD[g].nombre)} · ${esc(GRAVEDAD[g].que)}</div>
          ${casos.map(c => {
            const x = porId.get(c.id);
            const estado = !x ? 'sin-correr' : x.ok ? 'pasa' : 'falla';
            return `<div class="ent-caso ${estado}">
              <div class="ent-caso-cab">
                <span class="ent-punto" aria-hidden="true"></span>
                <strong>${esc(c.titulo)}</strong>
                <code class="sh-mono">${esc(c.id)}</code>
                <span class="pill ${GRAVEDAD[g].tono}">${esc(GRAVEDAD[g].nombre)}</span>
                ${x ? `<span class="sh-muted ent-ms">${x.ms} ms</span>` : ''}
              </div>
              <p class="ent-porque">${esc(c.porque)}</p>
              ${x && !x.ok ? `<ul class="ent-fallos">${x.fallos.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
            </div>`;
          }).join('')}
        </div>`;
      }).join('')}
    </div>`;

  const btn = cont.querySelector('#ent-correr');
  btn.addEventListener('click', () => {
    if (!crearAgente) return;
    btn.disabled = true;
    cont.querySelector('#ent-estado').textContent = 'Ejecutando…';
    /* Un frame para que el botón llegue a pintarse deshabilitado
       antes de que la ejecución bloquee el hilo. */
    requestAnimationFrame(() => setTimeout(() => {
      ultimosResultados = correrSuite(crearAgente, CASOS);
      renderEvaluaciones(cont, crearAgente);
    }, 20));
  });
}

/* ---------- Correcciones ---------- */
function renderCorrecciones(cont, alCambiar) {
  const lista = listarCorrecciones().slice().reverse();
  const pendientes = lista.filter(c => c.estado === 'pendiente');
  const motivos = porMotivo(lista);

  cont.innerHTML = `
    <div class="sh-alert">
      ${icono('info', { size: 16 })}
      <div>
        <strong>De una respuesta mala a un sitio del código.</strong>
        <p>Quien atiende marca una respuesta del agente y dice qué falló. Cada motivo apunta a
        dónde se arregla —el catálogo, una precondición, un guardrail, el prompt—, porque una
        corrección que no dice dónde se arregla es una queja.</p>
      </div>
    </div>

    ${motivos.length ? `<div class="ent-tiles">
      ${tile(pendientes.length, 'Sin revisar', null, pendientes.length ? 'warn' : 'ok')}
      ${motivos.slice(0, 3).map(m => tile(m.n, m.nombre, m.donde, m.tono === 'danger' ? 'danger' : '')).join('')}
    </div>` : ''}

    ${!lista.length ? `<div class="ent-vacio">
      ${icono('chispa', { size: 22 })}
      <strong>Todavía no hay correcciones.</strong>
      <p class="sh-muted">Abre una conversación y pulsa <em>Marcar</em> bajo una respuesta de Sofía
      que no te convenza. Aparecerá aquí, clasificada.</p>
    </div>` : `<div class="ent-lista">
      ${lista.map(c => {
        const m = MOTIVOS[c.motivo];
        return `<article class="ent-correccion ${c.estado}">
          <header>
            <span class="pill ${m.tono}">${esc(m.nombre)}</span>
            <span class="sh-muted">${esc(m.donde)}</span>
            <time class="sh-muted">${new Date(c.fecha).toLocaleString('es-PA', { dateStyle: 'short', timeStyle: 'short' })}</time>
            ${c.estado !== 'pendiente' ? `<span class="pill muted">${c.estado === 'convertida' ? 'convertida en caso' : 'descartada'}</span>` : ''}
          </header>
          <blockquote>${esc(sinMarcado(c.textoBot))}</blockquote>
          ${c.correccion ? `<p class="ent-debio"><span class="sh-muted">Debió decir:</span> ${esc(c.correccion)}</p>` : ''}
          <p class="ent-donde">${esc(m.detalle)}</p>
          ${c.estado === 'pendiente' ? `<div class="ent-acciones">
            <button class="btn btn-sm" data-convertir="${esc(c.id)}">Convertir en caso de evaluación</button>
            <button class="btn btn-sm btn-ghost" data-descartar="${esc(c.id)}">Descartar</button>
          </div>` : ''}
        </article>`;
      }).join('')}
    </div>`}`;

  cont.querySelectorAll('[data-convertir]').forEach(b => b.addEventListener('click', () => {
    cambiarEstadoCorreccion(b.dataset.convertir, 'convertida');
    alCambiar?.('convertida');
    renderCorrecciones(cont, alCambiar);
  }));
  cont.querySelectorAll('[data-descartar]').forEach(b => b.addEventListener('click', () => {
    cambiarEstadoCorreccion(b.dataset.descartar, 'descartada');
    alCambiar?.('descartada');
    renderCorrecciones(cont, alCambiar);
  }));
}

/* ---------- Conocimiento ---------- */
function renderConocimiento(cont) {
  const alias = ESTUDIOS.reduce((n, e) => n + (e.alias?.length || 0), 0);
  const fila = (dato, fuente, manda) => `
    <div class="ent-fila">
      <span>${esc(dato)}</span>
      <code class="sh-mono">${esc(fuente)}</code>
      <span class="pill ${manda === 'herramienta' ? 'ok' : manda === 'código' ? 'ai' : 'warn'}">${esc(manda)}</span>
    </div>`;

  cont.innerHTML = `
    <div class="sh-alert">
      ${icono('info', { size: 16 })}
      <div>
        <strong>El modelo entiende. Las herramientas deciden.</strong>
        <p>Nada de lo que aparece abajo está en el prompt como texto que el modelo pueda parafrasear
        mal. Son llamadas: el modelo pregunta y la herramienta contesta. Por eso un precio
        equivocado se arregla en un archivo, y no reescribiendo instrucciones con la esperanza de
        que esta vez sí.</p>
      </div>
    </div>

    <div class="ent-tiles">
      ${tile(ESTUDIOS.length, 'Estudios en el catálogo', 'RM, TC y ecografía')}
      ${tile(alias, 'Alias reconocidos', 'las palabras del paciente')}
      ${tile(ASEGURADORAS.length, 'Aseguradoras', 'convenios y autorización previa')}
      ${tile(Object.keys(SEDES).length, 'Sedes', HORARIO.texto.split('·')[0].trim())}
    </div>

    <div class="sh-group-label">Quién manda sobre cada dato</div>
    <div class="ent-tabla">
      <div class="ent-fila ent-fila-cab"><span>Dato</span><span>De dónde sale</span><span>Quién manda</span></div>
      ${fila('Precio de un estudio', 'cotizar_estudio()', 'herramienta')}
      ${fila('Duración y ayuno', 'consultar_preparacion()', 'herramienta')}
      ${fila('Convenio y autorización previa', 'verificar_seguro()', 'herramienta')}
      ${fila('Horarios libres', 'buscar_cupos() → Google Calendar', 'herramienta')}
      ${fila('Contraindicaciones de resonancia', 'screening_rm()', 'código')}
      ${fila('Consentimiento del paciente', 'registrar_consentimiento()', 'código')}
      ${fila('Emergencias y peticiones de humano', 'triage previo al modelo', 'código')}
      ${fila('Tono, orden de las preguntas, redacción', 'prompt del sistema', 'prompt')}
    </div>

    <div class="sh-group-label">Alias por estudio</div>
    <div class="ent-alias">
      ${ESTUDIOS.map(e => `<div class="ent-alias-fila">
        <strong>${esc(e.nombre)}</strong>
        <span>${(e.alias || []).map(a => `<code class="sh-mono">${esc(a)}</code>`).join(' ') || '<em class="sh-muted">sin alias</em>'}</span>
      </div>`).join('')}
    </div>`;
}

/* ============================================================
   Dataset
   ------------------------------------------------------------
   La pestaña existe porque la decisión ya está tomada: va a haber
   fine-tuning y aprendizaje por refuerzo. Lo que hace falta
   entonces no es un entrenador —eso se cambia en una tarde— sino
   el dato, que tarda años en acumularse. Esto lo acumula desde
   hoy, en los tres formatos que las tres etapas necesitan, y con
   la anonimización puesta ANTES del formato.

   También enseña el número que nadie quiere mirar: cuántos pares
   faltan para que entrenar tenga sentido.
   ============================================================ */

function descargar(nombre, contenido) {
  const url = URL.createObjectURL(new Blob([contenido], { type: 'application/x-ndjson' }));
  const a = document.createElement('a');
  a.href = url; a.download = nombre;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function renderDataset(cont, alCambiar) {
  const conversaciones = listarConversaciones();
  const correcciones = listarCorrecciones();
  const d = construir({ correcciones, conversaciones, casos: CASOS, resultadosEvals: ultimosResultados || [] });

  /* Ritmo real de los últimos 30 días, no una cifra inventada. */
  const hace30 = Date.now() - 30 * 864e5;
  const recientes = correcciones.filter(c => new Date(c.fecha).getTime() > hace30).length;
  const porDia = recientes / 30;
  const p = proyeccion(d.preferencias.length, porDia);

  const motivos = Object.entries(d.resumen.motivosDeDescarte);

  cont.innerHTML = `
    <div class="sh-alert">
      ${icono('info', { size: 16 })}
      <div>
        <strong>Claude no se puede afinar; el dato sí se puede acumular.</strong>
        <p>Hoy solo Claude&nbsp;3 Haiku admite fine-tuning, y únicamente en Amazon Bedrock
        (<code>us-west-2</code>): ningún modelo de generación actual, y nada por la API de Anthropic.
        Eso no cancela el plan, lo ordena. Claude se queda de orquestador; lo que se afina son modelos
        abiertos para tareas estrechas —clasificar intención, reconocer cómo llama la gente a su
        dolor—. Y para las tres etapas hace falta el mismo insumo, que es lo que esta pestaña
        construye: ejemplos, pares de preferencia y recompensas.</p>
      </div>
    </div>

    <div class="ent-tiles">
      ${tile(d.sft.length, 'Ejemplos SFT', 'conversación → respuesta correcta')}
      ${tile(d.preferencias.length, 'Pares de preferencia', 'para DPO: elegida vs rechazada')}
      ${tile(d.recompensas.length, 'Recompensas verificables', ultimosResultados ? 'del banco de evaluaciones' : 'ejecuta el banco primero', ultimosResultados ? '' : 'warn')}
      ${tile(d.resumen.datosPersonalesRetirados, 'Datos personales retirados', 'antes de dar formato', 'ok')}
    </div>

    <div class="ent-progreso">
      <div class="ent-progreso-cab">
        <strong>${p.pares} de ${p.umbral} pares</strong>
        <span class="sh-muted">${p.listo
          ? 'Hay material suficiente para un DPO con sentido.'
          : p.diasEstimados
            ? `Al ritmo de los últimos 30 días (${ritmoLegible(porDia)}), faltan ${plazoLegible(p.diasEstimados)}.`
            : 'Sin correcciones recientes no se puede estimar cuándo habrá suficiente.'}</span>
      </div>
      <div class="sh-progress"><i style="width:${Math.min(100, (p.pares / p.umbral) * 100).toFixed(1)}%"></i></div>
      <p class="sh-muted ent-porque">
        Un DPO empieza a notarse hacia los mil pares; por debajo de doscientos manda el ruido.
        Es el número que conviene mirar antes de presupuestar GPUs, no después.
      </p>
    </div>

    ${d.resumen.descartados ? `<div class="sh-alert destructive">
      ${icono('alerta', { size: 16 })}
      <div>
        <strong>${d.resumen.descartados} correcciones no entran en el conjunto.</strong>
        <p>${motivos.map(([m, n]) => `${n} · ${esc(textoMotivoDescarte(m))}`).join('<br>')}</p>
      </div>
    </div>` : ''}

    <div class="sh-group-label">Cómo se usa cada formato</div>
    <div class="ent-tabla">
      <div class="ent-fila ent-fila-cab"><span>Etapa</span><span>Qué come</span><span>De dónde sale</span></div>
      <div class="ent-fila"><span>SFT</span><span><code class="sh-mono">messages[]</code></span><span>lo que escribió quien corrigió</span></div>
      <div class="ent-fila"><span>DPO</span><span><code class="sh-mono">prompt · chosen · rejected</code></span><span>cada corrección ya es un par</span></div>
      <div class="ent-fila"><span>RL con recompensa verificable</span><span><code class="sh-mono">entrada · recompensa · peso</code></span><span>el banco de evaluaciones</span></div>
    </div>

    ${d.preferencias.length ? `<div class="sh-group-label">Un par, tal como saldría</div>
    <div class="ent-par">
      <div><span class="pill danger">rechazada</span><p>${esc(sinMarcado(d.preferencias[0].rejected))}</p></div>
      <div><span class="pill ok">elegida</span><p>${esc(sinMarcado(d.preferencias[0].chosen))}</p></div>
    </div>` : ''}

    <div class="ent-barra">
      <button class="btn" id="ds-sft" type="button" ${d.sft.length ? '' : 'disabled'}>Descargar SFT (.jsonl)</button>
      <button class="btn" id="ds-dpo" type="button" ${d.preferencias.length ? '' : 'disabled'}>Descargar preferencias (.jsonl)</button>
      <button class="btn" id="ds-rw" type="button" ${d.recompensas.length ? '' : 'disabled'}>Descargar recompensas (.jsonl)</button>
    </div>`;

  const bajar = (id, filas, nombre) => {
    const b = cont.querySelector(id);
    if (b && !b.disabled) b.addEventListener('click', () => {
      descargar(nombre, aJSONL(filas));
      alCambiar?.('exportado');
    });
  };
  bajar('#ds-sft', d.sft, 'openside-sft.jsonl');
  bajar('#ds-dpo', d.preferencias, 'openside-preferencias.jsonl');
  bajar('#ds-rw', d.recompensas, 'openside-recompensas.jsonl');
}

/* «29 970 días» es exacto y no dice nada. Un plazo se entiende en
   la unidad en que se vive, y de paso deja claro lo que cuesta
   llegar al umbral sin subir el ritmo. */
function plazoLegible(dias) {
  if (dias < 60) return `unos ${dias} días`;
  if (dias < 730) return `unos ${Math.round(dias / 30)} meses`;
  return `más de ${Math.round(dias / 365)} años`;
}

function ritmoLegible(porDia) {
  if (porDia >= 1) return `${porDia.toFixed(1)} al día`;
  const porSemana = porDia * 7;
  if (porSemana >= 1) return `${porSemana.toFixed(1)} por semana`;
  return `${Math.round(porDia * 30)} al mes`;
}

function textoMotivoDescarte(m) {
  return {
    sin_consentimiento_de_atencion: 'sin consentimiento de atención',
    sin_consentimiento_de_entrenamiento: 'el paciente consintió que le atendieran, no que se entrenara un modelo con su conversación: son finalidades distintas y hace falta pedirlo aparte',
    conversacion_no_encontrada: 'sin la conversación no se puede comprobar el consentimiento',
    descartada_por_el_equipo: 'descartadas por el equipo',
    residuo_de_datos_personales: 'quedaba algo que parecía un dato personal tras anonimizar'
  }[m] || m;
}
