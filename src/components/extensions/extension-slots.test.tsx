/**
 * EXT-02 slot tests: object actions render as labelled buttons, the
 * palette group stays absent while empty, and panel tabs map through the
 * host renderer (unknown extensions never mount).
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ResolvedExtensionContribution } from '#/lib/extensions/registry'
import {
  ExtensionCommandGroup,
  ExtensionObjectActions,
  toExtensionPanelTabs,
} from './extension-slots'

afterEach(() => cleanup())

function contribution(
  overrides: Partial<ResolvedExtensionContribution> = {},
): ResolvedExtensionContribution {
  return {
    extensionId: 'ext-1',
    extensionKey: 'sample',
    manifestId: 'sheetbase.sample-panel',
    manifestVersion: '1.0.0',
    point: 'object-actions',
    id: 'open-panel',
    title: 'Open sample panel',
    requiredCapability: null,
    key: 'sample:object-actions:open-panel',
    ...overrides,
  }
}

describe('ExtensionObjectActions', () => {
  it('renders nothing when there are no actions', () => {
    const { container } = render(
      <ExtensionObjectActions actions={[]} onSelect={() => {}} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders labelled buttons that invoke on click', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <ExtensionObjectActions actions={[contribution()]} onSelect={onSelect} />,
    )
    const button = screen.getByRole('button', { name: 'Open sample panel' })
    expect(button.getAttribute('title')).toMatch(/sample/)
    await user.click(button)
    expect(onSelect).toHaveBeenCalledTimes(1)
  })
})

describe('ExtensionCommandGroup', () => {
  it('renders nothing while empty', () => {
    const { container } = render(
      <ExtensionCommandGroup commands={[]} onSelect={() => {}} />,
    )
    expect(screen.queryByText('Extensions')).toBeNull()
    expect(container.innerHTML).toBe('')
  })
})

describe('toExtensionPanelTabs', () => {
  it('maps panels through the host renderer and skips unknown extensions', () => {
    const panels = [
      contribution({
        point: 'panels',
        id: 'sample-panel',
        key: 'sample:panels:sample-panel',
      }),
      contribution({
        point: 'panels',
        id: 'other',
        extensionKey: 'stranger',
        key: 'stranger:panels:other',
      }),
    ]
    const tabs = toExtensionPanelTabs(panels, (panel) =>
      panel.extensionKey === 'sample' ? <div>Sample body</div> : null,
    )
    expect(tabs.map((tab) => tab.id)).toEqual(['extension-sample-sample-panel'])
    expect(tabs[0].label).toBe('Open sample panel')
  })
})
