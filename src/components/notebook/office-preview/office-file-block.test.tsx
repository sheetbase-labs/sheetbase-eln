import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { strToU8, zipSync } from 'fflate'
import type { Zippable } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { OfficeFileBlock } from './office-file-block'
import { OfficeEditButton } from '../office-editor'
import { fileVersionsKey } from './use-file-versions'
import type { StoredFileVersion } from './use-file-versions'
import type { PreviewSheet } from '#/lib/office-preview/sheets'

const transport = vi.fn<typeof fetch>()
let versions: StoredFileVersion[] = []
let workbook = new Uint8Array()
let session: Response | null = null

beforeEach(() => {
  versions = []
  session = null
  serveWorkbook([])
  transport.mockImplementation(async (input) => {
    const url = new URL(
      input instanceof Request ? input.url : input,
      'http://localhost',
    )

    if (url.pathname.endsWith('/download'))
      return new Response(workbook.slice().buffer)

    if (url.pathname === '/api/office-editor/status') {
      return Response.json({ enabled: session !== null, reachable: true })
    }

    if (url.pathname === '/api/office-editor/session' && session)
      return session.clone()

    throw new Error(`Unexpected request: ${url.pathname}`)
  })
  vi.stubGlobal('fetch', transport)
})

function serveWorkbook(sheets: PreviewSheet[]) {
  // Real XLSX bytes exercise loadPreview and its workbook decoder, not a module replacement.
  const files: Zippable = {
    'xl/workbook.xml': strToU8(
      `<workbook xmlns:r="r"><sheets>${sheets.map((sheet, i) => `<sheet name="${sheet.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<Relationships>${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`,
    ),
  }

  for (const [i, sheet] of sheets.entries()) {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(
      `<worksheet><sheetData>${sheet.rows.map((row, r) => `<row r="${r + 1}">${row.map((text, c) => `<c r="${String.fromCharCode(65 + c)}${r + 1}" t="inlineStr"><is><t>${text}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`,
    )
  }

  // Even an empty workbook has a worksheet; it is a valid empty document.
  if (sheets.length === 0) {
    serveWorkbook([{ name: 'Empty', rows: [], totalRows: 0, totalColumns: 0 }])

    return
  }

  workbook = zipSync(files, { level: 0 })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
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
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
    },
  })

  client.setQueryData(fileVersionsKey('file-1'), versions)
  client.setQueryData(fileVersionsKey('file-2'), versions)

  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

