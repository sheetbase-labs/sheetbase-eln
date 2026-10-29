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
import { createDataClient } from '#/lib/data-client'
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

const client = createDataClient()
const definitionSchema = z.record(z.string(), z.unknown())

function instrumentGuidance(
  status: ParserVersionStatus | undefined,
  canEdit: boolean,
): string {
  if (!canEdit)
    return 'Ask a workspace admin or schema editor to create and test it.'
  if (status === 'draft')
    return 'Pick a retained export from this instrument, or upload one, then validate the draft.'
  if (status === 'validated')
    return 'Validation passed. Approve the version when QA is satisfied.'
  if (status === 'approved') return 'This version is approved.'
  return 'Create a draft below, then test it against a real export from the instrument.'
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
  const [signature, setSignature] = useState('{"requiredHeaders":["sample"]}')
  const [mapping, setMapping] = useState('{}')
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
    setKey(
      `${forInstrument.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')}-export`,
    )
  }
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
        const existing = parsers.data?.find((p) => p.key === key)
        const result = await createParserDraft(client, {
          workspaceId,
          key,
          name,
          format,
          instrumentId: instrumentId || null,
          version:
            Math.max(
              0,
              ...(existing?.parser_versions.map((v) => v.version) ?? []),
            ) + 1,
          signature: definitionSchema.parse(JSON.parse(signature)),
          mapping: definitionSchema.parse(JSON.parse(mapping)),
        })
        setSelectedId(result.parserVersionId)
        setMessage(
          `Created draft v${result.version}. Test it against a retained file before approval.`,
        )
      } else if (kind === 'validate') {
        const result = await validateParserVersion(selectedId, testFileId)
        setMessage(
          result.ok
            ? 'Validation passed. This version is ready for QA approval.'
            : `Validation failed: ${result.validation?.errors?.join('; ') ?? 'The test file did not match.'}`,
        )
      } else {
        await approveParserVersion(client, selectedId)
        setMessage(
          'Parser version approved. Retry the retained import using this exact version.',
        )
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
          Setting up the parser for{' '}
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
            : 'This page was opened from a failed import.'}{' '}
          {canEdit
            ? 'Create, test and approve a parser below, then resume the import from here.'
            : `You can’t change parsers with the ${role ?? 'current'} role. Ask a workspace admin or schema editor to approve one; ${
                testFile?.parser_failure?.requestedAt
                  ? 'a request is already with them in their Inbox.'
                  : 'use “Ask an admin to update the parser” on the import page to put the request in their Inbox.'
              } Meanwhile you can map the columns by hand.`}{' '}
          <Link
            to="/import/$importId"
            params={{ importId: fileId }}
            search={{ step: 'map' }}
            className="font-semibold"
          >
            Back to the import
          </Link>
        </Notice>
      ) : null}
      {fileId && selected?.status === 'approved' ? (
        <Notice tone="info" title="Parser approved.">
          The retained file is still stored.{' '}
          <Link
            to="/import/$importId"
            params={{ importId: fileId }}
            search={{ step: 'map', parser: selectedParser?.key }}
            className="font-semibold"
          >
            Resume the import
          </Link>{' '}
          to read it with this version.
        </Notice>
      ) : null}
      <Section title="Canonical parser versions">
        <Muted>
          Definitions and approval belong to this workspace. A regulated-record
          Dataset requires an approved version; this import policy is not a
          compliance certification.
        </Muted>
        {parsers.isLoading ? (
          <Muted>Loading parser versions…</Muted>
        ) : (
          <ParserVersions
            parsers={parsers.data ?? []}
            selectedVersionId={selectedId}
            onSelect={(parser, version) => {
              setSelectedId(version.id)
              setKey(parser.key)
              setName(parser.name)
              setFormat(parser.format)
              setInstrumentId(parser.instrument_id ?? '')
              setSignature(JSON.stringify(version.signature, null, 2))
              setMapping(JSON.stringify(version.mapping, null, 2))
              setMessage('')
            }}
          />
        )}
      </Section>
      {selected ? (
        <Section
          title={`${selectedParser?.name} v${selected.version}: retained-file validation`}
        >
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Retained test file">
              <Select
                value={testFileId}
                onChange={(e) => setTestFileId(e.target.value)}
              >
                <option value="">Choose a retained file</option>
                {files.data?.map((file) => (
                  <option key={file.id} value={file.id}>
                    {file.filename} · {file.id.slice(0, 8)}
                  </option>
                ))}
              </Select>
            </Field>
            {canEdit ? (
              <FileDrop
                label="Upload a new test file"
                inputLabel="Upload a new test file"
                onFile={(file) => (file ? upload.mutateAsync(file) : undefined)}
              />
            ) : null}
          </div>
          {testFile ? (
            <Muted>
              SHA-256:{' '}
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
                Validate retained file
              </Button>
            ) : null}
            {hasCapability(role, 'schema.publish') ? (
              <Button
                variant="primary"
                disabled={selected.status !== 'validated' || action.isPending}
                onClick={() => action.mutate('approve')}
              >
                Approve version
              </Button>
            ) : null}
          </div>
          {selected.approved_at ? (
            <p className="break-words text-label">
              QA approved at {selected.approved_at} by{' '}
              <span className="break-all mono">
                {selected.approved_by_user_id}
              </span>
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
                rows · {selected.validated_at}
              </p>
              <Collapsible>
                <CollapsibleTrigger>
                  Full validation evidence
                </CollapsibleTrigger>
                <CollapsiblePanel className="mt-1">
                  <CodeBlock
                    code={JSON.stringify(selected.test_result, null, 2)}
                    language="json"
                    label="Full validation evidence"
                    maxHeight="lg"
                  />
                </CollapsiblePanel>
              </Collapsible>
            </div>
          ) : (
            <Muted>Not validated against a sample file yet.</Muted>
          )}
        </Section>
      ) : null}
      {canEdit && parsers.isSuccess ? (
        <Section title="Create a draft version">
          <Muted>
            Use a new key for a new parser, or an existing key for its next
            version. Approved definitions are not edited; add a new version
            instead. A column mapping needs a test file linked to a Dataset.
          </Muted>
          <form
            className="grid gap-3 md:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault()
              action.mutate('create')
            }}
          >
            <Field label="Parser key">
              <Input
                required
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
            </Field>
            <Field label="Parser name">
              <Input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Format">
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
            <Field label="Structural signature (JSON)">
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
            <div>
              <Button type="submit" disabled={action.isPending}>
                Create draft version
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
