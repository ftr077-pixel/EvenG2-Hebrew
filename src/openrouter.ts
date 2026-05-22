/**
 * OpenRouter API client — OpenAI-compatible chat completions endpoint.
 *
 * Used for both Hebrew→Russian translation (translate.ts) and the
 * post-session AI summary (summarize.ts).
 *
 * OpenRouter exposes permissive CORS for browser apps, so we call the
 * absolute URL in both dev and the Even Hub WebView — no proxy needed.
 *
 *   POST https://openrouter.ai/api/v1/chat/completions
 *   Authorization: Bearer <key>
 *   Optional: HTTP-Referer, X-Title (shown in dashboards / rankings)
 */

const OPENROUTER_BASE = 'https://openrouter.ai';

const APP_TITLE   = 'EvenG2 Hebrew';
const APP_REFERER = 'https://github.com/ftr077-pixel/EvenG2-Hebrew';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
}

interface ChatResponse {
  choices?: Array<{
    message?: { role: string; content: string };
    finish_reason?: string;
  }>;
  error?: { message: string; code?: number };
}

function authHeaders(apiKey: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'authorization': `Bearer ${apiKey}`,
    'http-referer': APP_REFERER,
    'x-title': APP_TITLE,
  };
}

/** Non-streaming chat completion. Returns the assistant text. */
export async function chat(req: ChatRequest, apiKey: string): Promise<string> {
  const response = await fetch(`${OPENROUTER_BASE}/api/v1/chat/completions`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ ...req, stream: false }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`OpenRouter ${response.status}: ${errText}`);
  }

  const data = (await response.json()) as ChatResponse;
  if (data.error) throw new Error(`OpenRouter: ${data.error.message}`);
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

/** Streaming chat completion (SSE). Calls onChunk for each text delta. */
export async function chatStream(
  req: ChatRequest,
  apiKey: string,
  onChunk?: (chunk: string) => void,
): Promise<string> {
  const response = await fetch(`${OPENROUTER_BASE}/api/v1/chat/completions`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ ...req, stream: true }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`OpenRouter ${response.status}: ${errText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No streaming support');

  const decoder = new TextDecoder();
  let fullText = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const raw of lines) {
      const trimmed = raw.trim();
      if (!trimmed.startsWith('data: ')) continue;
      const payload = trimmed.slice(6);
      if (payload === '[DONE]') continue;
      let event: { choices?: Array<{ delta?: { content?: string } }> };
      try { event = JSON.parse(payload); } catch { continue; }
      const delta = event.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta.length > 0) {
        fullText += delta;
        onChunk?.(delta);
      }
    }
  }

  return fullText.trim();
}
