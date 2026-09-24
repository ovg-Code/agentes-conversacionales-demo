/* ============================================================
   Toasts · la gramática de Sonner
   ------------------------------------------------------------
   Sonner es el toaster que shadcn adoptó, y sus decisiones son
   las que se copian aquí:

     · Apilados abajo a la derecha, el más nuevo abajo.
     · Como mucho tres a la vez. El cuarto empuja al primero.
     · Se puede cerrar, pero también se va solo.
     · Un aviso de error no se va solo: si algo falló, la persona
       tiene que poder leerlo cuando vuelva de mirar otra cosa.

   Sustituye al aviso centrado de antes, que tapaba el compositor
   justo cuando se acababa de escribir algo.
   ============================================================ */

import { icono } from './iconos.js';

const MAXIMO = 3;
const ICONOS = { ok: 'check', warn: 'reloj', danger: 'alerta', info: 'info' };
const VIDA   = { ok: 3200, info: 3200, warn: 5000, danger: 0 };   // 0 = no se va solo

let contenedor = null;
const vivos = [];

function montar() {
  if (contenedor) return contenedor;
  contenedor = document.createElement('div');
  contenedor.className = 'sh-toasts';
  contenedor.setAttribute('role', 'status');
  contenedor.setAttribute('aria-live', 'polite');
  document.body.appendChild(contenedor);
  return contenedor;
}

function retirar(el) {
  if (!el || el.dataset.saliendo) return;
  el.dataset.saliendo = '1';
  el.classList.add('saliendo');
  const i = vivos.indexOf(el);
  if (i >= 0) vivos.splice(i, 1);
  el.addEventListener('animationend', () => el.remove(), { once: true });
  // Si la animación no corre (reduced motion), no dejar el nodo colgado.
  setTimeout(() => el.remove(), 400);
}

/**
 * @param texto   la línea principal
 * @param opciones {tono: ok|warn|danger|info, detalle, accion: {texto, alPulsar}}
 */
export function toast(texto, opciones = {}) {
  const { tono = 'info', detalle = null, accion = null } = opciones;
  const raiz = montar();

  const el = document.createElement('div');
  el.className = `sh-toast ${tono}`;
  el.innerHTML = `
    ${icono(ICONOS[tono] || 'info', { size: 16 })}
    <div>
      <strong></strong>
      ${detalle ? '<p></p>' : ''}
    </div>
    <button class="sh-toast-x" type="button" aria-label="Cerrar">${icono('cerrar', { size: 14 })}</button>`;
  // textContent y no innerHTML: el texto puede venir de un paciente.
  el.querySelector('strong').textContent = texto;
  if (detalle) el.querySelector('p').textContent = detalle;

  if (accion) {
    const b = document.createElement('button');
    b.className = 'btn btn-sm';
    b.style.marginTop = '8px';
    b.textContent = accion.texto;
    b.addEventListener('click', () => { accion.alPulsar(); retirar(el); });
    el.querySelector('div').appendChild(b);
  }

  el.querySelector('.sh-toast-x').addEventListener('click', () => retirar(el));

  raiz.appendChild(el);
  vivos.push(el);
  while (vivos.length > MAXIMO) retirar(vivos[0]);

  const vida = VIDA[tono] ?? 3200;
  if (vida) {
    let t = setTimeout(() => retirar(el), vida);
    /* Si el cursor está encima, la persona lo está leyendo. */
    el.addEventListener('mouseenter', () => clearTimeout(t));
    el.addEventListener('mouseleave', () => { t = setTimeout(() => retirar(el), 1200); });
  }
  return el;
}

export const toastOk     = (t, o) => toast(t, { ...o, tono: 'ok' });
export const toastAviso  = (t, o) => toast(t, { ...o, tono: 'warn' });
export const toastError  = (t, o) => toast(t, { ...o, tono: 'danger' });
