/**
 * The sequence block: a sequence in the notebook with a workbench for the
 * work done on it. It shows as a map with a short summary; the workbench opens
 * the tools (edit, enzymes, digest, primers, cloning, Sanger reads).
 */
import { useLayoutEffect, useMemo, useState } from 'react'

import { Textarea } from '#/components/inventory/list'
import {
  canEditBlockOffline,
  useOfflineEdits,
} from '#/components/offline/offline-edits'
import { CloningTab } from '#/components/sequence/workbench/cloning-tab'
import { DigestTab } from '#/components/sequence/workbench/digest-tab'
import { EditTab } from '#/components/sequence/workbench/edit-tab'
import { EnzymesTab } from '#/components/sequence/workbench/enzymes-tab'
import { PrimersTab } from '#/components/sequence/workbench/primers-tab'
import { CodonsTab } from '#/components/sequence/workbench/codons-tab'
import { GuidesTab } from '#/components/sequence/workbench/guides-tab'
import { ReadsTab } from '#/components/sequence/workbench/reads-tab'
import { parsedOf } from '#/components/sequence/workbench/shared'
import type { WorkbenchProps } from '#/components/sequence/workbench/shared'
import { CircularMap, LinearMap } from '#/components/sequence/sequence-map'
import { SequenceViewer } from '#/components/sequence/sequence-viewer'
import { summaryLine } from '#/components/sequence/sequence-panel'
import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Tabs } from '#/components/ui/tabs'
import { t } from '#/copy'
import { validateBlock } from '#/lib/blocks'
import { summarise } from '#/lib/sequence'
import { sequenceOf } from '#/lib/sequence-block'
import type { SequenceBlockPayload } from '#/lib/sequence-block'
import { ConflictBanner } from './conflict-banner'
import type { BlockEditorProps } from './block-editor'
import { useAutosave } from './use-autosave'

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

function useSequenceAutosave(
  { block, save, offline, onStatusChange }: BlockEditorProps,
  initial: SequenceBlockPayload,
) {
  const { canQueue } = useOfflineEdits()
  const holdOffline =
    (offline ?? false) && !(canQueue && canEditBlockOffline('sequence'))
  const autosave = useAutosave<SequenceBlockPayload>({
    initialValue: initial,
    validate: (value) => {
      const result = validateBlock({
        type: 'sequence',
        payload: value,
        payloadSchemaVersion: block.payloadSchemaVersion,
      })
      return result.ok ? [] : result.errors.map((error) => error.message)
    },
    save: async (value) =>
      (await save(
        value as unknown as Record<string, unknown>,
      )) as unknown as Awaited<
        ReturnType<
          Parameters<typeof useAutosave<SequenceBlockPayload>>[0]['save']
        >
      >,
    offline: holdOffline,
    touched: true,
  })
  useLayoutEffect(() => {
    onStatusChange?.(autosave.status)
  }, [autosave.status, onStatusChange])
  return autosave
}

function Notices({
  autosave,
}: {
  autosave: ReturnType<typeof useAutosave<SequenceBlockPayload>>
}) {
  return (
    <>
      {autosave.status === 'conflict' ? (
        <ConflictBanner
          message={t('molbio.block.changedElsewhere')}
          serverPreview={JSON.stringify(autosave.serverValue)}
          onUseServer={autosave.discardDraft}
          onKeepLocal={autosave.retry}
        />
      ) : null}
      {autosave.error && autosave.status !== 'conflict' ? (
        <Notice
          tone="bad"
          action={
            <Button onClick={autosave.retry}>{t('molbio.block.retry')}</Button>
          }
        >
          {autosave.error}
        </Notice>
      ) : null}
    </>
  )
}

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
        onValueChange={(k) => setTab(k as TabKey)}
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

