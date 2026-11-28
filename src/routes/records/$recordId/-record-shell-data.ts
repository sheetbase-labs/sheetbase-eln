/**
 * The record shell's header facts and tabs, kept out of the component file so
 * the page module exports components only.
 */
import type { RecordFact } from '#/components/record-page/record-page'
import type { TabsProps } from '#/components/ui/tabs'
import { formatDate } from '#/lib/format-date'
import type { NotebookRecord } from '#/lib/notebook-data'
import { t } from '#/copy'

export type RecordShellTab =
  | 'details'
  | 'notebook'
  | 'links'
  | 'sequences'
  | 'revisions'
  | 'signatures'
  | 'history'

/** Type, project, owner and last change: what the header says once. */
export function recordShellFacts({
  record,
  modelName,
  projectTitle,
  ownerName,
}: {
  record: NotebookRecord
  modelName: string
  projectTitle: string | null
  ownerName: string
}): RecordFact[] {
  const facts: RecordFact[] = [
    { label: t('notebook.recordPage.typeFact'), value: modelName },
  ]

  if (projectTitle) {
    facts.push({
      label: t('notebook.recordPage.projectFact'),
      value: projectTitle,
    })
  }

  facts.push(
    { label: t('notebook.recordPage.ownerFact'), value: ownerName },
    {
      label: t('notebook.recordPage.updatedFact'),
      value: formatDate(record.updatedAt, { year: false }),
    },
  )

  return facts
}

/** Details first, the notebook beside it, History at the far end. */
export function recordShellTabs({
  tab,
  onTab,
  links,
  sequences,
  revisions,
  signatures,
}: {
  tab: RecordShellTab
  onTab: (tab: RecordShellTab) => void
  links: number
  sequences: number
  revisions: number
  signatures: number
}): TabsProps {
  return {
    mode: 'state',
    label: t('notebook.recordPage.sections'),
    value: tab,
    // SAFETY: the strip only offers the keys listed below, all RecordShellTab values.
    onValueChange: (key) => onTab(key as RecordShellTab),
    items: [
      { key: 'details', label: t('notebook.recordPage.detailsTab') },
      { key: 'notebook', label: t('notebook.recordPage.notebookTab') },
      {
        key: 'links',
        label: t('notebook.notebookPage.linksLabel'),
        count: links,
      },
      { key: 'sequences', label: t('sequences.title'), count: sequences },
      {
        key: 'revisions',
        label: t('notebook.notebookPage.revisionsLabel'),
        count: revisions,
      },
      {
        key: 'signatures',
        label: t('notebook.notebookPage.signaturesLabel'),
        count: signatures,
      },
      { key: 'history', label: t('notebook.recordPage.history'), end: true },
    ],
  }
}
