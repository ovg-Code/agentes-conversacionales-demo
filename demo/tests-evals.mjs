/* ============================================================
   Banco de evaluaciones · node demo/tests-evals.mjs
   ------------------------------------------------------------
   Dos cosas distintas se comprueban aquí:
     1. Que el agente pasa los casos (la suite de verdad).
     2. Que las COMPROBACIONES detectan lo que dicen detectar —
        un banco que nunca falla no está midiendo nada.
   ============================================================ */
import { CASOS, GRAVEDAD, comprobar, correrCaso, correrSuite, resumir } from './src/evals.js';
import { createAgent } from './src/agent.js';

let f = 0, n = 0;
const ok = (c, s, d) => { n++; console.log((c ? '✅' : '❌') + ' ' + s); if (!c) { f++; if (d !== undefined) console.log('   →', typeof d === 'string' ? d : JSON.stringify(d).slice(0, 300)); } };

console.log('\n— Las comprobaciones detectan lo que dicen —');

const turno = (texto, extra = {}) => ({
  mensajes: [{ text: texto }],
  trace: { tools: [], guardrails: [], escalamiento: null, ...extra.trace },
  crm: { conversacion: {}, ...extra.crm }
});

ok(comprobar({ agenda: true }, [turno('hola')]).length === 1, 'exige una cita y no la hay → falla');
ok(comprobar({ agenda: true }, [turno('listo', { crm: { conversacion: { cita_id: 'OS-1' } } })]).length === 0,
   'exige una cita y la hay → pasa');
ok(comprobar({ agenda: false }, [turno('listo', { crm: { conversacion: { cita_id: 'OS-1' } } })])[0]
     .includes('OS-1'), 'prohíbe agendar y agendó → falla nombrando la cita');

ok(comprobar({ escala: true }, [turno('hola')]).length === 1, 'exige escalar y no escaló → falla');
ok(comprobar({ escala: 'tecnologia_rm' }, [turno('x', { trace: { escalamiento: { equipo: 'general' } } })])[0]
     .includes('general'), 'exige un equipo concreto y dice a cuál escaló');
ok(comprobar({ escala: false }, [turno('x', { trace: { escalamiento: { motivo: 'reclamo' } } })])[0]
     .includes('reclamo'), 'prohíbe escalar y escaló → dice por qué escaló');
ok(comprobar({ prioridad: 'urgent' }, [turno('x', { trace: { escalamiento: { prioridad: 'medium' } } })]).length === 1,
   'la prioridad del escalamiento se comprueba');

ok(comprobar({ herramienta: 'cotizar_estudio' }, [turno('x')]).length === 1, 'exige una herramienta y no se llamó → falla');
ok(comprobar({ herramienta: 'cotizar_estudio' }, [turno('x', { trace: { tools: [{ nombre: 'cotizar_estudio' }] } })]).length === 0,
   'y pasa cuando sí se llamó');
ok(comprobar({ noHerramienta: 'agendar_cita' }, [turno('x', { trace: { tools: [{ nombre: 'agendar_cita' }] } })]).length === 1,
   'y también se puede prohibir una herramienta');
ok(comprobar({ guardrail: 'anti_inyeccion' }, [turno('x', { trace: { guardrails: [{ nombre: 'anti_inyeccion' }] } })]).length === 0,
   'los guardrails se comprueban por nombre');

ok(comprobar({ dice: ['380'] }, [turno('El precio es US$380')]).length === 0, 'dice: encuentra el texto');
ok(comprobar({ dice: ['380'] }, [turno('El precio es US$420')]).length === 1, 'y falla si no está');
ok(comprobar({ noDice: ['es grave'] }, [turno('No, ES GRAVE en absoluto')]).length === 1,
   'noDice: no se escapa por las mayúsculas');
ok(comprobar({}, [turno('cualquier cosa')]).length === 0, 'sin expectativas, nada falla');

console.log('\n— Estructura del banco —');
ok(CASOS.length >= 10, `hay ${CASOS.length} casos`);
ok(CASOS.every(c => c.porque && c.porque.length > 30),
   'todos explican POR QUÉ existen: un caso sin motivo es un caso que nadie se atreve a borrar',
   CASOS.filter(c => !c.porque || c.porque.length <= 30).map(c => c.id));
ok(CASOS.every(c => GRAVEDAD[c.gravedad]), 'todos tienen una gravedad conocida');
ok(new Set(CASOS.map(c => c.id)).size === CASOS.length, 'no hay identificadores repetidos');
ok(CASOS.every(c => Object.keys(c.espera || {}).length > 0),
   'ninguno está vacío de expectativas: un caso que no comprueba nada siempre pasa');
ok(CASOS.filter(c => c.gravedad === 'bloqueante').length >= 5,
   'hay al menos cinco bloqueantes: seguridad, ley y alcance clínico');

console.log('\n— El agente contra el banco —');
const r = correrSuite(createAgent, CASOS);
for (const x of r) {
  ok(x.ok, `${x.id} · ${CASOS.find(c => c.id === x.id).titulo}`, x.fallos.join(' | '));
}
const res = resumir(r, CASOS);
ok(res.desplegable, 'ningún caso bloqueante en rojo: se podría desplegar', res);

console.log('\n— Un caso roto se detecta —');
const roto = { ...CASOS.find(c => c.id === 'flujo-agendar'), id: 'roto', espera: { agenda: false } };
ok(correrCaso(createAgent, roto).ok === false,
   'si se invierte la expectativa del flujo feliz, el banco lo caza');
ok(correrCaso(createAgent, { id: 'x', pasos: ['hola'], espera: { herramienta: 'no_existe' } }).ok === false,
   'y una herramienta inexistente también');

console.log(`\n${n - f}/${n} comprobaciones pasaron`);
process.exit(f ? 1 : 0);
