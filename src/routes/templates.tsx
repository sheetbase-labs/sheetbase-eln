import { useMemo } from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Badge } from '#/components/v3/ui/badge'
import { Status } from '#/components/v3/ui/status'
import type { Tone } from '#/components/v3/ui/status'
import { Input } from '#/components/v3/ui/input'
import { Inspector, InspectorSection, Muted } from '#/components/v3/ui/layout'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { notebookDataClient } from '#/lib/notebook-data'
import type { NotebookRecord } from '#/lib/notebook-data'
import { fetchTemplates } from '#/lib/templates'

/** UI port (roadmap-4/ui-app3): the Templates board on real protocol
 * templates. Sheet/notebook template kinds and the TPL display id are not in
 * the model yet, so they render as gaps. */
export const Route = createFileRoute('/templates')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { selected?: string; template?: string; protocol?: string } => ({
    selected: typeof search.selected === 'string' ? search.selected : undefined,
    template: typeof search.template === 'string' ? search.template : undefined,
    protocol: typeof search.protocol === 'string' ? search.protocol : undefined,
  }),
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect({ to: '/sign-in' })
    }
    return { context }
  },
  component: TemplatesList,
})

const STATUS: Record<string, { tone: Tone; label: string }> = {
  draft: { tone: 'draft', label: 'Draft' },
  under_review: { tone: 'review', label: 'In review' },
  active: { tone: 'ok', label: 'Active' },
}

function templateStatus(status: string): { tone: Tone; label: string } {
  return (
    STATUS[status] ?? {
      tone: 'none',
      label: status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    }
  )
}

function TemplatesList() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const query = useQuery({
    queryKey: ['ui-port', 'templates'],
    queryFn: () => fetchTemplates(notebookDataClient),
    staleTime: 15_000,
  })
  const templates = useMemo(() => query.data ?? [], [query.data])

  const wanted = search.selected ?? search.template ?? search.protocol
  const current = templates.find((t) => t.id === wanted) ?? templates.at(0)

  const select = (t: NotebookRecord) =>
    navigate({
      to: '/templates',
      search: (s) => ({
        ...s,
        selected: t.id,
        template: undefined,
        protocol: undefined,
      }),
      replace: true,
    })

  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col overflow-auto">
        <header className="flex flex-col gap-1 border-b border-border px-4 pb-3 pt-4 md:px-6">
          <div className="flex items-center gap-2">
            <h1 className="text-title">Templates</h1>
            <span className="num text-fg-muted">{templates.length}</span>
            <span className="flex-1" />
            <label className="block w-[220px]">
              <span className="sr-only">Search templates</span>
              <Input type="search" placeholder="Search templates" disabled />
            </label>
          </div>
          <Muted>
            Reusable notebooks, sheets and record forms. A new version never
            changes work already made from an old one.
          </Muted>
        </header>

        <div className="px-4 py-4 md:px-6">
          {templates.length ? (
            <TableBox>
              <Table>
                <TableHeader>
                  <TableRow>
                    {[
                      'Template',
                      'Kind',
                      'Identifier',
                      'Status',
                      'Updated',
                    ].map((h) => (
                      <TableHead key={h}>{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {templates.map((t) => {
                    const status = templateStatus(t.status)
                    return (
                      <TableRow
                        key={t.id}
                        selected={t.id === current?.id}
                        className="cursor-pointer"
                        onClick={() => select(t)}
                      >
                        <TableCell>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              select(t)
                            }}
                            className="cursor-pointer border-0 bg-transparent p-0 text-left text-body text-link hover:underline"
                          >
                            {t.title}
                          </button>
                        </TableCell>
                        <TableCell>
                          <Badge variant="kind">Protocol</Badge>
                        </TableCell>
                        <TableCell className="mono">{t.identifier}</TableCell>
                        <TableCell>
                          <Status tone={status.tone}>{status.label}</Status>
                        </TableCell>
                        <TableCell className="text-fg-muted">
                          {t.updatedAt.slice(0, 10)}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </TableBox>
          ) : (
            <Muted>
              {query.isLoading ? 'Loading templates…' : 'No templates yet.'}
            </Muted>
          )}
        </div>
      </div>

      {current ? (
        <Inspector
          aria-label={`Template ${current.identifier}`}
          className="w-[320px]"
        >
          <InspectorSection>
            <span className="mono text-fg-muted">{current.identifier}</span>
            <h2 className="text-doc">{current.title}</h2>
            <p className="mb-0 mt-1 text-label leading-[18px]">
              {String(current.properties.description ?? 'No description.')}
            </p>
            <div className="mt-2 flex gap-1.5">
              <Button
                size="sm"
                variant="primary"
                onClick={() =>
                  void navigator.clipboard.writeText(
                    `${window.location.origin}/templates?protocol=${current.id}`,
                  )
                }
              >
                Copy link
              </Button>
            </div>
          </InspectorSection>
          <InspectorSection title="Versioning">
            <Muted>
              Protocol versions with approval chains arrive with the controlled
              protocols capability; a template currently stores no version.
            </Muted>
          </InspectorSection>
          <InspectorSection title="Reuse is deliberate">
            <Muted>
              New versions never change work already made from an old one.
            </Muted>
          </InspectorSection>
        </Inspector>
      ) : null}
    </>
  )
}
