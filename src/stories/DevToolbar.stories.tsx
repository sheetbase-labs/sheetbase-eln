import { useEffect, useState } from 'react'
import { QueryClient } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { DevToolbar } from '#/components/dev-toolbar/dev-toolbar'
import { setDevSwitch } from '#/components/dev-toolbar/dev-switch'

/**
 * The toolbar that lives inside the app: switch feature flags, watch
 * performance, slow or break the network, and run developer actions. Everything
 * it does is local to this browser. In a production build it shows only to
 * owners and admins who switch it on with Ctrl+Alt+D; these stories switch it
 * on.
 */
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Infinity } },
})

function Switched({
  on,
  children,
}: {
  on: boolean
  children: React.ReactNode
}) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    setDevSwitch(on)
    setReady(true)

    return () => setDevSwitch(false)
  }, [on])

  return ready ? <>{children}</> : null
}

const meta = {
  title: 'Shell/Dev toolbar',
  component: DevToolbar,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  args: { role: 'owner', queryClient },
  decorators: [
    (Story) => (
      <Switched on>
        <div className="h-[420px]">
          <Story />
        </div>
      </Switched>
    ),
  ],
} satisfies Meta<typeof DevToolbar>

export default meta

type Story = StoryObj<typeof meta>

export const Owner: Story = {}

export const Admin: Story = { args: { role: 'admin' } }
