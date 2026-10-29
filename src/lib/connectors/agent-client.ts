/**
 * The browser's side of the folder-agent download and its check-in status
 * (`/api/connectors/agent`).
 */
import { t } from '#/copy'
import type { AgentSystem } from './agent-package'

export interface AgentStatus {
  /** A token for an agent has been made and not replaced. */
  downloaded: boolean
  /** The last time the agent signed in, if ever. */
  lastSeenAt: string | null
  /** It signed in recently enough to be running. */
  running: boolean
}

export const agentQueryKeys = {
  status: (connectorId: string) =>
    ['instrument-intake', 'agent', connectorId] as const,
}

async function failure(response: Response): Promise<Error> {
  const body = (await response.json().catch(() => null)) as {
    error?: { message?: string }
  } | null
  return new Error(
    body?.error?.message ?? t('library.instruments.agent.cantDownload'),
  )
}

export async function fetchAgentStatus(
  connectorId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AgentStatus> {
  const response = await fetchImpl(
    `/api/connectors/agent?connector=${encodeURIComponent(connectorId)}`,
    { credentials: 'same-origin' },
  )
  if (!response.ok) throw await failure(response)
  return (await response.json()) as AgentStatus
}

/** Asks for the zip and hands it to the browser as a file download. */
export async function downloadAgent(
  input: { connectorId: string; system: AgentSystem; folder: string },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImpl('/api/connectors/agent', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) throw await failure(response)
  const fileName =
    /filename="([^"]+)"/.exec(
      response.headers.get('content-disposition') ?? '',
    )?.[1] ?? 'sheetbase-agent.zip'
  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
  return fileName
}
