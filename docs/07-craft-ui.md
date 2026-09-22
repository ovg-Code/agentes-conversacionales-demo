# 07 · Craft de interfaz

Las interfaces se rehicieron aplicando las skills de diseño de [Emil Kowalski](https://github.com/emilkowalski/skills) (autor de Sonner y Vaul), instaladas en `.claude/skills/`.

## La auditoría de partida

| Comprobación | Antes |
|---|---|
| Elementos pulsables con feedback al presionar | **0** |
| `:hover` protegidos con `@media (hover: hover)` | **0** de 10 |
| Curva de easing | `cubic-bezier(.4, 0, .2, 1)` — la de Material, floja |
| Duración máxima | 320 ms, por encima del límite |
| `prefers-reduced-motion` | mataba toda transición, también las de color |

Ningún botón respondía al ser presionado. En un teléfono eso se nota en cada toque.

## Qué se cambió

### Curvas fuertes

Las curvas nativas de CSS son débiles: les falta el acento que hace que una animación parezca intencionada.

```css
--ease-out:    cubic-bezier(0.23, 1, 0.32, 1);    /* entradas y salidas */
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);   /* movimiento en pantalla */
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);    /* paneles, tipo iOS */
```

**Nunca `ease-in` en interfaz.** Arranca lento justo en el instante en que el usuario más está mirando, y eso se percibe como lentitud aunque la duración sea idéntica.

### Duraciones por debajo de 300 ms

```css
--dur-press:  110ms;   /* respuesta al pulsar */
--dur-fast:   140ms;   /* hover, color */
--dur-base:   200ms;   /* entradas de elementos */
--dur-panel:  260ms;   /* paneles y burbujas */
```

### Feedback al pulsar, en todo

13 elementos pulsables llevan ahora `transform: scale(0.97)` en `:active` (0.92 en los botones circulares, 0.985 en las filas de lista). Verificado en navegador midiendo el `transform` computado durante la pulsación, no solo leyendo el CSS.

### Hover solo donde hay ratón

Los 10 `:hover` están protegidos con `@media (hover: hover) and (pointer: fine)`. En pantallas táctiles el hover se dispara al tocar y deja el estado pegado.

### Nada aparece desde la nada

Las burbujas entran desde `scale(0.97)` con opacidad, nunca desde `scale(0)`. Nada en el mundo real aparece de la nada.

### Movimiento reducido, no movimiento nulo

Antes se anulaba todo. Ahora se conservan opacidad, color y sombra —que ayudan a entender qué cambió— y se elimina el desplazamiento, que es lo que provoca malestar.

### Entradas escalonadas

Las filas de la bandeja entran con 40 ms de diferencia. Suficiente para que se lea como cascada, no tanto como para que la interfaz parezca lenta.

## Lo que la revisión visual encontró

El craft de movimiento no arregla la composición. Mirando capturas aparecieron cuatro defectos que el CSS por sí solo no delataba:

| Defecto | Causa | Arreglo |
|---|---|---|
| El encabezado partía "atiende **una persona**" en dos líneas con tamaño enorme | `.who strong` afectaba a cualquier `strong` descendiente, también al del subtítulo | Acotado a hijo directo: `.who > strong` |
| Los cuatro filtros se solapaban: "1 Humano0 Listas" | La columna de 300 px no daba | 324 px, texto más compacto y "Resueltas" → "Listas" |
| Las notas privadas gritaban más que los mensajes reales | Amarillo saturado a ancho completo | Centradas, al 88 %, fondo al 7 % |
| El acento de color iba a la izquierda en burbujas alineadas a la derecha | — | El acento va del lado por el que entra el mensaje |

Además: los mensajes consecutivos del mismo autor se agrupan (repetir la etiqueta en cada burbuja era ruido), la fecha de consentimiento pasó de ISO crudo a `22 sep · 6:01 p.m.`, y el CRM renderiza el formato de WhatsApp en vez de mostrar los asteriscos.

## Skills instaladas

En `.claude/skills/`: `emil-design-eng`, `animate`, `improve-animations`, `review-animations`, `animation-vocabulary`, `find-animation-opportunities`, `prototype`, `pick-ui-library`, más `performance-cheatsheet.md`.

Las de Swift, Expo y móvil nativo no se instalaron por no aplicar a este proyecto.
