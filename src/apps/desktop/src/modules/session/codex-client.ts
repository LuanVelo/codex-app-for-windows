import type { ChatMessage } from "../common/types";

interface CodexReply {
  output?: string;
  message?: string;
}

interface OpenAIResponsesOutput {
  type?: string;
  content?: Array<{ type?: string; text?: string }>;
}

interface OpenAIResponsesPayload {
  output_text?: string;
  output?: OpenAIResponsesOutput[];
}

export interface ChatAuthOptions {
  method: "oauth" | "api_key";
  accessToken?: string;
  apiKey?: string;
  model?: string;
  apiBaseUrl?: string;
}

function localFallback(userPrompt: string): string {
  return [
    "Plano de execução sugerido:",
    `1. Entender tarefa: ${userPrompt}`,
    "2. Inspecionar arquivos do workspace no painel Workspace",
    "3. Executar comandos no painel Terminal",
    "4. Aplicar mudanças e validar com build/testes",
  ].join("\n");
}

function extractOpenAIText(payload: OpenAIResponsesPayload): string {
  if (payload.output_text?.trim()) {
    return payload.output_text.trim();
  }

  const chunks: string[] = [];
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) {
        chunks.push(content.text);
      }
    }
  }

  return chunks.join("\n").trim();
}

async function requestOpenAIApi(userPrompt: string, auth: ChatAuthOptions): Promise<string> {
  if (!auth.apiKey?.trim()) {
    throw new Error("API key is required for API mode.");
  }

  const baseUrl = (auth.apiBaseUrl || "https://api.openai.com/v1").replace(/\/$/, "");

  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.apiKey}`,
    },
    body: JSON.stringify({
      model: auth.model || "gpt-4.1-mini",
      input: userPrompt,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API failed with status ${response.status}`);
  }

  const payload = (await response.json()) as OpenAIResponsesPayload;
  return extractOpenAIText(payload) || "No text output returned from OpenAI API.";
}

export async function requestAssistantReply(
  history: ChatMessage[],
  userPrompt: string,
  auth: ChatAuthOptions,
): Promise<string> {
  if (auth.method === "api_key") {
    return requestOpenAIApi(userPrompt, auth);
  }

  const endpoint = import.meta.env.VITE_CODEX_CHAT_URL;

  if (!endpoint) {
    return localFallback(userPrompt);
  }

  if (!auth.accessToken?.trim()) {
    throw new Error("OAuth session is required. Connect your account in Add Key.");
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.accessToken}`,
    },
    body: JSON.stringify({
      messages: history.map((item) => ({ role: item.role, content: item.content })),
      input: userPrompt,
    }),
  });

  if (!response.ok) {
    throw new Error(`Codex endpoint failed with status ${response.status}`);
  }

  const payload = (await response.json()) as CodexReply;
  return payload.output || payload.message || "Sem resposta do endpoint Codex.";
}
