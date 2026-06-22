import type { ApiFetch } from '../auth/useApiFetch';
import type { CopilotMessage, CopilotResponse } from './types';

// POST /copilot — read-only "farm copilot" chat. Conversation state lives on
// the client, so the full message history is sent each turn and the backend
// replies with a single (non-streaming) assistant turn plus the optional list
// of tools it consulted.
export async function sendCopilotMessage(
  apiFetch: ApiFetch,
  messages: CopilotMessage[],
): Promise<CopilotResponse> {
  return apiFetch<CopilotResponse>('/copilot', {
    method: 'POST',
    body: { messages },
  });
}
