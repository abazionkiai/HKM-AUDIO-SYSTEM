interface DesktopApiResponse {
  status: number;
  body: unknown;
}

declare global {
  interface Window {
    __TAURI__?: {
      core?: {
        invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
      };
    };
  }
}

/** Uses the native, allowlisted state API in Tauri and the Express API on web. */
export async function appFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const invoke = typeof window === 'undefined' ? undefined : window.__TAURI__?.core?.invoke;
  if (!invoke) return fetch(input, init);

  const requestUrl = input instanceof Request ? input.url : input.toString();
  const url = new URL(requestUrl, window.location.href);
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  let body: unknown = null;
  const rawBody = init?.body;
  if (typeof rawBody === 'string' && rawBody.length > 0) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      return new Response(JSON.stringify({ ok: false, error: 'Desktop API expects a JSON request body.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  try {
    const result = await invoke<DesktopApiResponse>('desktop_api_request', {
      method,
      path: url.pathname,
      body,
    });
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
