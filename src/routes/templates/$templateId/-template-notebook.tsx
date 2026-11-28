import { useEffect, useMemo, useState } from 'react'
import type * as React from 'react'

import { NotebookDocument } from '#/components/notebook/notebook-document'
import { PartsStrip } from '#/components/notebook/parts-strip'
import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { IconButton } from '#/components/ui/icon-button'
import { InspectorSection, Muted } from '#/components/ui/layout'
import { toast } from '#/components/ui/sonner'
import { TemplatePartsSection } from '#/components/templates/template-parts'
import {
  TemplateSectionBlock,
  TemplateSheetBlock,
  TemplateVersionInspector,
} from '#/components/templates/template-sections-board'
import { useSheetDefinitions } from '#/components/templates/templates-data'
import type { PartProgress } from '#/lib/experiment-parts'
import type { NotebookBlock, NotebookRecord } from '#/lib/notebook-data'
import type {
  NotebookTemplate,
  NotebookTemplateVersion,
} from '#/lib/notebook-template-data'
import type { NotebookTemplateConfiguration } from '#/lib/notebook-template'
import {
  TEMPLATE_SECTION_BLOCK,
  TEMPLATE_SHEET_BLOCK,
  duplicateTemplateBlock,
  insertTemplateBlock,
  isTemplateBlockType,
  moveTemplateBlock,
  removeTemplateBlock,
  setPlacementBlock,
  templateNotebookBlocks,
} from '#/lib/template-blocks'
import type { BlockDestination } from '#/lib/template-blocks'
import { useTemplateDraft } from '../-template-draft'
import {
  ParametersSection,
  SectionsSection,
  sheetSettingTargets,
  valueTypeLabel,
} from './-template-settings'
import { t } from '#/copy'

type Draft = ReturnType<typeof useTemplateDraft>

type Part = NonNullable<NotebookTemplateConfiguration['parts']>[number]

/** A template's day, read as an experiment's part that has not started. */
function plannedPart(
  part: Part,
  index: number,
  templateId: string,
  blocks: NotebookBlock[],
): PartProgress {
  const own = blocks.filter((block) => block.partId === part.id)

  return {
    id: part.id,
    recordId: templateId,
    position: index + 1,
    number: index + 1,
    title: part.title,
    dayOffset: part.dayOffset,
    assigneeUserId: null,
    openedAt: null,
    completedAt: null,
    completedByUserId: null,
    opensWhen: part.opensWhen ?? null,
    gateMode: part.gateMode,
    stepsInOrder: part.stepsInOrder,
    requiresSignOff: false,
    signedOffAt: null,
    signedOffByUserId: null,
    signoffId: null,
    state: 'later',
    stepCount: own.filter((block) => block.type === 'procedure_step').length,
    stepsDone: 0,
    blockCount: own.length,
    awaitingSignOff: false,
    signed: false,
  }
}

/**
 * The notebook draws a template the way it draws an experiment; this is the
 * experiment it is drawn as. Nothing reads it as a stored record.
 */
function templateRecord(template: NotebookTemplate): NotebookRecord {
  return {
    id: template.id,
    projectId: null,
    kind: 'notebook_template',
    identifier: template.displayId ?? template.name,
    title: template.name,
    status: template.lifecycle,
    tags: [],
    structureVersion: 1,
    metadataVersion: 1,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
    archivedAt: null,
    deletedAt: null,
    createdByUserId: template.createdByUserId ?? '',
    updatedByUserId: null,
    properties: {},
    lockedAt: null,
    lockedByRevisionId: null,
  }
}

/**
 * A template shown as the notebook it makes: its days as parts along the
 * top, and the blocks themselves, steps, checklists, notes, plate maps and
 * sheets, drawn and edited with the experiment's own notebook. Edits collect
 * in a draft; saving it makes a new version, because a published version pins
 * the experiments already made from it.
 */
