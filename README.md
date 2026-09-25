# Reto 03 — Agente conversacional “Órdenes de Compra SAP”

Solución del reto técnico para procesar solicitudes de órdenes de compra, aplicar reglas de negocio, gestionar excepciones y confirmaciones humanas, construir el payload de la OC y simular su creación en SAP.

## Requisitos

- Node.js 20 o superior
- npm

## Instalación y arranque

```bash
npm install
npm run dev
```

Abrir en el navegador:

```text
http://localhost:3000
```

El frontend y el backend se sirven desde el mismo proceso.

## Modos de ejecución

La aplicación soporta dos modos mediante `LLM_PROVIDER`.

### Modo determinístico

```env
LLM_PROVIDER=deterministic
```

Utiliza las mismas herramientas y reglas de negocio del agente sin consumir una API externa. Es el modo recomendado para ejecutar la evaluación sin credenciales de terceros.

### Modo OpenAI

```env
LLM_PROVIDER=openai
LLM_MODEL=gpt-5-mini
OPENAI_API_KEY=<clave-configurada-en-backend>
```

El proyecto incluye un adapter para OpenAI y un loop de agente con function calling.

La clave se configura exclusivamente mediante variables de entorno del backend. Nunca debe incluirse en el frontend, repositorio, logs o archivos entregables.

> El modo OpenAI requiere que la cuenta asociada a la API tenga consumo habilitado. El modo determinístico no requiere créditos ni API key.

## Variables de entorno

Puede utilizarse `.env.example` como referencia.

Variables disponibles:

```env
PORT=3000
LLM_PROVIDER=deterministic
LLM_MODEL=gpt-5-mini
OPENAI_API_KEY=
MAX_AGENT_ITERATIONS=25
MAX_SESSION_TOKENS=12000
LLM_TIMEOUT_MS=30000
```

El archivo `.env` está excluido del repositorio mediante `.gitignore`.

## Demo determinística

Ejecutar:

```bash
npm run demo
```

La demo limpia y regenera `out/` y procesa los seis escenarios:

- `sol-001`: flujo normal.
- `sol-002`: bloqueo RC1 por proveedor inexistente o inactivo.
- `sol-003`: bloqueo RC2 por aprobación inválida.
- `sol-004`: confirmación humana RC5 por diferencia entre solicitud y cotización.
- `sol-005`: operación retroactiva y confirmación RC8.
- `sol-006`: IVA ausente, derivación y confirmación RC6.

Finalmente vuelve a ejecutar `sol-001` para demostrar idempotencia.

## Pruebas automatizadas

Ejecutar:

```bash
npm test
```

La suite valida los seis escenarios principales y sus reglas críticas.

Para comprobar TypeScript:

```bash
npm run check
```

## Prueba sugerida en el chat

Enviar:

```text
Procesa la solicitud sol-004. Muéstrame la OC como quedaría en SAP, qué validaciones pasó y cuáles no, y no la crees hasta que yo lo confirme.
```

El sistema debe presentar la OC propuesta y solicitar confirmación sin crearla.

Después enviar:

```text
Confirmo
```

Solo entonces se permite ejecutar la creación simulada de la OC.

## API

### POST /api/chat

Entrada:

```json
{
  "sessionId": "demo-001",
  "message": "Procesa la solicitud sol-004"
}
```

### GET /api/sessions/:id

Consulta el estado de una sesión.

### GET /api/health

Permite verificar que el servicio se encuentra activo y muestra el modo de ejecución configurado.

## Salidas y trazabilidad

La ejecución genera artefactos en:

```text
out/<caso>/aprobacion.txt
out/<caso>/trazabilidad.json
out/sap/ordenes.jsonl
out/control.csv
out/log.jsonl
```

El SAP utilizado en el reto es un mock local. Las órdenes se generan secuencialmente y la creación es idempotente por solicitud.

## Seguridad

- Las credenciales LLM se leen únicamente desde variables de entorno del backend.
- `.env` no se versiona.
- No se utilizan credenciales SAP reales.
- No se ejecutan comandos de shell desde las herramientas del agente.
- La creación de una OC con excepciones requiere confirmación humana explícita.
- Una solicitud bloqueada no puede ser forzada mediante confirmación.

## URL pública

La URL pública del despliegue se añadirá aquí al finalizar el despliegue.

## Documentación técnica

La arquitectura, decisiones de diseño, reglas RC1–RC10, trazabilidad, seguridad, limitaciones y decisiones de producción se encuentran documentadas en:

```text
SOLUCION.md
```