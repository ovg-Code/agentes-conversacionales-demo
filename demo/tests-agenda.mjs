const store = {};
global.localStorage = { getItem: k => store[k] ?? null, setItem: (k,v) => { store[k]=v; }, removeItem: k => { delete store[k]; } };
const m = await import('./src/crm-agenda.js');
const hoy = new Date();
console.log('citas totales:', m.listarCitas().length);
const sem = m.citasDeSemana(hoy);
console.log('por día:', sem.map(d => m.diaCorto(d.fecha)+':'+d.citas.length).join(' '));
console.log('ocupación hoy (ambas sedes):', JSON.stringify(m.ocupacionDia(hoy)));
console.log('ocupación hoy (solo 75E):', JSON.stringify(m.ocupacionDia(hoy,'75E')));
const hoyCitas = m.citasDelDia(hoy);
console.log('primeras de hoy:', hoyCitas.slice(0,4).map(c => m.horaCorta(c.inicio)+' '+c.estudio.slice(0,22)+' ['+c.estado+']').join(' | '));
const estados = {};
for (const c of m.listarCitas()) estados[c.estado] = (estados[c.estado]||0)+1;
console.log('estados:', JSON.stringify(estados));
console.log('solapes en la misma sede y hora:', (() => {
  const vistos = new Set(); let n = 0;
  for (const c of m.listarCitas()) { const k = c.sede+'@'+c.inicio; if (vistos.has(k)) n++; vistos.add(k); }
  return n;
})());
process.exit(0);
