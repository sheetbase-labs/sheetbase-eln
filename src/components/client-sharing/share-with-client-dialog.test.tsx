import { once } from 'node:events'
import { createServer } from 'node:http'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { Toaster, toast } from '#/components/ui/sonner'
import { clientSharingKeys, recordSharingKey } from '#/lib/client-sharing'
import type { RecordSharing } from '#/lib/client-sharing'

const base: RecordSharing = {
  recordStatus: 'approved',
  projectId: 'p1',
  clientId: 'c1',
  clientCode: 'CL-017',
  clientName: 'AAV Vector Partners',
  autoShare: false,
  sharedAt: null,
  sharedByName: null,
  canManage: true,
}

const requests: { path: string; method: string; body: string }[] = []
const unexpected: string[] = []
const clients: QueryClient[] = []
const recordPath = '/api/db/rpc/record_client_sharing'
const sharePath = '/api/db/rpc/share_record_with_client'
const unsharePath = '/api/db/rpc/unshare_record_with_client'
let current: RecordSharing | null = base
let readFailures = 0
let mutationFailure = false
let readGate: Promise<void> | undefined
let mutationGate: Promise<void> | undefined
const releases = new Set<() => void>()

function gate() {
  let release: () => void = () => undefined

  const promise = new Promise<void>((resolve) => {
    release = resolve
    releases.add(resolve)
  })

  return { promise, release }
}

function sharingWire(value: RecordSharing) {
  return {
    record_status: value.recordStatus,
    project_id: value.projectId,
    client_id: value.clientId,
    client_code: value.clientCode,
    client_name: value.clientName,
    auto_share: value.autoShare,
    shared_at: value.sharedAt,
    shared_by_name: value.sharedByName,
    can_manage: value.canManage,
  }
}

const server = createServer((request, response) => {
  let body = ''
  request.setEncoding('utf8')
  request.on('data', (chunk: string) => {
    body += chunk
  })
  request.on('end', () => {
    const path = request.url ?? ''
    requests.push({ path, method: request.method ?? '', body })

    const send = (json: string, status = 200) => {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(json)
    }

    if (request.method !== 'POST') {
      unexpected.push(`${request.method} ${path}`)
      send('{}', 500)

      return
    }

    if (path === recordPath) {
      const read = () => {
        if (readFailures > 0) {
          readFailures -= 1
          send(
            JSON.stringify({
              error: { code: 'refused', message: 'Sharing read refused' },
            }),
            403,
          )
        } else send(JSON.stringify(current ? [sharingWire(current)] : []))
      }

      if (readGate) void readGate.then(read)
      else read()

      return
    }

    if (path === sharePath || path === unsharePath) {
      const mutate = () => {
        if (mutationFailure) {
          send(
            JSON.stringify({
              error: { code: 'refused', message: 'Client sharing refused' },
            }),
            403,
          )

          return
        }

        if (current) {
          current = {
            ...current,
            sharedAt: path === sharePath ? '2026-10-20T09:00:00Z' : null,
            sharedByName: path === sharePath ? 'Gareth P.' : null,
          }
        }

        send('null')
      }

      if (mutationGate) void mutationGate.then(mutate)
      else mutate()

      return
    }

    unexpected.push(`${request.method} ${path}`)
    send('{}', 500)
  })
})

server.listen(0, '127.0.0.1')

await once(server, 'listening')

const { port } = z.object({ port: z.number() }).parse(server.address())
const originalFetch = globalThis.fetch

// Keep the real transport and production module-level DataClient; adapt relative URLs only.
globalThis.fetch = (input, init) =>
  originalFetch(
    new URL(
      input instanceof Request ? input.url : input,
      `http://127.0.0.1:${port}`,
    ),
    init,
  )

const { ShareWithClientDialog } = await import('./share-with-client-dialog')

beforeEach(() => {
  current = base
  readFailures = 0
  mutationFailure = false
  readGate = undefined
  mutationGate = undefined
  requests.length = 0
  unexpected.length = 0
})

afterEach(async () => {
  for (const release of releases) release()
  releases.clear()
  toast.dismiss()
  cleanup()

  for (const client of clients) {
    await client.cancelQueries()
    client.clear()
  }

  clients.length = 0
  expect(unexpected).toEqual([])
})

