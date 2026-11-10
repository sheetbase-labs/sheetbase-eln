import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { z } from 'zod'
import { ThemeProvider } from '#/components/theme-provider'
import { Toaster } from '#/components/ui/sonner'
import { SettingsSessions } from '#/components/settings/settings-sessions'
import { SettingsTwoFactor } from '#/components/settings/settings-two-factor'
import { SettingsNotifications } from '#/components/settings/settings-notifications'
import { SettingsPasskeys } from '#/components/settings/settings-passkeys'
import '#/styles.css'

// Actual compiled components and transport, without application auth/bootstrap.
const view = z
  .enum(['sessions', 'two-factor', 'notifications', 'passkeys'])
  .parse(new URLSearchParams(location.search).get('view'))

const root = createRootRoute({
  component: { sessions: SettingsSessions, 'two-factor': SettingsTwoFactor, notifications: SettingsNotifications, passkeys: SettingsPasskeys }[view],
})

const router = createRouter({ routeTree: root })
const target = document.getElementById('root')

if (!target) throw new Error('Component fixture root required')

createRoot(target).render(
  <QueryClientProvider
    client={
      new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      })
    }
  >
    <ThemeProvider>
      <RouterProvider router={router} />
      <Toaster />
    </ThemeProvider>
  </QueryClientProvider>,
)
