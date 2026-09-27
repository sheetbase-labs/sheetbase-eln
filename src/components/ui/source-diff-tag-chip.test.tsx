import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Diff } from '#/components/scientific/diff'
import { Source } from '#/components/scientific/source'
import { Chip } from '#/components/ui/chip'
import { Tag } from '#/components/ui/tag'

afterEach(cleanup)

describe('Source', () => {
  it('labels each source kind', () => {
    const labels = {
      dataset: 'Dataset',
      record: 'Record',
      calc: 'Calculated',
      local: 'Local',
    } as const
    for (const [kind, label] of Object.entries(labels)) {
      const { unmount } = render(<Source kind={kind as keyof typeof labels} />)
      expect(screen.getByText(label)).toBeTruthy()
      unmount()
    }
  })

  it('marks local values with the link colour', () => {
    render(<Source kind="local" />)
    expect(screen.getByText('Local').className).toContain('text-link')
  })
})

describe('Diff', () => {
  it('uses del and ins for before and after', () => {
    const { container } = render(<Diff before="6.9" after="7.2" />)
    expect(container.querySelector('del')?.textContent).toBe('6.9')
    expect(container.querySelector('ins')?.textContent).toBe('7.2')
  })

  it('renders only the side that exists', () => {
    const { container } = render(<Diff after="new" />)
    expect(container.querySelector('del')).toBeNull()
    expect(container.querySelector('ins')?.textContent).toBe('new')
  })
})

describe('Tag', () => {
  it('uses the add, change and delete tones', () => {
    const cases = {
      add: 'bg-success-wash',
      chg: 'bg-warning-wash',
      del: 'bg-danger-wash',
    } as const
    for (const [kind, tone] of Object.entries(cases)) {
      const { container, unmount } = render(
        <Tag kind={kind as keyof typeof cases} />,
      )
      expect(container.querySelector('[data-slot="tag"]')?.className).toContain(
        tone,
      )
      unmount()
    }
  })
})

describe('Chip', () => {
  it('renders a removable chip with a named remove control', async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    render(
      <Chip onRemove={onRemove} removeLabel="Remove Lifecycle filter">
        Lifecycle
      </Chip>,
    )
    await user.click(
      screen.getByRole('button', { name: 'Remove Lifecycle filter' }),
    )
    expect(onRemove).toHaveBeenCalledOnce()
  })
})
