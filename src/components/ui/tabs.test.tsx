import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs'

afterEach(() => {
  cleanup()
})

async function setup(jsx: React.ReactElement) {
  const user = userEvent.setup()
  const utils = render(jsx)
  return { user, ...utils }
}

describe('Tabs', () => {
  it('renders a tablist with tab triggers and content', () => {
    render(
      <Tabs defaultValue="properties">
        <TabsList>
          <TabsTrigger value="properties">Properties</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>
        <TabsContent value="properties">Properties panel</TabsContent>
        <TabsContent value="activity">Activity panel</TabsContent>
      </Tabs>,
    )
    const tablist = screen.getByRole('tablist')
    expect(tablist).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Properties' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Activity' })).toBeTruthy()
    // Selected tab is marked selected per WAI-ARRIA.
    const properties = screen.getByRole('tab', { name: 'Properties' })
    expect(properties.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('Properties panel')).toBeTruthy()
    expect(screen.queryByText('Activity panel')).toBeNull()
  })

  it('switches panel on trigger click', async () => {
    const { user } = await setup(
      <Tabs defaultValue="properties">
        <TabsList>
          <TabsTrigger value="properties">Properties</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>
        <TabsContent value="properties">Properties panel</TabsContent>
        <TabsContent value="activity">Activity panel</TabsContent>
      </Tabs>,
    )
    await user.click(screen.getByRole('tab', { name: 'Activity' }))
    expect(
      screen
        .getByRole('tab', { name: 'Activity' })
        .getAttribute('aria-selected'),
    ).toBe('true')
    expect(
      screen
        .getByRole('tab', { name: 'Properties' })
        .getAttribute('aria-selected'),
    ).toBe('false')
    expect(screen.getByText('Activity panel')).toBeTruthy()
  })

  it('moves focus to the next tab on ArrowRight', async () => {
    const { user } = await setup(
      <Tabs defaultValue="properties">
        <TabsList>
          <TabsTrigger value="properties">Properties</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>
        <TabsContent value="properties">Properties panel</TabsContent>
        <TabsContent value="activity">Activity panel</TabsContent>
      </Tabs>,
    )
    const properties = screen.getByRole('tab', { name: 'Properties' })
    const activity = screen.getByRole('tab', { name: 'Activity' })
    await user.click(properties)
    expect(document.activeElement).toBe(properties)
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(activity)
  })
})
