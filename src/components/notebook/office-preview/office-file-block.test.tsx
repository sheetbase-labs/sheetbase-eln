import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { OfficeFileBlock } from './office-file-block'
import * as loadModule from './load-preview'
import * as notebookData from '#/lib/notebook-data'

vi.mock('./load-preview', async (importOriginal) => {
  const actual = await importOriginal<typeof loadModule>()
  return { ...actual, loadPreview: vi.fn() }
})
vi.mock('#/lib/notebook-data', async (importOriginal) => {
  const actual = await importOriginal<typeof notebookData>()
  return { ...actual, notebookDataClient: { list: vi.fn() } }
})

const load = vi.mocked(loadModule.loadPreview)
const list = vi.mocked(notebookData.notebookDataClient.list)
const fetchVersions = {
  mockResolvedValue(versions: Array<ReturnType<typeof version>>) {
    list.mockResolvedValue(
      versions.map((v) => ({
        version: v.version,
        display_name: v.displayName,
        media_type: v.mediaType,
        byte_size: v.byteSize,
        created_at: v.createdAt,
        status: v.status,
      })),
    )
  },
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const payload = {
  fileRecordId: 'file-1',
  fileIdentifier: 'FILE-1',
  displayName: 'plate.xlsx',
  mediaType: XLSX,
  byteSize: 2048,
  fileVersion: 1,
}

function version(n: number, name = 'plate.xlsx', size = 2048) {
  return {
    version: n,
    displayName: name,
    mediaType: XLSX,
    byteSize: size,
    createdAt: '2026-11-01T10:00:00Z',
    status: 'active',
  }
}

function renderBlock(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

describe('office file block', () => {
  it('shows the pinned version as a table with sheet tabs', async () => {
    fetchVersions.mockResolvedValue([version(1)])
    load.mockResolvedValue({
      kind: 'sheets',
      sheets: [
        {
          name: 'Plate 1',
          rows: [
            ['Well', 'OD'],
            ['A1', '0.5'],
          ],
          totalRows: 2,
          totalColumns: 2,
        },
        { name: 'Plate 2', rows: [['B1']], totalRows: 1, totalColumns: 1 },
      ],
    })
    renderBlock(<OfficeFileBlock payload={payload} />)
    expect(await screen.findByText('A1')).toBeTruthy()
    expect(screen.getByRole('table', { name: 'Plate 1' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Plate 2' })).toBeTruthy()
    expect(load).toHaveBeenCalledWith(
      expect.objectContaining({ fileRecordId: 'file-1', version: 1 }),
    )
  })

  it('offers a newer version and pins the block to it on request', async () => {
    fetchVersions.mockResolvedValue([
      version(1),
      version(2, 'plate-v2.xlsx', 4096),
    ])
    load.mockResolvedValue({ kind: 'sheets', sheets: [] })
    const save = vi.fn().mockResolvedValue({ ok: true })
    renderBlock(<OfficeFileBlock payload={payload} save={save} />)
    expect(
      await screen.findByText('A newer version is available.'),
    ).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Use it' }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        fileVersion: 2,
        displayName: 'plate-v2.xlsx',
        byteSize: 4096,
        fileRecordId: 'file-1',
      }),
    )
  })

  it('keeps a locked notebook on its pinned version', async () => {
    fetchVersions.mockResolvedValue([version(1), version(2)])
    load.mockResolvedValue({ kind: 'sheets', sheets: [] })
    const save = vi.fn()
    renderBlock(<OfficeFileBlock payload={payload} save={save} readOnly />)
    expect(
      await screen.findByText('A newer version is available.'),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Use it' })).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Upload new version' }),
    ).toBeNull()
    expect(
      screen.getByText(/keeps the version it was written with/),
    ).toBeTruthy()
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ version: 1 }))
  })

  it('downloads the pinned version', async () => {
    fetchVersions.mockResolvedValue([version(1), version(2)])
    load.mockResolvedValue({ kind: 'sheets', sheets: [] })
    renderBlock(<OfficeFileBlock payload={payload} />)
    const link = await screen.findByRole('link', { name: 'Open in Excel' })
    expect(link.getAttribute('href')).toBe(
      '/api/files/file-1/download?version=1',
    )
  })

  it('follows the latest version for a block that never pinned one', async () => {
    fetchVersions.mockResolvedValue([version(1), version(2)])
    load.mockResolvedValue({ kind: 'sheets', sheets: [] })
    const { fileVersion: _drop, ...legacy } = payload
    renderBlock(<OfficeFileBlock payload={legacy} />)
    await waitFor(() => expect(load).toHaveBeenCalled())
    expect(load).toHaveBeenCalledWith(
      expect.objectContaining({ version: null }),
    )
    expect(screen.queryByText('A newer version is available.')).toBeNull()
  })

  it('opens the full-size view from Expand', async () => {
    fetchVersions.mockResolvedValue([version(1)])
    load.mockResolvedValue({
      kind: 'sheets',
      sheets: [
        { name: 'Plate 1', rows: [['A1']], totalRows: 1, totalColumns: 1 },
      ],
    })
    renderBlock(<OfficeFileBlock payload={payload} />)
    await screen.findByText('A1')
    await userEvent.click(screen.getByRole('button', { name: 'Expand' }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(load).toHaveBeenCalledWith(
      expect.objectContaining({ expanded: true }),
    )
  })
})
