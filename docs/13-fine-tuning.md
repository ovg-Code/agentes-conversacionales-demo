# 13 · Fine-tuning y aprendizaje por refuerzo

> Decisión tomada: va a haber fine-tuning y RL. Este documento es cómo se hace
> desde aquí, no si conviene.

## 1. El hecho que ordena todo lo demás

**Claude no se puede afinar.** Hoy el único camino es Claude 3 Haiku en Amazon
Bedrock, región `us-west-2`: ningún modelo de generación actual —Opus 5,
Sonnet 5, Haiku 4.5— lo admite, y nada por la API de Anthropic.

Eso no cancela el plan. Lo ordena:

```
Claude            → orquestador conversacional. No se afina.
Modelos abiertos  → tareas estrechas. Se afinan, y ahí sí paga.
Herramientas      → la verdad. No se entrenan, se corrigen.
```

Las tareas estrechas donde un modelo afinado gana de verdad en este dominio:

| Tarea | Por qué paga afinar |
|---|---|
| Clasificar la intención del primer mensaje | Miles de ejemplos, una etiqueta, latencia baja y sin llamada a Claude |
| Reconocer cómo llama la gente a su dolor | «espalda baja», «cintura», «el huesito» — español panameño, no del catálogo |
| Extraer cédula, nombre y aseguradora de texto libre | Formato local, muy repetitivo |
| Puntuar si una respuesta cumple la política | Un juez barato para el bucle de RL |

Lo que **no** paga afinar: el tono, el orden de las preguntas, las reglas de
seguridad. Eso vive en el prompt y en el código, y ahí se cambia en minutos en
vez de en una tanda de entrenamiento.

## 2. Las tres etapas y de dónde sale el dato

La pieza que hay que construir primero no es el entrenador —se cambia en una
tarde— sino el dato, que tarda años en acumularse. Está en
`demo/src/dataset.js`, y produce los tres formatos:

### SFT · conversación → respuesta correcta

```json
{"messages":[{"role":"user","content":"…"},{"role":"assistant","content":"…"}]}
```

Sale de las correcciones: lo que escribió la persona que corrigió es la
respuesta correcta.

### DPO · elegida vs rechazada

```json
{"prompt":[…], "chosen":"lo que debió decir", "rejected":"lo que dijo"}
```

**Cada corrección ya es un par de preferencia.** No hay que anotar nada aparte:
lo que dijo el agente es la rechazada, lo que debió decir es la elegida, y el
CRM lleva recogiéndolo desde que existe la sección de Entrenamiento. Esa es la
razón de que la pantalla de correcciones se construyera antes que esta.

### RL con recompensa verificable

```json
{"id":"seguridad-marcapasos","entrada":[…],"recompensa":0,"peso":10}
```

Aquí no hace falta un modelo de recompensa entrenado, y es una suerte: **la
conducta correcta es comprobable por código**. El banco de evaluaciones ya
devuelve 1 o 0 por caso, así que es recompensa verificable directa (RLVR), que
es mucho más estable que un juez aprendido.

El **peso** importa tanto como la recompensa: un fallo bloqueante pesa 10, uno
alto 3, uno medio 1. Sin eso, la política aprende que da igual poner a alguien
con marcapasos en una resonancia mientras acierte los precios.

## 3. Lo que no sale de aquí

Un modelo afinado sobre datos de pacientes convierte datos sensibles en **pesos
que no se pueden borrar**: el derecho de supresión de la Ley 81 de 2019 deja de
poder atenderse. La única salida es que el dato personal no entre. Tres verjas,
en este orden:

**1 · Consentimiento separado.** El consentimiento que el paciente dio es para
que **le atiendan**. No es consentimiento para entrenar un modelo con su
conversación: son finalidades distintas y la ley las trata como tales. Hay un
campo aparte y un interruptor en la ficha de contacto; sin él, la conversación
no entra, y la pantalla dice por qué en vez de disimularlo.

**2 · Anonimización antes del formato.** Cédulas panameñas en sus siete formas,
teléfonos fijos y móviles, correos, fechas de nacimiento, y los nombres — tanto
los que alguien registró en un campo como los que el propio texto se delata
(«soy Ana Sofía Vargas»). Lo que **no** se toca: precios, duraciones,
direcciones de sede y fechas de cita, que son justamente lo que hay que
aprender.

**3 · La verja final.** Tras anonimizar se vuelve a mirar. Si queda algo con
forma de nombre propio que no esté en la lista de lo que lo parece y no lo es
—estudios, sedes, meses, aseguradoras—, **el ejemplo no sale**. Perder un
ejemplo no cuesta nada; filtrar el nombre de un paciente a los pesos de un
modelo, sí.

### Cómo se descubrió que la segunda verja no bastaba

Quitar nombres por coincidencia exacta solo funciona si alguien capturó el
nombre en un campo. Una prueba de extremo a extremo —conversación real,
exportación real, búsqueda del nombre en el JSONL descargado— lo encontró: el
paciente se había presentado en medio de una frase, el agente aún no había
llegado a pedir el nombre, y salía intacto. De ahí salieron la detección por
fórmulas de presentación y, sobre todo, la verja final.

Es la diferencia entre probar el formato y probar la propiedad que importa.

## 4. El número que nadie quiere mirar

Un DPO empieza a notarse hacia los **mil pares**; por debajo de doscientos manda
el ruido. La pantalla lo dice sin adornos: cuántos pares hay, cuántos faltan, y
a qué plazo se llega **al ritmo real de los últimos 30 días**.

Con una corrección al mes, el plazo sale en décadas. Eso no es un argumento en
contra: es el argumento a favor de instrumentar **ahora**, porque el reloj solo
corre si alguien está recogiendo. También dice dónde está la palanca — no en el
entrenador, sino en cuánta gente marca respuestas malas.

## 5. Orden recomendado

1. **Instrumentar** (hecho). Correcciones, evaluaciones, consentimiento
   separado, anonimización, exportación.
2. **Arreglar donde toca** mientras el dato se acumula. La tabla de motivos dice
   el sitio: catálogo, precondición, guardrail o prompt. Esto mejora el agente
   hoy, sin GPU.
3. **Afinar el clasificador de intención** con un modelo abierto en cuanto haya
   unos miles de mensajes etiquetados. Es la victoria más barata y no toca nada
   sensible.
4. **DPO** sobre los pares, cuando pasen del millar.
5. **RL con recompensa verificable** contra el banco, con los pesos por
   gravedad. Y una regla: **el banco que entrena no puede ser el banco que
   evalúa**. Hace falta partirlo, o la política aprende a aprobar el examen en
   vez de a atender.

## Pruebas

```bash
npm run test:dataset
```

63 comprobaciones, y la mitad son sobre anonimización a propósito: un fallo ahí
no es un error de formato. Cubren las siete formas de cédula panameña, fijos y
móviles, nombres con y sin campo registrado, lo que **no** se debe tocar, las
tres verjas, el recuento de datos retirados, los tres formatos y la proyección.

La prueba de extremo a extremo descarga el JSONL de verdad desde el navegador y
busca dentro el nombre, la cédula y el teléfono del paciente.
