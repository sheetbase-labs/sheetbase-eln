import { PickerSelect } from '#/components/record-picker/entity-picker'
import { instrumentOption } from '#/components/record-picker/entity-options'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { z } from 'zod'
import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from '#/components/ui/collapsible'
import { CodeBlock } from '#/components/ui/code-block'
import { Field, Input } from '#/components/ui/input'
import { FileDrop } from '#/components/ui/file-drop'
import { Muted, Section } from '#/components/ui/layout'
import { Select } from '#/components/ui/select'
import { useInstruments } from '#/components/instruments/instruments-data'
import { InstrumentParserTable } from './instrument-parser-table'
import { PluginParserTable } from './plugin-parser-table'
import { createDataClient } from '#/lib/data-client'
import { formatDate } from '#/lib/format-date'
import { useUserNames } from '#/lib/user-names'
import { hasCapability } from '#/lib/capability'
import { uploadImportFile } from '#/lib/import/data'
import {
  approveParserVersion,
  createParserDraft,
  fetchParserSettings,
  fetchParserTestFiles,
  parserSettingsQueryKeys,
  rotateWebhookParserKey,
  validateParserVersion,
} from '#/lib/parser-settings'
import type {
  ParserVersionStatus,
  ParserSettingsVersion,
  ParserSettingsRow,
  ParserTestFile,
} from '#/lib/parser-settings'
import { ParserVersions } from './parser-versions'
import { ParserLayoutEditor, tidyLayout } from './parser-layout-editor'
import { layoutOf } from '#/lib/import/parser-layout'
import type { ParserLayout } from '#/lib/import/parser-layout'
import { WebhookParserDialog } from './webhook-parser-dialog'
import { parserKindOf } from '#/lib/connectors/builtin-parsers'
import { rich, t } from '#/copy'
import { JsonEditor } from '#/components/code-editor/json-editor'

const client = createDataClient()
const definitionSchema = z.record(z.string(), z.json())

/** The advanced JSON boxes, with a plain refusal rather than a parser's message. */
function parseDefinition(text: string) {
  try {
    return definitionSchema.parse(JSON.parse(text))
  } catch {
    throw new Error(
      t('settings.parserSettings.advancedSettingsMust', { example: '{}' }),
    )
  }
}

const slugOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

interface ParserDraft {
  key: string
  name: string
  format: string
  instrumentId: string
  headers: string
  signature: string
  mapping: string
  layout: ParserLayout
}

function instrumentGuidance(
  status: ParserVersionStatus | undefined,
  canEdit: boolean,
): string {
  if (!canEdit) return t('settings.parserSettings.askWorkspaceAdmin')

  if (status === 'draft') return t('settings.parserSettings.pickRetainedExport')

  if (status === 'validated')
    return t('settings.parserSettings.validationPassedApprove')

  if (status === 'approved') return t('settings.parserSettings.versionApproved')

  return t('settings.parserSettings.createDraftBelow')
}

function useParserDraft(
  instrument: { name: string } | undefined,
  instrumentId: string | undefined,
  selectedId: string,
) {
  const [draft, setDraft] = useState<ParserDraft>({
    key: '',
    name: '',
    format: 'csv',
    instrumentId: instrumentId ?? '',
    headers: 'sample',
    signature: '{}',
    mapping: '{}',
    layout: {},
  })

  const [prefilled, setPrefilled] = useState(false)

  // A late instrument read fills an untouched draft once, without overwriting edits or a selected version.
  if (instrument && !selectedId && !prefilled && !draft.key && !draft.name) {
    setPrefilled(true)
    setDraft({ ...draft, name: `${instrument.name} export` })
  }

  return { draft, setDraft }
}

function selectedParserVersion(
  parsers: ParserSettingsRow[] | undefined,
  selectedId: string,
) {
  const selectedParser = parsers?.find((parser) =>
    parser.parser_versions.some((version) => version.id === selectedId),
  )

  return {
    selectedParser,
    selected: selectedParser?.parser_versions.find(
      (version) => version.id === selectedId,
    ),
  }
}

