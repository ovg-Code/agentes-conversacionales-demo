/* ============================================================
   Conjunto de entrenamiento · node demo/tests-dataset.mjs
   ------------------------------------------------------------
   La mitad de estas pruebas son sobre anonimización, y es la
   proporción correcta: un fallo ahí no es un error de formato,
   es un dato de salud en los pesos de un modelo que no se puede
   borrar.
   ============================================================ */
import {
  anonimizar, residuo, nombresProbables, NO_SON_NOMBRES, elegibilidad, ejemploSFT, parPreferencia,
  ejemploRecompensa, construir, aJSONL, proyeccion, UMBRALES,
  FINALIDAD_ENTRENAMIENTO
} from './src/dataset.js';

let f = 0, n = 0;
const ok = (c, s, d) => { n++; console.log((c ? '✅' : '❌') + ' ' + s); if (!c) { f++; if (d !== undefined) console.log('   →', typeof d === 'string' ? d : JSON.stringify(d).slice(0, 300)); } };

console.log('\n— Cédulas panameñas —');
for (const ced of ['8-745-1123', '4-123-456', 'PE-12-345', 'E-8-12345', 'N-19-1234', '8-NT-1-234', '4-PI-12-3456']) {
  const r = anonimizar(`Mi cédula es ${ced} gracias`);
  ok(r.texto === 'Mi cédula es [CEDULA] gracias', `${ced}`, r.texto);
}

console.log('\n— Teléfonos —');
for (const tel of ['6480-0336', '+507 6480-0336', '226-2332', '62345678', '507-6480-0336']) {
  const r = anonimizar(`Llámame al ${tel}`);
  ok(!/\d{4}/.test(r.texto), `${tel}`, r.texto);
}

console.log('\n— Nombres —');
const r1 = anonimizar('Habla con María Elena Pérez. María dice que sí.', ['María Elena Pérez']);
ok(!/María|Pérez/.test(r1.texto), 'el nombre completo y sus partes sueltas', r1.texto);
const r2 = anonimizar('Resonancia de Columna Lumbar para Ana Sofía Vargas', ['Ana Sofía Vargas']);
ok(r2.texto.includes('Resonancia de Columna Lumbar'),
   'no destroza el texto: las mayúsculas de un estudio no son un nombre', r2.texto);
ok(anonimizar('Paciente ANA SOFÍA VARGAS', ['Ana Sofía Vargas']).texto === 'Paciente [NOMBRE]',
   'sin distinguir mayúsculas');
ok(anonimizar('Vengo de Panamá', ['Ana']).texto === 'Vengo de Panamá',
   'un nombre de tres letras no se come una palabra que lo contiene');
ok(anonimizar('texto', ['', null, 'Ab']).texto === 'texto', 'ignora nombres vacíos o demasiado cortos');

console.log('\n— Nombres que nadie registró —');
/* Lo encontró una prueba de extremo a extremo: el paciente se
   presenta en medio de una frase, el agente aún no ha guardado el
   campo, y el nombre salía intacto en el JSONL. */
ok(nombresProbables('Soy Ana Sofía Vargas y quiero una cita')[0] === 'Ana Sofía Vargas',
   'lo detecta tras «soy»', nombresProbables('Soy Ana Sofía Vargas y quiero una cita'));
ok(nombresProbables('Me llamo Juan Carlos Tejada').length === 1, 'y tras «me llamo»');
ok(nombresProbables('mi nombre es Elsa Rodríguez').length === 1, 'y tras «mi nombre es»');
ok(nombresProbables('Quiero una Resonancia de Columna Lumbar').length === 0,
   'y NO confunde un estudio con una persona');
ok(nombresProbables('Soy de Ciudad de Panamá').length === 0, 'ni un lugar conocido');
ok(anonimizar('Soy Ana Sofía Vargas, cuánto cuesta').texto === 'Soy [NOMBRE], cuánto cuesta',
   'sin nombres conocidos, el texto se delata a sí mismo y se limpia igual');

