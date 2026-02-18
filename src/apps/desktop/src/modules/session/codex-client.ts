import type { ChatMessage } from "../common/types";

interface CodexReply {
  output?: string;
  message?: string;
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

export async function requestAssistantReply(
  history: ChatMessage[],
  userPrompt: string,
  accessToken?: string,
): Promise<string> {
  const endpoint = import.meta.env.VITE_CODEX_CHAT_URL;

  if (!endpoint) {
    return localFallback(userPrompt);
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
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