export function TemplateNotebook({
  template,
  version,
  versions,
  canEdit,
  regulated,
}: {
  template: NotebookTemplate
  version: NotebookTemplateVersion
  versions: NotebookTemplateVersion[]
  canEdit: boolean
  regulated: boolean
}) {
  const templateId = template.id
  const draft = useTemplateDraft(templateId, version)
  const sheets = useSheetDefinitions(versions)
  const config = draft.draft ?? version.configuration
  const [edits, setEdits] = useState<ReadonlyMap<string, number>>(new Map())
  const [pickedPartId, setPickedPartId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'parts' | 'settings' | null>(null)

  const blocks = useMemo(
    () => templateNotebookBlocks(templateId, config.placements, edits),
    [templateId, config.placements, edits],
  )

  const parts = config.parts ?? []

  const shownPart =
    parts.find((part) => part.id === pickedPartId) ?? parts.at(0)

  // A block with no part of its own is on the first day.
  const partOf = (block: NotebookBlock) => block.partId ?? parts.at(0)?.id

  const shownBlocks = shownPart
    ? blocks.filter((block) => partOf(block) === shownPart.id)
    : blocks

  const partList = parts.map((part, index) =>
    plannedPart(part, index, templateId, blocks),
  )

  const shownProgress = partList.find((part) => part.id === shownPart?.id)
  const dirty = draft.draft !== null
  const readOnly = !canEdit || draft.saving || template.lifecycle !== 'active'

  const nextVersion = Math.max(0, ...versions.map((v) => v.version)) + 1

  useWarnBeforeLeaving(dirty)

  const record = useMemo(() => templateRecord(template), [template])

  const change = (
    id: string | null,
    edit: (
      current: NotebookTemplateConfiguration,
    ) => NotebookTemplateConfiguration,
  ) => {
    draft.edit(edit)

    if (id) {
      setEdits((current) =>
        new Map(current).set(id, (current.get(id) ?? 1) + 1),
      )
    }
  }

  const insert = async (
    type: string,
    afterBlockId?: string,
    options?: { payload?: NotebookBlock['payload'] },
  ): Promise<string | undefined> => {
    if (!isTemplateBlockType(type)) {
      toast.error(t('library.templates.notebook.blockNotInTemplates'))

      return undefined
    }

    const id = crypto.randomUUID()

    change(null, (current) =>
      insertTemplateBlock(current, {
        id,
        type,
        payload: options?.payload,
        afterBlockId: afterBlockId ?? null,
        partId: shownPart?.id ?? null,
      }),
    )

    return id
  }

  const move = (id: string, destination: BlockDestination) =>
    change(null, (current) => moveTemplateBlock(current, id, destination))

  const renderBlock = (block: NotebookBlock): React.ReactNode | null => {
    if (block.type === TEMPLATE_SHEET_BLOCK) {
      const placement = config.placements.find((p) => p.id === block.id)

      if (placement?.kind !== 'sheet') return null

      return (
        <TemplateSheetBlock
          placement={placement}
          sheets={sheets}
          draftVersion={
            version.lifecycle === 'draft' && !dirty && canEdit ? version : null
          }
        />
      )
    }

    if (block.type === TEMPLATE_SECTION_BLOCK) {
      const placement = config.placements.find((p) => p.id === block.id)

      if (placement?.kind !== 'section_placeholder') return null

      return <TemplateSectionBlock label={placement.label} />
    }

    return null
  }

  const openDialog = (which: 'parts' | 'settings') => {
    if (!draft.draft) draft.startEditing()
    setDialog(which)
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="min-w-0 flex-1 overflow-y-auto px-4 pb-16 md:px-6 lg:pl-10">
        {dirty ? (
          <DraftBar
            nextVersion={nextVersion}
            saving={draft.saving}
            onDiscard={() => {
              draft.stopEditing()
              setEdits(new Map())
            }}
            onSave={draft.saveDraft}
          />
        ) : null}
        {draft.saveError ? (
          <Notice
            tone="bad"
            className="my-3"
            title={t('library.templates.overview.couldNotSaveTheNew2')}
          >
            {draft.saveError}
          </Notice>
        ) : null}
        {shownProgress ? (
          <PartsStrip
            expId={templateId}
            parts={partList}
            shown={shownProgress}
            startedAt={template.createdAt}
            planned
            label={t('library.templates.notebook.daysLabel')}
            onPick={(part) => setPickedPartId(part.id)}
            actions={
              canEdit ? (
                <IconButton
                  icon="edit"
                  label={t('library.templates.notebook.editParts')}
                  onClick={() => openDialog('parts')}
                />
              ) : undefined
            }
          />
        ) : null}
        <div className="mx-auto w-full max-w-[920px]">
          <NotebookDocument
            key={shownPart?.id ?? 'all'}
            record={record}
            blocks={shownBlocks}
            readOnly={readOnly}
            // Nobody asks to edit a template from here, so a reader sees it plainly.
            partLocked={readOnly}
            renderBlock={renderBlock}
            onSaveBlock={async (block, payload) => {
              change(block.id, (current) =>
                setPlacementBlock(current, block.id, {
                  type: block.type,
                  payload,
                }),
              )

              return { ok: true }
            }}
            onInsertBlock={insert}
            onDuplicateBlock={async (block) => {
              if (!isTemplateBlockType(block.type)) return undefined

              const id = crypto.randomUUID()
              change(null, (current) =>
                duplicateTemplateBlock(current, block.id, id),
              )

              return id
            }}
            onDeleteBlock={async (block) =>
              change(null, (current) => removeTemplateBlock(current, block.id))
            }
            onUndoDelete={async (type, payload, destination) => {
              const id = await insert(type, undefined, { payload })

              if (!id) return undefined
              move(id, destination)

              return { id }
            }}
            onMoveBlock={async (block, destination) =>
              move(block.id, destination)
            }
            onReplaceBlock={async (block, type, options) => {
              const id = await insert(type, block.id, options)

              if (id) {
                change(null, (current) =>
                  removeTemplateBlock(current, block.id),
                )
              }

              return id
            }}
          />
        </div>
      </div>
      <TemplateVersionInspector version={version} versions={versions}>
        <PartsSummary
          parts={parts}
          canEdit={canEdit && !readOnly}
          onEdit={() => openDialog('parts')}
        />
        <SettingsSummary
          config={config}
          canEdit={canEdit && !readOnly}
          onEdit={() => openDialog('settings')}
        />
      </TemplateVersionInspector>
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null)
        }}
      >
        <DialogContent className="w-[min(960px,calc(100vw-32px))]">
          {dialog === 'parts' ? (
            <PartsDialogBody draft={draft} regulated={regulated} />
          ) : null}
          {dialog === 'settings' ? (
            <SettingsDialogBody draft={draft} version={version} />
          ) : null}
          <DialogFooter>
            <Button variant="primary" onClick={() => setDialog(null)}>
              {t('library.templates.notebook.done')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** A browser leaving the page with edits not yet saved asks first. */
function useWarnBeforeLeaving(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return

    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }

    window.addEventListener('beforeunload', warn)

    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
}

