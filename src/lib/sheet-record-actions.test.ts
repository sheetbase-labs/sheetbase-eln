import { describe, expect, it } from 'vitest'

import {
  SHEET_RECORD_CAPABILITY_LIMITATION,
  resolveSheetRecordActions,
} from './sheet-record-actions'

const ACTION = '10000000-0000-4000-8000-000000000001'
const BINDING = '10000000-0000-4000-8000-000000000002'

describe('Sheet Record Definition actions', () => {
  it('hides create when the Definition only configures link-record', () => {
    const resolved = resolveSheetRecordActions({
      actions: [
        {
          id: ACTION,
          key: 'link_sample',
          label: 'Link Sample',
          kind: 'link-record',
          bindingId: BINDING,
        },
      ],
    })
    expect(
      resolved.find((action) => action.kind === 'link-record'),
    ).toMatchObject({ enabled: true })
    expect(
      resolved.find((action) => action.kind === 'create-record'),
    ).toMatchObject({ enabled: false })
    expect(SHEET_RECORD_CAPABILITY_LIMITATION).toMatch(/CORE-05/)
  })
})
