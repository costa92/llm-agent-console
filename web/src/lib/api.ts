/**
 * Shared REST fetch wrapper. Every TanStack Query fetcher routes through this
 * so the non-secret operator scope is injected as `X-Console-*` headers on
 * every request (CONTEXT D-07, RESEARCH Pattern 6).
 *
 * The operator auth token is NOT added here — it is held in memory separately
 * and managed by a distinct auth layer (D-01). This wrapper never sets an
 * auth/bearer header.
 */
export type OperatorContext = {
  tenantId: string
  userId: string
  projectId: string
  sessionId: string
}

export function makeApiFetcher(ctx: OperatorContext) {
  return async function apiFetch(
    path: string,
    init?: RequestInit,
  ): Promise<Response> {
    const headers = new Headers(init?.headers)
    if (ctx.tenantId) headers.set('X-Console-Tenant', ctx.tenantId)
    if (ctx.userId) headers.set('X-Console-User', ctx.userId)
    if (ctx.projectId) headers.set('X-Console-Project', ctx.projectId)
    if (ctx.sessionId) headers.set('X-Console-Session', ctx.sessionId)
    return fetch(path, { ...init, headers })
  }
}