/** Edits waiting to be saved, and the two things a person can do with them. */
function DraftBar({
  nextVersion,
  saving,
  onDiscard,
  onSave,
}: {
  nextVersion: number
  saving: boolean
  onDiscard: () => void
  onSave: () => void
}) {
  return (
    <div
      role="status"
      className="sticky top-0 z-20 -mx-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-surface px-4 py-2 md:-mx-6 md:px-6 lg:-ml-10 lg:pl-10"
    >
      <span className="min-w-0 flex-1 text-label text-fg-muted">
        {t('library.templates.notebook.unsaved', { version: nextVersion })}
      </span>
      <Button size="sm" disabled={saving} onClick={onDiscard}>
        {t('library.templates.notebook.discard')}
      </Button>
      <Button size="sm" variant="primary" disabled={saving} onClick={onSave}>
        {saving
          ? t('common.states.saving')
          : t('library.templates.notebook.saveAsDraft', {
              version: nextVersion,
            })}
      </Button>
    </div>
  )
}

/** The template's days in the inspector, with the way to change them. */
function PartsSummary({
  parts,
  canEdit,
  onEdit,
}: {
  parts: readonly Part[]
  canEdit: boolean
  onEdit: () => void
}) {
  return (
    <InspectorSection
      title={t('library.templates.notebook.days')}
      action={
        canEdit ? (
          <Button
            size="sm"
            variant="quiet"
            aria-label={t('library.templates.notebook.editParts')}
            onClick={onEdit}
          >
            {t('common.actions.edit')}
          </Button>
        ) : undefined
      }
    >
      <Muted>
        {parts.length
          ? t('library.templates.notebook.daysSummary', {
              count: parts.length,
              last: Math.max(...parts.map((part) => part.dayOffset)),
            })
          : t('library.templates.notebook.onePage')}
      </Muted>
    </InspectorSection>
  )
}

