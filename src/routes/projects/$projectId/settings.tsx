import { useEffect, useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Muted, Section } from '#/components/v3/ui/layout'
import { Field, Input } from '#/components/v3/ui/input'
import { Button } from '#/components/v3/ui/button'
import { Notice } from '#/components/v3/ui/alert'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { toast } from '#/components/v3/ui/sonner'
import { NativeSelect } from '#/components/v3/projects/select'
import { stages } from '#/components/v3/projects/options'
import {
  projectDataClient,
  PROJECTS_KEY,
  useProjectSummary,
} from '#/components/v3/projects/project-data'
import { DataClientError } from '#/lib/data-client'

interface ClientWire {
  id: string
  code: string
  name: string
}

/** UI port (roadmap-4/ui-app3): project Settings wired to update_project_details
 * and archive_project / unarchive_project. */
export const Route = createFileRoute('/projects/$projectId/settings')({
  component: ProjectSettings,
})

function ProjectSettings() {
  const { projectId } = Route.useParams()
  const { context } = Route.useRouteContext()
  const { project, query } = useProjectSummary(projectId)
  const queryClient = useQueryClient()
  const router = useRouter()
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [name, setName] = useState('')
  const [clientId, setClientId] = useState('')
  const [stage, setStage] = useState('')
  const [agreement, setAgreement] = useState('')

  useEffect(() => {
    if (!project) return
    setName(project.title)
    setClientId('')
    setStage(project.stage ?? '')
    setAgreement(project.agreementReference ?? '')
  }, [project?.id])

  const clientsQuery = useQuery({
    queryKey: ['clients', context.workspace?.id],
    queryFn: () =>
      projectDataClient.list<ClientWire>(
        'clients',
        '?select=id,code,name&order=code.asc',
      ),
  })

  const save = useMutation({
    mutationFn: () =>
      projectDataClient.rpc('update_project_details', {
        p_project_id: projectId,
        p_expected_revision: Number(project!.revision),
        p_title: name.trim(),
        p_client_id: clientId || null,
        p_stage: stage || null,
        p_agreement_reference: agreement || null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PROJECTS_KEY })
      toast('Project settings saved')
    },
  })

  const portal = useQuery({
    queryKey: ['ui-port', 'project-client-portal', projectId],
    queryFn: () =>
      projectDataClient
        .list<{
          id: string
          client_id: string | null
          auto_share_to_client: boolean
        }>(
          'projects',
          `?id=eq.${encodeURIComponent(projectId)}&select=id,client_id,auto_share_to_client`,
        )
        .then((rows) => rows[0] ?? null),
  })

  const setPortal = useMutation({
    mutationFn: (enabled: boolean) =>
      projectDataClient.rpc('update_project_settings', {
        p_project_id: projectId,
        p_auto_share_to_client: enabled,
      }),
    onSuccess: (_data, enabled) => {
      void queryClient.invalidateQueries({
        queryKey: ['ui-port', 'project-client-portal', projectId],
      })
      toast(enabled ? 'Client portal enabled' : 'Client portal disabled', {
        description: enabled
          ? 'Approved records of this project are shared with its client.'
          : 'The client sees only records explicitly shared to them.',
      })
    },
  })

  const archive = useMutation({
    mutationFn: (nextArchived: boolean) =>
      projectDataClient.rpc(
        nextArchived ? 'archive_project' : 'unarchive_project',
        { p_project_id: projectId },
      ),
    onSuccess: (_data, nextArchived) => {
      void queryClient.invalidateQueries({ queryKey: PROJECTS_KEY })
      void router.invalidate()
      setConfirmArchive(false)
      toast(nextArchived ? 'Project archived' : 'Project restored')
    },
  })

  if (!project) {
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-[26px] overflow-auto px-4 py-[22px] md:px-8">
        <p className="text-body text-fg-muted">
          {query.isLoading ? 'Loading project…' : 'Project not found.'}
        </p>
      </div>
    )
  }

  const isLead = project.leadUserId === context.user.id
  if (!isLead) {
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-[26px] overflow-auto px-4 py-[22px] md:px-8">
        <Notice icon="lock" title="Only the project lead can change settings.">
          {project.leadName ?? 'The lead'} is the lead. Ask them to change the
          stage, reviewer or client sharing.
        </Notice>
      </div>
    )
  }

  const saving = save.isPending
  const saveError =
    save.error instanceof DataClientError ? save.error.message : null

  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col gap-[26px] overflow-auto px-4 py-[22px] md:px-8">
        <Section title="Project details">
          <div className="flex flex-col gap-3.5">
            <Field label="Name" required className="max-w-[520px]">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <div className="grid grid-cols-1 gap-x-5 gap-y-3.5 md:grid-cols-[250px_250px]">
              <Field label="Client">
                <NativeSelect
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                >
                  <option value="">Internal</option>
                  {(clientsQuery.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} · {c.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Stage">
                <NativeSelect
                  value={stage}
                  onChange={(e) => setStage(e.target.value)}
                >
                  <option value="">—</option>
                  {stages.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <Field
              label="Agreement reference"
              hint="Shown on exported PDFs and the client portal."
              className="max-w-[520px]"
            >
              <Input
                value={agreement}
                onChange={(e) => setAgreement(e.target.value)}
              />
            </Field>
            {saveError ? (
              <p role="alert" className="m-0 text-label text-danger-text">
                {saveError}
              </p>
            ) : null}
          </div>
          <div className="mt-3 flex gap-2">
            <Button
              variant="primary"
              disabled={saving || !name.trim()}
              onClick={() => save.mutate()}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </Section>

        <Section title="Client portal">
          {project.clientCode || project.clientName ? (
            <div className="flex max-w-[640px] flex-col gap-2.5">
              <Muted>
                {portal.data?.auto_share_to_client
                  ? `Approved records of this project are shared with ${project.clientName ?? 'the client'}. Drafts and unapproved revisions are never shared.`
                  : `Off. ${project.clientName ?? 'The client'} sees only records you share to them individually.`}
              </Muted>
              <div>
                <Button
                  variant={
                    portal.data?.auto_share_to_client ? 'secondary' : 'primary'
                  }
                  disabled={setPortal.isPending || portal.isLoading}
                  onClick={() =>
                    setPortal.mutate(!portal.data?.auto_share_to_client)
                  }
                >
                  {portal.data?.auto_share_to_client
                    ? 'Turn the client portal off'
                    : 'Turn the client portal on'}
                </Button>
              </div>
            </div>
          ) : (
            <Muted>
              This project has no client. Set one above to open a client portal.
            </Muted>
          )}
        </Section>

        <Section title="Archive project">
          <Notice
            tone="warn"
            icon={false}
            className="max-w-[640px]"
            action={
              project.archivedAt ? (
                <Button
                  variant="secondary"
                  disabled={archive.isPending}
                  onClick={() => archive.mutate(false)}
                >
                  Restore project
                </Button>
              ) : (
                <Button
                  variant="danger"
                  onClick={() => setConfirmArchive(true)}
                >
                  Archive…
                </Button>
              )
            }
          >
            Archiving makes every record read-only and removes the project from
            lists. Signed records stay available for audit.
          </Notice>
        </Section>
      </div>

      <Dialog open={confirmArchive} onOpenChange={setConfirmArchive}>
        <DialogContent className="w-[min(480px,calc(100vw-32px))]">
          <DialogHeader
            title={`Archive ${project.title}?`}
            description={`${project.displayId ?? project.key} · every record becomes read-only`}
          />
          <DialogBody>
            <p className="m-0 text-body leading-5">
              The project leaves the Projects list and the navigation. Signed
              records, datasets and audit trails stay available; the lead can
              restore it from the Archived tab.
            </p>
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button />}>Cancel</DialogClose>
            <Button variant="danger-fill" onClick={() => archive.mutate(true)}>
              Archive project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
