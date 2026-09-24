/* ============================================================
   Paleta de comandos · el patrón cmdk de shadcn
   ------------------------------------------------------------
   Antes ⌘K abría un buscador. Un buscador contesta "¿dónde está
   esto?"; una paleta contesta además "¿qué puedo hacer?". Es la
   diferencia entre una web y una herramienta, y es de las cosas
   que más cambian la sensación de una interfaz sin tocar un solo
   color.

   Tres grupos, en el orden en que se necesitan:
     Acciones     lo que se puede hacer AQUÍ y AHORA
     Navegación   las secciones
     Resultados   lo que devuelve la búsqueda

   El grupo de acciones depende del contexto: si hay una
   conversación abierta aparecen sus acciones, si no, no. Una
   paleta que ofrece lo que no se puede hacer enseña a ignorarla.
   ============================================================ */

import { icono } from './iconos.js';

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const normalizar = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Filtro por subsecuencia, como cmdk: "agnd" encuentra "Agenda". */
export function coincide(consulta, texto) {
  const q = normalizar(consulta), t = normalizar(texto);
  if (!q) return true;
  if (t.includes(q)) return true;
  let i = 0;
  for (const c of t) { if (c === q[i]) i++; if (i === q.length) return true; }
  return false;
}

/** Ordena: primero lo que empieza igual, luego lo que contiene. */
export function puntuar(consulta, texto) {
  const q = normalizar(consulta), t = normalizar(texto);
  if (!q) return 0;
  if (t.startsWith(q)) return 0;
  const i = t.indexOf(q);
  return i >= 0 ? 1 + i / 100 : 50;
}

/* La subsecuencia es generosa a propósito —"agnd" tiene que
   encontrar "Agenda"— pero también hace que "agend" encuentre
   "Tomar la conversación abierta", porque esas letras están ahí en
   ese orden. Con los grupos ordenados, ese ruido se cuela por
   encima de la coincidencia buena.

   Regla: si algún candidato contiene el texto literalmente, los que
   solo casan por subsecuencia sobran. Solo cuando no hay ninguna
   coincidencia literal vale la pena ser generoso. */
const FLOJA = 50;

function puntuados(comandos, consulta) {
  return comandos
    .map(c => ({ c, p: Math.min(puntuar(consulta, c.titulo), puntuar(consulta, c.claves || '')) }))
    .filter(({ c, p }) => p < FLOJA || coincide(consulta, c.titulo + ' ' + (c.claves || '')));
}

const ordenar = (lista, exigirLiteral) => lista
  .filter(x => !exigirLiteral || x.p < FLOJA)
  .sort((a, b) => a.p - b.p)
  .map(x => x.c);

export function filtrarComandos(comandos, consulta) {
  const lista = puntuados(comandos, consulta);
  return ordenar(lista, lista.some(x => x.p < FLOJA));
}

/* La decisión de descartar las coincidencias flojas tiene que
   tomarse mirando TODOS los grupos a la vez. Grupo a grupo, una
   acción que solo casa por subsecuencia sobrevive porque en su
   grupo no hay nada mejor —y acaba listada por encima de la
   coincidencia buena del grupo siguiente, que es lo que se vio en
   pantalla con "agend". */
export function filtrarGrupos(grupos, consulta) {
  const listas = grupos.map(g => ({ g, lista: puntuados(g.items, consulta) }));
  const hayBuenas = listas.some(({ lista }) => lista.some(x => x.p < FLOJA));
  return listas.map(({ g, lista }) => ({ ...g, items: ordenar(lista, hayBuenas) }));
}

/* ------------------------------------------------------------
   Pintado
   ------------------------------------------------------------ */
export function renderPaleta(cont, grupos, activo) {
  const planos = grupos.flatMap(g => g.items);
  if (!planos.length) {
    cont.innerHTML = '<div class="cmd-vacio">Sin resultados. Prueba con otro término.</div>';
    return planos;
  }
  let i = 0;
  cont.innerHTML = grupos.filter(g => g.items.length).map(g => `
    <div class="cmd-grupo" role="group" aria-label="${esc(g.titulo)}">
      <div class="sh-group-label">${esc(g.titulo)}</div>
      ${g.items.map(it => {
        const idx = i++;
        return `<button class="cmd-item" role="option" data-i="${idx}"
                  aria-selected="${idx === activo}" type="button">
          ${it.icono ? icono(it.icono, { size: 15 }) : '<span class="cmd-hueco"></span>'}
          <span class="cmd-txt">${it.html || esc(it.titulo)}</span>
          ${it.pista ? `<span class="cmd-pista">${esc(it.pista)}</span>` : ''}
          ${it.atajo ? `<kbd>${esc(it.atajo)}</kbd>` : ''}
        </button>`;
      }).join('')}
    </div>`).join('');
  return planos;
}