/** What a person is asked when they use the template. */
function SettingsSummary({
  config,
  canEdit,
  onEdit,
}: {
  config: NotebookTemplateConfiguration
  canEdit: boolean
  onEdit: () => void
}) {
  return (
    <InspectorSection
      title={t('library.templates.notebook.askedWhenUsed')}
      action={
        canEdit ? (
          <Button
            size="sm"
            variant="quiet"
            aria-label={t('library.templates.notebook.editAsked')}
            onClick={onEdit}
          >
            {t('common.actions.edit')}
          </Button>
        ) : undefined
      }
    >
      {config.parameters.length ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-label">
          {config.parameters.map((parameter) => (
            <li key={parameter.id} className="flex justify-between gap-3">
              <span>{parameter.label}</span>
              <span className="text-fg-muted">
                {parameter.type.kind === 'scalar'
                  ? valueTypeLabel(parameter.type.valueType)
                  : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <Muted>{t('library.templates.notebook.nothingAsked')}</Muted>
      )}
    </InspectorSection>
  )
}

/** The days, their rules, and which day each section is on. */
function PartsDialogBody({
  draft,
  regulated,
}: {
  draft: Draft
  regulated: boolean
}) {
  const current = draft.draft

  return (
    <>
      <DialogHeader
        title={t('library.templates.notebook.editParts')}
        description={t('library.templates.notebook.editPartsHint')}
      />
      <DialogBody className="gap-6">
        <TemplatePartsSection
          parts={draft.parts}
          placements={current?.placements ?? draft.placements}
          editable={Boolean(current)}
          disabled={draft.saving}
          signOff={current?.signOffParts ?? regulated}
          onSignOffChange={draft.setSignOff}
          onChange={draft.setParts}
        />
        <SectionsSection
          draft={Boolean(current)}
          placements={draft.placements}
          editPlacements={draft.editPlacements}
          templateParts={draft.parts}
          saving={draft.saving}
          onMove={draft.movePlacement}
          onSetPart={draft.setPlacementPart}
          onRemove={draft.removePlacement}
          onAdd={draft.addSection}
        />
      </DialogBody>
    </>
  )
}

/** The settings a person fills in when they make an experiment from the template. */
function SettingsDialogBody({
  draft,
  version,
}: {
  draft: Draft
  version: NotebookTemplateVersion
}) {
  const sheets = useSheetDefinitions([version])
  const shown = draft.draft ?? version.configuration

  return (
    <>
      <DialogHeader
        title={t('library.templates.notebook.askedWhenUsed')}
        description={t('library.templates.notebook.askedWhenUsedHint')}
      />
      <DialogBody>
        <ParametersSection
          draft={Boolean(draft.draft)}
          parameters={shown.parameters}
          placements={shown.placements}
          targets={sheetSettingTargets(shown.placements, sheets.versionsById)}
          saving={draft.saving}
          onRemove={draft.removeParameter}
          onAdd={draft.addParameter}
          onSetDefault={draft.setParameterDefault}
          onSetFeeds={draft.setParameterFeeds}
        />
      </DialogBody>
    </>
  )
}
