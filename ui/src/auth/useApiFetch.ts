import { useCallback } from 'react';
import { env } from './config';
import { useAuth } from './useAuth';

// The error shape the Homestead API returns on failures: { message, code }.
export interface ApiErrorBody {
  message?: string;
  code?: string;
}

export class ApiError extends Error {
  status: number;
  code: string | null;
  body: unknown;
  constructor(status: number, message: string, code: string | null, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
}

export type ApiFetch = <T = unknown>(path: string, options?: RequestOptions) => Promise<T>;

// Hook returning an authenticated fetch wrapper. Pulls the Cognito id token
// from Amplify's auth session on every call so token refreshes happen
// transparently. The token is sent as the raw `Authorization` header (not
// `Bearer X`) per the API's Cognito authorizer config, and requests target
// VITE_API_BASE_URL (which already includes the `v1` stage path).
export function useApiFetch(): ApiFetch {
  const { getIdToken } = useAuth();

  return useCallback(
    async <T,>(path: string, options: RequestOptions = {}): Promise<T> => {
      let token: string;
      try {
        token = await getIdToken();
      } catch (err) {
        throw new ApiError(401, (err as Error).message, null, null);
      }

      const url = new URL(`${env.apiBaseUrl}${path}`);
      if (options.query) {
        for (const [k, v] of Object.entries(options.query)) {
          if (v !== undefined && v !== null && v !== '') {
            url.searchParams.set(k, String(v));
          }
        }
      }

      const method = options.method ?? 'GET';
      const headers: Record<string, string> = {
        Authorization: token,
        ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
        // POST is non-idempotent; attach a per-call key so safe client-side
        // retries dedupe server-side instead of creating duplicate resources.
        ...(method === 'POST' ? { 'idempotency-key': crypto.randomUUID() } : {}),
        ...(options.headers ?? {}),
      };

      let response: Response;
      try {
        response = await fetch(url.toString(), {
          method,
          headers,
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        });
      } catch (err) {
        throw new ApiError(0, `Network error: ${(err as Error).message}`, null, null);
      }

      const contentType = response.headers.get('content-type') ?? '';
      const isJson = contentType.includes('application/json');
      const bodyText = await response.text();
      const parsed = isJson && bodyText.length > 0 ? safeJson(bodyText) : bodyText;

      if (!response.ok) {
        const { message, code } = extractError(parsed);
        throw new ApiError(
          response.status,
          message ?? `${response.status} ${response.statusText}`,
          code,
          parsed,
        );
      }

      return parsed as T;
    },
    [getIdToken],
  );
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// Maps the API error envelope `{ message, code }` out of a parsed body.
function extractError(body: unknown): { message: string | null; code: string | null } {
  if (body && typeof body === 'object') {
    const obj = body as ApiErrorBody;
    return {
      message: typeof obj.message === 'string' ? obj.message : null,
      code: typeof obj.code === 'string' ? obj.code : null,
    };
  }
  return { message: null, code: null };
}
