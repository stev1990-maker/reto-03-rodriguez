export type LlmTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type LlmMessage =
  | {
      role: "system" | "user" | "assistant";
      content: string;
    }
  | {
      role: "function_call";
      callId: string;
      name: string;
      arguments: string;
    }
  | {
      role: "tool";
      content: string;
      toolCallId: string;
      name: string;
    };

export type LlmResponse = {
  text: string;
  toolCalls: Array<{
    id: string;
    name: string;
    arguments: unknown;
    rawArguments: string;
  }>;
};

export interface LlmAdapter {
  provider: string;
  model: string;

  enviar(
    messages: LlmMessage[],
    tools: LlmTool[]
  ): Promise<LlmResponse>;
}