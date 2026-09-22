/* ============================================================
   Capa de presentación · simulador WhatsApp + consola
   ============================================================ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ---------- Formato WhatsApp básico ---------- */
export function formatearTexto(s) {
  const esc = s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc
    .replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>')
    .replace(/_([^_\n]+)_/g, '<em>$1</em>')
    .replace(/~([^~\n]+)~/g, '<s>$1</s>')
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
    .replace(/\n/g, '<br>');
}

export function horaCorta(d = new Date()) {
  const h24 = d.getHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h12}:${m} ${h24 < 12 ? 'a.m.' : 'p.m.'}`;
}

const TICK_SVG = `<svg class="wa-tick" viewBox="0 0 16 11" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M11.07.65a.45.45 0 00-.64 0L4.9 6.18 2.6 3.88a.45.45 0 10-.64.64l2.62 2.62c.18.18.46.18.64 0l5.85-5.85a.45.45 0 000-.64z" fill="currentColor"/><path class="t2" d="M15.07.65a.45.45 0 00-.64 0L8.9 6.18l-.5-.5-.64.64 1.14 1.14c.18.18.46.18.64 0l5.53-5.53a.45.45 0 000-.64z" fill="currentColor"/></svg>`;
const TICK_ONE = `<svg class="wa-tick" viewBox="0 0 16 11" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M11.07.65a.45.45 0 00-.64 0L4.9 6.18 2.6 3.88a.45.45 0 10-.64.64l2.62 2.62c.18.18.46.18.64 0l5.85-5.85a.45.45 0 000-.64z" fill="currentColor"/></svg>`;

/* ============================================================
   Chat
   ============================================================ */
export class ChatUI {
  constructor(thread, { onButton } = {}) {
    this.thread = thread;
    this.onButton = onButton;
    this.ultimoRemitente = null;
    this.typingEl = null;
  }

  limpiar() {
    this.thread.innerHTML = '';
    this.ultimoRemitente = null;
    this.typingEl = null;
  }

  divisorFecha(texto = 'hoy') {
    const el = document.createElement('div');
    el.className = 'wa-date';
    el.textContent = texto;
    this.thread.appendChild(el);
    this.ultimoRemitente = null;
    this.scroll();
  }

  aviso(texto) {
    const el = document.createElement('div');
    el.className = 'wa-system';
    el.innerHTML = formatearTexto(texto);
    this.thread.appendChild(el);
    this.ultimoRemitente = null;
    this.scroll();
  }

  mensaje(dir, msg, { esBot = false, esHumano = false } = {}) {
    const primera = this.ultimoRemitente !== dir;
    this.ultimoRemitente = dir;

    const row = document.createElement('div');
    row.className = `wa-row ${dir}${primera ? ' first' : ''}`;

    const bubble = document.createElement('div');
    bubble.className = 'wa-bubble' + (esHumano ? ' is-human' : '');
    bubble.setAttribute('role', 'article');

    let html = '';
    if (primera && dir === 'in' && (esBot || esHumano)) {
      html += `<span class="wa-bot-tag">${esHumano ? 'Agente · Open Side' : 'Asistente virtual'}</span>`;
    }
    html += `<div class="wa-body">${formatearTexto(msg.text || '')}</div>`;

    if (msg.card) {
      const c = msg.card;
      html += `<div class="wa-card"><dl>
        <dt>Cita</dt><dd>${c.cita_id}</dd>
        <dt>Estudio</dt><dd>${c.estudio}</dd>
        <dt>Fecha</dt><dd>${c.fecha}</dd>
        <dt>Sede</dt><dd>${c.sede}</dd>
        <dt>Costo</dt><dd>${c.precio}</dd>
      </dl></div>`;
    }

    const tick = dir === 'out' ? `<span class="tickslot">${TICK_ONE}</span>` : '';
    html += `<span class="wa-meta">${horaCorta()}${tick}</span>`;

    bubble.innerHTML = html;

    if (msg.buttons && msg.buttons.length) {
      const wrap = document.createElement('div');
      wrap.className = 'wa-buttons';
      msg.buttons.slice(0, 3).forEach(b => {
        const btn = document.createElement('button');
        btn.className = 'wa-btn';
        btn.type = 'button';
        btn.textContent = b.label;
        btn.addEventListener('click', () => {
          $$('.wa-btn', wrap).forEach(x => { x.disabled = true; });
          this.onButton && this.onButton(b);
        });
        wrap.appendChild(btn);
      });
      bubble.appendChild(wrap);
    }

    row.appendChild(bubble);
    this.thread.appendChild(row);
    this.scroll();

    if (dir === 'out') this.animarTicks(bubble);
    return bubble;
  }

