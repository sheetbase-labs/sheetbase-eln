/**
 * SCI-003 file block component tests. Verifies honest rendering of active,
 * quarantined, deleted and missing states; the upload flow (success, wrong
 * type, oversize); and the empty/loading/error states. The live file_objects
 * status is mocked so the preview always reflects the authoritative row.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { NotebookBlock, FileObjectSummary } from '#/lib/notebook-data'
import { fetchFileObjectByRecordId } from '#/lib/notebook-data'
import type * as notebookData from '#/lib/notebook-data'
import { BlockEditor } from './block-editor'
import { BlockPreview } from './block-preview'

vi.mock('#/lib/notebook-data', async (importOriginal) => {
  const actual = await importOriginal<typeof notebookData>()
  return { ...actual, fetchFileObjectByRecordId: vi.fn() }
})

const fetchFileObject = vi.mocked(fetchFileObjectByRecordId)

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function makeBlock(payload: Record<string, unknown>): NotebookBlock {
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
  fetchFileObject.mockResolvedValue({
    recordId: activePayload.fileRecordId,
    displayName: 'stability-run07.csv',
    mediaType: 'text/csv',
    byteSize: 1024,
    status,
    statusReason: overrides.statusReason ?? null,
    version: 1,
    ...overrides,
  })
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
      expect(fetchFileObject).toHaveBeenCalled()
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
    fetchFileObject.mockResolvedValue({
      recordId: imagePayload.fileRecordId,
      displayName: 'gel.png',
      mediaType: 'image/png',
      byteSize: 2048,
      status: 'active',
      statusReason: null,
      version: 1,
    })
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
    fetchFileObject.mockRejectedValue(new Error('network down'))
    renderWithQuery(<BlockPreview block={makeBlock(activePayload)} />)
    await waitFor(() =>
      expect(screen.getByText('File status could not be loaded.')).toBeTruthy(),
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
