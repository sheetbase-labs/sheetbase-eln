import { PickerSelect } from '#/components/v3/record-picker/entity-picker'
import { instrumentOption } from '#/components/v3/record-picker/entity-options'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { z } from 'zod'
import { Notice } from '#/components/v3/ui/alert'
import { Button } from '#/components/v3/ui/button'
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from '#/components/v3/ui/collapsible'
import { CodeBlock } from '#/components/v3/ui/code-block'
import { Field, Input } from '#/components/v3/ui/input'
import { FileDrop } from '#/components/v3/ui/file-drop'
import { Muted, Section } from '#/components/v3/ui/layout'
import { Select } from '#/components/v3/ui/select'
import { useInstruments } from '#/components/v3/instruments/instruments-data'
import { InstrumentParserTable } from './instrument-parser-table'
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
  validateParserVersion,
} from '#/lib/parser-settings'
import type { ParserVersionStatus } from '#/lib/parser-settings'
import { ParserVersions } from './parser-versions'
import { rich, t } from '#/copy'

const client = createDataClient()
const definitionSchema = z.record(z.string(), z.unknown())

/** The advanced JSON boxes, with a plain refusal rather than a parser's message. */
function parseDefinition(text: string): Record<string, unknown> {
  try {
    return definitionSchema.parse(JSON.parse(text))
  } catch {
    throw new Error(
      'The advanced settings must be a JSON object, for example {}.',
    )
  }
}

const slugOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

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
  const [key, setKey] = useState('')
  const [name, setName] = useState('')
  const [format, setFormat] = useState('csv')
  const [instrumentId, setInstrumentId] = useState(forInstrumentId ?? '')
  const [headers, setHeaders] = useState('sample')
  // Checks other than the required columns, which have their own field.
  const [signature, setSignature] = useState('{}')
  const [mapping, setMapping] = useState('{}')
  // The instrument whose parsers are listed; blank lists every parser.
  const [shownInstrumentId, setShownInstrumentId] = useState(
    forInstrumentId ?? '',
  )
  const [message, setMessage] = useState('')
  const selectedParser = parsers.data?.find((p) =>
    p.parser_versions.some((v) => v.id === selectedId),
  )
  const selected = selectedParser?.parser_versions.find(
    (v) => v.id === selectedId,
  )
  const testFile = files.data?.find((f) => f.id === testFileId)
  // Arriving from an instrument with nothing selected, start the draft as that
  // instrument's parser instead of a blank form.
  const [prefilled, setPrefilled] = useState(false)
  if (forInstrument && !selectedId && !prefilled && !key && !name) {
    setPrefilled(true)
    setName(`${forInstrument.name} export`)
  }
  const shownInstrument = instruments.data?.find(
    (i) => i.id === shownInstrumentId,
  )
  const shownParsers = (parsers.data ?? []).filter(
    (p) => !shownInstrumentId || p.instrument_id === shownInstrumentId,
  )
  const approverNames = useUserNames(
    selected?.approved_by_user_id ? [selected.approved_by_user_id] : [],
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
        const parserKey = key.trim() || slugOf(name)
        const existing = parsers.data?.find((p) => p.key === parserKey)
        const required = headers
          .split(',')
          .map((header) => header.trim())
          .filter(Boolean)
        const result = await createParserDraft(client, {
          workspaceId,
          key: parserKey,
          name,
          format,
          instrumentId: instrumentId || null,
          version:
            Math.max(
              0,
              ...(existing?.parser_versions.map((v) => v.version) ?? []),
            ) + 1,
          signature: {
            ...parseDefinition(signature),
            ...(required.length ? { requiredHeaders: required } : {}),
          },
          mapping: parseDefinition(mapping),
        })
        setSelectedId(result.parserVersionId)
        setMessage(
          `Created draft revision ${result.version}. Test it against a retained file before approval.`,
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
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const result = await uploadImportFile({ file })
      setTestFileId(result.fileId)
      await refresh()
    },
  })
  // A refused test-file upload is reported by the file field, on the file's own
  // row, with the retry beside it — so this line carries the other four sources.
  const error = action.error ?? parsers.error ?? files.error
  return (
    <div className="flex min-w-0 flex-col gap-6">
      {forInstrument ? (
        <Notice tone="info">
          {t('settings.parserSettings.settingUpParser')}
          <Link
            to="/instruments/$instrumentId"
            params={{ instrumentId: forInstrument.id }}
            className="font-semibold"
          >
            {forInstrument.name}
          </Link>
          . {instrumentGuidance(selected?.status, canEdit)}
        </Notice>
      ) : null}
      {fileId && !forInstrument ? (
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
      {fileId && selected?.status === 'approved' ? (
        <Notice tone="info" title={t('settings.parserSettings.parserApproved')}>
          {rich('settings.parserSettings.retainedFileStored', {
            link: (text) => (
              <Link
                to="/import/$importId"
                params={{ importId: fileId }}
                search={{ step: 'map', parser: selectedParser?.key }}
                className="font-semibold"
              >
                {text}
              </Link>
            ),
          })}
        </Notice>
      ) : null}
      <Section title="Instruments">
        <InstrumentParserTable
          parsers={parsers.data ?? []}
          selectedInstrumentId={shownInstrumentId || null}
          onSelect={(id) => setShownInstrumentId(id ?? '')}
        />
      </Section>
      <Section
        title={
          shownInstrument ? `Parsers for ${shownInstrument.name}` : 'Parsers'
        }
        count={
          shownInstrument ? (
            <Button
              size="sm"
              variant="quiet"
              onClick={() => setShownInstrumentId('')}
            >
              Show all parsers
            </Button>
          ) : undefined
        }
      >
        <Muted>
          Each parser is tested against a real export from the instrument, then
          approved by QA before it can import regulated data. An approved
          revision is never edited; add a new one instead.
        </Muted>
        {parsers.isLoading ? (
          <Muted>Loading parsers…</Muted>
        ) : (
          <ParserVersions
            parsers={shownParsers}
            selectedVersionId={selectedId}
            onSelect={(parser, version) => {
              setSelectedId(version.id)
              setKey(parser.key)
              setName(parser.name)
              setFormat(parser.format)
              setInstrumentId(parser.instrument_id ?? '')
              const required = version.signature.requiredHeaders
              setHeaders(Array.isArray(required) ? required.join(', ') : '')
              setSignature(
                JSON.stringify(
                  Object.fromEntries(
                    Object.entries(version.signature).filter(
                      ([field]) => field !== 'requiredHeaders',
                    ),
                  ),
                  null,
                  2,
                ),
              )
              setMapping(JSON.stringify(version.mapping, null, 2))
              setMessage('')
            }}
          />
        )}
      </Section>
      {selected ? (
        <Section
          title={`Test ${selectedParser?.name}, revision ${selected.version}`}
        >
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Test file">
              <Select
                value={testFileId}
                onChange={(e) => setTestFileId(e.target.value)}
              >
                <option value="">Choose a file already uploaded</option>
                {files.data?.map((file) => (
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
                onFile={(file) => (file ? upload.mutateAsync(file) : undefined)}
              />
            ) : null}
          </div>
          {testFile ? (
            <Muted>
              Checksum:{' '}
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
                  action.isPending ||
                  !['draft', 'validated'].includes(selected.status)
                }
                onClick={() => action.mutate('validate')}
              >
                Test with this file
              </Button>
            ) : null}
            {hasCapability(role, 'schema.publish') ? (
              <Button
                variant="primary"
                disabled={selected.status !== 'validated' || action.isPending}
                onClick={() => action.mutate('approve')}
              >
                {t('settings.parserSettings.approveVersion')}
              </Button>
            ) : null}
          </div>
          {selected.approved_at ? (
            <p className="break-words text-label">
              QA approved on {formatDate(selected.approved_at, { time: true })}
              {selected.approved_by_user_id
                ? ` by ${approverNames.userLabel(selected.approved_by_user_id)}`
                : ''}
              .
            </p>
          ) : null}
          {selected.test_result ? (
            <div className="flex flex-col gap-2">
              <p className="text-label">
                Validation{' '}
                {selected.test_result.ok === true ? 'passed' : 'failed'} ·{' '}
                {typeof selected.test_result.rowCount === 'number'
                  ? selected.test_result.rowCount
                  : 'unknown'}{' '}
                rows · {formatDate(selected.validated_at, { time: true })}
              </p>
              <Collapsible>
                <CollapsibleTrigger>
                  {t('settings.parserSettings.fullValidationEvidence')}
                </CollapsibleTrigger>
                <CollapsiblePanel className="mt-1">
                  <CodeBlock
                    code={JSON.stringify(selected.test_result, null, 2)}
                    language="json"
                    label={t('settings.parserSettings.fullValidationEvidence')}
                    maxHeight="lg"
                  />
                </CollapsiblePanel>
              </Collapsible>
            </div>
          ) : (
            <Muted>Not tested against a sample file yet.</Muted>
          )}
        </Section>
      ) : null}
      {canEdit && parsers.isSuccess ? (
        <Section title="Create a draft">
          <Muted>
            A new name makes a new parser; the name of an existing one adds its
            next revision. A column mapping needs a test file linked to a
            Dataset.
          </Muted>
          <form
            className="grid gap-3 md:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault()
              action.mutate('create')
            }}
          >
            <Field label="Parser name">
              <Input
                required
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  // Typing a new name starts a new parser, not a revision of
                  // the one picked above.
                  setKey('')
                }}
              />
            </Field>
            <Field label="Instrument">
              <PickerSelect
                noun="instrument"
                value={instrumentId}
                onChange={(id) => setInstrumentId(id)}
                clearLabel="Not linked"
                options={(instruments.data ?? []).map((i) =>
                  instrumentOption(i),
                )}
              />
            </Field>
            <Field label="File format">
              <Select
                value={format}
                onChange={(e) => setFormat(e.target.value)}
              >
                {['csv', 'tsv', 'xlsx', 'json'].map((value) => (
                  <option key={value} value={value}>
                    {value.toUpperCase()}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Columns the file must have"
              hint="Comma-separated column headings. A file without them is not read by this parser."
            >
              <Input
                value={headers}
                onChange={(e) => setHeaders(e.target.value)}
              />
            </Field>
            <Collapsible className="md:col-span-2">
              <CollapsibleTrigger>Advanced</CollapsibleTrigger>
              <CollapsiblePanel className="mt-2 grid gap-3 md:grid-cols-2">
                <Field
                  label="Parser key"
                  hint="Leave blank to make one from the name. An existing key adds its next revision."
                >
                  <Input
                    value={key}
                    placeholder={slugOf(name)}
                    onChange={(e) => setKey(e.target.value)}
                  />
                </Field>
                <span className="hidden md:block" />
                <Field label="Other file checks (JSON)">
                  <textarea
                    className="min-h-[110px] rounded-md border border-border bg-surface p-2 mono text-label"
                    value={signature}
                    onChange={(e) => setSignature(e.target.value)}
                  />
                </Field>
                <Field label="Column mapping (JSON)">
                  <textarea
                    className="min-h-[110px] rounded-md border border-border bg-surface p-2 mono text-label"
                    value={mapping}
                    onChange={(e) => setMapping(e.target.value)}
                  />
                </Field>
              </CollapsiblePanel>
            </Collapsible>
            <div>
              <Button type="submit" disabled={action.isPending}>
                Create draft
              </Button>
            </div>
          </form>
        </Section>
      ) : null}
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
    </div>
  )
}
