/**
 * The sequence block: a sequence in the notebook with a workbench for the work
 * done on it. It shows as a map with a short summary; the tabs open the tools
 * (edit, enzymes, digest, primers, cloning, guides, codons, Sanger reads).
 * The whole block is kept as the block's state.
 */
import { createRoot } from 'react-dom/client'
import { useMemo, useState } from 'react'

import { Button, Input, Notice, Tabs, Textarea } from './ui/kit'
import { t } from '#/copy'
import { summarise } from '#/lib/sequence'
import { CircularMap, LinearMap } from './sequence-map'
import { SequenceViewer } from './sequence-viewer'
import { summaryLine } from './summary'
import { CloningTab } from './workbench/cloning-tab'
import { CodonsTab } from './workbench/codons-tab'
import { DigestTab } from './workbench/digest-tab'
import { EditTab } from './workbench/edit-tab'
import { EnzymesTab } from './workbench/enzymes-tab'
import { GuidesTab } from './workbench/guides-tab'
import { PrimersTab } from './workbench/primers-tab'
import { ReadsTab } from './workbench/reads-tab'
import { parsedOf } from './workbench/shared'
import { insertSequenceBelow } from '#/lib/host'
import type { WorkbenchProps } from './workbench/shared'
import { useBlockState } from './use-block-state'
import './generated.css'

type TabKey =
  | 'map'
  | 'edit'
  | 'enzymes'
  | 'digest'
  | 'primers'
  | 'cloning'
  | 'guides'
  | 'codons'
  | 'reads'

function Workbench({
  tab,
  setTab,
  props,
  showMapTab,
}: {
  tab: TabKey
  setTab: (k: TabKey) => void
  props: WorkbenchProps
  showMapTab: boolean
}) {
  const { draft } = props

  const items: { key: TabKey; label: string }[] = [
    ...(showMapTab
      ? [{ key: 'map' as const, label: t('molbio.tabs.map') }]
      : []),
    { key: 'edit', label: t('molbio.tabs.edit') },
    { key: 'enzymes', label: t('molbio.tabs.enzymes') },
    { key: 'digest', label: t('molbio.tabs.digest') },
    { key: 'primers', label: t('molbio.tabs.primers') },
    { key: 'cloning', label: t('molbio.tabs.cloning') },
    { key: 'guides', label: t('molbio.tabs.guides') },
    { key: 'codons', label: t('molbio.tabs.codons') },
    { key: 'reads', label: t('molbio.tabs.reads') },
  ]

  const parsed = useMemo(() => parsedOf(draft), [draft])

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Tabs
        mode="state"
        variant="strip"
        label={t('molbio.tabs.label')}
        value={tab}
        onValueChange={setTab}
        items={items}
      />
      {tab === 'map' ? (
        draft.residues.length > 0 ? (
          <SequenceViewer sequences={[parsed]} />
        ) : (
          <Notice>{t('molbio.enzymes.empty')}</Notice>
        )
      ) : null}
      {tab === 'edit' ? <EditTab {...props} /> : null}
      {tab === 'enzymes' ? <EnzymesTab {...props} /> : null}
      {tab === 'digest' ? <DigestTab {...props} /> : null}
      {tab === 'primers' ? <PrimersTab {...props} /> : null}
      {tab === 'cloning' ? <CloningTab {...props} /> : null}
      {tab === 'guides' ? <GuidesTab {...props} /> : null}
      {tab === 'codons' ? <CodonsTab {...props} /> : null}
      {tab === 'reads' ? <ReadsTab {...props} /> : null}
    </div>
  )
}

