import { useState } from 'react'
import {
  Link,
  createFileRoute,
  redirect,
  useNavigate,
} from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'

import { PageHeader, Muted } from '#/components/v3/ui/layout'
import { Button } from '#/components/v3/ui/button'
import { Field, Input } from '#/components/v3/ui/input'
import { Notice } from '#/components/v3/ui/alert'
import { NativeSelect } from '#/components/v3/projects/select'
import { toast } from '#/components/v3/ui/sonner'
import { createBlankExperiment } from '#/lib/notebook-create'
import { notebookDataClient } from '#/lib/notebook-data'

/**
 * UI port (roadmap-4/ui-app3): New experiment. app-3's form asks for a
 * reviewer, planned end and a protocol to follow; the ELN models an experiment
 * as a record with a project and a title, so only those are asked for and the
 * rest are stated as gaps. Creation uses the canonical
 * `create_record_with_blocks` RPC, so the new notebook opens on its own data.
 */
export const Route = createFileRoute('/experiments/new')({
  validateSearch: (search: Record<string, unknown>): { project?: string } => ({
    project: typeof search.project === 'string' ? search.project : undefined,
  }),
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect({ to: '/sign-in' })
    }
    return { context }
  },
  component: NewExperiment,
})

function NewExperiment() {
  const search = Route.useSearch()
  const navigate = useNavigate()
  const projects = useQuery({
    queryKey: ['ui-port', 'experiments', 'new', 'projects'],
    queryFn: () =>
      notebookDataClient.list<{ id: string; title: string }>(
        'projects',
        '?select=id,title&order=title.asc',
      ),
    staleTime: 60_000,
  })
  const rows = projects.data ?? []
  const [projectId, setProjectId] = useState(search.project ?? '')
  const [title, setTitle] = useState('')
  const [touched, setTouched] = useState(false)

  const effectiveProjectId = projectId || rows.at(0)?.id || ''
  const titleError =
    touched && title.trim().length < 5
      ? 'Use at least 5 characters so the title says what is being tested.'
      : undefined
  const projectError =
    touched && !effectiveProjectId ? 'Choose a project.' : undefined

  const create = useMutation({
    mutationFn: () =>
      createBlankExperiment(notebookDataClient, {
        projectId: effectiveProjectId,
        title: title.trim(),
      }),
    onSuccess: (record) => {
      toast(`Draft ${record.identifier} created`, {
        description: 'It opens on a blank notebook; add blocks as you work.',
      })
      void navigate({
        to: '/experiments/$expId/notebook',
        params: { expId: record.id },
      })
    },
    onError: (error: unknown) => {
      toast.error(
        error instanceof Error ? error.message : 'Couldn’t create the draft.',
      )
    },
  })

  const submit = () => {
    setTouched(true)
    if (title.trim().length < 5 || !effectiveProjectId) return
    create.mutate()
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-auto">
      <PageHeader
        crumbs={
          <>
            <Link to="/experiments" className="text-link">
              Experiments
            </Link>{' '}
            / New
          </>
        }
        title="New experiment"
      />
      <form
        className="mx-auto flex w-full max-w-[560px] flex-col gap-4 px-4 py-4 md:px-6"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <Field label="Project" required error={projectError}>
          <NativeSelect
            value={effectiveProjectId}
            onChange={(e) => setProjectId(e.target.value)}
            disabled={projects.isLoading}
          >
            {rows.length === 0 ? (
              <option value="">No projects yet</option>
            ) : null}
            {rows.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field
          label="Title"
          required
          error={titleError}
          hint="What is being tested. It becomes the notebook title."
        >
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            aria-invalid={Boolean(titleError) || undefined}
          />
        </Field>
        <Notice tone="info">
          The ELN records an experiment with a project and a title. Reviewer,
          planned end, a protocol to follow and copying materials from an
          earlier experiment are not modelled yet; add them when those
          capabilities land.
        </Notice>
        <div className="flex gap-2">
          <Button
            type="submit"
            variant="primary"
            disabled={create.isPending || rows.length === 0}
          >
            {create.isPending ? 'Creating…' : 'Create draft'}
          </Button>
          <Button nativeButton={false} render={<Link to="/experiments" />}>
            Cancel
          </Button>
        </div>
        {rows.length === 0 && !projects.isLoading ? (
          <Muted>Create a project first; an experiment belongs to one.</Muted>
        ) : null}
      </form>
    </div>
  )
}
