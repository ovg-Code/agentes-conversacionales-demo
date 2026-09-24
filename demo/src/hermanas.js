/* ============================================================
   Enlaces entre las dos aplicaciones
   ------------------------------------------------------------
   El chat y el CRM son dos páginas distintas, y se enlazan entre
   sí. Un href relativo basta cuando se sirven como index.html y
   crm.html, pero no cuando la página vive en una ruta sin
   extensión ni barra final —un artifact publicado, por ejemplo—:
   ahí "crm.html" resolvería un nivel más arriba y el enlace
   llevaría a ninguna parte. Alguien concluiría que solo hay una
   página, que es justo lo contrario de lo que el sistema es.

   Se resuelve en tiempo de ejecución sobre location.pathname:

     /demo/index.html  →  /demo/crm.html
     /demo/            →  /demo/crm.html
     /artifact/ABC123  →  /artifact/ABC123/crm.html
   ============================================================ */

export function urlHermana(archivo, ruta = location.pathname) {
  const base = /\.[a-z0-9]+$/i.test(ruta)
    ? ruta.replace(/[^/]*$/, '')            // .../index.html → .../
    : (ruta.endsWith('/') ? ruta : ruta + '/');
  return base + archivo;
}

/** Reescribe los enlaces marcados con data-hermana. */
export function enlazarHermanas(raiz = document) {
  for (const a of raiz.querySelectorAll('a[data-hermana]')) {
    a.setAttribute('href', urlHermana(a.dataset.hermana));
  }
}
