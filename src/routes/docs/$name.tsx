import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { marked } from 'marked'

const DOC_NAMES = [
  'deployment',
  'recovery',
  'security',
  'performance',
  'observability',
  'administration',
] as const

export const Route = createFileRoute('/docs/$name')({
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) throw redirect({ to: '/sign-in' })
    if (!context.workspace) throw redirect({ to: '/' })
    return { context }
  },
  loader: async ({ params }) => {
    const name = params.name
    if (!DOC_NAMES.includes(name as (typeof DOC_NAMES)[number])) {
      throw new Error('Unknown document')
    }
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const filePath = resolve(process.cwd(), 'docs', `${name}.md`)
    try {
      const content = readFileSync(filePath, 'utf-8')
      const html = marked.parse(content, { async: false })
      return { name, html }
    } catch {
      return { name, html: null }
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
  const { name, html } = Route.useLoaderData()
  const title = DOC_TITLES[name] ?? name

  if (!html) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 md:px-8">
        <Link
          to="/admin/$section"
          params={{ section: 'deployment' }}
          search={{ model: undefined }}
          className="text-sm text-primary hover:underline"
        >
          ← Back to deployment
        </Link>
        <h1 className="mt-4 text-2xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This document is not available in the current deployment.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:px-8">
      <Link
        to="/admin/$section"
        params={{ section: 'deployment' }}
        search={{ model: undefined }}
        className="text-sm text-primary hover:underline"
      >
        ← Back to deployment
      </Link>
      <h1 className="mt-4 text-2xl font-semibold">{title}</h1>
      <div
        className="prose prose-sm dark:prose-invert mt-4 max-w-none [&_table]:border-collapse [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:bg-muted/30 [&_pre]:p-3"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}
