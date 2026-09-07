import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { describeSignInError } from '#/lib/auth-errors'

const getSignInState = createServerFn({ method: 'GET' }).handler(async () => {
  // Server-only: tells the page whether GitHub OAuth is configured without
  // exposing any credential material to the client.
  const { isDevAuthFreeEnabled, isGithubConfigured } =
    await import('#/lib/auth')
  return {
    devAuthFree: isDevAuthFreeEnabled(),
    githubEnabled: isGithubConfigured,
  }
})

const signInSearch = z.object({
  error: z.string().optional(),
})

export const Route = createFileRoute('/sign-in')({
  validateSearch: signInSearch,
  loader: () => getSignInState(),
  component: SignIn,
})

function SignIn() {
  const { devAuthFree, githubEnabled } = Route.useLoaderData()
  const { error } = Route.useSearch()
  const message = describeSignInError(error)

  return (
    <main className="grid min-h-svh place-items-center p-8">
      <div className="w-full max-w-sm space-y-4">
        <div className="space-y-1">
          <p className="text-sm font-medium text-muted-foreground">Sheetbase</p>
          <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
        </div>

        {message ? (
          <p
            role="alert"
            className="rounded-md border border-border bg-muted p-3 text-sm"
          >
            {message}
          </p>
        ) : null}

        {devAuthFree ? (
          <p className="text-sm leading-6 text-muted-foreground">
            This disposable development or preview environment is open for
            review. No sign-in or OAuth setup is required.
          </p>
        ) : githubEnabled ? (
          <SignInWithGitHub />
        ) : (
          <p className="text-sm leading-6 text-muted-foreground">
            GitHub sign-in is not configured for this environment yet. See
            docs/operations/authentication.md to create the OAuth application
            and set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.
          </p>
        )}
      </div>
    </main>
  )
}

function SignInWithGitHub() {
  return (
    <button
      type="button"
      className="inline-flex h-9 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
      onClick={async () => {
        try {
          const res = await fetch('/api/auth/sign-in/social', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
              provider: 'github',
              callbackURL: '/',
            }),
          })
          const data = (await res.json()) as { url?: string }
          if (data.url) {
            window.location.href = data.url
          }
        } catch (err) {
          console.error('GitHub sign-in failed:', err)
        }
      }}
    >
      Continue with GitHub
    </button>
  )
}
