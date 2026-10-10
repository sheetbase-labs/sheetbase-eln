import { createFileRoute } from '@tanstack/react-router'

import { Status } from '#/components/v3/ui/status'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Muted, Section } from '#/components/v3/ui/layout'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import {
  publishedTemplateVersion,
  templateLifecycle,
  useTemplateVersions,
} from '#/components/v3/templates/templates-data'
import type { NotebookTemplateVersion } from '#/lib/notebook-template-data'

/** UI port (roadmap-4/ui-app3): the template's Sections view reads the stored
 * configuration. Editing is deferred; the configuration is shown as stored. */
export const Route = createFileRoute('/templates/$templateId/')({
  component: TemplateSections,
})

function shownVersion(
  versions: NotebookTemplateVersion[],
): NotebookTemplateVersion | undefined {
  const published = publishedTemplateVersion(versions)
  return published ?? [...versions].sort((a, b) => b.version - a.version).at(0)
}

function sectionKind(placement: { kind: string; blockType?: string }): string {
  if (placement.kind === 'narrative') return placement.blockType ?? 'narrative'
  if (placement.kind === 'sheet') return 'sheet'
  return 'section'
}

function TemplateSections() {
  const { templateId } = Route.useParams()
  const versions = useTemplateVersions(templateId)
  const version = shownVersion(versions.data ?? [])

  if (!version) {
    return (
      <div className="px-4 py-4 md:px-6">
        <EmptyState
          icon="template"
          title="No version yet"
          body="A template needs a version with sections and parameters before a notebook can be made from it."
        />
      </div>
    )
  }

  const config = version.configuration
  const placements = [...config.placements].sort((a, b) => a.order - b.order)
  return (
    <div className="min-w-0 flex-1 overflow-auto px-4 py-4 md:px-6">
      <div className="flex flex-col gap-5">
        <Section
          title="Version"
          count={
            <Status tone={templateLifecycle(version.lifecycle).tone}>
              {templateLifecycle(version.lifecycle).label} v{version.version}
            </Status>
          }
        >
          <Muted>
            {version.publishedAt
              ? `Published ${version.publishedAt.slice(0, 10)}. `
              : 'Not published. '}
            Notebooks already made keep the version they started on.
          </Muted>
        </Section>

        <Section title="Sections" count={placements.length}>
          {placements.length ? (
            <TableBox>
              <Table aria-label="Template sections">
                <TableHeader>
                  <TableRow>
                    <TableHead align="right">Order</TableHead>
                    <TableHead>Section</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead>Built from</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {placements.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell align="right" className="num">
                        {p.order}
                      </TableCell>
                      <TableCell>
                        {p.kind === 'section_placeholder'
                          ? p.label
                          : p.kind === 'sheet'
                            ? (p.title ?? 'Sheet')
                            : p.blockType}
                      </TableCell>
                      <TableCell>{sectionKind(p)}</TableCell>
                      <TableCell className="mono text-fg-muted">
                        {p.kind === 'sheet'
                          ? `definition version ${p.definitionVersionId.slice(0, 8)}`
                          : p.kind === 'section_placeholder'
                            ? `placeholder ${p.key}`
                            : 'narrative block'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableBox>
          ) : (
            <Muted>No sections in this version.</Muted>
          )}
        </Section>

        <Section title="Parameters" count={config.parameters.length}>
          {config.parameters.length ? (
            <TableBox>
              <Table aria-label="Template parameters">
                <TableHeader>
                  <TableRow>
                    <TableHead>Key</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Label</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {config.parameters.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="mono">{p.key}</TableCell>
                      <TableCell>{p.type.kind}</TableCell>
                      <TableCell>{p.label}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableBox>
          ) : (
            <Muted>No parameters declared.</Muted>
          )}
        </Section>
      </div>
    </div>
  )
}
