import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GeneratedOutputDialog } from './generated-output-dialog'
import type { ReportGeneration } from '#/lib/report-builder'

const generation: ReportGeneration = {
  id: 'generation-1',
  workspaceId: 'workspace-1',
  reportId: 'report-1',
  reportVersion: 1,
  generationInputs: {},
  outputFormat: 'html',
  outputChecksum: 'a'.repeat(64),
  outputSizeBytes: 128,
  outputHtml: '<!DOCTYPE html><html><body>Generated report</body></html>',
  actorUserId: 'user-1',
  generatedAt: '2026-08-06T12:00:00Z',
  createdAt: '2026-08-06T12:00:00Z',
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('GeneratedOutputDialog', () => {
  it('downloads the returned HTML as a browser file', () => {
    const createObjectURL = vi.fn(() => 'blob:report-output')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {})

    render(<GeneratedOutputDialog generation={generation} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Download HTML' }))

    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(anchorClick).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:report-output')
    anchorClick.mockRestore()
  })
})
