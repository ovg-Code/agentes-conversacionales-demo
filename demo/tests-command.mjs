/* Filtro de la paleta de comandos · node demo/tests-command.mjs */
import { coincide, puntuar, filtrarComandos, filtrarGrupos } from './src/command.js';
let f = 0, n = 0;
const ok = (c, s, d) => { n++; console.log((c ? '✅' : '❌') + ' ' + s); if (!c) { f++; if (d !== undefined) console.log('   →', d); } };

ok(coincide('', 'Agenda'), 'sin consulta pasa todo');
ok(coincide('agenda', 'Ir a la agenda'), 'coincidencia literal');
ok(coincide('AGENDA', 'Ir a la agenda'), 'sin distinguir mayúsculas');
ok(coincide('agend', 'Ir a la Agènda'), 'sin distinguir acentos');
ok(coincide('agnd', 'Agenda'), 'por subsecuencia: agnd encuentra Agenda');
ok(coincide('ira', 'Ir a la agenda'), 'la subsecuencia puede saltar palabras');
ok(!coincide('zzz', 'Agenda'), 'y rechaza lo que no está');
ok(!coincide('adnega', 'Agenda'), 'la subsecuencia respeta el orden de las letras');

ok(puntuar('age', 'Agenda') < puntuar('age', 'Ir a la agenda'),
   'lo que empieza igual pesa más que lo que solo contiene');

const cmds = [
  { titulo: 'Ajustes' }, { titulo: 'Agenda' }, { titulo: 'Ir a la agenda' },
  { titulo: 'Pacientes', claves: 'contactos personas' }
];
const r = filtrarComandos(cmds, 'age');
ok(r[0].titulo === 'Agenda', 'ordena primero la coincidencia por prefijo', r.map(x => x.titulo));
ok(filtrarComandos(cmds, 'contactos')[0].titulo === 'Pacientes',
   'las claves ocultas también encuentran: "contactos" da con Pacientes');
ok(filtrarComandos(cmds, '').length === 4, 'sin consulta se listan todos');
ok(filtrarComandos(cmds, 'qqq').length === 0, 'y una consulta imposible no devuelve nada');

/* El caso que se vio en pantalla: "agend" listaba "Tomar la
   conversación abierta" por encima de "Ir a Agenda", porque esas
   cinco letras están ahí en ese orden. */
const ruido = [{ titulo: 'Tomar la conversación abierta' }, { titulo: 'Ir a Agenda' }];
const r2 = filtrarComandos(ruido, 'agend');
ok(r2.length === 1 && r2[0].titulo === 'Ir a Agenda',
   'habiendo coincidencia literal, la subsecuencia floja se descarta', r2.map(x => x.titulo));
ok(filtrarComandos(ruido, 'agnd')[0].titulo === 'Ir a Agenda',
   'pero sin ninguna literal, la subsecuencia sigue valiendo');
ok(filtrarComandos([{ titulo: 'Cambiar de tema', claves: 'oscuro claro dark' }], 'dark').length === 1,
   'las claves ocultas cuentan como coincidencia literal');
ok(filtrarComandos(ruido, '').length === 2, 'sin consulta no se descarta nada');

/* Y el mismo caso repartido en dos grupos, que es como está en el
   CRM: la acción floja vive en "Acciones" y la buena en
   "Navegación". Filtrando grupo a grupo, la floja sobrevivía. */
const g = filtrarGrupos([
  { titulo: 'Acciones',   items: [{ titulo: 'Tomar la conversación abierta' }] },
  { titulo: 'Navegación', items: [{ titulo: 'Ir a Agenda' }] }
], 'agend');
ok(g[0].items.length === 0, 'la acción floja desaparece aunque sea la única de su grupo',
   g.map(x => `${x.titulo}:${x.items.length}`));
ok(g[1].items.length === 1, 'y la coincidencia literal se queda');
/* "agnd" no aparece literalmente en ninguno de los dos, así que
   sobrevive lo que casa por subsecuencia: "Agenda", y no la acción,
   que ni siquiera tiene esas letras en ese orden. */
const g2 = filtrarGrupos([
  { titulo: 'Acciones',   items: [{ titulo: 'Tomar la conversación abierta' }] },
  { titulo: 'Navegación', items: [{ titulo: 'Ir a Agenda' }] }
], 'agnd');
ok(g2[0].items.length === 0 && g2[1].items[0].titulo === 'Ir a Agenda',
   'sin ninguna literal, la subsecuencia sigue encontrando lo que toca',
   g2.map(x => `${x.titulo}:${x.items.map(i => i.titulo)}`));
const g3 = filtrarGrupos([
  { titulo: 'Acciones',   items: [{ titulo: 'Tomar conversación' }] },
  { titulo: 'Navegación', items: [{ titulo: 'Ir a Agenda' }] }
], 'tmr');
ok(g3[0].items.length === 1 && g3[1].items.length === 0,
   'y la generosidad funciona también en el grupo de acciones');

console.log(`\n${n - f}/${n} comprobaciones pasaron`);
process.exit(f ? 1 : 0);