async function createDraftVersion(
  workspaceId: string,
  draft: ParserDraft,
  parsers: ParserSettingsRow[] | undefined,
) {
  const parserKey = draft.key.trim() || slugOf(draft.name)
  const existing = parsers?.find((parser) => parser.key === parserKey)

  const required = draft.headers
    .split(',')
    .map((header) => header.trim())
    .filter(Boolean)

  const signature = parseDefinition(draft.signature)

  if (required.length) signature.requiredHeaders = required
  const layout = tidyLayout(draft.layout)

  if (['csv', 'tsv'].includes(draft.format) && Object.keys(layout).length)
    signature.layout = definitionSchema.parse(layout)

  return createParserDraft(client, {
    workspaceId,
    key: parserKey,
    name: draft.name,
    format: draft.format,
    instrumentId: draft.instrumentId || null,
    version:
      Math.max(
        0,
        ...(existing?.parser_versions.map((version) => version.version) ?? []),
      ) + 1,
    signature,
    mapping: parseDefinition(draft.mapping),
  })
}

export function ParserSettings({
  workspaceId,
  role,
  fileId,
  versionId,
  instrumentId: forInstrumentId,
}: {
  workspaceId: string
  role: string | undefined
  fileId?: string
  versionId?: string
  /** The instrument the person came from, so its parser is the one in front of them. */
  instrumentId?: string
}) {
  const qc = useQueryClient()
  const instruments = useInstruments()

  const parsers = useQuery({
    queryKey: parserSettingsQueryKeys.list(workspaceId),
    queryFn: () => fetchParserSettings(client, workspaceId),
    enabled: Boolean(workspaceId),
  })

  const files = useQuery({
    queryKey: [...parserSettingsQueryKeys.files(workspaceId), fileId],
    queryFn: () => fetchParserTestFiles(client, workspaceId, fileId),
    enabled: Boolean(workspaceId),
  })

  const [selectedId, setSelectedId] = useState(versionId ?? '')
  const [testFileId, setTestFileId] = useState(fileId ?? '')
  const forInstrument = instruments.data?.find((i) => i.id === forInstrumentId)

  const { draft, setDraft } = useParserDraft(
    forInstrument,
    forInstrumentId,
    selectedId,
  )

  // The instrument whose parsers are listed; blank lists every parser.
  const [shownInstrumentId, setShownInstrumentId] = useState(
    forInstrumentId ?? '',
  )

  const [message, setMessage] = useState('')
  const [addingWebhook, setAddingWebhook] = useState(false)
  const [newKey, setNewKey] = useState('')

  const { selectedParser, selected } = selectedParserVersion(
    parsers.data,
    selectedId,
  )

  const testFile = files.data?.find((f) => f.id === testFileId)

  const shownInstrument = instruments.data?.find(
    (i) => i.id === shownInstrumentId,
  )

  const shownParsers = (parsers.data ?? []).filter(
    (p) => !shownInstrumentId || p.instrument_id === shownInstrumentId,
  )

  const canEdit = hasCapability(role, 'schema.edit')

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({
        queryKey: parserSettingsQueryKeys.list(workspaceId),
      }),
      qc.invalidateQueries({
        queryKey: parserSettingsQueryKeys.files(workspaceId),
      }),
      qc.invalidateQueries({ queryKey: ['work-items'] }),
    ])
  }

  const action = useMutation({
    mutationFn: async (kind: 'create' | 'validate' | 'approve') => {
      setMessage('')

      if (kind === 'create') {
        const result = await createDraftVersion(
          workspaceId,
          draft,
          parsers.data,
        )

        setSelectedId(result.parserVersionId)
        setMessage(
          t('settings.parserSettings.createdDraftRevision', {
            version: result.version,
          }),
        )
      } else if (kind === 'validate') {
        const result = await validateParserVersion(selectedId, testFileId)
        setMessage(
          result.ok
            ? t('settings.parserSettings.validationPassedVersion')
            : t('settings.parserSettings.validationFailedMessage', {
                errors:
                  result.validation?.errors?.join('; ') ??
                  t('settings.parserSettings.testFileNoMatch'),
              }),
        )
      } else {
        await approveParserVersion(client, selectedId)
        setMessage(t('settings.parserSettings.parserVersionApproved'))
      }

      await refresh()
    },
  })

  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation -- Rotation returns a one-use secret shown in local newKey state; the parser version/list contains no readable key to refetch.
  const rotate = useMutation({
    mutationFn: (parserId: string) => rotateWebhookParserKey(parserId),
    onSuccess: (result) => setNewKey(result.secret),
  })

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const result = await uploadImportFile({ file })
      setTestFileId(result.fileId)
      await refresh()
    },
  })

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <ParserGuidance
        instrument={forInstrument}
        fileId={fileId}
        testFile={testFile}
        status={selected?.status}
        parserKey={selectedParser?.key}
        canEdit={canEdit}
        role={role}
      />
      <Section title={t('settings.parserSettings.instruments')}>
        <InstrumentParserTable
          parsers={parsers.data ?? []}
          selectedInstrumentId={shownInstrumentId || null}
          onSelect={(id) => setShownInstrumentId(id ?? '')}
        />
      </Section>
      <PluginParserTable />
      <ParserCatalogue
        shownInstrument={shownInstrument}
        canEdit={canEdit}
        loading={parsers.isLoading}
        onClear={() => setShownInstrumentId('')}
        onAdd={() => setAddingWebhook(true)}
      >
        <ParserVersions
          parsers={shownParsers}
          selectedVersionId={selectedId}
          onSelect={(parser, version) => {
            setSelectedId(version.id)

            const required = z
              .array(z.string())
              .safeParse(version.signature.requiredHeaders)

            setDraft({
              key: parser.key,
              name: parser.name,
              format: parser.format,
              instrumentId: parser.instrument_id ?? '',
              headers: required.success ? required.data.join(', ') : '',
              signature: JSON.stringify(
                Object.fromEntries(
                  Object.entries(version.signature).filter(
                    ([field]) =>
                      field !== 'requiredHeaders' && field !== 'layout',
                  ),
                ),
                null,
                2,
              ),
              mapping: JSON.stringify(version.mapping, null, 2),
              layout: layoutOf(version.signature) ?? {},
            })
            setMessage('')
            setNewKey('')
          }}
        />
      </ParserCatalogue>
      {addingWebhook ? (
        <WebhookParserDialog
          workspaceId={workspaceId}
          instrumentId={shownInstrumentId || forInstrumentId}
          onClose={() => setAddingWebhook(false)}
          onCreated={(created) => setSelectedId(created.parserVersionId)}
        />
      ) : null}
      {selected ? (
        <ParserRevision
          selected={selected}
          parser={selectedParser}
          files={files.data ?? []}
          testFileId={testFileId}
          onTestFileId={setTestFileId}
          canEdit={canEdit}
          role={role}
          pending={action.isPending}
          onAction={(kind) => action.mutate(kind)}
          onUpload={(file) => upload.mutateAsync(file)}
          rotation={{
            pending: rotate.isPending,
            secret: newKey,
            onRotate: (id) => rotate.mutate(id),
          }}
        />
      ) : null}
      {canEdit && parsers.isSuccess ? (
        <ParserDraftEditor
          draft={draft}
          instruments={instruments.data ?? []}
          onChange={(patch) =>
            setDraft((current) => ({ ...current, ...patch }))
          }
          pending={action.isPending}
          onCreate={() => action.mutate('create')}
        />
      ) : null}
      <ParserFeedback
        errors={[action.error, rotate.error, parsers.error, files.error]}
        message={message}
      />
    </div>
  )
}

