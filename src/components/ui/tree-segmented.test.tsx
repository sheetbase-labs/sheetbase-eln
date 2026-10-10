import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Segmented } from './segmented'
import { Tree, TreeItem } from './tree'

afterEach(cleanup)

describe('Tree', () => {
  it('marks the current item with aria-current', () => {
    render(
      <Tree>
        <TreeItem icon="folder">Projects</TreeItem>
        <TreeItem current>AAV9 process transfer</TreeItem>
      </Tree>,
    )
    const current = screen.getByRole('treeitem', {
      name: /AAV9 process transfer/,
    })
    expect(current.getAttribute('aria-current')).toBe('page')
  })

  it('moves focus with the arrow keys', async () => {
    const user = userEvent.setup()
    render(
      <Tree>
        <TreeItem icon="folder">Projects</TreeItem>
        <TreeItem depth={1} current>
          Child
        </TreeItem>
      </Tree>,
    )
    const items = screen.getAllByRole('treeitem')
    items[0].focus()
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(items[1])
    await user.keyboard('{ArrowUp}')
    expect(document.activeElement).toBe(items[0])
  })
})

describe('Segmented', () => {
  it('reports the chosen option', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <Segmented
        aria-label="Appearance"
        options={['System', 'Light', 'Dark']}
        icons="monitor|sun|moon"
        value="System"
        onChange={onChange}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Dark/ }))
    expect(onChange).toHaveBeenCalledWith('Dark')
  })
})
