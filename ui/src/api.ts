import type { CallResult, Health, ToolInfo } from "./types";

/**
 * Same-origin in production (the bridge serves the built console), proxied to
 * the bridge by Vite in development. Either way the browser only ever talks to
 * /api/*.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const raw = await res.text();
  let body: unknown = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error(`Réponse non-JSON du pont (${res.status}) : ${raw.slice(0, 200)}`);
  }
  if (!res.ok) {
    const detail = (body as { error?: string } | null)?.error;
    throw new Error(detail ?? `Erreur ${res.status}`);
  }
  return body as T;
}

export function getHealth(): Promise<Health> {
  return request<Health>("/api/health");
}

export async function getTools(): Promise<ToolInfo[]> {
  const body = await request<{ ok: boolean; tools: ToolInfo[]; error?: string }>("/api/tools");
  if (!body.ok) throw new Error(body.error ?? "Impossible de lister les outils.");
  return body.tools;
}

export function callTool(name: string, args: Record<string, unknown>): Promise<CallResult> {
  return request<CallResult>("/api/call", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, arguments: args }),
  });
}
