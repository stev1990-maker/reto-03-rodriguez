import "dotenv/config";

import express from "express";
import path from "node:path";
import {
  mkdir,
  appendFile,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  PurchaseOrderAgent,
} from "./agent/loop.js";

import {
  OpenAIAdapter,
} from "./llm/openai.js";

import {
  leer_paquete,
  validar,
  construir_payload,
  crear,
  type ToolCtx,
} from "./tools/oc.js";

import type {
  Paquete,
  Validacion,
  OrdenCompra,
} from "./types.js";

import type {
  LlmMessage,
} from "./llm/adapter.js";

const root = path.resolve(
  path.dirname(
    fileURLToPath(import.meta.url)
  ),
  ".."
);

const app = express();

app.use(
  express.json({
    limit: "1mb",
  })
);

app.use(
  express.static(
    path.join(root, "web")
  )
);

const provider = (
  process.env.LLM_PROVIDER ??
  "deterministic"
).toLowerCase();

/*
 * El agente OpenAI solamente se crea
 * cuando el proveedor seleccionado es openai.
 *
 * En modo deterministic no se consume API.
 */
const openAiAgent =
  provider === "openai"
    ? new PurchaseOrderAgent(
        root,
        new OpenAIAdapter()
      )
    : undefined;

/* -------------------------------------------------
 * SESIONES
 * ------------------------------------------------- */

type ChatHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

type Session = {
  caso?: string;
  paquete?: Paquete;
  validacion?: Validacion;
  payload?: OrdenCompra;
  history: ChatHistoryMessage[];
};

const sessions =
  new Map<string, Session>();

/* -------------------------------------------------
 * HELPERS
 * ------------------------------------------------- */

type ToolResult<T> = {
  ok: boolean;
  data?: T;
  error?: string;
};

function parse<T>(
  value: string
): ToolResult<T> {
  return JSON.parse(
    value
  ) as ToolResult<T>;
}

async function log(
  obj: Record<string, unknown>
) {
  await mkdir(
    path.join(root, "out"),
    {
      recursive: true,
    }
  );

  await appendFile(
    path.join(
      root,
      "out/log.jsonl"
    ),
    JSON.stringify({
      ...obj,
      ts: new Date().toISOString(),
    }) + "\n"
  );
}

async function callTool<T>(
  name: string,
  args: unknown,
  fn: () => Promise<string>,
  calls: Array<unknown>
): Promise<T> {
  const result =
    parse<T>(
      await fn()
    );

  calls.push({
    name,
    args,
    result: result.ok
      ? result.data
      : {
          error: result.error,
        },
  });

  await log({
    type: "tool",
    name,
    args,
    result,
  });

  if (
    !result.ok ||
    result.data === undefined
  ) {
    throw new Error(
      result.error ??
        `Error ejecutando ${name}.`
    );
  }

  return result.data;
}

function money(
  value: number
) {
  return new Intl.NumberFormat(
    "es-CO",
    {
      style: "currency",
      currency: "COP",
      maximumFractionDigits: 0,
    }
  ).format(value);
}

function extractCase(
  message: string
): string | undefined {
  const match =
    message.match(
      /\bsol-?0*([1-6])\b/i
    );

  return match
    ? `sol-00${match[1]}`
    : undefined;
}

function isConfirmation(
  message: string
): boolean {
  const normalized =
    message
      .trim()
      .toLowerCase();

  return [
    "confirmo",
    "sí, confirmo",
    "si, confirmo",
    "confirmar",
    "proceder",
    "proceda",
    "puedes proceder",
    "puede proceder",
  ].includes(normalized);
}

/* -------------------------------------------------
 * HEALTH
 * ------------------------------------------------- */

app.get(
  "/api/health",
  (_req, res) => {
    res.json({
      ok: true,
      provider,
      model:
        provider === "openai"
          ? process.env.LLM_MODEL ??
            "gpt-5-mini"
          : "deterministic-tools",
    });
  }
);

/* -------------------------------------------------
 * CONSULTA DE SESIÓN
 * ------------------------------------------------- */

app.get(
  "/api/sessions/:id",
  (req, res) => {
    res.json(
      sessions.get(
        req.params.id
      ) ?? {
        history: [],
      }
    );
  }
);

/* -------------------------------------------------
 * MODO OPENAI
 * ------------------------------------------------- */

async function runOpenAi(
  sessionId: string,
  message: string,
  session: Session
) {
  if (!openAiAgent) {
    throw new Error(
      "El agente OpenAI no está habilitado."
    );
  }

  const history: LlmMessage[] =
    session.history.map(
      (item) => ({
        role: item.role,
        content: item.content,
      })
    );

  const result =
    await openAiAgent.run(
      sessionId,
      message,
      history
    );

  session.history.push(
    {
      role: "user",
      content: message,
    },
    {
      role: "assistant",
      content: result.text,
    }
  );

  sessions.set(
    sessionId,
    session
  );

  return {
    sessionId,
    reply: result.text,
    toolCalls:
      result.toolCalls,
    needsConfirmation:
      result.needsConfirmation,
    payload:
      result.payload,
  };
}

