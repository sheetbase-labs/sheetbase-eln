import { useEffect, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { InstallPrompt } from '#/components/pwa/install-prompt'

/**
 * Offers to install Sheetbase as an app. Chrome and Edge fire a
 * `beforeinstallprompt` event once the app is installable, and the prompt
 * triggers the browser's own dialog. iPhone and iPad have no such dialog, so
 * the prompt points at Share > Add to Home Screen. Nothing shows once
 * installed, and "Not now" is remembered for a month.
 *
 * Both states are reached the way the browser reaches them: the Chromium story
 * dispatches the real event, the iOS story presents an iPhone user agent.
 */
const meta = {
  title: 'Shell/Install prompt',
  component: InstallPrompt,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof InstallPrompt>

export default meta

type Story = StoryObj<typeof meta>

function snoozeCleared() {
  try {
    window.localStorage.removeItem('sheetbase.install.snoozedUntil')
  } catch {
    // Private mode: nothing was snoozed.
  }
}

/** The browser said the app is installable: the prompt offers an Install button. */
export const Installable: Story = {
  decorators: [
    (Story) => {
      snoozeCleared()
      queueMicrotask(() => {
        const event = new Event('beforeinstallprompt', { cancelable: true })
        Object.assign(event, {
          prompt: async () => {},
          userChoice: Promise.resolve({ outcome: 'dismissed' as const }),
        })
        window.dispatchEvent(event)
      })

      return <Story />
    },
  ],
}

/** iPhone Safari: no install dialog exists, so the prompt explains the Share sheet. */
export const IPhone: Story = {
  decorators: [
    (Story) => (
      <PresentAsIPhone>
        <Story />
      </PresentAsIPhone>
    ),
  ],
}

/** Presents an iPhone user agent for the story's lifetime, then restores it. */
function PresentAsIPhone({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    snoozeCleared()

    const original = Object.getOwnPropertyDescriptor(
      window.navigator,
      'userAgent',
    )

    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      get: () =>
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    })
    setReady(true)

    return () => {
      if (original)
        Object.defineProperty(window.navigator, 'userAgent', original)
      else delete (window.navigator as { userAgent?: string }).userAgent
    }
  }, [])

  return ready ? <>{children}</> : null
}
