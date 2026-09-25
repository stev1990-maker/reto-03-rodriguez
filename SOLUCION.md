# SOLUCIÓN — Reto 03

## 1. Problema en una frase
La analista administrativa pierde tiempo y asume riesgo de error al transcribir manualmente solicitudes de compra a SAP y validar de memoria proveedor, imputación y autoridad del aprobador.

## 2. Arquitectura
`Front chat → API backend → ciclo/orquestación → herramientas OC → fixtures (lectura) / out (escritura) → SapAdapter → SAP mock`.
El comportamiento vive en `agent/prompt.md`, el conocimiento RC1–RC10 en `src/knowledge/ordenes-compra.md` y la ejecución determinista en `src/tools/oc.ts`. El front nunca recibe claves.

## 3. Ciclo del agente
El flujo es leer → validar → construir/evidenciar → mostrar → confirmar si aplica → crear. Los bloqueos nunca se fuerzan. Las confirmaciones detienen el turno y requieren una respuesta posterior. `MAX_AGENT_ITERATIONS` y `MAX_SESSION_TOKENS` quedan configurables para un proveedor LLM. Para la defensa sin clave existe un flujo conversacional determinista que usa exactamente las mismas herramientas.

## 4. Elección del modelo
Se deja un adaptador propio y una implementación OpenAI desacoplada. El modelo solo interpreta/orquesta conversación; no calcula controles ni altera payloads. Modelo sugerido configurable: `gpt-5-mini`. El costo exacto por caso no se fija en el código porque depende del modelo/precio vigente y del volumen de tokens; debe calcularse antes del despliegue con la tarifa vigente. La demo obligatoria cuesta 0 porque no llama un modelo.

## 5. Matriz de controles
| Regla | Implementación | Efecto |
|---|---|---|
| RC1 | NIT o nombre normalizado + activo | bloqueo |
| RC2 | aprobación existe, contiene Aprobado y email autorizado | bloqueo |
| RC3 | total <= tope | bloqueo |
| RC4 | subárea ∈ centro | bloqueo |
| RC5 | diferencia relativa <=2% | confirmación |
| RC6 | IVA faltante desde proveedor | derivado + confirmación |
| RC7 | pago faltante desde proveedor | derivado informativo |
| RC8 | factura anterior a solicitud | retroactiva + confirmación |
| RC9 | aprobación no anterior a solicitud | confirmación |
| RC10 | cantidad × unitario = total ±1 | bloqueo |
La más delicada es RC2/RC3 porque autoridad y tope deben evaluarse juntos sin permitir que el modelo “interprete” permisos.

## 6. Adaptador SAP real
Elegiría OData `API_PURCHASEORDER_PROCESS_SRV` cuando el landscape SAP lo permita, detrás de SAP Integration Suite o un servicio corporativo de integración. `OrdenCompra` se transforma en cabecera, proveedor, sociedad/organización, condiciones y posiciones con centro de costo/impuesto. OAuth/client credentials o el mecanismo corporativo vive en Key Vault/secret manager, nunca en prompt/front/repositorio. Antes de crear se consulta una referencia externa basada en `solicitud_id`; reintentos usan la misma referencia. Un error parcial se conserva como intento fallido y no se reenvía ciegamente. Plan B: generar payload/archivo de carga y evidencia listos para importación o digitación asistida, manteniendo validaciones y trazabilidad.

## 7. Lectura del proceso
Las OC retroactivas no deberían ocultarse ni “arreglarse” automáticamente. Son una señal de que el compromiso económico ocurrió antes del control formal. Recomendaría medir tasa y valor de retroactividad por área/proveedor, acordar una política con Compras/Finanzas y mover el punto de control antes de la prestación o factura. El agente debe registrar el fenómeno y pedir confirmación; la decisión de tolerarlo o bloquearlo pertenece al gobierno del proceso.

## 8. Decisiones y trade-offs
1. Reglas deterministas en TypeScript vs. reglas en prompt: se elige código para auditabilidad y repetibilidad.
2. SAP por interfaz vs. llamadas directas desde tools: se elige `SapAdapter` para sustituir mock por real sin tocar negocio.
3. HTML plano vs. framework SPA: se elige HTML/JS para reducir dependencias y tiempo de arranque.
4. Evidencia TXT P0 vs. PDF: se prioriza el requisito P0; PDF queda como mejora P1.
Alternativa descartada: dejar que el LLM extraiga/corrija montos; viola trazabilidad y aumenta riesgo financiero.

## 9. Supuestos
Los maestros entregados son completos; el correo es evidencia suficiente para el reto; COP/USD son las monedas admitidas; cada fixture contiene una posición; la unidad se deriva de la descripción solo para representar el payload y debe reemplazarse por un campo fuente en producción.

## 10. Cobertura
| Historia | Estado | Falta producción |
|---|---|---|
| HU1 leer paquete | Hecho | parsers binarios reales |
| HU2 validar | Hecho | maestros SAP en tiempo real |
| HU3 payload/trazabilidad | Hecho | mapping SAP definitivo |
| HU4 evidencia | Hecho P0 | PDF/firma si Auditoría lo exige |
| HU5 SAP mock/idempotencia/control | Hecho | adaptador SAP real |
| HU6 errores legibles | Hecho | observabilidad centralizada |
| Chat/tool calls/confirmación | Hecho | autenticación si se exige |
| Link público | Hecho | desplegado en Render en modo determinístico |

### Despliegue de evaluación

La aplicación está disponible públicamente en:

https://reto-03-rodriguez-stev.onrender.com

El despliegue público utiliza `LLM_PROVIDER=deterministic` para permitir la evaluación sin depender de credenciales o consumo de terceros. La arquitectura conserva el adaptador OpenAI y el ciclo de agente para habilitar el modo LLM configurando `LLM_PROVIDER=openai` y una API key con consumo habilitado.

## 11. Uso de IA
Se utilizó ChatGPT para revisar el PRD, estructurar la solución, generar una primera implementación y revisar cobertura. Se mantuvieron deterministas las reglas financieras. Se descartó cualquier propuesta que inventara datos faltantes, corrigiera montos para hacerlos coincidir o permitiera saltar bloqueos.

## 12. Riesgos y mitigaciones
Conectividad SAP: adaptador + Plan B. Datos maestros obsoletos: consulta en tiempo real en producción. Prompt injection: herramientas con contratos y valores autoritativos. Duplicados: idempotencia por `solicitud_id`. Costos LLM: límites por turno/sesión. Fuga de secretos: variables backend/secret manager. Retroactividad: métrica y confirmación humana. Evidencia insuficiente: firma digital si Auditoría la exige.
