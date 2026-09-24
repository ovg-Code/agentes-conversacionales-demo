/* ============================================================
   Enlaces entre el chat y el CRM
   ------------------------------------------------------------
   Si este enlace se rompe, las dos aplicaciones parecen una sola.
   Ejecutar: node demo/tests-hermanas.mjs
   ============================================================ */
import { urlHermana } from './src/hermanas.js';

let fallos = 0, n = 0;
const ok = (cond, nombre, detalle) => {
  n++; console.log((cond ? '✅' : '❌') + ' ' + nombre);
  if (!cond) { fallos++; if (detalle !== undefined) console.log('   →', detalle); }
};

const casos = [
  ['/index.html',             'crm.html',   '/crm.html',                  'servido como archivo suelto'],
  ['/demo/index.html',        'crm.html',   '/demo/crm.html',             'dentro de una carpeta'],
  ['/demo/crm.html',          'index.html', '/demo/index.html',           'y de vuelta'],
  ['/',                       'crm.html',   '/crm.html',                  'en la raíz'],
  ['/demo/',                  'crm.html',   '/demo/crm.html',             'en una carpeta con barra final'],
  ['/artifact/TSp19jVKGKo6',  'crm.html',   '/artifact/TSp19jVKGKo6/crm.html', 'en una ruta sin extensión: el caso que rompía'],
  ['/artifact/TSp19jVKGKo6/', 'crm.html',   '/artifact/TSp19jVKGKo6/crm.html', 'la misma, con barra final'],
  ['/artifact/ABC/crm.html',  'index.html', '/artifact/ABC/index.html',   'y su vuelta']
];
for (const [ruta, archivo, esperado, nota] of casos) {
  const got = urlHermana(archivo, ruta);
  ok(got === esperado, `${nota} (${ruta})`, `esperaba ${esperado}, dio ${got}`);
}

ok(urlHermana('crm.html', '/a/b/c') === '/a/b/c/crm.html', 'una ruta anidada sin extensión tampoco sube de nivel');
ok(!urlHermana('crm.html', '/artifact/ABC').includes('/artifact/crm.html'),
   'nunca resuelve al hermano del contenedor, que es lo que dejaba el enlace muerto');

console.log(`\n${n - fallos}/${n} comprobaciones pasaron`);
process.exit(fallos ? 1 : 0);
