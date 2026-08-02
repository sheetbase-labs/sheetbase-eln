import { describe, expect, it } from 'vitest'

import {
  PREVIEW_LIMITS,
  normalizePreviewRoutes,
  previewAppPort,
  previewHostname,
  previewProjectName,
  previewRoute,
  removePreviewRoute,
  upsertPreviewRoute,
} from './preview-deployment'

describe('PR preview deployment boundaries', () => {
  it('derives stable names and loopback ports without touching production port 3000', () => {
    expect(previewHostname(42, 'sheetbase.co.uk')).toBe('pr-42.sheetbase.co.uk')
    expect(previewProjectName(42)).toBe('sheetbase-pr-42')
    expect(previewAppPort(42)).toBe(32042)
    expect(previewAppPort(42)).not.toBe(3000)
  })

  it('rejects unbounded or malformed pull request numbers', () => {
    expect(() => previewAppPort(0)).toThrow(/integer from 1/)
    expect(() =>
      previewAppPort(PREVIEW_LIMITS.maxPullRequestNumber + 1),
    ).toThrow(/integer from 1/)
    expect(() => previewHostname(1, 'https://sheetbase.co.uk')).toThrow(
      /DNS hostname/,
    )
  })

  it('upserts one route per PR and enforces the active preview limit', () => {
    const first = previewRoute(1, 'sheetbase.co.uk', '2026-08-02T00:00:00.000Z')
    const updated = previewRoute(
      1,
      'sheetbase.co.uk',
      '2026-08-02T00:01:00.000Z',
    )
    expect(upsertPreviewRoute([], first)).toEqual([first])
    expect(upsertPreviewRoute([first], updated)).toEqual([updated])

    const full = Array.from(
      { length: PREVIEW_LIMITS.maxActivePreviews },
      (_, i) => previewRoute(i + 1, 'sheetbase.co.uk'),
    )
    expect(() =>
      upsertPreviewRoute(full, previewRoute(9999, 'sheetbase.co.uk')),
    ).toThrow(/capacity reached/)
    expect(removePreviewRoute(full, 1)).toHaveLength(
      PREVIEW_LIMITS.maxActivePreviews - 1,
    )
  })

  it('does not accept arbitrary router targets from the registry', () => {
    expect(() =>
      normalizePreviewRoutes([
        {
          pullRequestNumber: 1,
          hostname: 'pr-1.sheetbase.co.uk',
          target: 'http://postgres:5432',
          appPort: 32001,
          updatedAt: '2026-08-02T00:00:00.000Z',
        },
      ]),
    ).toThrow()
  })
})
