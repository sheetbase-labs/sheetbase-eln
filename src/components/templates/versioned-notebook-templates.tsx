import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldLabel,
  Input,
  Select,
} from '#/components/ui'
import type { TemplateProject } from '#/components/templates/template-library'
import {
  createNotebookTemplate,
  fetchNotebookTemplates,
  fetchNotebookTemplateVersions,
  instantiateNotebookTemplateVersion,
  notebookTemplateDataClient,
  publishNotebookTemplateVersion,
} from '#/lib/notebook-template-data'
import type { NotebookTemplateConfiguration } from '#/lib/notebook-template'

function emptyNotebookTemplateConfiguration(): NotebookTemplateConfiguration {
  return {
    formatVersion: 1,
    parameters: [],
    placements: [
      {
        id: crypto.randomUUID(),
        kind: 'narrative',
        order: 1,
        blockType: 'rich_text',
        payload: {
          doc: { type: 'doc', content: [{ type: 'paragraph' }] },
        },
      },
    ],
  }
}

function notebookTemplateKey(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
  const base = slug.length > 0 ? slug : 'notebook'
  return `${base}_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`
}

export function VersionedNotebookTemplatePanel({
  workspaceId,
  canEdit,
  projects,
}: {
  workspaceId: string
  canEdit: boolean
  projects: TemplateProject[]
}) {
  const queryClient = useQueryClient()
  const [draftOpen, setDraftOpen] = useState(false)
  const [draftName, setDraftName] = useState('')
  const templates = useQuery({
    queryKey: ['notebook-templates', workspaceId],
    queryFn: () => fetchNotebookTemplates(notebookTemplateDataClient),
  })
  const create = useMutation({
    mutationFn: (name: string) =>
      createNotebookTemplate({
        workspaceId,
        key: notebookTemplateKey(name),
        name: name.trim(),
        configuration: emptyNotebookTemplateConfiguration(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notebook-templates'] })
      setDraftOpen(false)
      setDraftName('')
    },
  })

  return (
    <section className="mb-8 rounded-lg border p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Notebook templates</h2>
          <p className="text-xs text-muted-foreground">
            Published versions create a new Notebook. Existing Notebooks stay on
            the version they were created from.
          </p>
        </div>
        {canEdit ? (
          <Button
            type="button"
            size="sm"
            onClick={() => setDraftOpen(true)}
            disabled={create.isPending}
          >
            New draft
          </Button>
        ) : null}
      </div>
      {templates.isLoading ? (
        <p className="text-sm text-muted-foreground" role="status">
          Loading notebook templates…
        </p>
      ) : templates.data?.length ? (
        <ul className="space-y-3">
          {templates.data.map((template) => (
            <VersionedTemplateRow
              key={template.id}
              templateId={template.id}
              name={template.name}
              canPublish={canEdit}
              projects={projects}
            />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          No notebook templates yet. Create a draft to start the catalogue.
        </p>
      )}
      <Dialog open={draftOpen} onOpenChange={setDraftOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New notebook template</DialogTitle>
            <DialogDescription>
              Name the template. You can publish a version when it is ready to
              create Notebooks.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="notebook-template-name">Name</FieldLabel>
            <Input
              id="notebook-template-name"
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              placeholder="Stability run notebook"
            />
          </Field>
          {create.error ? (
            <p className="text-sm text-destructive" role="alert">
              Could not create the template. Check the name and try again.
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDraftOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!draftName.trim() || create.isPending}
              onClick={() => create.mutate(draftName)}
            >
              Create draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function VersionedTemplateRow({
  templateId,
  name,
  canPublish,
  projects,
}: {
  templateId: string
  name: string
  canPublish: boolean
  projects: TemplateProject[]
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [createOpen, setCreateOpen] = useState(false)
  const [versionId, setVersionId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '')
  const versions = useQuery({
    queryKey: ['notebook-template-versions', templateId],
    queryFn: () =>
      fetchNotebookTemplateVersions(templateId, notebookTemplateDataClient),
  })
  const publish = useMutation({
    mutationFn: (input: { id: string; revision: number }) =>
      publishNotebookTemplateVersion(input.id, input.revision),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['notebook-template-versions', templateId],
      }),
  })
  const instantiate = useMutation({
    mutationFn: () =>
      instantiateNotebookTemplateVersion({
        versionId: versionId ?? '',
        targetProjectId: projectId,
        title: title.trim() || undefined,
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: (result) => {
      const project = result.record.project_id
      if (!project) return
      setCreateOpen(false)
      void navigate({
        to: '/projects/$projectId/experiments/$recordId',
        params: { projectId: project, recordId: result.record.id },
      })
    },
  })

  return (
    <li className="rounded-md border px-3 py-2">
      <p className="text-sm font-medium">{name}</p>
      <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
        {versions.isLoading ? (
          <li role="status">Loading versions…</li>
        ) : (
          versions.data?.map((version) => (
            <li key={version.id} className="flex items-center justify-between">
              <span>
                Version {version.version} · {version.lifecycle}
                {version.configuration.placements.filter(
                  (placement) => placement.kind === 'sheet',
                ).length
                  ? ` · ${version.configuration.placements.filter((placement) => placement.kind === 'sheet').length} sheet placement(s)`
                  : ''}
              </span>
              <span className="flex gap-1">
                {canPublish && version.lifecycle === 'draft' ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      publish.mutate({
                        id: version.id,
                        revision: version.revision,
                      })
                    }
                  >
                    Publish
                  </Button>
                ) : null}
                {version.lifecycle === 'published' && projects.length > 0 ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setVersionId(version.id)
                      setTitle(name)
                      setProjectId(projects[0]?.id ?? '')
                      setCreateOpen(true)
                    }}
                  >
                    Create notebook
                  </Button>
                ) : null}
              </span>
            </li>
          ))
        )}
      </ul>
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create notebook from template</DialogTitle>
            <DialogDescription>
              Choose a project and a title. You will open the new Notebook when
              it is ready.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor={`notebook-title-${templateId}`}>
              Notebook title
            </FieldLabel>
            <Input
              id={`notebook-title-${templateId}`}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`notebook-project-${templateId}`}>
              Project
            </FieldLabel>
            <Select
              id={`notebook-project-${templateId}`}
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title}
                </option>
              ))}
            </Select>
          </Field>
          {instantiate.error ? (
            <p className="text-sm text-destructive" role="alert">
              Could not create the Notebook. Try again.
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreateOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!projectId || !versionId || instantiate.isPending}
              onClick={() => instantiate.mutate()}
            >
              Create and open
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  )
}