function ParserCatalogue({
  shownInstrument,
  canEdit,
  loading,
  onClear,
  onAdd,
  children,
}: {
  shownInstrument: { name: string } | undefined
  canEdit: boolean
  loading: boolean
  onClear: () => void
  onAdd: () => void
  children: ReactNode
}) {
  return (
    <Section
      title={
        shownInstrument
          ? t('settings.parserSettings.parsers', { name: shownInstrument.name })
          : t('settings.parserSettings.parsersAll')
      }
      count={
        <span className="inline-flex items-center gap-2">
          {shownInstrument ? (
            <Button size="sm" variant="quiet" onClick={onClear}>
              {t('settings.parserSettings.showParsers')}
            </Button>
          ) : null}
          {canEdit ? (
            <Button size="sm" onClick={onAdd}>
              {t('settings.webhookParserDialog.addParser')}
            </Button>
          ) : null}
        </span>
      }
    >
      <Muted>{t('settings.parserSettings.eachParserTested')}</Muted>
      {loading ? (
        <Muted>{t('settings.parserSettings.loadingParsers')}</Muted>
      ) : (
        children
      )}
    </Section>
  )
}

/** Upload refusals remain on FileDrop's own row; other actions report here. */
function ParserFeedback({
  errors,
  message,
}: {
  errors: (Error | null)[]
  message: string
}) {
  const error = errors.find((candidate) => candidate !== null)

  return (
    <>
      {error instanceof Error ? (
        <p role="alert" className="text-label text-danger-text">
          {error.message}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="text-label">
          {message}
        </p>
      ) : null}
    </>
  )
}