  animarTicks(bubble) {
    const slot = $('.tickslot', bubble);
    if (!slot) return;
    setTimeout(() => { slot.innerHTML = TICK_SVG; }, 550);
    setTimeout(() => {
      const t = $('.wa-tick', slot);
      if (t) t.classList.add('read');
    }, 1400);
  }

  typing(on) {
    if (on) {
      if (this.typingEl) return;
      const row = document.createElement('div');
      row.className = 'wa-row in';
      row.innerHTML = `<div class="wa-bubble"><div class="wa-typing" aria-label="escribiendo"><i></i><i></i><i></i></div></div>`;
      this.thread.appendChild(row);
      this.typingEl = row;
      this.ultimoRemitente = null;
      this.scroll();
    } else if (this.typingEl) {
      this.typingEl.remove();
      this.typingEl = null;
    }
  }

  scroll() {
    requestAnimationFrame(() => { this.thread.scrollTop = this.thread.scrollHeight; });
  }
}

/* ============================================================
   Inspector de trazas
   ============================================================ */
export function renderTraza(trace, contenedor) {
  const el = document.createElement('div');
  el.className = 'trace';

  const pillIntencion = trace.triage && trace.triage.disparo
    ? `<span class="pill danger">triage · ${trace.triage.tipo}</span>`
    : `<span class="pill ai">${escapar(trace.intencion || (trace.modo === 'ia' ? 'claude' : 'desconocido'))}</span>`;

  const conf = trace.triage && trace.triage.disparo ? 1 : trace.confianza;
  const pillConf = conf == null
    ? `<span class="pill info">${trace.tools.length} tool${trace.tools.length === 1 ? '' : 's'}</span>`
    : `<span class="pill ${conf >= .8 ? 'ok' : conf >= .5 ? 'warn' : 'danger'}">${(conf * 100).toFixed(0)}%</span>`;

  const head = document.createElement('button');
  head.className = 'trace-head';
  head.type = 'button';
  head.innerHTML = `<span class="turn">T${String(trace.turno).padStart(2, '0')}</span>
    <span class="intent">${escapar((trace.entrada || '').slice(0, 42)) || '(botón)'}</span>
    ${pillIntencion} ${pillConf}`;

  const body = document.createElement('div');
  body.className = 'trace-body';

  const esIA = trace.modo === 'ia';
  const via = trace.triage && trace.triage.disparo
    ? 'triage determinista · el modelo no vio este turno'
    : (esIA ? 'modelo con tool-calling' : 'motor de reglas local');

  let html = `<dl class="kv">
    <dt>Vía</dt><dd>${via}</dd>`;
  if (esIA) {
    html += `<dt>Modelo</dt><dd>${escapar(trace.modelo || '—')}${trace.effort ? ' · effort ' + escapar(trace.effort) : ''}</dd>`;
    if (trace.iteraciones) html += `<dt>Iteraciones</dt><dd>${trace.iteraciones}</dd>`;
    if (trace.uso) {
      html += `<dt>Tokens</dt><dd>${trace.uso.input} in · ${trace.uso.output} out` +
              (trace.uso.cache_read ? ` · ${trace.uso.cache_read} caché` : '') + `</dd>`;
    }
    if (trace.latencia_total) html += `<dt>Latencia</dt><dd>${trace.latencia_total} ms</dd>`;
  } else {
    html += `<dt>Fase</dt><dd>${trace.fase_antes} → ${trace.fase_despues}</dd>`;
  }
  html += `</dl>`;

  if (trace.tools.length) {
    html += `<div><div class="crm-section" style="margin:0 0 8px"><h3>Herramientas</h3></div>`;
    for (const t of trace.tools) {
      const args = JSON.stringify(t.args, null, 1).replace(/\n\s*/g, ' ').slice(0, 220);
      const res = JSON.stringify(t.resultado, null, 1).replace(/\n\s*/g, ' ').slice(0, 260);
      html += `<div class="tool-call">
        <span class="tname">${t.nombre}()</span><span class="lat">${t.latencia} ms</span>
        <pre>← ${escapar(args)}
→ ${escapar(res)}</pre>
      </div>`;
    }
    html += `</div>`;
  } else {
    html += `<div style="color:var(--text-secondary);font-size:13px">Sin llamadas a herramientas en este turno.</div>`;
  }

  html += `<div><div class="crm-section" style="margin:0 0 8px"><h3>Guardrails</h3></div>
    <div class="guard-list">` +
    trace.guardrails.map(g => {
      const malo = /BLOQUE|ALERTA/.test(g.resultado);
      const activo = /disparó|enmascarados|neutralizado/.test(g.resultado);
      return `<span class="pill ${malo ? 'danger' : activo ? 'warn' : 'ok'}" title="${escapar(g.resultado)}">${g.nombre}</span>`;
    }).join('') + `</div></div>`;

  if (trace.escalamiento) {
    const e = trace.escalamiento;
    html += `<div><div class="crm-section" style="margin:0 0 8px"><h3>Escalamiento</h3></div>
      <dl class="kv">
        <dt>Motivo</dt><dd>${e.motivo}</dd>
        <dt>Prioridad</dt><dd>${e.prioridad}</dd>
        <dt>Equipo</dt><dd>${e.equipo}</dd>
        <dt>Chatwoot</dt><dd>${e.chatwoot.status_anterior} → <strong>${e.chatwoot.status_nuevo}</strong></dd>
      </dl></div>`;
  }

  body.innerHTML = html;
  head.addEventListener('click', () => { body.hidden = !body.hidden; });
  el.append(head, body);
  contenedor.prepend(el);
}

