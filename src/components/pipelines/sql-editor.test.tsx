import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { SqlEditor } from './sql-editor'

afterEach(cleanup)

function Harness({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial)
  return (
    <SqlEditor
      aria-label="Transform code"
      value={value}
      onChange={(event) => setValue(event.target.value)}
    />
  )
}

describe('SqlEditor', () => {
  it('stays an ordinary labelled textarea holding the statement', () => {
    render(<Harness initial="select 1" />)
    const field = screen.getByLabelText<HTMLTextAreaElement>('Transform code')
    expect(field.tagName).toBe('TEXTAREA')
    expect(field.value).toBe('select 1')
    fireEvent.change(field, { target: { value: 'select 2' } })
    expect(field.value).toBe('select 2')
  })

  it('draws a coloured copy behind it that the screen reader skips and that follows edits', () => {
    const { container } = render(<Harness initial="select a from t" />)
    const behind = container.querySelector('[data-slot="sql-highlight"]')!
    expect(behind.getAttribute('aria-hidden')).toBe('true')
    expect(behind.textContent).toBe('select a from t')
    expect(behind.querySelectorAll('.text-primary-text')).toHaveLength(2)

    fireEvent.change(screen.getByLabelText('Transform code'), {
      target: { value: "select 'x' from t\n" },
    })
    expect(behind.textContent).toContain("select 'x' from t")
    expect(behind.querySelector('.text-success-text')?.textContent).toBe("'x'")
  })
})
