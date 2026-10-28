import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { signInRedirect } from '#/lib/sign-in-redirect'

// The rendered documents live in the repository's docs tree; map each stable
// name to its file so the surface renders the document it names.
const DOC_PATHS: Record<string, string> = {
  deployment: 'docs/operations/deployment.md',
  recovery: 'docs/operations/recovery.md',
  security: 'docs/operations/security.md',
  performance: 'docs/subsystems/performance.md',
  observability: 'docs/operations/observability.md',
  administration: 'docs/subsystems/administration.md',
}

export const Route = createFileRoute('/docs/$name')({
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth
    if (!context) throw redirect(signInRedirect(location))
    if (!context.workspace) throw redirect({ to: '/' })
    return { context }
  },
  loader: async ({ params }) => {
    const name = params.name
    // An unknown name is a missing document, not a server error: report it in
    // the page so the route's error boundary stays for real failures.
    const relativePath = DOC_PATHS[name]
    if (!relativePath) {
      return { name, html: null, known: false }
    }
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const filePath = resolve(process.cwd(), relativePath)
    try {
      const content = readFileSync(filePath, 'utf-8')
      // Loaded here so the markdown parser stays out of the app's first load.
      const { marked } = await import('marked')
      const html = marked.parse(content, { async: false })
      return { name, html, known: true }
    } catch {
      return { name, html: null, known: true }
    }
  },
  component: DocPage,
})

const DOC_TITLES: Record<string, string> = {
  deployment: 'Deployment',
  recovery: 'Recovery',
  security: 'Security',
  performance: 'Performance',
  observability: 'Observability',
  administration: 'Administration',
}

function DocPage() {
  const { name, html, known } = Route.useLoaderData()
  const title = DOC_TITLES[name] ?? name

  if (!html) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 md:px-8">
        <Link to="/settings" className="text-sm text-primary hover:underline">
          ← Settings
        </Link>
        <h1 className="mt-4 text-2xl font-semibold">
          {known ? title : 'Document not found'}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {known
            ? 'This document is not available in the current deployment.'
            : `There is no document named “${name}”. Check the name or return to Settings.`}
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:px-8">
      <Link to="/settings" className="text-sm text-primary hover:underline">
        ← Settings
      </Link>
      <h1 className="mt-4 text-2xl font-semibold">{title}</h1>
      <div
        className="prose prose-sm dark:prose-invert mt-4 max-w-none [&_table]:border-collapse [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:bg-muted/30 [&_pre]:p-3"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}
