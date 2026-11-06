import { describe, expect, it } from 'vitest'

import { runLabReadTool } from './assistant-lab-tools.server'
import type { DataClient } from './data-client'

function context(rows: Record<string, unknown[]>) {
  const client = {
    rpc: (name: string) => Promise.resolve(rows[name] ?? []),
  } as unknown as DataClient
  return {
    client,
    workspaceId: 'ws',
    userId: 'me',
    timeZone: 'Europe/London',
    now: new Date('2026-11-06T10:00:00Z'),
  }
}

describe('the facility report read tool', () => {
  it('sums spend per currency and counts orders without a price', async () => {
    const result = await runLabReadTool(
      'sheetbase.facility.report',
      { report: 'spend', period: 'last_month' },
      context({
        report_spend_lines: [
          {
            order_id: 'o1',
            number: 1,
            material_title: 'Media',
            supplier_record_id: null,
            supplier: 'Cytiva',
            project_id: 'p1',
            project_title: 'AAV9',
            quantity: 1,
            unit: null,
            status: 'ordered',
            ordered_at: '2026-10-05T10:00:00Z',
            total_price: '100',
            currency: 'GBP',
          },
          {
            order_id: 'o2',
            number: 2,
            material_title: 'Tips',
            supplier_record_id: null,
            supplier: 'Cytiva',
            project_id: 'p1',
            project_title: 'AAV9',
            quantity: 1,
            unit: null,
            status: 'ordered',
            ordered_at: '2026-10-06T10:00:00Z',
            total_price: null,
            currency: null,
          },
        ],
      }),
    )
    expect(result.isError).toBe(false)
    expect(result.text).toContain('£100.00')
    expect(result.text).toContain('2 orders placed, 1 without a price')
    expect(result.text).toContain('Cytiva')
  })

  it('says so when nothing was booked', async () => {
    const result = await runLabReadTool(
      'sheetbase.facility.report',
      { report: 'usage' },
      context({}),
    )
    expect(result.text).toContain('no bookings')
  })
})
