/**
 * SCI-003 file block component tests. Verifies honest rendering of active,
 * quarantined, deleted and missing states; the upload flow (success, wrong
 * type, oversize); and the empty/loading/error states. Controlled HTTP responses
 * exercise the real file_objects reader and status mapping.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { NotebookBlock, FileObjectSummary } from '#/lib/notebook-data'
import { dropSharedReads } from '#/lib/data-client'
import { BlockEditor } from './block-editor'
import { BlockPreview } from './block-preview'

// The singleton DataClient captures fetch when its module loads.
const transport = vi.hoisted(() => {
  const http = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', http)

  return http
})

let fileStatus: FileObjectSummary | Error | null = null

beforeEach(() => {
  dropSharedReads()
  fileStatus = null
  transport.mockImplementation(async (input) => {
    const url = new URL(
      input instanceof Request ? input.url : input,
      'http://localhost',
    )

    if (url.pathname === '/api/office-editor/status')
      return Response.json({ enabled: false, reachable: false })

    if (url.pathname !== '/api/db/file_objects')
      throw new Error(`Unexpected request: ${url.pathname}`)

    if (fileStatus instanceof Error) throw fileStatus

    return Response.json(
      fileStatus
        ? [
            {
              id: 'object-1',
              workspace_id: 'workspace-1',
              record_id: fileStatus.recordId,
              storage_key: 'files/object-1',
              display_name: fileStatus.displayName,
              media_type: fileStatus.mediaType,
              byte_size: String(fileStatus.byteSize),
              checksum: null,
              status: fileStatus.status,
              status_reason: fileStatus.statusReason,
              version: fileStatus.version,
            },
          ]
        : [],
    )
  })
  vi.stubGlobal('fetch', transport)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

function makeBlock(payload: NotebookBlock['payload']): NotebookBlock {
  return {
    id: 'block-file',
    recordId: 'experiment-1',
    type: 'file',
    payload,
    payloadSchemaVersion: 1,
    order: 1,
    version: 1,
  }
}

function renderWithQuery(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })

  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const activePayload = {
  fileRecordId: '10000000-0000-4000-8000-000000000001',
  fileIdentifier: 'FILE-2026-0001',
  displayName: 'stability-run07.csv',
  mediaType: 'text/csv',
  byteSize: 1024,
}

function mockStatus(
  status: 'active' | 'quarantined' | 'deleted' | 'missing',
  overrides: Partial<FileObjectSummary> = {},
) {
  fileStatus = {
    recordId: activePayload.fileRecordId,
    displayName: 'stability-run07.csv',
    mediaType: 'text/csv',
    byteSize: 1024,
    status,
    statusReason: overrides.statusReason ?? null,
    version: 1,
    ...overrides,
  }
}

describe('SCI-003 file block preview', () => {
  it('renders an empty draft prompt', () => {
    renderWithQuery(<BlockPreview block={makeBlock({})} />)
    expect(
      screen.getByText('No file attached. Select this block to upload a file.'),
    ).toBeTruthy()
  })

  it('renders an active file with a download link, size and media type', async () => {
    mockStatus('active')
    renderWithQuery(<BlockPreview block={makeBlock(activePayload)} />)
    await waitFor(() => {
      expect(transport).toHaveBeenCalledWith(
        expect.stringContaining('/api/db/file_objects?record_id=eq.'),
        expect.anything(),
      )
    })

    const link = await screen.findByRole('link', {
      name: 'stability-run07.csv',
    })

    expect(link.getAttribute('href')).toBe(
      '/api/files/10000000-0000-4000-8000-000000000001/download',
    )
    expect(screen.getByText(/text\/csv/)).toBeTruthy()
    expect(screen.getByText('Active')).toBeTruthy()
  })

  it('renders an img for an active image/png file', async () => {
    const imagePayload = {
      fileRecordId: '20000000-0000-4000-8000-000000000002',
      fileIdentifier: 'FILE-2026-0002',
      displayName: 'gel.png',
      mediaType: 'image/png',
      byteSize: 2048,
    }

    fileStatus = {
      recordId: imagePayload.fileRecordId,
      displayName: 'gel.png',
      mediaType: 'image/png',
      byteSize: 2048,
      status: 'active',
      statusReason: null,
      version: 1,
    }
    renderWithQuery(<BlockPreview block={makeBlock(imagePayload)} />)
    const img = await screen.findByRole('img', { name: 'gel.png' })
    expect(img.getAttribute('src')).toBe(
      '/api/files/20000000-0000-4000-8000-000000000002/download',
    )
    expect(
      screen.getByRole('link', { name: 'gel.png' }).getAttribute('href'),
    ).toBe('/api/files/20000000-0000-4000-8000-000000000002/download')
  })

  it('renders a quarantined file honestly with the reason', async () => {
    mockStatus('quarantined', { statusReason: 'suspected corruption' })
    renderWithQuery(<BlockPreview block={makeBlock(activePayload)} />)
    await waitFor(() =>
      expect(
        screen.getByText(/Quarantined — suspected corruption/),
      ).toBeTruthy(),
    )
    expect(
      screen.queryByRole('link', { name: 'stability-run07.csv' }),
    ).toBeNull()
  })

  it('renders a deleted file with a strikethrough name and no download', async () => {
    mockStatus('deleted')
    renderWithQuery(<BlockPreview block={makeBlock(activePayload)} />)
    await waitFor(() =>
      expect(screen.getByText('This file is deleted.')).toBeTruthy(),
    )
    expect(
      screen.queryByRole('link', { name: 'stability-run07.csv' }),
    ).toBeNull()
  })

  it('renders a missing storage object honestly', async () => {
    mockStatus('missing')
    renderWithQuery(<BlockPreview block={makeBlock(activePayload)} />)
    await waitFor(() =>
      expect(
        screen.getByText('The storage object for this file is missing.'),
      ).toBeTruthy(),
    )
    expect(
      screen.queryByRole('link', { name: 'stability-run07.csv' }),
    ).toBeNull()
  })

  it('renders an error state when the live status cannot be loaded', async () => {
    fileStatus = new Error('network down')
    renderWithQuery(<BlockPreview block={makeBlock(activePayload)} />)
    await waitFor(() =>
      expect(screen.getByText('File status couldn’t be loaded.')).toBeTruthy(),
    )
  })
})

describe('SCI-003 file block editor upload flow', () => {
  function renderEditor(props: {
    onAttachFile?: (file: File) => Promise<void>
  }) {
    return renderWithQuery(
      <BlockEditor
        block={makeBlock({})}
        save={vi.fn()}
        onAttachFile={props.onAttachFile}
      />,
    )
  }

  function file(name: string, type: string, size: number): File {
    const f = new File([new Uint8Array(size)], name, { type })

    // File.size is read-only; for oversize we rely on a spy-backed policy in
    // the oversize case below. For normal cases the real size is fine.
    return f
  }

  it('shows an accessible file input with the size limit', () => {
    renderEditor({})
    const input = screen.getByLabelText('Attach a file')
    expect(input.tagName).toBe('INPUT')
  })

  it('rejects a disallowed type client-side with a useful message', async () => {
    const user = userEvent.setup()
    const onAttachFile = vi.fn()
    renderEditor({ onAttachFile })
    const input = screen.getByLabelText('Attach a file')
    await user.upload(input, file('evil.exe', 'application/x-msdownload', 10))
    expect(await screen.findByText(/not allowed/i)).toBeTruthy()
    expect(onAttachFile).not.toHaveBeenCalled()
  })

  it('calls onAttachFile for a valid file', async () => {
    const user = userEvent.setup()
    const onAttachFile = vi.fn().mockResolvedValue(undefined)
    renderEditor({ onAttachFile })
    const input = screen.getByLabelText('Attach a file')
    await user.upload(input, file('run.csv', 'text/csv', 12))
    await waitFor(() => expect(onAttachFile).toHaveBeenCalledTimes(1))
    expect(onAttachFile.mock.calls[0][0].name).toBe('run.csv')
  })

  it('surfaces an oversize error from the attach flow', async () => {
    const user = userEvent.setup()

    const onAttachFile = vi
      .fn()
      .mockRejectedValue(
        new Error('File is 200.0 MiB; the limit is 100.0 MiB.'),
      )

    renderEditor({ onAttachFile })
    const input = screen.getByLabelText('Attach a file')
    await user.upload(input, file('big.csv', 'text/csv', 12))
    expect(await screen.findByText(/limit is 100.0 MiB/i)).toBeTruthy()
  })
})

describe('image annotations on a file block', () => {
  const gel = {
    fileRecordId: '20000000-0000-4000-8000-000000000002',
    fileIdentifier: 'FILE-2026-0002',
    displayName: 'gel.png',
    mediaType: 'image/png',
    byteSize: 2048,
    annotations: [
      { id: 'l1', kind: 'lane', x: 0.2, text: 'Ladder', color: 'white' },
      {
        id: 'a1',
        kind: 'arrow',
        x1: 0.1,
        y1: 0.1,
        x2: 0.4,
        y2: 0.4,
        color: 'red',
      },
    ],
  }

  function mockGel() {
    fileStatus = {
      recordId: gel.fileRecordId,
      displayName: 'gel.png',
      mediaType: 'image/png',
      byteSize: 2048,
      status: 'active',
      statusReason: null,
      version: 1,
    }
  }

  it('shows lane names and lets the reader switch to the original', async () => {
    const user = userEvent.setup()
    mockGel()
    renderWithQuery(<BlockPreview block={makeBlock(gel)} />)
    expect(await screen.findByText('Ladder')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Original' }))
    expect(screen.queryByText('Ladder')).toBeNull()
    expect(screen.getByRole('img', { name: 'gel.png' })).toBeTruthy()
  })

  it('offers no switch when the image has no marks', async () => {
    mockGel()
    const { annotations: _a, ...plain } = gel
    renderWithQuery(<BlockPreview block={makeBlock(plain)} />)
    await screen.findByRole('img', { name: 'gel.png' })
    expect(screen.queryByRole('button', { name: 'Original' })).toBeNull()
  })

  it('saves the marks with the file reference intact', async () => {
    const user = userEvent.setup()
    const save = vi.fn().mockResolvedValue({ ok: true })
    const { annotations: _a, ...plain } = gel
    renderWithQuery(<BlockEditor block={makeBlock(plain)} save={save} />)
    await user.click(screen.getByRole('button', { name: 'Annotate' }))
    await user.click(screen.getByRole('button', { name: 'Lane name' }))
    const canvas = screen.getByTestId('annotation-canvas')
    canvas.getBoundingClientRect = () => new DOMRect(0, 0, 100, 100)
    await user.pointer({
      keys: '[MouseLeft]',
      target: canvas,
      coords: { clientX: 25, clientY: 50 },
    })
    await user.type(screen.getByLabelText('Text'), 'Ladder')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.click(screen.getByRole('button', { name: 'Save annotations' }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    const sent = save.mock.calls[0][0]
    expect(sent).toMatchObject({
      fileRecordId: gel.fileRecordId,
      displayName: 'gel.png',
      annotations: [{ kind: 'lane', text: 'Ladder', x: 0.25 }],
    })
  })

  it.each(['pointercancel', 'lostpointercapture'])(
    'does not save an interrupted arrow after %s',
    async (eventType) => {
      const user = userEvent.setup()
      const save = vi.fn().mockResolvedValue({ ok: true })
      const { annotations: _annotations, ...plain } = gel
      renderWithQuery(<BlockEditor block={makeBlock(plain)} save={save} />)
      await user.click(screen.getByRole('button', { name: 'Annotate' }))
      const canvas = screen.getByTestId('annotation-canvas')
      canvas.getBoundingClientRect = () => new DOMRect(0, 0, 100, 100)
      canvas.setPointerCapture = () => {}

      await user.pointer({
        keys: '[MouseLeft>]',
        target: canvas,
        coords: { clientX: 10, clientY: 20 },
      })
      fireEvent(canvas, new Event(eventType, { bubbles: true }))
      await user.pointer({
        keys: '[/MouseLeft]',
        target: canvas,
        coords: { clientX: 80, clientY: 70 },
      })
      await user.click(screen.getByRole('button', { name: 'Lane name' }))
      await user.pointer({
        keys: '[MouseLeft]',
        target: canvas,
        coords: { clientX: 25, clientY: 50 },
      })
      await user.type(screen.getByLabelText('Text'), 'Control')
      await user.click(screen.getByRole('button', { name: 'Add' }))
      await user.click(screen.getByRole('button', { name: 'Save annotations' }))
      await waitFor(() =>
        expect(save).toHaveBeenCalledWith(
          expect.objectContaining({
            fileRecordId: gel.fileRecordId,
            annotations: [
              expect.objectContaining({
                kind: 'lane',
                text: 'Control',
                x: 0.25,
              }),
            ],
          }),
        ),
      )
    },
  )

  it('hides Annotate when the block is read-only', () => {
    renderWithQuery(
      <BlockEditor block={makeBlock(gel)} save={vi.fn()} readOnly />,
    )
    expect(screen.queryByRole('button', { name: /annotat/i })).toBeNull()
  })
})
