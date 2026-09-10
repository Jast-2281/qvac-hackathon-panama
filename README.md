# Zarpe

Cuánto cuesta de verdad sacar una carga — calculado en el dispositivo, sin señal.

## Qué es

Un comerciante, importador o agente de aduanas en la Zona Libre de Colón necesita
saber, en el momento, cuánto le va a costar traer un producto — arancel, ITBMS,
costo total. Esa decisión se toma casi siempre dentro de un depósito, y dentro de
un depósito de la Zona Libre la señal falla justo cuando más se necesita.

Zarpe corre 100% en el dispositivo con QVAC. El usuario describe la carga en texto
libre y la app responde con el arancel estimado, el ITBMS y el costo total, sin
depender de conexión.

## Arquitectura y por qué

El modelo QVAC tiene un único trabajo: clasificar el texto libre del usuario contra
un **enum cerrado**, construido en tiempo real desde `data/aranceles.json`. La
respuesta se fuerza con `responseFormat: json_schema` — el SDK convierte ese schema
a gramática GBNF de llama.cpp, así que estructuralmente el modelo no puede devolver
una categoría que no exista en la tabla.

El cálculo de impuestos es aritmética determinista en `src/calculo.js`, sin ningún
componente de IA: misma entrada, mismo resultado, siempre. El modelo nunca produce
una tasa, un monto ni un impuesto — solo elige una categoría. Esa separación es el
argumento central del proyecto: **Zarpe no puede alucinar un impuesto**, porque la
única pieza que podría hacerlo (el modelo) nunca tiene la posibilidad de proponer un
número.

## La bifurcación de régimen

La mercancía introducida a la Zona Libre de Colón con destino final el extranjero
(reexportación) no causa DAI ni ITBMS panameño. La que se nacionaliza — entra a
territorio fiscal panameño — sí los causa. Zarpe siempre calcula y muestra **las dos
cifras**, para que la decisión de a dónde va la carga se tome con el costo real de
ambos caminos delante, no solo del elegido.

## Cómo correrlo

Requiere Node ≥ 22.17.

```bash
npm install
QVAC_CONFIG_PATH=./qvac.config.json node src/server.js
```

Servidor en `http://localhost:4173`.

## Track

Zarpe se presenta únicamente al **Track 03 – Desafío General** ($6,000). No aplica
a ningún track corporativo.

## Base preexistente declarada (Art. 11.c)

**Tabla de aranceles (`data/aranceles.json`):** los datos provienen de la
Herramienta Interactiva del Arancel Nacional, Autoridad Nacional de Aduanas
(https://aranceles.ana.gob.pa/), consultada el 9 de septiembre de 2026.

**Conocimiento de dominio:** cómo se calcula el arancel, el público real y la
terminología se informan de [tradefacilpanama.com](https://tradefacilpanama.com),
proyecto propio anterior al hackathon. No se reutilizó código de ese proyecto —
ni una línea.

**Andamiaje previo al 9 de septiembre:** verificación de entorno Node/QVAC,
instalación del SDK y un script de prueba (`index.js`), preparados el 7 de
septiembre conforme al Art. 11(b) del reglamento.

**Código del producto:** todo el código de este repositorio — núcleo de
clasificación, cálculo, servidor e interfaz (`src/`, `public/`, `data/`) — se
escribió el 9 de septiembre de 2026, dentro de la ventana de 48 horas.

**Librerías de terceros:** `@qvac/sdk` (^0.19.0), con su propia licencia.

**Asistentes de IA:** se usaron asistentes de programación basados en IA para
escribir y depurar código, conforme al reglamento (Art. 11.d).

## Decisiones técnicas

Comparamos `LLAMA_3_2_1B_INST_Q4_0` y `QWEN3_600M_INST_Q4` con el mismo prompt y el
mismo schema. Con la frase "tres bicicletas de montaña" — un producto fuera de las
categorías cubiertas — Qwen la clasificó como camisetas con confianza 0.96,
superando el umbral de aceptación; LLAMA la dejó en 0.50 y el sistema bloqueó la
respuesta.

Elegimos LLAMA por seguridad, no por acierto aparente. El enum obliga al modelo a
elegir siempre una categoría existente de la lista, pero esa lista incluye "otros"
como categoría de escape, y el prompt le indica explícitamente usarla cuando la
descripción no corresponde con claridad a ninguna categoría cubierta. Aun así, el
modelo puede sobrestimar su propia certeza, así que el umbral de confianza sigue
siendo la defensa real contra productos fuera de cobertura, y en esa prueba puntual
LLAMA se comportó de forma más conservadora.

## Limitaciones conocidas

- Solo 3 categorías con tributos verificados: cigarrillos, licores, camisetas.
- Solo tasas NMF (nación más favorecida) — sin tratados preferenciales por origen.
- Supuesto sin confirmar: el cálculo excluye el ISC de la base del ITBMS; falta
  verificar contra el Código Fiscal antes de tratarlo como definitivo.
- Es una estimación orientativa contra el Arancel Nacional, no un dictamen oficial
  de clasificación arancelaria.
- El atajo por keywords rechaza subcadenas (p. ej. "ron" dentro de "drones"),
  negaciones ("no son camisetas", "camisetas sin algodón") y contradicciones de
  material/forma para camisetas (poliéster, seda, rollos de tela, entre otras).
  Una coma, un "+", un ";", un salto de línea o un "y" suelto en la descripción
  ("camisetas y zapatos") se tratan como posible carga mixta: no se usa el atajo
  y, si igual el resultado final contradice la categoría o sugiere más de un
  producto, el cálculo se bloquea aunque la clasificación venga del modelo.
  Una palabra usada en un contexto no literal (p. ej. "fundas para camisetas")
  no tiene una regla de keywords segura — rompería descripciones válidas como
  "camisetas para hombre". En vez de eso, las categorías donde esto es un
  riesgo real (por ahora, camisetas) exigen una confirmación explícita del
  usuario antes de calcular: Zarpe propone la categoría y pregunta si el
  producto y el material son los correctos, y solo calcula tras un sí. Esto
  cierra el caso "fundas para camisetas" sin agregar más reglas de keywords.

## Evidencia de inferencia local

`LLAMA_3_2_1B_INST_Q4_0` corriendo sobre Apple Silicon con aceleración Metal.
Verificado con el flujo completo — carga de modelo, clasificación, cálculo — con el
wifi apagado. Ninguna llamada de inferencia sale del equipo.

## Video de demostración

[Enlace acá — máximo 5 minutos, en español, sin credenciales]
