import OpenAI from "openai";

import type {
  LlmAdapter,
  LlmMessage,
  LlmResponse,
  LlmTool,
} from "./adapter.js";

export class OpenAIAdapter implements LlmAdapter {
  provider = "openai";

  model =
    process.env.LLM_MODEL ?? "gpt-5-mini";

  async enviar(
    messages: LlmMessage[],
    tools: LlmTool[]
  ): Promise<LlmResponse> {
    const apiKey =
      process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new Error(
        "OPENAI_API_KEY no configurada en el backend."
      );
    }

    const client = new OpenAI({
      apiKey,
      timeout: Number(
        process.env.LLM_TIMEOUT_MS ?? 30000
      ),
      maxRetries: 2,
    });

    const input: OpenAI.Responses.ResponseInput =
      messages.map((message) => {
        if (message.role === "function_call") {
          return {
            type: "function_call" as const,
            call_id: message.callId,
            name: message.name,
            arguments: message.arguments,
          };
        }

        if (message.role === "tool") {
          return {
            type: "function_call_output" as const,
            call_id: message.toolCallId,
            output: message.content,
          };
        }

        return {
          role: message.role,
          content: message.content,
        };
      });

    const response =
      await client.responses.create({
        model: this.model,
        input,

        tools: tools.map((tool) => ({
          type: "function" as const,
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          strict: false,
        })),
      });

    const toolCalls =
      response.output
        .filter(
          (item) =>
            item.type === "function_call"
        )
        .map((item) => {
          if (
            item.type !== "function_call"
          ) {
            throw new Error(
              "Respuesta de herramienta inválida."
            );
          }

          let args: unknown = {};

          try {
            args = JSON.parse(
              item.arguments || "{}"
            ) as unknown;
          } catch {
            throw new Error(
              `Argumentos JSON inválidos para ${item.name}.`
            );
          }

          return {
            id: item.call_id,
            name: item.name,
            arguments: args,
            rawArguments:
              item.arguments || "{}",
          };
        });

    return {
      text:
        response.output_text ?? "",
      toolCalls,
    };
  }
}