import { cleanup, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { sqlTokens } from '#/lib/pipelines/code-tokens'
import { SqlEditor } from './sql-editor'

afterEach(cleanup)

function Harness({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial)

  return (
    <SqlEditor aria-label="Transform code" value={value} onChange={setValue} />
  )
}

describe('SqlEditor', () => {
  it('is a labelled text box holding the statement', async () => {
    render(<Harness initial="select 1" />)
    const field = await screen.findByLabelText('Transform code')

    expect(field.getAttribute('role')).toBe('textbox')
    expect(field.textContent).toBe('select 1')
  })
})

describe('sqlTokens', () => {
  it('points keywords, strings, numbers, comments and parameters at their place', () => {
    const text = "select a, 'x', 2 from t -- why\nwhere b = {{p}}"
    const found = sqlTokens(text).map((t) => [text.slice(t.from, t.to), t.kind])

    expect(found).toEqual([
      ['select', 'kw'],
      ["'x'", 'str'],
      ['2', 'num'],
      ['from', 'kw'],
      ['-- why', 'cm'],
      ['where', 'kw'],
      ['{{p}}', 'ref'],
    ])
  })
})
