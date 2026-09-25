import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  LlmAdapter,
  LlmMessage,
  LlmTool,
} from "../llm/adapter.js";

import {
  tools,
  type ToolCtx,
} from "../tools/oc.js";

import type {
  Paquete,
  Validacion,
  OrdenCompra,
} from "../types.js";

type AgentState = {
  caso?: string;
  paquete?: Paquete;
  validacion?: Validacion;
  payload?: OrdenCompra;
  confirmado: boolean;
};

export type AgentToolCall = {
  name: string;
  args: unknown;
  result: unknown;
};

export type AgentResult = {
  text: string;
  toolCalls: AgentToolCall[];
  needsConfirmation: boolean;
  payload?: OrdenCompra;
};

type ToolResult<T> = {
  ok: boolean;
  data?: T;
  error?: string;
};

function parseToolResult<T>(
  value: string
): ToolResult<T> {
  return JSON.parse(value) as ToolResult<T>;
}

function extractCase(
  text: string
): string | undefined {
  const match =
    text.match(/sol-?0*([1-6])/i);

  return match
    ? `sol-00${match[1]}`
    : undefined;
}

function isConfirmation(
  text: string
): boolean {
  return /\b(confirmo|confirmar|sí|si|proceder)\b/i.test(
    text
  );
}

function toJsonSchema(
  args: Record<string, unknown>
): Record<string, unknown> {
  const properties: Record<
    string,
    unknown
  > = {};

  for (const key of Object.keys(args)) {
    properties[key] = {};
  }

  return {
    type: "object",
    properties,
    additionalProperties: false,
  };
}

function llmTools(): LlmTool[] {
  return Object.entries(tools).map(
    ([name, tool]) => ({
      name,
      description: tool.description,
      parameters: toJsonSchema(
        tool.args
      ),
    })
  );
}

async function loadInstructions(
  root: string
): Promise<string> {
  const [prompt, knowledge] =
    await Promise.all([
      readFile(
        path.join(
          root,
          "agent/prompt.md"
        ),
        "utf8"
      ),

      readFile(
        path.join(
          root,
          "src/knowledge/ordenes-compra.md"
        ),
        "utf8"
      ),
    ]);

  return `${prompt}\n\n${knowledge}`;
}

export class PurchaseOrderAgent {
  private states = new Map<
    string,
    AgentState
  >();

  constructor(
    private root: string,
    private llm: LlmAdapter
  ) {}

  private async executeTool(
    name: string,
    requestedArgs: unknown,
    state: AgentState,
    ctx: ToolCtx
  ): Promise<AgentToolCall> {
    const caso = state.caso;

    if (!caso) {
      throw new Error(
        "No hay una solicitud seleccionada."
      );
    }

    if (name === "oc_leer_paquete") {
      const result =
        parseToolResult<Paquete>(
          await tools.oc_leer_paquete.execute(
            { caso },
            ctx
          )
        );

      if (
        !result.ok ||
        !result.data
      ) {
        throw new Error(
          result.error ??
            "No fue posible leer el paquete."
        );
      }

      state.paquete =
        result.data;

      return {
        name,
        args: { caso },
        result: result.data,
      };
    }

    if (name === "oc_validar") {
      if (!state.paquete) {
        throw new Error(
          "Primero debe ejecutarse oc_leer_paquete."
        );
      }

      const result =
        parseToolResult<Validacion>(
          await tools.oc_validar.execute(
            {
              caso,
              paquete:
                state.paquete,
            },
            ctx
          )
        );

      if (
        !result.ok ||
        !result.data
      ) {
        throw new Error(
          result.error ??
            "No fue posible validar la solicitud."
        );
      }

      state.validacion =
        result.data;

      return {
        name,
        args: {
          caso,
          paquete:
            "<paquete controlado por backend>",
        },
        result: result.data,
      };
    }

    if (
      name ===
      "oc_generar_evidencia"
    ) {
      if (!state.validacion) {
        throw new Error(
          "Primero debe validarse la solicitud."
        );
      }

      const result =
        parseToolResult<unknown>(
          await tools.oc_generar_evidencia.execute(
            { caso },
            ctx
          )
        );

      if (!result.ok) {
        throw new Error(
          result.error ??
            "No fue posible generar la evidencia."
        );
      }

      return {
        name,
        args: { caso },
        result: result.data,
      };
    }

    if (
      name ===
      "oc_construir_payload"
    ) {
      if (
        !state.paquete ||
        !state.validacion
      ) {
        throw new Error(
          "Primero debe leerse y validarse la solicitud."
        );
      }

      if (
        !state.validacion.apta
      ) {
        throw new Error(
          "No se puede construir una OC bloqueada."
        );
      }

      const result =
        parseToolResult<{
          payload: OrdenCompra;
          trazabilidad: string;
        }>(
          await tools.oc_construir_payload.execute(
            {
              caso,
              paquete:
                state.paquete,
              derivados:
                state.validacion
                  .derivados,
              confirmaciones:
                state.validacion
                  .confirmaciones,
              confirmado:
                state.confirmado,
            },
            ctx
          )
        );

      if (
        !result.ok ||
        !result.data
      ) {
        throw new Error(
          result.error ??
            "No fue posible construir el payload."
        );
      }

      state.payload =
        result.data.payload;

      return {
        name,
        args: {
          caso,
          confirmado:
            state.confirmado,
        },
        result: result.data,
      };
    }

    if (
      name === "oc_crear"
    ) {
      if (
        !state.validacion ||
        !state.payload
      ) {
        throw new Error(
          "La OC debe estar validada y construida antes de crearla."
        );
      }

      if (
        !state.validacion.apta
      ) {
        throw new Error(
          "La solicitud está bloqueada."
        );
      }

      if (
        state.validacion
          .confirmaciones.length >
          0 &&
        !state.confirmado
      ) {
        throw new Error(
          "Se requiere confirmación humana antes de crear la OC."
        );
      }

      const result =
        parseToolResult<{
          numero_oc: string;
          fecha: string;
          idempotente: boolean;
        }>(
          await tools.oc_crear.execute(
            {
              caso,
              payload:
                state.payload,
              confirmado:
                state.confirmado,
              validacion:
                state.validacion,
            },
            ctx
          )
        );

      if (
        !result.ok ||
        !result.data
      ) {
        throw new Error(
          result.error ??
            "No fue posible crear la OC."
        );
      }

      return {
        name,
        args: {
          caso,
          confirmado:
            state.confirmado,
        },
        result: result.data,
      };
    }

    throw new Error(
      `Herramienta no permitida: ${name}`
    );
  }

