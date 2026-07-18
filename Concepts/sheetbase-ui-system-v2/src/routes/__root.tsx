import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'
import appCss from '../styles.css?url'
import { ThemeProvider } from '#/components/theme-provider'
import { DesignSystemShell } from '#/components/design-system-shell'
import { Toaster } from '#/components/ui/sonner'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Sheetbase UI System' },
      { name: 'description', content: 'The Sheetbase design system and component framework.' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  component: RootComponent,
  shellComponent: RootDocument,
})

function RootComponent() {
  return <ThemeProvider><DesignSystemShell><Outlet /></DesignSystemShell><Toaster richColors /></ThemeProvider>
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><HeadContent /></head>
      <body>
        {children}
        <TanStackDevtools config={{ position: 'bottom-right' }} plugins={[{ name: 'TanStack Router', render: <TanStackRouterDevtoolsPanel /> }]} />
        <Scripts />
      </body>
    </html>
  )
}