describe('office file block', () => {
  it('shows the pinned version as a table with sheet tabs', async () => {
    versions = [version(1)]
    serveWorkbook([
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
    ])
    renderBlock(<OfficeFileBlock payload={payload} />)
    expect(await screen.findByText('A1')).toBeTruthy()
    expect(screen.getByRole('table', { name: 'Plate 1' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Plate 2' })).toBeTruthy()
    expect(transport).toHaveBeenCalledWith(
      '/api/files/file-1/download?version=1',
    )
  })

  it('offers a newer version and pins the block to it on request', async () => {
    versions = [version(1), version(2, 'plate-v2.xlsx', 4096)]
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
    versions = [version(1), version(2)]
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
    await waitFor(() =>
      expect(transport).toHaveBeenCalledWith(
        '/api/files/file-1/download?version=1',
      ),
    )
  })

  it('downloads the pinned version', async () => {
    versions = [version(1), version(2)]
    renderBlock(<OfficeFileBlock payload={payload} />)
    const link = await screen.findByRole('link', { name: 'Open in Excel' })
    expect(link.getAttribute('href')).toBe(
      '/api/files/file-1/download?version=1',
    )
  })

  it('follows the latest version for a block that never pinned one', async () => {
    versions = [version(1), version(2)]
    const { fileVersion: _drop, ...legacy } = payload
    renderBlock(<OfficeFileBlock payload={legacy} />)
    await waitFor(() =>
      expect(transport).toHaveBeenCalledWith('/api/files/file-1/download'),
    )
    expect(screen.queryByText('A newer version is available.')).toBeNull()
  })

  it('opens the full-size view from Expand', async () => {
    versions = [version(1)]
    serveWorkbook([
      { name: 'Plate 1', rows: [['A1']], totalRows: 1, totalColumns: 1 },
    ])
    renderBlock(<OfficeFileBlock payload={payload} />)
    await screen.findByText('A1')
    await userEvent.click(screen.getByRole('button', { name: 'Expand' }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
    await waitFor(() =>
      expect(
        transport.mock.calls.filter(
          ([input]) => input === '/api/files/file-1/download?version=1',
        ),
      ).toHaveLength(2),
    )
  })

  describe('with the browser editor running', () => {
    // Its own file: whether a block is full size is remembered per file.
    const editorPayload = { ...payload, fileRecordId: 'file-2' }

    it('shows the real Office view in place of the built-in preview', async () => {
      versions = [version(1)]

      const submitted = vi
        .spyOn(HTMLFormElement.prototype, 'submit')
        .mockImplementation(() => {})

      session = Response.json({
        actionUrl: 'https://office.example/edit?WOPISrc=x',
        accessToken: 'token',
        accessTokenTtl: 1,
        canEdit: false,
        lockedReason: null,
        fileName: 'plate.xlsx',
      })

      renderBlock(<OfficeFileBlock payload={editorPayload} />)
      expect(await screen.findByTestId('office-viewer')).toBeTruthy()
      await waitFor(() =>
        expect(document.querySelector('iframe')).not.toBeNull(),
      )
      const frame = screen.getByTitle('plate.xlsx')
      const form = document.querySelector('form')

      if (!(form instanceof HTMLFormElement))
        throw new Error('Missing WOPI form')
      expect(form.method).toBe('post')
      expect(form.target).toBe(frame.getAttribute('name'))
      expect(form.action).toBe('https://office.example/edit?WOPISrc=x')
      expect(new FormData(form).get('access_token')).toBe('token')
      expect(new FormData(form).get('access_token_ttl')).toBe('1')
      expect(form.action).not.toContain('access_token')
      expect(frame.getAttribute('sandbox')).toBe(
        'allow-scripts allow-same-origin allow-forms',
      )
      expect(frame.getAttribute('allow')).toBe(
        'clipboard-read https://office.example; clipboard-write https://office.example',
      )
      expect(submitted).toHaveBeenCalledTimes(1)
      expect(
        transport.mock.calls.filter(
          ([input]) => input === '/api/files/file-2/download?version=1',
        ),
      ).toHaveLength(0)

      const call = transport.mock.calls.find(
        ([input]) => input === '/api/office-editor/session',
      )

      expect(JSON.parse(z.string().parse(call?.[1]?.body))).toMatchObject({
        fileRecordId: 'file-2',
        mode: 'view',
      })
    })

    it('falls back to the built-in preview when the editor cannot show the file', async () => {
      versions = [version(1)]
      serveWorkbook([
        { name: 'Plate 1', rows: [['A1']], totalRows: 1, totalColumns: 1 },
      ])
      session = Response.json({ error: { message: 'down' } }, { status: 502 })
      renderBlock(<OfficeFileBlock payload={editorPayload} />)
      expect(await screen.findByText('A1')).toBeTruthy()
    })

    it.each(['not a URL', '/relative/editor', 'javascript:alert(1)'])(
      'refuses malformed or non-HTTP viewer action %s through preview fallback',
      async (actionUrl) => {
        versions = [version(1)]
        serveWorkbook([
          { name: 'Plate 1', rows: [['A1']], totalRows: 1, totalColumns: 1 },
        ])

        const submitted = vi
          .spyOn(HTMLFormElement.prototype, 'submit')
          .mockImplementation(() => {})

        session = Response.json({
          actionUrl,
          accessToken: 'token',
          accessTokenTtl: 1,
          canEdit: false,
          lockedReason: null,
          fileName: 'plate.xlsx',
        })
        renderBlock(<OfficeFileBlock payload={editorPayload} />)
        expect(await screen.findByText('A1')).toBeTruthy()
        expect(document.querySelector('iframe')).toBeNull()
        expect(submitted).not.toHaveBeenCalled()
      },
    )

    it.each([
      { mode: 'edit', normalized: false },
      { mode: 'view', normalized: false },
      { mode: 'edit', normalized: true },
      { mode: 'view', normalized: true },
    ])(
      'refuses same-origin $mode action (normalized=$normalized) before token POST',
      async ({ mode, normalized }) => {
        versions = [version(1)]
        serveWorkbook([
          { name: 'Plate 1', rows: [['A1']], totalRows: 1, totalColumns: 1 },
        ])

        const submitted = vi
          .spyOn(HTMLFormElement.prototype, 'submit')
          .mockImplementation(() => {})

        const { origin, protocol, hostname, port } = window.location

        const authority = normalized
          ? `${protocol}//${hostname.toUpperCase()}:${port || (protocol === 'https:' ? '443' : '80')}`
          : origin

        session = Response.json({
          actionUrl: `${authority}/different-path/editor?WOPISrc=x`,
          accessToken: 'must-not-post',
          accessTokenTtl: 99,
          canEdit: mode === 'edit',
          lockedReason: null,
          fileName: 'plate.xlsx',
        })

        if (mode === 'view') {
          renderBlock(<OfficeFileBlock payload={editorPayload} />)
          expect(await screen.findByText('A1')).toBeTruthy()
        } else {
          renderBlock(
            <OfficeEditButton fileRecordId="file-2" fileName="plate.xlsx" />,
          )
          await userEvent.click(
            await screen.findByRole('button', { name: 'Edit' }),
          )
          expect(await screen.findByRole('alert')).toHaveProperty(
            'textContent',
            'The editor could not be opened.',
          )
        }

        expect(document.querySelector('iframe')).toBeNull()
        expect(document.querySelector('form')).toBeNull()
        expect(submitted).not.toHaveBeenCalled()
      },
    )

    it.each([
      { canEdit: true, lockedReason: null, reason: null },
      { canEdit: false, lockedReason: 'signed', reason: 'Signed · view only' },
      {
        canEdit: false,
        lockedReason: 'archived',
        reason: 'Archived · view only',
      },
    ])(
      'preserves edit-session authority for $lockedReason with canEdit=$canEdit',
      async ({ canEdit, lockedReason, reason }) => {
        const submitted = vi
          .spyOn(HTMLFormElement.prototype, 'submit')
          .mockImplementation(() => {})

        session = Response.json({
          actionUrl: 'http://127.0.0.1:9980/browser/edit?WOPISrc=x',
          accessToken: 'edit-token',
          accessTokenTtl: 99,
          canEdit,
          lockedReason,
          fileName: 'plate.xlsx',
        })
        renderBlock(
          <OfficeEditButton
            fileRecordId="file-2"
            recordId="record-2"
            fileName="plate.xlsx"
          />,
        )
        await userEvent.click(
          await screen.findByRole('button', { name: 'Edit' }),
        )
        const frame = await screen.findByTitle('plate.xlsx')
        const form = document.querySelector('form')

        if (!(form instanceof HTMLFormElement))
          throw new Error('Missing WOPI form')
        expect(frame.getAttribute('sandbox')).toBe(
          'allow-scripts allow-same-origin allow-forms',
        )
        expect(frame.getAttribute('allow')).toBe(
          'clipboard-read http://127.0.0.1:9980; clipboard-write http://127.0.0.1:9980',
        )
        expect(form.method).toBe('post')
        expect(form.target).toBe(frame.getAttribute('name'))
        expect(form.action).toBe('http://127.0.0.1:9980/browser/edit?WOPISrc=x')
        expect(new FormData(form).get('access_token')).toBe('edit-token')
        expect(new FormData(form).get('access_token_ttl')).toBe('99')
        expect(frame.hasAttribute('src')).toBe(false)
        expect(submitted).toHaveBeenCalledTimes(1)
        expect(
          screen.queryByText(
            'Every save becomes a new version of the file.',
          ) !== null,
        ).toBe(canEdit)

        if (reason) expect(screen.getByText(reason)).toBeTruthy()

        const call = transport.mock.calls.find(
          ([input]) => input === '/api/office-editor/session',
        )

        expect(JSON.parse(z.string().parse(call?.[1]?.body))).toEqual({
          fileRecordId: 'file-2',
          recordId: 'record-2',
        })
      },
    )

    it('refuses a malformed edit action through the existing alert without posting tokens', async () => {
      const submitted = vi
        .spyOn(HTMLFormElement.prototype, 'submit')
        .mockImplementation(() => {})

      session = Response.json({
        actionUrl: 'https://',
        accessToken: 'edit-token',
        accessTokenTtl: 1,
        canEdit: true,
        lockedReason: null,
        fileName: 'plate.xlsx',
      })
      renderBlock(
        <OfficeEditButton fileRecordId="file-2" fileName="plate.xlsx" />,
      )
      await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
      expect(await screen.findByRole('alert')).toBeTruthy()
      expect(document.querySelector('iframe')).toBeNull()
      expect(submitted).not.toHaveBeenCalled()
    })

    it('keeps the built-in preview for a version older than the latest', async () => {
      versions = [version(1), version(2)]
      serveWorkbook([
        { name: 'Plate 1', rows: [['A1']], totalRows: 1, totalColumns: 1 },
      ])
      session = Response.json({})
      renderBlock(<OfficeFileBlock payload={editorPayload} />)
      expect(await screen.findByText('A1')).toBeTruthy()
      expect(screen.queryByTestId('office-viewer')).toBeNull()
    })
  })
})
