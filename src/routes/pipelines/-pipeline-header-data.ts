/**
 * The pipeline's header as data for the shared record page: its version
 * status, when it was published, who owns it and how much of the editor it
 * shows, and its sections from Steps to Activity.
 */
import { versionStatus } from '#/components/pipelines/pipelines-data'
import type {
  RecordFact,
  RecordPageProps,
} from '#/components/record-page/record-page'
import type { TabsProps } from '#/components/ui/tabs'
import type { PipelineDefinitionVersionWire } from '#/lib/pipelines/types'
import { formatNotebookDateTime } from '#/lib/notebook-data'
import { t } from '#/copy'

type Version = Pick<
  PipelineDefinitionVersionWire,
  'version' | 'lifecycle' | 'published_at'
>

/** The draft being edited, else the current version, else none yet. */
export function pipelineStatus(
  current: Version | null | undefined,
  draft: Version | null | undefined,
): NonNullable<RecordPageProps['status']> {
  if (draft) {
    return {
      tone: 'draft',
      label: `${t('data.pipelinePage.draftV')}${draft.version}`,
    }
  }

  if (current) {
    const status = versionStatus(current.lifecycle)

    return { tone: status.tone, label: `${status.label} v${current.version}` }
  }

  return { tone: 'draft', label: t('data.pipelinePage.versionYet') }
}

export function pipelineFacts({
  current,
  owner,
  mode,
}: {
  current: Version | null | undefined
  owner: string | undefined
  mode: 'simple' | 'standard' | 'advanced'
}): RecordFact[] {
  const facts: (RecordFact | null)[] = [
    current?.lifecycle === 'published' && current.published_at
      ? {
          label: t('data.pipelineHeader.publishedFact'),
          value: formatNotebookDateTime(current.published_at),
        }
      : null,
    owner ? { label: t('data.pipelineHeader.ownerFact'), value: owner } : null,
    {
      label: t('data.pipelineHeader.modeFact'),
      value: t(`data.pipelineHeader.mode.${mode}`),
    },
  ]

  return facts.filter((fact) => fact !== null)
}

/** Steps first, the pipeline's own document; Activity at the far end. */
export function pipelineTabs({
  params,
  steps,
  runs,
}: {
  params: { pipelineId: string }
  steps: number | undefined
  runs: number | undefined
}): TabsProps {
  return {
    mode: 'url',
    label: t('data.pipelinePage.pipelineSections'),
    items: [
      {
        label: t('data.pipelinePage.steps'),
        count: steps,
        link: { to: '/pipelines/$pipelineId/steps', params },
      },
      {
        label: t('data.pipelineHeader.startsAndRuns'),
        count: runs,
        link: { to: '/pipelines/$pipelineId/starts', params },
      },
      {
        label: t('data.pipelineHeader.activity'),
        link: { to: '/pipelines/$pipelineId/activity', params },
        end: true,
      },
    ],
  }
}