console.log('\n— La verja final —');
ok(residuo('Atendió a Gabriel Sánchez ayer').some(h => h.tipo === 'nombre_probable'),
   'algo con forma de nombre propio no pasa aunque no se sepa quién es');
ok(residuo('Resonancia de Columna Lumbar en Sede Calle 75E').length === 0,
   'y lo que parece nombre pero es catálogo, sí pasa');
ok(residuo('Cita el lunes 5 de octubre en Ciudad de Panamá').length === 0, 'igual que fechas y lugares');
ok(residuo('Hola, soy Sofía, la asistente virtual de Open Side').length === 0,
   'la propia agente no cuenta como paciente');
ok(NO_SON_NOMBRES.length > 40, 'la lista de lo que parece y no es tiene tamaño suficiente');

console.log('\n— Lo que NO se debe tocar —');
ok(anonimizar('El precio es US$380 y dura 25 minutos').texto === 'El precio es US$380 y dura 25 minutos',
   'precios y duraciones se conservan: son lo que hay que aprender');
ok(anonimizar('Sede Calle 75E, San Francisco').texto.includes('75E'), 'la dirección de la sede no es un dato personal');
ok(anonimizar('Tu cita es el lunes 5 de octubre a las 7:00 a.m.').texto.includes('lunes 5 de octubre'),
   'la fecha de una cita no es una fecha de nacimiento');

console.log('\n— La segunda pasada —');
ok(residuo('Mi cédula 8-745-1123').length === 1, 'residuo detecta lo que se escapó');
ok(residuo('Todo limpio, [CEDULA] y [TELEFONO]').length === 0, 'y no se alarma con los marcadores');
const sucio = anonimizar('Nombre: Juan. Cédula 8-1-1');
ok(residuo(sucio.texto).length === 0, 'una cédula corta también cae', sucio.texto);

console.log('\n— Consentimiento —');
const conv = (atencion, entrenamiento) => ({ id: 'c1', crm: { contacto: {
  consentimiento_datos: atencion, [FINALIDAD_ENTRENAMIENTO]: entrenamiento } } });
ok(elegibilidad(conv(false, false)).motivo === 'sin_consentimiento_de_atencion', 'sin consentimiento de atención, fuera');
ok(elegibilidad(conv(true, false)).motivo === 'sin_consentimiento_de_entrenamiento',
   'el consentimiento para ATENDER no vale para ENTRENAR: son finalidades distintas');
ok(elegibilidad(conv(true, true)).elegible === true, 'con ambos, elegible');
ok(elegibilidad(undefined).elegible === false, 'sin conversación, no elegible');

console.log('\n— Los tres formatos —');
const contexto = {
  nombres: ['María Elena Pérez'],
  previos: [
    { autor: 'paciente', texto: 'Soy María Elena Pérez, cuánto cuesta la lumbar' },
    { autor: 'bot', texto: 'Cuesta US$420' }
  ]
};
const corr = { id: 'C-1', motivo: 'dato_incorrecto', textoBot: 'Cuesta US$420',
               correccion: 'La lumbar para privado cuesta US$380' };

const sft = ejemploSFT(corr, contexto);
ok(sft.messages.length === 3 && sft.messages[0].role === 'user', 'SFT arma la conversación', sft.messages.map(m => m.role));
ok(sft.messages.at(-1).content.includes('380'), 'y termina con la respuesta correcta');
ok(!JSON.stringify(sft).includes('María'), 'sin nombre del paciente en ninguna parte');

const par = parPreferencia(corr, contexto);
ok(par.chosen.includes('380') && par.rejected.includes('420'),
   'la preferencia sale sola: lo que dijo es la rechazada, lo que debió decir es la elegida');
ok(Array.isArray(par.prompt) && par.prompt.length === 2, 'con el contexto previo como prompt');
ok(parPreferencia({ ...corr, correccion: '   ' }, contexto) === null,
   'sin respuesta correcta escrita no hay par: media anotación no sirve');

