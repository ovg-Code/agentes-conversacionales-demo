# 08 · Línea gráfica

El CRM sigue la línea gráfica de Chatwoot. Los valores no están estimados a ojo: salen de su código fuente (`app/javascript/.../woot.scss`, `tailwind.config.js`, `theme/colors.js`) en el clon que tenemos.

## Qué usa Chatwoot

| Pieza | Chatwoot | Nosotros |
|---|---|---|
| Color | **Radix Colors**, escalas de 12 pasos | Las mismas escalas, mismos valores |
| Acento | `iris` | `iris` |
| Neutros | `slate` | `slate` |
| Estados | `teal` · `amber` · `ruby` | Iguales |
| Tipografía | **Inter**, con pesos 420/440/460/520/620 | Inter, con 420 · 500 · 560 · 600 |
| Iconos | **Lucide** (`i-lucide-*`) | Lucide 1.47.0, incrustado |
| Modo oscuro | Escalas oscuras de Radix, por clase | Escalas oscuras de Radix, por atributo y por preferencia del sistema |

## Por qué Radix y no una paleta propia

Radix asigna un papel fijo a cada paso, y eso convierte el color en una decisión resuelta:

| Pasos | Papel |
|---|---|
| 1–2 | Fondos de página y panel |
| 3–5 | Fondos de componente: normal, hover, activo |
| 6–8 | Bordes: sutil, con interacción, fuerte |
| 9–10 | Sólidos: el color de marca y su hover |
| 11–12 | Texto: secundario y primario |

En `tokens.css` las escalas se declaran como tripletes RGB y encima van los **papeles semánticos** (`--surface-panel`, `--text-secondary`, `--acento`…). Las reglas del proyecto nombran el papel, nunca el color, así que cambiar de escala es tocar un bloque y no cada archivo.

## Iconos

Se pasó de SVG dibujados a mano a **Lucide**, el set que usa Chatwoot. Están incrustados en `demo/src/iconos.js` en lugar de cargarse de un CDN, para que la interfaz no dependa de la red.

```js
icono('buscar', { size: 15 })          // devuelve el SVG
pintarIconos()                          // sustituye todo [data-icono] del documento
```

36 iconos, con los paths oficiales. La licencia de Lucide es ISC y la atribución está en la cabecera del archivo.

### Un fallo en la extracción que costó encontrar

Los archivos de `lucide-static` empiezan con `<!-- @license lucide-static v1.47.0 - ISC -->`. El primer extractor buscaba el contenido con `>(.*)</svg>`, y el primer `>` que encontraba era **el del comentario**, no el de la etiqueta `<svg>`. Resultado: cada icono quedó envuelto en un SVG dentro de otro SVG.

Se veía el dibujo, así que a simple vista parecía bien. Lo que delató el problema fue que **el texto junto al icono desaparecía**: un chip que debía decir "⏱ ahora" salía con el reloj y sin la palabra. La comprobación automática lo cazó comparando `innerText` (vacío) con `textContent` (`"  ahora"`).

## Otro fallo del mismo tipo

Las filas de la bandeja son elementos `<button>`, y sin un `border: 0` explícito conservan el **borde de 2 px que el navegador les pone por defecto**. Con la paleta anterior pasaba desapercibido; con la de Chatwoot apareció como un rectángulo negro alrededor de la lista.

Ambos casos se arreglaron y se añadió una comprobación que recorre todos los `<button>` de las dos páginas buscando bordes por defecto del navegador.

## Movimiento

Se conserva lo de la pasada anterior: curvas fuertes, nada por encima de 300 ms, feedback al pulsar en todo lo pulsable, `:hover` sólo donde hay ratón, y movimiento reducido que mantiene opacidad y color pero quita el desplazamiento.