afterAll(async () => {
  globalThis.fetch = originalFetch
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
})

function renderDialog(sharing: RecordSharing | null, open = true) {
  current = sharing

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  clients.push(client)

  const view = render(
    <QueryClientProvider client={client}>
      <ShareWithClientDialog
        open={open}
        onOpenChange={() => undefined}
        recordId="r1"
      />
      <Toaster />
    </QueryClientProvider>,
  )

  return { ...view, client }
}

async function enabledAction(name: string) {
  const button = await screen.findByRole('button', { name })
  await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false))

  return button
}

function mutations() {
  return requests.filter((request) => request.path !== recordPath)
}

function expectRpc(path: string) {
  const request = requests.find((item) => item.path === path)
  expect(request?.method).toBe('POST')
  expect(request?.body).toBe(
    JSON.stringify({ p_client_id: 'c1', p_record_id: 'r1' }),
  )
}

describe('ShareWithClientDialog', () => {
  it('shares an approved record with the client of its project', async () => {
    renderDialog(base)
    await userEvent.click(await enabledAction('Share'))
    expect(
      await screen.findByText('Shared with AAV Vector Partners'),
    ).toBeTruthy()
    expectRpc(sharePath)
    expect(
      await screen.findByRole('button', { name: 'Stop sharing' }),
    ).toBeTruthy()
    expect(
      requests.filter((request) => request.path === recordPath),
    ).toHaveLength(2)
    expect(requests[0]?.body).toBe(JSON.stringify({ p_record_id: 'r1' }))
  })

  it('says why a record that is not approved cannot be shared yet', async () => {
    renderDialog({ ...base, recordStatus: 'in_progress' })
    expect(await screen.findByText('Not approved yet')).toBeTruthy()
    const button = screen.getByRole('button', { name: 'Share' })
    expect(button.hasAttribute('disabled')).toBe(true)
    await userEvent.click(button)
    expect(mutations()).toEqual([])
  })

  it('explains a project with no client instead of offering a client list', async () => {
    renderDialog({
      ...base,
      clientId: null,
      clientCode: null,
      clientName: null,
    })
    expect(
      await screen.findByText('This record’s project has no client'),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Share' }).hasAttribute('disabled'),
    ).toBe(true)
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(mutations()).toEqual([])
  })

  it('offers to stop sharing a record that was shared by hand', async () => {
    renderDialog({
      ...base,
      sharedAt: '2026-10-20T09:00:00Z',
      sharedByName: 'Gareth P.',
    })
    await userEvent.click(await enabledAction('Stop sharing'))
    expect(await screen.findByText('No longer shared')).toBeTruthy()
    expectRpc(unsharePath)
    expect(await screen.findByRole('button', { name: 'Share' })).toBeTruthy()
  })

  it('allows a manager to stop a manual share even after approval is lost', async () => {
    renderDialog({
      ...base,
      recordStatus: 'in_progress',
      sharedAt: '2026-10-20T09:00:00Z',
    })
    expect(await screen.findByText('Not approved yet')).toBeTruthy()
    await userEvent.click(await enabledAction('Stop sharing'))
    expect(await screen.findByText('No longer shared')).toBeTruthy()
    expectRpc(unsharePath)
    expect(
      (await screen.findByRole('button', { name: 'Share' })).hasAttribute(
        'disabled',
      ),
    ).toBe(true)
  })

  it('does not offer to stop an automatic share', async () => {
    renderDialog({ ...base, autoShare: true, sharedAt: '2026-10-20T09:00:00Z' })
    expect(
      await screen.findByText(/shared with the client automatically/),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Stop sharing' })).toBeNull()
    const button = screen.getByRole('button', { name: 'Share' })
    expect(button.hasAttribute('disabled')).toBe(true)
    await userEvent.click(button)
    expect(mutations()).toEqual([])
  })

  it.each([null, '2026-10-20T09:00:00Z'])(
    'keeps read-only sharing unchanged when sharedAt is %s',
    async (sharedAt) => {
      renderDialog({ ...base, canManage: false, sharedAt })
      expect(
        await screen.findByText(
          'Only members who can manage this record can share it.',
        ),
      ).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Stop sharing' })).toBeNull()
      const button = screen.getByRole('button', { name: 'Share' })
      expect(button.hasAttribute('disabled')).toBe(true)
      await userEvent.click(button)
      expect(mutations()).toEqual([])
    },
  )

  it('keeps the action disabled while the sharing read is pending or unavailable', async () => {
    const pending = gate()
    readGate = pending.promise
    const { client } = renderDialog(null)
    expect(
      (await screen.findByRole('button', { name: 'Share' })).hasAttribute(
        'disabled',
      ),
    ).toBe(true)
    await waitFor(() => expect(requests).toHaveLength(1))
    pending.release()
    await waitFor(() =>
      expect(client.getQueryState(recordSharingKey('r1'))?.status).toBe(
        'success',
      ),
    )
    expect(client.getQueryData(recordSharingKey('r1'))).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Share' }).hasAttribute('disabled'),
    ).toBe(true)
    expect(mutations()).toEqual([])
  })

  it('makes no sharing request while closed', () => {
    renderDialog(base, false)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(requests).toEqual([])
  })

  it('reports a refused read and retries the actual sharing request', async () => {
    readFailures = 1
    renderDialog(base)
    await userEvent.click(
      await screen.findByRole('button', { name: 'Try again' }),
    )
    await enabledAction('Share')
    expect(
      requests.filter((request) => request.path === recordPath),
    ).toHaveLength(2)
    expect(mutations()).toEqual([])
  })

  it('holds the mutation lock and refreshes only the owning record, shares and preview', async () => {
    const pending = gate()
    mutationGate = pending.promise
    const { client } = renderDialog(base)
    const shares = clientSharingKeys.shares('c1')
    const preview = clientSharingKeys.preview('c1')

    const unrelated = [
      recordSharingKey('r2'),
      clientSharingKeys.shares('c2'),
      clientSharingKeys.preview('c2'),
      clientSharingKeys.shareable('w1', 'c1'),
    ]

    for (const key of [shares, preview, ...unrelated])
      client.setQueryData(key, 'retained')
    await userEvent.click(await enabledAction('Share'))
    await waitFor(() => expect(mutations()).toHaveLength(1))
    expect(
      screen.getByRole('button', { name: 'Share' }).hasAttribute('disabled'),
    ).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: 'Share' }))
    expect(mutations()).toHaveLength(1)
    expect(client.getQueryState(shares)?.isInvalidated).toBe(false)
    pending.release()
    await enabledAction('Stop sharing')
    expect(client.getQueryState(shares)?.isInvalidated).toBe(true)
    expect(client.getQueryState(preview)?.isInvalidated).toBe(true)

    for (const key of unrelated) {
      expect(client.getQueryData(key)).toBe('retained')
      expect(client.getQueryState(key)?.isInvalidated).toBe(false)
    }
  })

  it.each([false, true])(
    'retains current sharing after a refused mutation, initially shared=%s',
    async (shared) => {
      mutationFailure = true

      const { client } = renderDialog({
        ...base,
        sharedAt: shared ? '2026-10-20T09:00:00Z' : null,
      })

      client.setQueryData(clientSharingKeys.shares('c1'), 'retained')
      client.setQueryData(clientSharingKeys.preview('c1'), 'retained')
      const action = shared ? 'Stop sharing' : 'Share'
      await userEvent.click(await enabledAction(action))
      expect(await screen.findByText('Client sharing refused')).toBeTruthy()
      await enabledAction(action)
      expectRpc(shared ? unsharePath : sharePath)
      expect(
        requests.filter((request) => request.path === recordPath),
      ).toHaveLength(1)
      expect(
        client.getQueryState(clientSharingKeys.shares('c1'))?.isInvalidated,
      ).toBe(false)
      expect(
        client.getQueryState(clientSharingKeys.preview('c1'))?.isInvalidated,
      ).toBe(false)
      mutationFailure = false
      await userEvent.click(await enabledAction(action))
      await enabledAction(shared ? 'Share' : 'Stop sharing')
      expect(mutations()).toHaveLength(2)
    },
  )
})