/* -------------------------------------------------
 * MODO DETERMINÍSTICO
 * ------------------------------------------------- */

async function runDeterministic(
  sessionId: string,
  message: string,
  session: Session
) {
  const calls:
    Array<unknown> = [];

  const detectedCase =
    extractCase(message);

  const confirmation =
    isConfirmation(message);

  /*
   * NUEVA SOLICITUD
   */
  if (detectedCase) {
    session.caso =
      detectedCase;

    session.paquete =
      undefined;

    session.validacion =
      undefined;

    session.payload =
      undefined;

    const ctx: ToolCtx = {
      directory: root,
      sessionId,
    };

    session.paquete =
      await callTool<Paquete>(
        "oc_leer_paquete",
        {
          caso:
            session.caso,
        },
        () =>
          leer_paquete.execute(
            {
              caso:
                session.caso!,
            },
            ctx
          ),
        calls
      );

    session.validacion =
      await callTool<Validacion>(
        "oc_validar",
        {
          caso:
            session.caso,
          paquete:
            "<normalizado>",
        },
        () =>
          validar.execute(
            {
              caso:
                session.caso!,
              paquete:
                session.paquete!,
            },
            ctx
          ),
        calls
      );

    /*
     * CASO BLOQUEADO
     */
    if (
      !session.validacion.apta
    ) {
      const reply =
        `La solicitud ${session.caso} está BLOQUEADA y no crearé la OC. ` +
        session.validacion.bloqueos
          .map(
            (issue) =>
              `${issue.codigo}: ${issue.detalle}`
          )
          .join(" ");

      session.history.push(
        {
          role: "user",
          content: message,
        },
        {
          role: "assistant",
          content: reply,
        }
      );

      sessions.set(
        sessionId,
        session
      );

      return {
        sessionId,
        reply,
        toolCalls: calls,
        needsConfirmation:
          false,
      };
    }

    /*
     * CONSTRUCCIÓN DE LA OC PROPUESTA.
     *
     * Todavía NO está confirmada.
     */
    const built =
      await callTool<{
        payload:
          OrdenCompra;
        trazabilidad:
          string;
      }>(
        "oc_construir_payload",
        {
          caso:
            session.caso,
          confirmado:
            false,
        },
        () =>
          construir_payload.execute(
            {
              caso:
                session.caso!,
              paquete:
                session.paquete!,
              derivados:
                session.validacion!
                  .derivados,
              confirmaciones:
                session.validacion!
                  .confirmaciones,
              confirmado:
                false,
            },
            ctx
          ),
        calls
      );

    session.payload =
      built.payload;

    /*
     * REQUIERE CONFIRMACIÓN HUMANA
     */
    if (
      session.validacion
        .confirmaciones.length >
      0
    ) {
      const position =
        session.payload
          .posiciones[0];

      const validations =
        session.validacion
          .confirmaciones
          .map(
            (issue) =>
              `${issue.codigo}: ${issue.detalle}`
          )
          .join(" ");

      const retroactive =
        session.validacion
          .retroactiva
          ? " La OC está marcada como RETROACTIVA."
          : "";

      const reply =
        `${session.caso} es apta, pero requiere confirmación. ` +
        `${validations}${retroactive} ` +
        `OC propuesta para SAP: ` +
        `proveedor ${session.payload.proveedor.nombre}, ` +
        `NIT ${session.payload.proveedor.nit}, ` +
        `${position.cantidad} x ${money(position.precio_unitario)}, ` +
        `centro de costo ${position.centro_costo}, ` +
        `subárea ${position.subarea}, ` +
        `IVA ${position.indicador_iva}, ` +
        `condiciones de pago ${session.payload.condiciones_pago}. ` +
        `No se ha creado ninguna OC. ` +
        `¿Confirmas que proceda a crearla?`;

      session.history.push(
        {
          role: "user",
          content: message,
        },
        {
          role: "assistant",
          content: reply,
        }
      );

      sessions.set(
        sessionId,
        session
      );

      return {
        sessionId,
        reply,
        toolCalls: calls,
        needsConfirmation:
          true,
        payload:
          session.payload,
      };
    }

    /*
     * NO REQUIERE CONFIRMACIÓN:
     * puede crear directamente.
     */
    const created =
      await callTool<{
        numero_oc: string;
        fecha: string;
        idempotente: boolean;
      }>(
        "oc_crear",
        {
          caso:
            session.caso,
        },
        () =>
          crear.execute(
            {
              caso:
                session.caso!,
              payload:
                session.payload!,
              validacion:
                session.validacion!,
            },
            ctx
          ),
        calls
      );

    const reply =
      `OC creada: ${created.numero_oc}` +
      (
        created.idempotente
          ? " (ya existía; idempotencia aplicada)"
          : ""
      ) +
      `. Evidencia: out/${session.caso}/aprobacion.txt.`;

    session.history.push(
      {
        role: "user",
        content: message,
      },
      {
        role: "assistant",
        content: reply,
      }
    );

    sessions.set(
      sessionId,
      session
    );

    return {
      sessionId,
      reply,
      toolCalls: calls,
      needsConfirmation:
        false,
      payload:
        session.payload,
    };
  }

  /*
   * CONFIRMACIÓN DE UNA SOLICITUD
   * YA PROCESADA.
   */
  if (
    confirmation &&
    session.caso &&
    session.paquete &&
    session.payload &&
    session.validacion
  ) {
    if (
      !session.validacion.apta
    ) {
      throw new Error(
        "Una solicitud bloqueada no puede confirmarse."
      );
    }

    if (
      session.validacion
        .confirmaciones.length ===
      0
    ) {
      throw new Error(
        "Esta solicitud no tiene confirmaciones pendientes."
      );
    }

    const ctx: ToolCtx = {
      directory: root,
      sessionId,
    };

    const built =
      await callTool<{
        payload:
          OrdenCompra;
        trazabilidad:
          string;
      }>(
        "oc_construir_payload",
        {
          caso:
            session.caso,
          confirmado:
            true,
        },
        () =>
          construir_payload.execute(
            {
              caso:
                session.caso!,
              paquete:
                session.paquete!,
              derivados:
                session.validacion!
                  .derivados,
              confirmaciones:
                session.validacion!
                  .confirmaciones,
              confirmado:
                true,
            },
            ctx
          ),
        calls
      );

    session.payload =
      built.payload;

    const created =
      await callTool<{
        numero_oc: string;
        fecha: string;
        idempotente: boolean;
      }>(
        "oc_crear",
        {
          caso:
            session.caso,
          confirmado:
            true,
        },
        () =>
          crear.execute(
            {
              caso:
                session.caso!,
              payload:
                session.payload!,
              confirmado:
                true,
              validacion:
                session.validacion!,
            },
            ctx
          ),
        calls
      );

    const reply =
      `Confirmación registrada. OC ${created.numero_oc} ` +
      (
        created.idempotente
          ? "recuperada sin duplicar"
          : "creada correctamente"
      ) +
      `. Evidencia: out/${session.caso}/aprobacion.txt.`;

    session.history.push(
      {
        role: "user",
        content: message,
      },
      {
        role: "assistant",
        content: reply,
      }
    );

    sessions.set(
      sessionId,
      session
    );

    return {
      sessionId,
      reply,
      toolCalls: calls,
      needsConfirmation:
        false,
      payload:
        session.payload,
    };
  }

  /*
   * MENSAJE SIN CASO RECONOCIBLE
   */
  const reply =
    'Indícame una solicitud, por ejemplo: "Procesa la solicitud sol-004".';

  session.history.push(
    {
      role: "user",
      content: message,
    },
    {
      role: "assistant",
      content: reply,
    }
  );

  sessions.set(
    sessionId,
    session
  );

  return {
    sessionId,
    reply,
    toolCalls: calls,
    needsConfirmation:
      false,
  };
}

