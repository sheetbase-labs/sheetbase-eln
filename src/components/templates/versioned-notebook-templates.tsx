import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'

import { SearchableSelect } from '#/components/ui/searchable-select'
import {
  Badge,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui'
import type { TemplateProject } from '#/components/templates/template-library'
import { formatDate } from '#/lib/notebook-data'
import {
  createNotebookTemplate,
  fetchAllNotebookTemplateVersions,
  fetchNotebookTemplates,
  instantiateNotebookTemplateVersion,
  notebookTemplateDataClient,
  publishNotebookTemplateVersion,
} from '#/lib/notebook-template-data'
import type { NotebookTemplateConfiguration } from '#/lib/notebook-template'
import type { NotebookTemplateVersion } from '#/lib/notebook-template-data'

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
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [draftOpen, setDraftOpen] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [createTitle, setCreateTitle] = useState('')
  const [createProjectId, setCreateProjectId] = useState(projects[0]?.id ?? '')
  const [createVersionId, setCreateVersionId] = useState<string | null>(null)
  const templates = useQuery({
    queryKey: ['notebook-templates', workspaceId, search],
    queryFn: () =>
      fetchNotebookTemplates(notebookTemplateDataClient, {
        search,
        limit: 100,
      }),
  })
  const versions = useQuery({
    queryKey: ['notebook-template-versions'],
    queryFn: () => fetchAllNotebookTemplateVersions(notebookTemplateDataClient),
  })
  const versionsByTemplate = useMemo(() => {
    const map = new Map<string, NotebookTemplateVersion[]>()
    for (const version of versions.data ?? []) {
      const list = map.get(version.templateId) ?? []
      list.push(version)
      map.set(version.templateId, list)
    }
    return map
  }, [versions.data])
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
      queryClient.invalidateQueries({
        queryKey: ['notebook-template-versions'],
      })
      setDraftOpen(false)
      setDraftName('')
    },
  })
  const publish = useMutation({
    mutationFn: (input: { id: string; revision: number }) =>
      publishNotebookTemplateVersion(input.id, input.revision),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['notebook-template-versions'],
      }),
  })
  const instantiate = useMutation({
    mutationFn: () =>
      instantiateNotebookTemplateVersion({
        versionId: createVersionId ?? '',
        targetProjectId: createProjectId,
        title: createTitle.trim() || undefined,
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
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold">Notebook templates</h2>
          <p className="text-xs text-muted-foreground">
            Search the catalogue, then create a Notebook from a published
            version.
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
      <label htmlFor="notebook-template-search" className="sr-only">
        Search notebook templates
      </label>
      <Input
        id="notebook-template-search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search by name or key"
        className="max-w-md"
      />
      {templates.isLoading || versions.isLoading ? (
        <p className="text-sm text-muted-foreground" role="status">
          Loading notebook templates…
        </p>
      ) : templates.data?.length ? (
        <Table containerClassName="rounded-md border">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Latest</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.data.map((template) => {
              const templateVersions = versionsByTemplate.get(template.id) ?? []
              const published = templateVersions.find(
                (version) => version.lifecycle === 'published',
              )
              const draft = templateVersions.find(
                (version) => version.lifecycle === 'draft',
              )
              return (
                <TableRow key={template.id}>
                  <TableCell>
                    <p className="font-medium">{template.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {template.key}
                    </p>
                  </TableCell>
                  <TableCell>
                    {templateVersions.length === 0 ? (
                      '—'
                    ) : (
                      <span className="inline-flex items-center gap-2">
                        <span>v{templateVersions[0].version}</span>
                        <Badge
                          variant={
                            templateVersions[0].lifecycle === 'published'
                              ? 'success'
                              : 'outline'
                          }
                          className="text-xs"
                        >
                          {templateVersions[0].lifecycle}
                        </Badge>
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(template.updatedAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="inline-flex justify-end gap-1">
                      {canEdit && draft ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            publish.mutate({
                              id: draft.id,
                              revision: draft.revision,
                            })
                          }
                        >
                          Publish
                        </Button>
                      ) : null}
                      {published && projects.length > 0 ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setCreateVersionId(published.id)
                            setCreateTitle(template.name)
                            setCreateProjectId(projects[0]?.id ?? '')
                            setCreateOpen(true)
                          }}
                        >
                          Create notebook
                        </Button>
                      ) : null}
                    </span>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      ) : (
        <p className="text-sm text-muted-foreground">
          No notebook templates match that search.
        </p>
      )}
      {templates.data && templates.data.length === 100 ? (
        <p className="text-xs text-muted-foreground">
          Showing the first 100 matches. Narrow the search to find a specific
          template.
        </p>
      ) : null}

      <Dialog open={draftOpen} onOpenChange={setDraftOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New notebook template</DialogTitle>
            <DialogDescription>
              Name the template. Publish a version when it is ready to create
              Notebooks.
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

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create notebook from template</DialogTitle>
            <DialogDescription>
              Search for a project, name the Notebook, then open it.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="notebook-title">Notebook title</FieldLabel>
            <Input
              id="notebook-title"
              value={createTitle}
              onChange={(event) => setCreateTitle(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="notebook-project">Project</FieldLabel>
            <SearchableSelect
              id="notebook-project"
              items={projects}
              value={createProjectId}
              onChange={setCreateProjectId}
              getId={(project) => project.id}
              getLabel={(project) => project.title}
              getDescription={(project) => project.key}
              placeholder="Search projects"
              triggerLabel="Select a project"
              emptyLabel="No projects match that search."
            />
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
              disabled={
                !createProjectId || !createVersionId || instantiate.isPending
              }
              onClick={() => instantiate.mutate()}
            >
              Create and open
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
