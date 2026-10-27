import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { signInRedirect } from '#/lib/sign-in-redirect'

/**
 * UI port (roadmap-4/ui-app3): the analysis area frame. The list lives at
 * `/analysis`, the builder at `/analysis/new`, and a saved view at
 * `/analysis/$analysisId`.
 */
export const Route = createFileRoute('/analysis')({
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth
    if (!context) throw redirect(signInRedirect(location))
    return { context }
  },
  component: AnalysisLayout,
})

function AnalysisLayout() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <Outlet />
    </div>
  )
}
