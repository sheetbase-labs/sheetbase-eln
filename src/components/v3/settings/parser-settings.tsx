import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { Button } from '#/components/v3/ui/button'
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from '#/components/v3/ui/collapsible'
import { CodeBlock } from '#/components/v3/ui/code-block'
import { Field, Input } from '#/components/v3/ui/input'
import { Muted, Section } from '#/components/v3/ui/layout'
import { NativeSelect } from '#/components/v3/projects/select'
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
import { ParserVersions } from './parser-versions'

const client = createDataClient()
const definitionSchema = z.record(z.string(), z.unknown())

export function ParserSettings({
  workspaceId,
  role,
  fileId,
  versionId,
}: {
  workspaceId: string
  role: string | undefined
  fileId?: string
  versionId?: string
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
  const [key, setKey] = useState('')
  const [name, setName] = useState('')
  const [format, setFormat] = useState('csv')
  const [instrumentId, setInstrumentId] = useState('')
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
  const error = action.error ?? upload.error ?? parsers.error ?? files.error
  return (
    <div className="flex min-w-0 flex-col gap-6">
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
          <div className="grid max-w-[720px] gap-3 md:grid-cols-2">
            <Field label="Retained test file">
              <NativeSelect
                value={testFileId}
                onChange={(e) => setTestFileId(e.target.value)}
              >
                <option value="">Choose a retained file</option>
                {files.data?.map((file) => (
                  <option key={file.id} value={file.id}>
                    {file.filename} · {file.id.slice(0, 8)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {canEdit ? (
              <Field label="Upload a new test file">
                <input
                  type="file"
                  aria-label="Upload a new test file"
                  disabled={upload.isPending}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) upload.mutate(file)
                  }}
                />
              </Field>
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
            <Muted>No retained-file validation result yet.</Muted>
          )}
        </Section>
      ) : null}
      {canEdit && parsers.isSuccess ? (
        <Section title="Create a draft version">
          <Muted>
            Use a new key for a new parser, or an existing key for its next
            version. Approved definitions are not edited in place. A nonempty
            mapping requires a Dataset-linked retained test file.
          </Muted>
          <form
            className="grid max-w-[720px] gap-3 md:grid-cols-2"
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
              <NativeSelect
                value={format}
                onChange={(e) => setFormat(e.target.value)}
              >
                {['csv', 'tsv', 'xlsx', 'json'].map((value) => (
                  <option key={value} value={value}>
                    {value.toUpperCase()}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Instrument">
              <NativeSelect
                value={instrumentId}
                onChange={(e) => setInstrumentId(e.target.value)}
              >
                <option value="">Not linked</option>
                {instruments.data?.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </NativeSelect>
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
