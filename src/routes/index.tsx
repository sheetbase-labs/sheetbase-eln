import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'

import { AppShell } from '#/components/app-shell'

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    const context = await getCurrentContextFn()
    if (!context) {
      throw redirect({ to: '/sign-in' })
    }
    return { context }
  },
  component: Home,
})

const getCurrentContextFn = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { getRequestHeaders } = await import('@tanstack/react-start/server')
    const { getCurrentContext } = await import('#/lib/current-user')
    return getCurrentContext(getRequestHeaders())
  },
)

const retryBootstrapFn = createServerFn({ method: 'POST' }).handler(
  async () => {
    const { getRequestHeaders } = await import('@tanstack/react-start/server')
    const { auth } = await import('#/lib/auth')
    const { drizzle } = await import('drizzle-orm/node-postgres')
    const { env } = await import('#/env.server')
    const schema = await import('#/db/schema')
    const { bootstrapWorkspaceForUser } = await import('#/lib/bootstrap')

    const session = await auth.api.getSession({ headers: getRequestHeaders() })
    if (!session) {
      throw new Error('Not signed in')
    }
    const db = drizzle(env.DATABASE_URL, { schema })
    return bootstrapWorkspaceForUser(db, {
      id: session.user.id,
      name: session.user.name,
    })
  },
)

function Home() {
  const { context } = Route.useRouteContext()

  if (!context.workspace) {
    return (
      <AppShell
        context={{
          workspace: null,
          user: { name: context.user.name, email: context.user.email },
        }}
        breadcrumbs={[{ label: 'Home' }]}
      >
        <BootstrapRecovery userName={context.user.name} />
      </AppShell>
    )
  }

  return (
    <AppShell
      context={{
        workspace: { name: context.workspace.name },
        user: {
          name: context.user.name,
          email: context.user.email,
          role: context.workspace.role,
        },
      }}
      breadcrumbs={[{ label: 'Home' }]}
      primaryAction={
        <a
          href="/projects"
          className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground no-underline"
        >
          + New
        </a>
      }
    >
      <WorkspaceSummary context={context} />
    </AppShell>
  )
}

export function WorkspaceSummary({
  context,
}: {
  context: {
    user: { id: string; name: string; email: string }
    workspace: { id: string; slug: string; name: string; role: string } | null
  }
}) {
  const workspace = context.workspace!
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        {workspace.name}
      </h1>
      <p className="text-sm text-muted-foreground">
        Welcome back. Your workspace is ready.
      </p>
      <dl className="space-y-1 text-sm">
        <div className="flex gap-2">
          <dt className="w-28 text-muted-foreground">Signed in as</dt>
          <dd>
            {context.user.name} ({context.user.email})
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-28 text-muted-foreground">Workspace</dt>
          <dd>{workspace.slug}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-28 text-muted-foreground">Your role</dt>
          <dd>{workspace.role}</dd>
        </div>
      </dl>
      <a
        href="/projects"
        className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
      >
        Open projects
      </a>
    </div>
  )
}

function BootstrapRecovery({ userName }: { userName: string }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-semibold tracking-tight">
        Finish setting up, {userName}
      </h1>
      <p className="text-sm leading-6 text-muted-foreground">
        Your account exists but its workspace was not created. This is
        recoverable — creating it now picks up exactly where sign-up stopped.
      </p>
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-border bg-muted p-3 text-sm"
        >
          {error}
        </p>
      ) : null}
      <button
        type="button"
        disabled={pending}
        className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
        onClick={async () => {
          setPending(true)
          setError(null)
          try {
            await retryBootstrapFn()
            await router.invalidate()
          } catch {
            setError('Workspace creation failed. Try again.')
            setPending(false)
          }
        }}
      >
        {pending ? 'Creating workspace…' : 'Create my workspace'}
      </button>
    </div>
  )
}
