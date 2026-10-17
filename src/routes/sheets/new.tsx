import { useState } from 'react'
import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'

import { PageHeader, Muted } from '#/components/v3/ui/layout'
import { Button } from '#/components/v3/ui/button'
import { Field, Input } from '#/components/v3/ui/input'
import { Select } from '#/components/v3/ui/select'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { toast } from '#/components/v3/ui/sonner'
import { Icon } from '#/components/v3/icons'
import { createAdHocSheetInstance } from '#/lib/sheet-instance-data'
import type { SheetInstanceState } from '#/lib/sheet-instance'
import { fetchProjectSummaries } from '#/components/v3/projects/project-data'

/** UI port (roadmap-4/ui-app3): a new, empty working sheet. A sheet lives in a
 * project, so the flow picks one; the blank sheet is created through the
 * canonical create RPC and opened at /sheets/$sheetId. */
export const Route = createFileRoute('/sheets/new')({
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect({ to: '/sign-in' })
    }
    return { context }
  },
  component: NewSheet,
})

function blankState(): SheetInstanceState {
  return {
    bindings: [],
    localFields: [],
    localValues: {},
    calculationOverrides: {},
    presentation: {
      columnOrder: [],
      hiddenColumnIds: [],
      columnWidths: {},
      frozenColumnCount: 0,
      density: 'standard',
      filters: [],
      sorts: [],
    },
    provenance: { createdFrom: 'ad_hoc' },
  }
}

const starts = [
  {
    icon: 'database' as const,
    title: 'From a dataset snapshot',
    body: 'Pick columns from a dataset. They stay read-only and pinned to the snapshot.',
    to: '/datasets' as const,
  },
  {
    icon: 'template' as const,
    title: 'From a template',
    body: 'Start from a notebook template that already has its sheets and fields.',
    to: '/templates' as const,
  },
  {
    icon: 'upload' as const,
    title: 'Paste or import a file',
    body: 'CSV or Excel. Values stay local until you keep them.',
    to: '/import' as const,
  },
  {
    icon: 'table' as const,
    title: 'Blank sheet',
    body: 'Start with local columns only, then promote them into a dataset.',
    blank: true,
    to: '/sheets/new' as const,
  },
]

function NewSheet() {
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id ?? ''
  const navigate = useNavigate()
  const projects = useQuery({
    queryKey: ['ui-port', 'sheets', 'new', 'projects'],
    queryFn: () => fetchProjectSummaries(undefined),
  })
  const [projectId, setProjectId] = useState('')
  const [name, setName] = useState('Untitled sheet')

  const create = useMutation({
    mutationFn: () =>
      createAdHocSheetInstance({
        workspaceId,
        name: name.trim() || 'Untitled sheet',
        projectId,
        state: blankState(),
      }),
    onSuccess: (instance) => {
      toast('Sheet created', {
        description:
          'Bring in data you want to look at, then add local columns.',
      })
      void navigate({
        to: '/sheets/$sheetId',
        params: { sheetId: instance.id },
        search: { projectId },
      })
    },
    onError: (error: unknown) =>
      toast('Could not create the sheet', {
        description:
          error instanceof Error ? error.message : 'The database refused it.',
      }),
  })

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-auto">
      <PageHeader
        trail={[{ label: 'New' }]}
        title="New sheet"
        meta={
          <span>Sheets are private to a project and are never evidence.</span>
        }
      />
      <div className="flex justify-center px-4 pb-8 pt-8 md:px-6">
        <div className="flex w-[560px] max-w-full flex-col gap-3.5">
          <EmptyState
            icon="table"
            title="This sheet is empty"
            body="A working sheet is for trying things. Bring in data you want to look at, then add local columns to explore it."
            className="py-0"
          />
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {starts.map((o) =>
              'blank' in o && o.blank ? (
                <button
                  key={o.title}
                  type="button"
                  onClick={() => {
                    document
                      .getElementById('new-sheet')
                      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    document.getElementById('new-sheet-name')?.focus()
                  }}
                  className="flex min-h-14 cursor-pointer gap-2.5 rounded-md border border-border bg-surface p-3 text-left text-fg hover:bg-surface-hover"
                >
                  <span className="mt-px shrink-0 text-fg-muted">
                    <Icon name={o.icon} size={16} />
                  </span>
                  <span>
                    <b className="block font-medium">{o.title}</b>
                    <span className="text-caption text-fg-muted">{o.body}</span>
                  </span>
                </button>
              ) : (
                <Link
                  key={o.title}
                  to={o.to}
                  className="flex min-h-14 gap-2.5 rounded-md border border-border bg-surface p-3 text-fg no-underline hover:bg-surface-hover hover:text-fg hover:no-underline"
                >
                  <span className="mt-px shrink-0 text-fg-muted">
                    <Icon name={o.icon} size={16} />
                  </span>
                  <span>
                    <b className="block font-medium">{o.title}</b>
                    <span className="text-caption text-fg-muted">{o.body}</span>
                  </span>
                </Link>
              ),
            )}
          </div>

          <div
            id="new-sheet"
            className="mt-2 flex flex-col gap-3 rounded-md border border-border p-3"
          >
            <Field label="Project" required>
              <Select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                <option value="">Choose a project…</option>
                {(projects.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayId ? `${p.displayId} · ${p.title}` : p.title}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Name">
              <Input
                id="new-sheet-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Button
              variant="primary"
              disabled={!projectId || create.isPending}
              onClick={() => create.mutate()}
            >
              Create blank sheet
            </Button>
          </div>

          <Muted>
            Sheets are private to the project and never count as evidence.
            Promote columns into a dataset when you want to keep them.
          </Muted>
        </div>
      </div>
    </div>
  )
}
