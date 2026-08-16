import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/ui'
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

const EMPTY_CONFIGURATION: NotebookTemplateConfiguration = {
  formatVersion: 1,
  parameters: [],
  placements: [
    {
      id: '0198d970-e266-4000-8000-0000000000c1',
      kind: 'narrative',
      order: 1,
      blockType: 'rich_text',
      payload: {
        doc: { type: 'doc', content: [{ type: 'paragraph' }] },
      },
    },
  ],
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
  const templates = useQuery({
    queryKey: ['notebook-templates', workspaceId],
    queryFn: () => fetchNotebookTemplates(notebookTemplateDataClient),
  })
  const create = useMutation({
    mutationFn: () =>
      createNotebookTemplate({
        workspaceId,
        key: `notebook_${crypto.randomUUID().slice(0, 8)}`,
        name: 'Untitled notebook template',
        configuration: EMPTY_CONFIGURATION,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['notebook-templates'] }),
  })

  return (
    <section className="mb-8 rounded-lg border p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Versioned notebook templates</h2>
          <p className="text-xs text-muted-foreground">
            Published versions pin Sheet Definition Versions. Existing
            Notebooks stay on the version they were created from.
          </p>
        </div>
        {canEdit ? (
          <Button
            type="button"
            size="sm"
            onClick={() => create.mutate()}
            disabled={create.isPending}
          >
            New draft
          </Button>
        ) : null}
      </div>
      {templates.data?.length ? (
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
          No versioned notebook templates yet. Legacy record templates remain
          listed below.
        </p>
      )}
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
    mutationFn: (versionId: string) =>
      instantiateNotebookTemplateVersion({
        versionId,
        targetProjectId: projects[0]?.id ?? '',
        idempotencyKey: crypto.randomUUID(),
      }),
  })

  return (
    <li className="rounded-md border px-3 py-2">
      <p className="text-sm font-medium">{name}</p>
      <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
        {versions.data?.map((version) => (
          <li key={version.id} className="flex items-center justify-between">
            <span>
              Version {version.version} · {version.lifecycle}
              {version.configuration.placements.filter((p) => p.kind === 'sheet')
                .length
                ? ` · ${version.configuration.placements.filter((p) => p.kind === 'sheet').length} sheet placement(s)`
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
              {version.lifecycle === 'published' && projects[0] ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={instantiate.isPending}
                  onClick={() => instantiate.mutate(version.id)}
                >
                  Create notebook
                </Button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </li>
  )
}
