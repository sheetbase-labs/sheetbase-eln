import { Link, Outlet, createFileRoute, redirect } from '@tanstack/react-router'

import { Status } from '#/components/v3/ui/status'
import { DescriptionList, Muted } from '#/components/v3/ui/layout'
import { Skeleton } from '#/components/v3/ui/skeleton'
import { useHelp } from '#/lib/help'
import { signInRedirect } from '#/lib/sign-in-redirect'

/**
 * Help centre frame: /help (index), /help/records, /help/shortcuts. Help
 * content is static and ships with the release; the release card reads what
 * varies per deployment.
 */
export const Route = createFileRoute('/help')({
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect(signInRedirect(location))
    }
    return { context }
  },
  component: HelpLayout,
})

function HelpLayout() {
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-auto">
      <Outlet />
    </div>
  )
}

/** Side card with the running release: used on every help page. */
export function ReleaseCard() {
  const help = useHelp()
  return (
    <section
      aria-labelledby="release-h"
      className="flex flex-col gap-2 rounded-md border border-border p-3.5"
    >
      <h2 id="release-h" className="font-sans text-label font-semibold">
        This release
      </h2>
      {help ? (
        <>
          <DescriptionList
            labelWidth={84}
            items={[
              ['Version', <span className="mono">{help.release.version}</span>],
              [
                'Status',
                <Status tone={help.release.validation.tone}>
                  {help.release.validation.label}
                </Status>,
              ],
              [
                'Build',
                <span className="mono text-[11px]">{help.release.build}</span>,
              ],
            ]}
          />
          <Muted className="text-caption leading-4">
            {help.release.validation.detail} {help.release.statement}.
          </Muted>
        </>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-40" />
        </div>
      )}
      <Link to="/help" hash="whats-new" className="text-label">
        Release notes
      </Link>
    </section>
  )
}