export function SequenceEditor(props: BlockEditorProps) {
  const { block, readOnly } = props
  const initial = useMemo(() => sequenceOf(block.payload), [block.payload])
  const autosave = useSequenceAutosave(props, initial)
  const draft = autosave.draft
  const [tab, setTab] = useState<TabKey>(
    initial.residues.length > 0 ? 'map' : 'edit',
  )
  const canEdit = !readOnly && !(props.offline ?? false)
  const wb: WorkbenchProps = {
    draft,
    edit: (change) => autosave.setDraft((current) => change(current)),
    canEdit,
    recordId: block.recordId,
    blockId: block.id,
    insertBelow: props.onInsertBelow
      ? (payload) => props.onInsertBelow?.('sequence', payload)
      : undefined,
  }
  const summary =
    draft.residues.length > 0 ? summaryLine(summarise(parsedOf(draft))) : null
  return (
    <section
      aria-label={t('molbio.block.aria')}
      className="flex min-w-0 flex-col gap-3 rounded-md border border-border p-3"
    >
      <Notices autosave={autosave} />
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label={t('molbio.block.title')}
          placeholder={t('molbio.block.titlePlaceholder')}
          className="min-w-48 flex-1"
          value={draft.title ?? ''}
          readOnly={!canEdit}
          autoFocus={props.autoFocus}
          onChange={(e) =>
            autosave.setDraft((c) => ({ ...c, title: e.target.value }))
          }
          onBlur={autosave.flush}
        />
        <Input
          aria-label={t('molbio.block.name')}
          placeholder={t('molbio.block.namePlaceholder')}
          className="w-56"
          value={draft.name}
          readOnly={!canEdit}
          onChange={(e) =>
            autosave.setDraft((c) => ({ ...c, name: e.target.value }))
          }
          onBlur={autosave.flush}
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
      <Workbench tab={tab} setTab={setTab} props={wb} showMapTab />
      <Textarea
        aria-label={t('molbio.block.caption')}
        placeholder={t('molbio.block.captionPlaceholder')}
        rows={2}
        readOnly={!canEdit}
        value={draft.caption ?? ''}
        onChange={(e) =>
          autosave.setDraft((c) => ({ ...c, caption: e.target.value }))
        }
        onBlur={autosave.flush}
      />
    </section>
  )
}

/** The block as read: a map, a summary of the work, and the workbench on request. */
export function SequencePreview({
  payload,
  recordId,
  blockId,
  insertBelow,
}: {
  payload: unknown
  recordId?: string
  blockId?: string
  insertBelow?: (payload: Record<string, unknown>) => void
}) {
  const p = sequenceOf(payload)
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<TabKey>('map')
  const parsed = useMemo(() => parsedOf(p), [p])
  const [selected, setSelected] = useState<number | null>(null)
  const reads = p.reads ?? []
  const lines = [
    (p.primers?.length ?? 0) > 0
      ? t('molbio.block.primerCount', { count: p.primers?.length ?? 0 })
      : null,
    (p.plans?.length ?? 0) > 0
      ? t('molbio.block.planCount', { count: p.plans?.length ?? 0 })
      : null,
    reads.length > 0
      ? t('molbio.block.readCount', { count: reads.length })
      : null,
    (p.digests?.length ?? 0) > 0
      ? t('molbio.block.digestCount', { count: p.digests?.length ?? 0 })
      : null,
  ].filter(Boolean)
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      {p.title ? (
        <figcaption className="text-body font-medium text-fg">
          {p.title}
        </figcaption>
      ) : null}
      {p.residues.length === 0 ? (
        <p className="text-label text-fg-muted">{t('molbio.block.empty')}</p>
      ) : (
        <>
          <p className="num text-label text-fg-muted">
            {[
              p.name,
              summaryLine(summarise(parsed)),
              p.registryIdentifier
                ? t('molbio.block.registeredAs', {
                    identifier: p.registryIdentifier,
                  })
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {p.topology === 'circular' ? (
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
      {(p.products?.length ?? 0) > 0 ? (
        <p className="text-label text-fg-muted">
          {t('molbio.block.products', {
            identifiers: (p.products ?? []).map((x) => x.identifier).join(', '),
          })}
        </p>
      ) : null}
      {p.caption ? (
        <p className="text-label text-fg-muted">{p.caption}</p>
      ) : null}
      {p.residues.length > 0 && recordId && blockId ? (
        <div>
          <Button size="sm" onClick={() => setOpen((v) => !v)}>
            {open
              ? t('molbio.block.hideWorkbench')
              : t('molbio.block.openWorkbench')}
          </Button>
        </div>
      ) : null}
      {open && recordId && blockId ? (
        <Workbench
          tab={tab}
          setTab={setTab}
          showMapTab={false}
          props={{
            draft: p,
            edit: () => undefined,
            canEdit: false,
            recordId,
            blockId,
            insertBelow,
          }}
        />
      ) : null}
    </figure>
  )
}