function ParserRevision({
  selected,
  parser,
  files,
  testFileId,
  onTestFileId,
  canEdit,
  role,
  pending,
  onAction,
  onUpload,
  rotation,
}: {
  selected: ParserSettingsVersion
  parser: ParserSettingsRow | undefined
  files: ParserTestFile[]
  testFileId: string
  onTestFileId: (id: string) => void
  canEdit: boolean
  role: string | undefined
  pending: boolean
  onAction: (kind: 'validate' | 'approve') => void
  onUpload: (file: File) => Promise<void>
  rotation: { pending: boolean; secret: string; onRotate: (id: string) => void }
}) {
  const testFile = files.find((file) => file.id === testFileId)

  return (
    <Section
      title={t('settings.parserSettings.testRevision', {
        name: parser?.name ?? '',
        version: selected.version,
      })}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Field label={t('settings.parserSettings.testFile')}>
          <Select
            value={testFileId}
            onChange={(event) => onTestFileId(event.target.value)}
          >
            <option value="">
              {t('settings.parserSettings.chooseFileAlready')}
            </option>
            {files.map((file) => (
              <option key={file.id} value={file.id}>
                {file.filename} · {file.id.slice(0, 8)}
              </option>
            ))}
          </Select>
        </Field>
        {canEdit ? (
          <FileDrop
            label={t('settings.parserSettings.uploadNewTest')}
            inputLabel={t('settings.parserSettings.uploadNewTest')}
            onFile={(file) => (file ? onUpload(file) : undefined)}
          />
        ) : null}
      </div>
      {testFile ? (
        <Muted>
          {t('settings.parserSettings.checksum')}
          <span className="break-all mono">{testFile.checksum}</span>
        </Muted>
      ) : null}
      {testFile?.parser_failure ? (
        <p role="status" className="text-label text-danger-text">
          {testFile.parser_failure.message}
          {testFile.parser_failure.requestedAt
            ? ' · Admin update requested'
            : ''}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {canEdit ? (
          <Button
            disabled={
              !testFileId ||
              pending ||
              !['draft', 'validated'].includes(selected.status)
            }
            onClick={() => onAction('validate')}
          >
            {t('settings.parserSettings.testFile2')}
          </Button>
        ) : null}
        {hasCapability(role, 'schema.publish') ? (
          <Button
            variant="primary"
            disabled={selected.status !== 'validated' || pending}
            onClick={() => onAction('approve')}
          >
            {t('settings.parserSettings.approveVersion')}
          </Button>
        ) : null}
      </div>
      {canEdit &&
      parser &&
      parserKindOf(parser.key, selected.signature) === 'webhook' ? (
        <div className="flex flex-col gap-2">
          <div>
            <Button
              size="sm"
              disabled={rotation.pending}
              onClick={() => rotation.onRotate(parser.id)}
            >
              {t('settings.webhookParserDialog.newKey')}
            </Button>
          </div>
          {rotation.secret ? (
            <>
              <p className="m-0 text-label">
                {t('settings.webhookParserDialog.newKeyShown')}
              </p>
              <Input
                readOnly
                aria-label={t('settings.webhookParserDialog.keyAria')}
                className="mono"
                value={rotation.secret}
                onFocus={(event) => event.currentTarget.select()}
              />
            </>
          ) : null}
        </div>
      ) : null}
      <ParserVersionEvidence version={selected} />
    </Section>
  )
}

function ParserGuidance({
  instrument,
  fileId,
  testFile,
  status,
  parserKey,
  canEdit,
  role,
}: {
  instrument: { id: string; name: string } | undefined
  fileId: string | undefined
  testFile: ParserTestFile | undefined
  status: ParserVersionStatus | undefined
  parserKey: string | undefined
  canEdit: boolean
  role: string | undefined
}) {
  return (
    <>
      {instrument ? (
        <Notice tone="info">
          {t('settings.parserSettings.settingUpParser')}
          <Link
            to="/instruments/$instrumentId"
            params={{ instrumentId: instrument.id }}
            className="font-semibold"
          >
            {instrument.name}
          </Link>
          . {instrumentGuidance(status, canEdit)}
        </Notice>
      ) : null}
      {fileId && !instrument ? (
        <Notice tone={testFile?.parser_failure ? 'warn' : 'info'}>
          {testFile
            ? `${testFile.filename} could not be read by an approved parser.`
            : t('settings.parserSettings.pageOpenedFailed')}{' '}
          {canEdit
            ? t('settings.parserSettings.createTestApprove')
            : t('settings.parserSettings.cantChangeParsers', {
                role: role ?? t('settings.parserSettings.currentRole'),
                request: testFile?.parser_failure?.requestedAt
                  ? t('settings.parserSettings.requestInInbox')
                  : t('settings.parserSettings.useAskAdmin'),
              })}{' '}
          <Link
            to="/import/$importId"
            params={{ importId: fileId }}
            search={{ step: 'map' }}
            className="font-semibold"
          >
            {t('settings.parserSettings.backImport')}
          </Link>
        </Notice>
      ) : null}
      {fileId && status === 'approved' ? (
        <Notice tone="info" title={t('settings.parserSettings.parserApproved')}>
          {rich('settings.parserSettings.retainedFileStored', {
            link: (text) => (
              <Link
                to="/import/$importId"
                params={{ importId: fileId }}
                search={{ step: 'map', parser: parserKey }}
                className="font-semibold"
              >
                {text}
              </Link>
            ),
          })}
        </Notice>
      ) : null}
    </>
  )
}

function ParserVersionEvidence({
  version,
}: {
  version: ParserSettingsVersion
}) {
  const approverNames = useUserNames(
    version.approved_by_user_id ? [version.approved_by_user_id] : [],
  )

  return (
    <>
      {version.approved_at ? (
        <p className="break-words text-label">
          {t('settings.parserSettings.qaApproved2')}
          {formatDate(version.approved_at, { time: true })}
          {version.approved_by_user_id
            ? ` by ${approverNames.userLabel(version.approved_by_user_id)}`
            : ''}
          .
        </p>
      ) : null}
      {version.test_result ? (
        <div className="flex flex-col gap-2">
          <p className="text-label">
            {t('settings.parserSettings.validationResult', {
              result:
                version.test_result.ok === true
                  ? t('settings.parserSettings.validationPassed')
                  : t('settings.parserSettings.validationFailed'),
              rowCount:
                z.number().safeParse(version.test_result.rowCount).data ??
                t('settings.parserSettings.rowCountUnknown'),
              when: formatDate(version.validated_at, { time: true }),
            })}
          </p>
          <Collapsible>
            <CollapsibleTrigger>
              {t('settings.parserSettings.fullValidationEvidence')}
            </CollapsibleTrigger>
            <CollapsiblePanel className="mt-1">
              <CodeBlock
                code={JSON.stringify(version.test_result, null, 2)}
                language="json"
                label={t('settings.parserSettings.fullValidationEvidence')}
                maxHeight="lg"
              />
            </CollapsiblePanel>
          </Collapsible>
        </div>
      ) : (
        <Muted>{t('settings.parserSettings.testedAgainstSample')}</Muted>
      )}
    </>
  )
}

function ParserDraftEditor({
  draft,
  instruments,
  onChange,
  pending,
  onCreate,
}: {
  draft: ParserDraft
  instruments: NonNullable<ReturnType<typeof useInstruments>['data']>
  onChange: (patch: Partial<ParserDraft>) => void
  pending: boolean
  onCreate: () => void
}) {
  return (
    <Section title={t('settings.parserSettings.createDraft')}>
      <Muted>{t('settings.parserSettings.newNameMakes')}</Muted>
      <form
        className="grid gap-3 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault()
          onCreate()
        }}
      >
        <Field label={t('settings.parserSettings.parserName')}>
          <Input
            required
            value={draft.name}
            onChange={(e) => onChange({ name: e.target.value, key: '' })}
          />
        </Field>
        <Field label={t('settings.parserSettings.instrument')}>
          <PickerSelect
            noun="instrument"
            value={draft.instrumentId}
            onChange={(instrumentId) => onChange({ instrumentId })}
            clearLabel={t('settings.parserSettings.linked')}
            options={instruments.map((i) => instrumentOption(i))}
          />
        </Field>
        <Field label={t('settings.parserSettings.fileFormat')}>
          <Select
            value={draft.format}
            onChange={(e) => onChange({ format: e.target.value })}
          >
            {['csv', 'tsv', 'xlsx', 'json'].map((value) => (
              <option key={value} value={value}>
                {value.toUpperCase()}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={t('settings.parserSettings.columnsFileMust')}
          hint={t('settings.parserSettings.commaSeparatedColumnHint')}
        >
          <Input
            value={draft.headers}
            onChange={(e) => onChange({ headers: e.target.value })}
          />
        </Field>
        {['csv', 'tsv'].includes(draft.format) ? (
          <ParserLayoutEditor
            value={draft.layout}
            onChange={(layout) => onChange({ layout })}
            onUseColumns={(found) =>
              onChange({ headers: found.slice(0, 4).join(', ') })
            }
          />
        ) : (
          <Muted className="md:col-span-2">
            {t('settings.parserLayout.textOnly')}
          </Muted>
        )}
        <Collapsible className="md:col-span-2">
          <CollapsibleTrigger>
            {t('settings.parserSettings.advanced')}
          </CollapsibleTrigger>
          <CollapsiblePanel className="mt-2 grid gap-3 md:grid-cols-2">
            <Field
              label={t('settings.parserSettings.parserKey')}
              hint={t('settings.parserSettings.leaveBlankMakeHint')}
            >
              <Input
                value={draft.key}
                placeholder={slugOf(draft.name)}
                onChange={(e) => onChange({ key: e.target.value })}
              />
            </Field>
            <span className="hidden md:block" />
            <Field label={t('settings.parserSettings.otherFileChecks')}>
              <JsonEditor
                ariaLabel={t('settings.parserSettings.otherFileChecks')}
                value={draft.signature}
                accepts="object"
                onChange={(signature) => onChange({ signature })}
              />
            </Field>
            <Field label={t('settings.parserSettings.columnMappingJson')}>
              <JsonEditor
                ariaLabel={t('settings.parserSettings.columnMappingJson')}
                value={draft.mapping}
                accepts="object"
                onChange={(mapping) => onChange({ mapping })}
              />
            </Field>
          </CollapsiblePanel>
        </Collapsible>
        <div>
          <Button type="submit" disabled={pending}>
            {t('settings.parserSettings.createDraft2')}
          </Button>
        </div>
      </form>
    </Section>
  )
}
