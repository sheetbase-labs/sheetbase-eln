import { annotateRequest, setRequestLevel } from './request-log'

const MAX_BODY_BYTES = 8 * 1024

/**
 * Gives the request's event a readable `message` ("GET /api/db/records 200")
 * for log viewers that list one line per event and show a blank row otherwise.
 * Development terminals already print that line as the event's header.
 */
export function annotateSummary(request: Request, response: Response): void {
  if (process.env.NODE_ENV !== 'production') return
  const { pathname } = new URL(request.url)
  annotateRequest({
    message: `${request.method} ${pathname} ${response.status}`,
  })
}

/**
 * Puts the reason for a failed API reply on the request's wide event, so a 4xx
 * or 5xx says why without anyone reading the route's code. Reads a clone of
 * the body, only for small JSON replies; streams and files are never touched.
 */
export async function annotateFailure(response: Response): Promise<void> {
  if (response.status < 400) return
  // A failed reply is a warning (the caller's doing) or an error (ours), so the
  // log level reflects it and alerts can key on it.
  setRequestLevel(response.status >= 500 ? 'error' : 'warn')
  if (!(response.headers.get('content-type') ?? '').includes('json')) return
  const length = Number(response.headers.get('content-length') ?? '0')
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) return
  try {
    const text = await response.clone().text()
    if (text.length > MAX_BODY_BYTES) return
    const body: unknown = JSON.parse(text)
    const reason = readReason(body)
    if (reason) annotateRequest({ failure: reason })
  } catch {
    // Not JSON, or the body was already consumed: the status line is enough.
  }
}

function readReason(body: unknown): { code?: string; message?: string } | null {
  if (body === null || typeof body !== 'object') return null
  const record = body as Record<string, unknown>
  const source =
    record['error'] !== null && typeof record['error'] === 'object'
      ? (record['error'] as Record<string, unknown>)
      : record
  const code = typeof source['code'] === 'string' ? source['code'] : undefined
  const message =
    typeof source['message'] === 'string'
      ? source['message']
      : typeof record['error'] === 'string'
        ? record['error']
        : undefined
  if (!code && !message) return null
  return { code, message: message?.slice(0, 300) }
}
