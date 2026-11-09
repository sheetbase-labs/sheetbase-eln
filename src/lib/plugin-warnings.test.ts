import { describe, expect, it } from 'vitest'

import { pluginWarningsOf } from './plugin-warnings'
import { PLUGIN_WARNINGS_HEADER } from './plugin-warnings-header'

const response = (value?: string) =>
  new Response(null, {
    headers: value ? { [PLUGIN_WARNINGS_HEADER]: value } : {},
  })

describe('pluginWarningsOf', () => {
  it('reads what the proxy put in the header, in order', () => {
    const header = encodeURIComponent(
      'Lab rules: No protocol note yet. | Other: Check units',
    )

    expect(pluginWarningsOf(response(header))).toEqual([
      'Lab rules: No protocol note yet.',
      'Other: Check units',
    ])
  })

  it('says nothing when there is no header or it cannot be read', () => {
    expect(pluginWarningsOf(response())).toEqual([])
    expect(pluginWarningsOf(response('%E0%A4%A'))).toEqual([])
  })
})
