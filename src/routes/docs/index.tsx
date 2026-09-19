import { createFileRoute, Link, redirect } from '@tanstack/react-router'

import { DOC_NAMES, DOC_TITLES } from './-documents'

/**
 * `/docs` index — lists the operational runbooks served under `/docs/$name`.
 * The documents themselves render from `docs/*.md` in the deployment (see
 * `$name.tsx`); this index only links to them.
 */
export const Route = createFileRoute('/docs/')({
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) throw redirect({ to: '/sign-in' })
    if (!context.workspace) throw redirect({ to: '/' })
    return { context }
  },
  component: DocsIndexPage,
})

function DocsIndexPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:px-8">
      <h1 className="text-2xl font-semibold">Documentation</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Operational runbooks for this deployment.
      </p>
      <ul className="mt-4 space-y-2">
        {DOC_NAMES.map((name) => (
          <li key={name}>
            <Link
              to="/docs/$name"
              params={{ name }}
              className="text-sm text-primary hover:underline"
            >
              {DOC_TITLES[name] ?? name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