function Block() {
  const { ready, invalid, context, draft, change, flush } = useBlockState()
  const canEdit = !context.readOnly
  const [tab, setTab] = useState<TabKey | null>(null)
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  const parsed = useMemo(() => parsedOf(draft), [draft])

  if (!ready) return null

  if (invalid)
    return (
      <div role="alert">
        <Notice tone="warn">{t('molbio.block.invalidState')}</Notice>
      </div>
    )
  const shownTab: TabKey = tab ?? (draft.residues.length > 0 ? 'map' : 'edit')

  const wb: WorkbenchProps = {
    draft,
    edit: change,
    canEdit,
    recordId: context.recordId ?? '',
    blockId: context.blockId ?? '',
    context,
    insertBelow: (payload) =>
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Host rejections can be any value; convert them to a notification string.
      void insertSequenceBelow(context, payload).catch((e: unknown) =>
        sheetbase.notify(e instanceof Error ? e.message : String(e), 'danger'),
      ),
  }

  const summary =
    draft.residues.length > 0 ? summaryLine(summarise(parsed)) : null

  if (!canEdit) {
    const reads = draft.reads ?? []

    const lines = [
      (draft.primers?.length ?? 0) > 0
        ? t('molbio.block.primerCount', { count: draft.primers?.length ?? 0 })
        : null,
      (draft.plans?.length ?? 0) > 0
        ? t('molbio.block.planCount', { count: draft.plans?.length ?? 0 })
        : null,
      reads.length > 0
        ? t('molbio.block.readCount', { count: reads.length })
        : null,
      (draft.digests?.length ?? 0) > 0
        ? t('molbio.block.digestCount', { count: draft.digests?.length ?? 0 })
        : null,
    ].filter(Boolean)

    return (
      <figure className="flex min-w-0 flex-col gap-2">
        {draft.title ? (
          <figcaption className="text-body font-medium text-fg">
            {draft.title}
          </figcaption>
        ) : null}
        {draft.residues.length === 0 ? (
          <p className="text-label text-fg-muted">{t('molbio.block.empty')}</p>
        ) : (
          <>
            <p className="num text-label text-fg-muted">
              {[
                draft.name,
                summary,
                draft.registryIdentifier
                  ? t('molbio.block.registeredAs', {
                      identifier: draft.registryIdentifier,
                    })
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {draft.topology === 'circular' ? (
              <CircularMap
                sequence={parsed}
                selectedId={selected}
                onSelect={setSelected}
                className="mx-auto max-w-sm"
              />
            ) : (
              <LinearMap
                sequence={parsed}
                selectedId={selected}
                onSelect={setSelected}
                from={1}
                to={parsed.length}
              />
            )}
          </>
        )}
        {lines.length > 0 ? (
          <p className="text-label text-fg-muted">{lines.join(' · ')}</p>
        ) : null}
        {(draft.products?.length ?? 0) > 0 ? (
          <p className="text-label text-fg-muted">
            {t('molbio.block.products', {
              identifiers: (draft.products ?? [])
                .map((x) => x.identifier)
                .join(', '),
            })}
          </p>
        ) : null}
        {draft.caption ? (
          <p className="text-label text-fg-muted">{draft.caption}</p>
        ) : null}
        {draft.residues.length > 0 ? (
          <div>
            <Button size="sm" onClick={() => setOpen((v) => !v)}>
              {open
                ? t('molbio.block.hideWorkbench')
                : t('molbio.block.openWorkbench')}
            </Button>
          </div>
        ) : null}
        {open ? (
          <Workbench
            tab={tab === 'map' || tab === null ? 'edit' : tab}
            setTab={setTab}
            showMapTab={false}
            props={wb}
          />
        ) : null}
      </figure>
    )
  }

  return (
    <section
      aria-label={t('molbio.block.aria')}
      className="flex min-w-0 flex-col gap-3 rounded-md border border-border p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label={t('molbio.block.title')}
          placeholder={t('molbio.block.titlePlaceholder')}
          className="min-w-48 flex-1"
          value={draft.title ?? ''}
          onChange={(e) => change((c) => ({ ...c, title: e.target.value }))}
          onBlur={flush}
        />
        <Input
          aria-label={t('molbio.block.name')}
          placeholder={t('molbio.block.namePlaceholder')}
          className="w-56"
          value={draft.name}
          onChange={(e) => change((c) => ({ ...c, name: e.target.value }))}
          onBlur={flush}
        />
      </div>
      {summary ? (
        <p className="num text-label text-fg-muted">
          {summary}
          {draft.registryIdentifier
            ? ` · ${t('molbio.block.registeredAs', { identifier: draft.registryIdentifier })}`
            : ''}
        </p>
      ) : null}
      <Workbench tab={shownTab} setTab={setTab} props={wb} showMapTab />
      <Textarea
        aria-label={t('molbio.block.caption')}
        placeholder={t('molbio.block.captionPlaceholder')}
        rows={2}
        value={draft.caption ?? ''}
        onChange={(e) => change((c) => ({ ...c, caption: e.target.value }))}
        onBlur={flush}
      />
    </section>
  )
}

createRoot(document.getElementById('app')!).render(<Block />)
