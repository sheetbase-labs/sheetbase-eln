import { createFileRoute, Link } from '@tanstack/react-router'

const DOC_NAMES = [
  'deployment',
  'recovery',
  'security',
  'performance',
  'observability',
  'administration',
] as const

export const Route = createFileRoute('/docs/$name')({
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
      return { name, content }
    } catch {
      return { name, content: null }
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
  const { name, content } = Route.useLoaderData()
  const title = DOC_TITLES[name] ?? name

  if (!content) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 md:px-8">
        <Link to="/admin/$section" params={{ section: 'deployment' }} search={{ model: undefined }} className="text-sm text-primary hover:underline">
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
      <Link to="/admin/$section" params={{ section: 'deployment' }} search={{ model: undefined }} className="text-sm text-primary hover:underline">
        ← Back to deployment
      </Link>
      <h1 className="mt-4 text-2xl font-semibold">{title}</h1>
      <pre className="mt-4 overflow-x-auto whitespace-pre-wrap rounded-lg border bg-muted/30 p-4 text-sm leading-relaxed">
        {content}
      </pre>
    </div>
  )
}
