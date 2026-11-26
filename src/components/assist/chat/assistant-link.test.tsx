import { cleanup, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { notebookDataClient } from '#/lib/notebook-data'
import { renderSheetRoute } from '#/components/sheet/sheet-test-router'

import { appPathFromHref, recordRefFromPath } from './assistant-link'
import { MessageResponse } from './message'

afterEach(cleanup)

describe('appPathFromHref', () => {
  it('treats paths, this app and bare identifiers as in-app', () => {
    expect(appPathFromHref('/records/EXP-4302')).toBe('/records/EXP-4302')
    expect(appPathFromHref('https://sheetbase.dev/experiments/EXP-1?x=1')).toBe(
      '/experiments/EXP-1?x=1',
    )
    expect(
      appPathFromHref('http://localhost:3000/samples/S', 'localhost:3000'),
    ).toBe('/samples/S')
    expect(appPathFromHref('EXP-4302')).toBe('/records/EXP-4302')
  })

  it('leaves real external links and protocol tricks alone', () => {
    expect(appPathFromHref('https://example.com/records/EXP-1')).toBeNull()
    expect(appPathFromHref('//evil.test/x')).toBeNull()
    expect(appPathFromHref('javascript:alert(1)')).toBeNull()
    expect(appPathFromHref('#top')).toBeNull()
    expect(appPathFromHref(undefined)).toBeNull()
  })
})

describe('recordRefFromPath', () => {
  it('reads an identifier out of a record path', () => {
    expect(recordRefFromPath('/records/EXP-4302')).toBe('EXP-4302')
    expect(recordRefFromPath('/experiments/EXP-4302?tab=x')).toBe('EXP-4302')
    expect(recordRefFromPath('/projects/not-an-id')).toBeNull()
  })
})

describe('assistant answer links', () => {
  it('opens a record link in-app on the experiment page, with no external warning', async () => {
    // The identifier look-up is the one data call a link makes.
    vi.spyOn(notebookDataClient, 'list').mockResolvedValue([
      { identifier: 'EXP-4302', kind: 'experiment' },
    ])
    await renderSheetRoute(
      <MessageResponse mode="static">
        {'See [EXP-4302](/records/EXP-4302) and [the docs](/settings/ai).'}
      </MessageResponse>,
    )
    await waitFor(() => {
      expect(
        screen.getByText('EXP-4302').closest('a')?.getAttribute('href'),
      ).toBe('/experiments/EXP-4302')
    })
    const anchor = screen.getByText('EXP-4302').closest('a')

    expect(anchor?.hasAttribute('data-record-link')).toBe(true)
    expect(
      (await screen.findByText('the docs')).closest('a')?.getAttribute('href'),
    ).toBe('/settings/ai')
    expect(screen.queryByRole('button', { name: /external/i })).toBeNull()
  })

  it('keeps the external-link check for a real external address', async () => {
    await renderSheetRoute(
      <MessageResponse mode="static">
        {'Read [this](https://example.com/page).'}
      </MessageResponse>,
    )
    const link = await screen.findByText('this')

    expect(link.closest('a')).toBeNull()
  })
})