/* ============================================================
   Métricas
   ============================================================ */
export function renderMetricas(m, contenedor) {
  const tarjeta = (val, lab) => `<div class="metric"><div class="m-val">${val}</div><div class="m-lab">${lab}</div></div>`;
  contenedor.innerHTML = `<div class="metrics">
    ${tarjeta(m.turnos, 'Turnos del paciente')}
    ${tarjeta(m.mensajesBot, 'Mensajes del agente')}
    ${tarjeta(m.tools, 'Llamadas a herramientas')}
    ${tarjeta(m.latenciaMedia + ' ms', 'Latencia media de herramienta')}
    ${tarjeta(m.escalamientos, 'Escalamientos')}
    ${tarjeta(m.guardrailsActivados, 'Guardrails activados')}
  </div>
  <div class="crm-section" style="margin-top:24px">
    <h3>Costo estimado del canal</h3>
    <div class="crm-card">
      <div class="crm-row"><span class="k">Mensajes de servicio enviados</span><span class="v">${m.mensajesBot}</span></div>
      <div class="crm-row"><span class="k">Mensajes por resolución</span><span class="v">${m.turnos ? (m.mensajesBot / Math.max(1, m.turnos)).toFixed(1) : '0'}</span></div>
      <div class="crm-row"><span class="k">Ventana de 24h</span><span class="v">abierta</span></div>
    </div>
    <p style="font-size:12px;color:var(--text-secondary);margin-top:12px">
      Desde el 1 de octubre de 2026 Meta cobra los mensajes de servicio dentro de la ventana
      de 24 horas, con un tramo gratuito de 1,000 por número al mes. Por eso la métrica a
      optimizar es <strong>mensajes por resolución</strong>, no duración de la sesión.
    </p>
  </div>`;
}

function escapar(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export { $, $$, escapar };
