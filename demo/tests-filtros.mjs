// El motor se prueba con conversaciones sintéticas, sin navegador.
global.localStorage = { getItem: () => null, setItem: () => {} };
const { cumple, describir, ATRIBUTOS, atributoPorClave } =
  await import('./src/crm-filtros.js');

const conv = (extra = {}) => ({
  id: 'c1', actualizado: Date.now(), esperaDesde: Date.now() - 20 * 60000,
  asignadoA: null, equipo: null, prioridad: null, agenteVistoEn: 0, mensajes: [],
  crm: { status: 'pending', labels: [], contacto: {}, conversacion: {} }, ...extra
});
let fallos = 0;
const ok = (c, n) => { console.log((c ? '✅' : '❌') + ' ' + n); if (!c) fallos++; };

ok(cumple(conv(), [{atributo:'estado', operador:'es', valor:'pending'}]), 'estado es pending');
ok(!cumple(conv(), [{atributo:'estado', operador:'es', valor:'resolved'}]), 'estado no es resolved');
ok(cumple(conv({prioridad:'urgent'}), [{atributo:'prioridad', operador:'es', valor:'urgent'}]), 'prioridad urgente');
ok(cumple(conv({crm:{status:'open', labels:['seguro','urgente'], contacto:{}, conversacion:{}}}),
   [{atributo:'label', operador:'es', valor:'seguro'}]), 'label presente entre varios');
ok(!cumple(conv({crm:{status:'open', labels:['seguro'], contacto:{}, conversacion:{}}}),
   [{atributo:'label', operador:'no_es', valor:'seguro'}]), 'label negado');
ok(cumple(conv({crm:{status:'open', labels:[], contacto:{}, conversacion:{estudio_solicitado:'Resonancia de columna lumbar'}}}),
   [{atributo:'estudio', operador:'contiene', valor:'lumbar'}]), 'estudio contiene (sin tildes ni mayúsculas)');
ok(cumple(conv({crm:{status:'open', labels:[], contacto:{}, conversacion:{estudio_solicitado:'Tomografía de tórax'}}}),
   [{atributo:'estudio', operador:'contiene', valor:'TORAX'}]), 'búsqueda insensible a tildes');
ok(cumple(conv(), [{atributo:'espera', operador:'mayor_que', valor:'10'}]), 'espera mayor que 10 min');
ok(!cumple(conv(), [{atributo:'espera', operador:'mayor_que', valor:'60'}]), 'espera no mayor que 60');
ok(cumple(conv({crm:{status:'open', labels:[], contacto:{consentimiento_datos:true}, conversacion:{}}}),
   [{atributo:'consentimiento', operador:'es', valor:'si'}]), 'consentimiento otorgado');
ok(cumple(conv({crm:{status:'open', labels:[], contacto:{}, conversacion:{cita_id:'OS-1'}}}),
   [{atributo:'cita', operador:'es', valor:'si'}]), 'tiene cita');
ok(cumple(conv({actualizado: Date.now() - 5*86400000}), [{atributo:'actividad', operador:'hace_mas_de', valor:'3'}]), 'actividad hace más de 3 días');

// Y / O
const c = conv({prioridad:'urgent', crm:{status:'open', labels:['seguro'], contacto:{}, conversacion:{}}});
ok(cumple(c, [{atributo:'prioridad',operador:'es',valor:'urgent'},{atributo:'label',operador:'es',valor:'seguro'}], 'y'), 'Y: ambas se cumplen');
ok(!cumple(c, [{atributo:'prioridad',operador:'es',valor:'urgent'},{atributo:'label',operador:'es',valor:'otro'}], 'y'), 'Y: una falla → no pasa');
ok(cumple(c, [{atributo:'prioridad',operador:'es',valor:'baja'},{atributo:'label',operador:'es',valor:'seguro'}], 'o'), 'O: basta una');
ok(cumple(conv(), []), 'sin condiciones pasa todo');

console.log('\ndescripción:', describir(
  [{atributo:'estudio',operador:'contiene',valor:'resonancia'},{atributo:'prioridad',operador:'es',valor:'urgent'}], 'y'));
console.log('atributos:', ATRIBUTOS.length, '· operadores del tipo texto:', atributoPorClave('estudio').tipo);
console.log(fallos ? `\n🔴 ${fallos} fallan` : '\n🟢 todas pasan');
process.exit(fallos ? 1 : 0);
