import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ThemeProvider, useTheme } from '#/components/theme-provider'
import { Button } from '#/components/ui/button'

/**
 * Appearance is per user (System, Light or Dark). The provider shares the
 * preference with the shell and, when signed in, adopts the server value once
 * on a device that has not chosen for itself. Signed out here, so nothing is
 * read or written beyond this browser.
 */
function Picker() {
  const { theme, setTheme } = useTheme()

  return (
    <div className="flex flex-col gap-2 text-body">
      <span>
        Appearance: <b>{theme}</b>
      </span>
      <div className="flex gap-2">
        {(['system', 'light', 'dark'] as const).map((choice) => (
          <Button
            key={choice}
            variant={theme === choice ? 'primary' : 'secondary'}
            onClick={() => setTheme(choice)}
          >
            {choice}
          </Button>
        ))}
      </div>
    </div>
  )
}

const meta = {
  title: 'Shell/Theme provider',
  component: ThemeProvider,
  tags: ['autodocs'],
  args: { children: <Picker /> },
} satisfies Meta<typeof ThemeProvider>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}