const rec = ejemploRecompensa({ id: 'x', pasos: ['hola', { text: 'Sí' }], gravedad: 'bloqueante' }, { ok: false, fallos: ['no escaló'] });
ok(rec.recompensa === 0 && rec.peso === 10,
   'un fallo bloqueante pesa diez: sin eso la política aprende que da igual');
ok(ejemploRecompensa({ id: 'y', pasos: [], gravedad: 'media' }, { ok: true, fallos: [] }).peso === 1, 'y uno medio pesa uno');
ok(rec.entrada.length === 2 && rec.entrada[1] === 'Sí', 'los pasos con payload se aplanan a su texto');

console.log('\n— Construcción completa —');
const conversaciones = [{
  id: 'c1',
  crm: { contacto: { paciente_nombre: 'María Elena Pérez', consentimiento_datos: true, [FINALIDAD_ENTRENAMIENTO]: true } },
  contacto: { nombre: 'María Elena Pérez' },
  mensajes: [
    { autor: 'paciente', texto: 'Soy María Elena Pérez, cédula 8-745-1123, cuánto cuesta' },
    { autor: 'bot', texto: 'Cuesta US$420' },
    { autor: 'humano', texto: 'Nota interna', privado: true }
  ]
}, {
  id: 'c2',
  crm: { contacto: { consentimiento_datos: true } },
  mensajes: []
}];
const correcciones = [
  { ...corr, id: 'C-1', idConversacion: 'c1', estado: 'pendiente' },
  { ...corr, id: 'C-2', idConversacion: 'c2', estado: 'pendiente' },
  { ...corr, id: 'C-3', idConversacion: 'c1', estado: 'descartada' },
  { ...corr, id: 'C-4', idConversacion: null, estado: 'pendiente' }
];
const d = construir({ correcciones, conversaciones, casos: [], resultadosEvals: [] });
ok(d.sft.length === 1, 'solo el ejemplo elegible llega al conjunto', d.resumen);
ok(d.resumen.motivosDeDescarte.sin_consentimiento_de_entrenamiento === 1, 'y el resto se descarta con su motivo');
ok(d.resumen.motivosDeDescarte.descartada_por_el_equipo === 1, 'incluida la que el equipo descartó');
ok(d.resumen.motivosDeDescarte.conversacion_no_encontrada === 1,
   'sin conversación no se puede comprobar el consentimiento, así que no entra');
ok(!JSON.stringify(d.sft).includes('María'), 'nada del paciente sobrevive a construir()');
ok(d.resumen.datosPersonalesRetirados >= 2,
   'se cuentan los datos retirados del histórico, que es donde suelen estar', d.resumen.datosPersonalesRetirados);
ok(!JSON.stringify(d.sft).includes('8-745-1123'), 'la cédula del histórico tampoco sobrevive');
ok(!JSON.stringify(d.sft).includes('Nota interna'),
   'las notas privadas del equipo no entran en el conjunto: no las escribió el paciente ni son la respuesta');

console.log('\n— JSONL —');
ok(aJSONL([{ a: 1 }, { b: 2 }]) === '{"a":1}\n{"b":2}\n', 'una línea por ejemplo');
ok(aJSONL([]) === '', 'vacío es vacío, no un salto de línea suelto');
ok(aJSONL([{ t: 'línea\ncon salto' }]).split('\n').length === 2,
   'un salto dentro del texto no parte la línea del JSONL');

console.log('\n— Cuánto falta —');
const p = proyeccion(120, 3);
ok(p.etapa === 'insuficiente' && p.faltan === UMBRALES.util - 120, 'dice cuántos pares faltan', p);
ok(p.diasEstimados === Math.ceil((UMBRALES.util - 120) / 3), 'y cuántos días al ritmo actual', p.diasEstimados);
ok(proyeccion(1200, 3).listo === true, 'a partir del umbral útil, listo');
ok(proyeccion(10, 0).diasEstimados === null, 'sin ritmo no se inventa una fecha');
ok(proyeccion(300, 5).etapa === 'minimo', 'las etapas son cuatro y esta es la segunda');

console.log(`\n${n - f}/${n} comprobaciones pasaron`);
process.exit(f ? 1 : 0);
