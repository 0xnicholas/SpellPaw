// Minimal fetch helper for the embedded API from client components.
export interface ApiClient {
  get<T>(path: string): Promise<T>;
  send<T>(path: string, method: string, body?: unknown): Promise<T>;
}

export function createApiClient(workspaceId: string): ApiClient {
  const headers = (json: boolean): Record<string, string> => ({
    "x-workspace-id": workspaceId,
    ...(json ? { "content-type": "application/json" } : {}),
  });

  async function request<T>(path: string, method: string, body?: unknown): Promise<T> {
    const res = await fetch(path, {
      method,
      headers: headers(body !== undefined),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
    if (!res.ok) {
      throw new Error(data.error ?? `request failed (${res.status})`);
    }
    return data;
  }

  return {
    get: (path) => request(path, "GET"),
    send: (path, method, body) => request(path, method, body),
  };
}