  async run(
    sessionId: string,
    userMessage: string,
    history: LlmMessage[]
  ): Promise<AgentResult> {
    const state =
      this.states.get(
        sessionId
      ) ?? {
        confirmado: false,
      };

    const detectedCase =
      extractCase(userMessage);

    if (detectedCase) {
      state.caso =
        detectedCase;

      state.paquete =
        undefined;

      state.validacion =
        undefined;

      state.payload =
        undefined;

      state.confirmado =
        false;
    }

    if (
      isConfirmation(
        userMessage
      ) &&
      state.validacion
        ?.confirmaciones.length
    ) {
      state.confirmado =
        true;
    }

    this.states.set(
      sessionId,
      state
    );

    const instructions =
      await loadInstructions(
        this.root
      );

    const messages: LlmMessage[] =
      [
        {
          role: "system",
          content:
            instructions,
        },

        ...history,

        {
          role: "user",
          content:
            userMessage,
        },
      ];

    const executed:
      AgentToolCall[] = [];

    const maxIterations =
      Math.max(
        1,
        Number(
          process.env
            .MAX_AGENT_ITERATIONS ??
            25
        )
      );

    for (
      let iteration = 0;
      iteration <
      maxIterations;
      iteration++
    ) {
      const response =
        await this.llm.enviar(
          messages,
          llmTools()
        );

      if (
        response.toolCalls
          .length === 0
      ) {
        const needsConfirmation =
          Boolean(
            state.validacion
              ?.apta &&
              state.validacion
                .confirmaciones
                .length >
                0 &&
              !state.confirmado
          );

        return {
          text:
            response.text ||
            "Proceso completado.",

          toolCalls:
            executed,

          needsConfirmation,

          payload:
            state.payload,
        };
      }

      for (
        const requested of
        response.toolCalls
      ) {
        /*
         * Primero conservamos exactamente
         * la llamada que produjo el modelo.
         *
         * Después agregaremos el resultado
         * correspondiente de la herramienta.
         */
        messages.push({
          role:
            "function_call",

          callId:
            requested.id,

          name:
            requested.name,

          arguments:
            requested.rawArguments,
        });

        const call =
          await this.executeTool(
            requested.name,
            requested.arguments,
            state,
            {
              directory:
                this.root,
              sessionId,
            }
          );

        executed.push(
          call
        );

        messages.push({
          role: "tool",

          toolCallId:
            requested.id,

          name:
            requested.name,

          content:
            JSON.stringify(
              call.result
            ),
        });
      }
    }

    throw new Error(
      `El agente superó el máximo de ${maxIterations} iteraciones.`
    );
  }
}