/* -------------------------------------------------
 * CHAT
 * ------------------------------------------------- */

app.post(
  "/api/chat",
  async (req, res) => {
    const sessionId =
      String(
        req.body.sessionId ??
          crypto.randomUUID()
      );

    const message =
      String(
        req.body.message ??
          ""
      ).trim();

    if (!message) {
      return res
        .status(400)
        .json({
          sessionId,
          reply:
            "El mensaje no puede estar vacío.",
          toolCalls: [],
          needsConfirmation:
            false,
        });
    }

    const session =
      sessions.get(
        sessionId
      ) ?? {
        history: [],
      };

    try {
      const result =
        provider === "openai"
          ? await runOpenAi(
              sessionId,
              message,
              session
            )
          : await runDeterministic(
              sessionId,
              message,
              session
            );

      return res.json(
        result
      );
    } catch (error) {
      const detail =
        error instanceof Error
          ? error.message
          : String(error);

      return res
        .status(500)
        .json({
          sessionId,
          reply:
            `No pude completar la operación: ${detail}`,
          toolCalls: [],
          needsConfirmation:
            false,
        });
    }
  }
);

/* -------------------------------------------------
 * START
 * ------------------------------------------------- */

const port =
  Number(
    process.env.PORT ??
      3000
  );

app.listen(
  port,
  () => {
    console.log(
      `Reto 03 listo en http://localhost:${port}`
    );

    console.log(
      provider === "openai"
        ? `Modo: OpenAI / ${
            process.env.LLM_MODEL ??
            "gpt-5-mini"
          }`
        : "Modo: deterministic / tools locales"
    );
  }
);