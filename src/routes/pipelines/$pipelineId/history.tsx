import { useState } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'

import { DuplicateDialog } from '#/components/pipelines/history/duplicate-dialog'
import {
  HistoryTable,
  versionMode,
} from '#/components/pipelines/history/history-table'
import { ReadOnlyVersion } from '#/components/pipelines/history/read-only-version'
import {
  usePipelineDefinition,
  usePipelineVersions,
  useWorkspaceMemberNames,
} from '#/components/pipelines/pipelines-data'
import { Button } from '#/components/ui/button'
import { Muted, Section } from '#/components/ui/layout'
import { t } from '#/copy'
import { words } from '#/lib/pipelines/simple/words'
import { signInRedirect } from '#/lib/sign-in-redirect'
import type { PipelineDefinitionVersionWire } from '#/lib/pipelines/types'

/** Every version of a pipeline in the mode it was written in; open one read-only or duplicate it. */
export const Route = createFileRoute('/pipelines/$pipelineId/history')({
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth

    if (!context) throw redirect(signInRedirect(location))

    return { context }
  },
  component: PipelineHistory,
})

function PipelineHistory() {
  const { pipelineId } = Route.useParams()
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id ?? ''
  const definition = usePipelineDefinition(pipelineId)
  const versions = usePipelineVersions(pipelineId)
  const members = useWorkspaceMemberNames()
  const [open, setOpen] = useState<PipelineDefinitionVersionWire | null>(null)

  const [duplicate, setDuplicate] =
    useState<PipelineDefinitionVersionWire | null>(null)

  const list = versions.data ?? []
  const d = definition.data

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-auto px-6 py-5 max-md:px-4">
      <Section title={t('features.pipelineSimple.history.title')}>
        <Muted>{t('features.pipelineSimple.history.description')}</Muted>
        <HistoryTable
          versions={list}
          names={members.data ?? {}}
          convertedVersion={new Set()}
          onOpen={setOpen}
          onDuplicate={setDuplicate}
        />
        <Muted>{t('features.pipelineSimple.history.note')}</Muted>
      </Section>
      {open ? (
        <Section
          title={words('history')('readOnly', {
            version: open.version,
            mode: words('mode')(versionMode(open)),
          })}
          action={
            <Button size="sm" onClick={() => setOpen(null)}>
              {t('features.pipelineSimple.history.back')}
            </Button>
          }
        >
          <ReadOnlyVersion version={open} />
        </Section>
      ) : null}
      {duplicate && d ? (
        <DuplicateDialog
          key={duplicate.id}
          open
          onOpenChange={(next) => {
            if (!next) setDuplicate(null)
          }}
          workspaceId={workspaceId}
          versionId={duplicate.id}
          version={duplicate.version}
          mode={words('mode')(versionMode(duplicate))}
          displayId={d.display_id ?? d.key}
          name={d.name}
        />
      ) : null}
    </div>
  )
}
