import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '#/components/ui'
import type { DataClient } from '#/lib/data-client'
import { datasetRevision } from '#/lib/dataset-product'
import type { CanonicalDatasetWire } from '#/lib/dataset-explorer-data'
import { validateAndCommitImport } from '#/lib/import-commit'
import type { ImportCommitTarget } from '#/lib/import-commit'
import {
  applyMappingProposal,
  suggestMappingProposal,
} from '#/lib/assist-drafts'
import type { AssistMappingProposal } from '#/lib/assist-drafts'
import { DraftProposalPanel } from '#/components/assist/draft-proposal-panel'
import {
  datasetFieldsFromColumns,
  mapImportSheet,
  recordFieldsFromModel,
  suggestImportMappings,
} from '#/lib/import-mapping'
import type {
  ImportColumnMapping,
  ImportTargetField,
} from '#/lib/import-mapping'
import {
  parseImportBytes,
  parseImportText,
  selectImportSheet,
  sniffImportFormat,
} from '#/lib/import-parse'
import type { ImportPreview } from '#/lib/import-parse'
import type { ModelFieldDefinition } from '#/lib/model-fields'

type WizardMode =
  | { kind: 'dataset'; table: CanonicalDatasetWire }
  | {
      kind: 'record'
      projectId: string
      projects?: Array<{ id: string; title: string }>
      modelKey: string
      recordKind: string
      fields: ModelFieldDefinition[]
    }

export function ImportWizard({
  open,
  onOpenChange,
  client,
  mode,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  client: DataClient
  mode: WizardMode
  onDone: () => void
}) {
  const fields = useMemo<ImportTargetField[]>(() => {
    if (mode.kind === 'dataset') {
      return datasetFieldsFromColumns(mode.table.columns)
    }
    return recordFieldsFromModel(mode.fields)
  }, [mode])
  const schemaVersionId =
    mode.kind === 'dataset' ? (mode.table.schema_version_id ?? null) : null

  const [paste, setPaste] = useState('')
  const [status, setStatus] = useState('')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [sheetName, setSheetName] = useState('')
  const [mappingValues, setMappingValues] = useState<Record<string, string>>({})
  // ASSIST-02: deterministic mapping suggestions with confidence + preview.
  // Accept applies them through the ordinary mappingValues path the wizard
  // already commits; Discard leaves zero state.
  const [mappingProposal, setMappingProposal] =
    useState<AssistMappingProposal | null>(null)
  const [projectId, setProjectId] = useState(
    mode.kind === 'record' ? mode.projectId : '',
  )
  const sheet = preview
    ? selectImportSheet(preview, sheetName || undefined)
    : null
  const mappings = useMemo<ImportColumnMapping[]>(() => {
    if (!sheet) return []
    return sheet.headers.map((source) => {
      const value = mappingValues[source] ?? 'ignore'
      if (value === 'ignore') return { source, kind: 'ignore' }
      const field = fields.find((item) => item.id === value)
      return field
        ? { source, kind: 'field', field }
        : { source, kind: 'ignore' }
    })
  }, [fields, mappingValues, sheet])

  const mapped = useMemo(
    () => (sheet ? mapImportSheet(sheet, mappings, schemaVersionId) : null),
    [mappings, schemaVersionId, sheet],
  )

  const reset = () => {
    setPaste('')
    setStatus('')
    setPreview(null)
    setSheetName('')
    setMappingValues({})
  }

  const applyPreview = (next: ImportPreview) => {
    const first = next.sheets.at(0)
    if (!first) {
      setPreview(null)
      setStatus('Import contains no sheets.')
      return
    }
    setPreview(next)
    setSheetName(first.name)
    setMappingValues(
      Object.fromEntries(
        suggestImportMappings(first.headers, fields).map((mapping) => [
          mapping.source,
          mapping.kind === 'field' ? mapping.field.id : 'ignore',
        ]),
      ),
    )
    setStatus(
      `Previewed ${first.rows.length} rows in ${next.sheets.length} sheet(s).`,
    )
  }

  const loadFile = async (file: File | undefined) => {
    if (!file) return
    try {
      const bytes = await file.arrayBuffer()
      applyPreview(
        await parseImportBytes(bytes, {
          fileName: file.name,
          format: sniffImportFormat(file.name),
        }),
      )
    } catch (error) {
      setPreview(null)
      setStatus(
        error instanceof Error ? error.message : 'Could not parse file.',
      )
    }
  }

  const loadPaste = () => {
    try {
      applyPreview(parseImportText(paste, { format: 'clipboard' }))
    } catch (error) {
      setPreview(null)
      setStatus(
        error instanceof Error ? error.message : 'Could not parse paste.',
      )
    }
  }

  const commitMutation = useMutation({
    mutationFn: async () => {
      if (!mapped) throw new Error('Preview the file before committing.')
      const target: ImportCommitTarget =
        mode.kind === 'dataset'
          ? {
              kind: 'dataset',
              datasetId: mode.table.id,
              expectedRevision: datasetRevision(mode.table),
              schemaVersionId: mode.table.schema_version_id ?? '',
            }
          : {
              kind: 'record',
              projectId: projectId || mode.projectId,
              modelKey: mode.modelKey,
              recordKind: mode.recordKind,
            }
      const result = await validateAndCommitImport(
        client,
        target,
        mapped,
        crypto.randomUUID(),
      )
      if (!result.ok) {
        const detail = result.errors.at(0)
        throw new Error(
          detail
            ? `Row ${detail.row ?? '?'}: ${detail.message}`
            : 'Import was rejected.',
        )
      }
      return result
    },
    onSuccess: (result) => {
      onDone()
      onOpenChange(false)
      reset()
      setStatus(`Imported ${result.committed} rows.`)
    },
  })

  const mappedFieldCount = mappings.filter(
    (item) => item.kind === 'field',
  ).length
  const canCommit =
    Boolean(mapped) &&
    mappedFieldCount > 0 &&
    (mapped?.errors.length ?? 1) === 0 &&
    !commitMutation.isPending

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import</DialogTitle>
          <DialogDescription>
            Upload CSV, TSV, JSON or XLSX, or paste from the clipboard. Rows are
            mapped, validated against the current Schema Version, then committed
            through the canonical Dataset or Record writers.
          </DialogDescription>
        </DialogHeader>
        {mode.kind === 'dataset' ? (
          <p className="text-xs text-muted-foreground">
            Target Dataset Schema Version{' '}
            {mode.table.schema_version_number ?? ''} (
            {mode.table.schema_version_id ?? 'unpinned'})
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Target Records: {mode.recordKind}. Creates go through{' '}
              <code>create_model_record</code> after{' '}
              <code>validate_sheet_record_batch</code>.
            </p>
            {mode.projects && mode.projects.length > 0 ? (
              <Label className="text-xs text-muted-foreground">
                Project
                <Select
                  className="mt-1"
                  aria-label="Import project"
                  value={projectId}
                  onChange={(event) => setProjectId(event.target.value)}
                >
                  {mode.projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.title}
                    </option>
                  ))}
                </Select>
              </Label>
            ) : null}
          </div>
        )}
        <Tabs defaultValue="upload">
          <TabsList>
            <TabsTrigger value="upload">Upload</TabsTrigger>
            <TabsTrigger value="paste">Paste</TabsTrigger>
          </TabsList>
          <TabsContent value="upload">
            <Label className="text-xs text-muted-foreground">
              Laboratory file
              <Input
                className="mt-1"
                type="file"
                accept=".csv,.tsv,.tab,.txt,.json,.xlsx,text/csv,text/tab-separated-values,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(event) => {
                  void loadFile(event.target.files?.[0])
                }}
              />
            </Label>
          </TabsContent>
          <TabsContent value="paste" className="space-y-2">
            <Label className="text-xs text-muted-foreground">
              Clipboard
              <Textarea
                aria-label="Import paste"
                className="mt-1 min-h-28 font-mono text-xs"
                value={paste}
                onChange={(event) => setPaste(event.target.value)}
                placeholder="Paste CSV, TSV or JSON"
              />
            </Label>
            <Button size="sm" variant="outline" onClick={loadPaste}>
              Preview paste
            </Button>
          </TabsContent>
        </Tabs>
        {preview && sheet ? (
          <div className="space-y-3">
            {preview.sheets.length > 1 ? (
              <Label className="text-xs text-muted-foreground">
                Sheet
                <Select
                  className="mt-1"
                  aria-label="Import sheet"
                  value={sheetName}
                  onChange={(event) => {
                    const name = event.target.value
                    setSheetName(name)
                    const next = selectImportSheet(preview, name)
                    setMappingValues(
                      Object.fromEntries(
                        suggestImportMappings(next.headers, fields).map(
                          (mapping) => [
                            mapping.source,
                            mapping.kind === 'field'
                              ? mapping.field.id
                              : 'ignore',
                          ],
                        ),
                      ),
                    )
                  }}
                >
                  {preview.sheets.map((item) => (
                    <option key={item.name} value={item.name}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              </Label>
            ) : null}
            <div className="overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    {sheet.headers.map((header) => (
                      <TableHead key={header}>{header}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sheet.rows.slice(0, 8).map((row, index) => (
                    <TableRow key={index}>
                      {sheet.headers.map((header) => (
                        <TableCell key={header} className="font-mono text-xs">
                          {row[header]}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="grid gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-medium">Column mapping</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (sheet) setMappingProposal(suggestMappingProposal(sheet.headers, fields))
                  }}
                >
                  Suggest mapping
                </Button>
              </div>
              {mappingProposal ? (
                <DraftProposalPanel
                  proposal={mappingProposal}
                  onAccept={() => {
                    setMappingValues(
                      Object.fromEntries(
                        applyMappingProposal(mappingProposal).map((mapping) => [
                          mapping.source,
                          mapping.kind === 'field' ? mapping.field.id : 'ignore',
                        ]),
                      ),
                    )
                    setMappingProposal(null)
                  }}
                  onDiscard={() => setMappingProposal(null)}
                />
              ) : null}
              {sheet.headers.map((header) => (
                <Label
                  key={header}
                  className="grid grid-cols-[1fr_1fr] items-center gap-2 text-xs text-muted-foreground"
                >
                  <span>{header}</span>
                  <Select
                    aria-label={`Map ${header}`}
                    value={mappingValues[header] ?? 'ignore'}
                    onChange={(event) =>
                      setMappingValues((current) => ({
                        ...current,
                        [header]: event.target.value,
                      }))
                    }
                  >
                    <option value="ignore">Ignore</option>
                    {fields.map((field) => (
                      <option key={field.id} value={field.id}>
                        {field.label}
                        {field.nullable ? '' : ' *'}
                      </option>
                    ))}
                  </Select>
                </Label>
              ))}
            </div>
            {mapped && mapped.errors.length > 0 ? (
              <ul role="alert" className="text-xs text-destructive">
                {mapped.errors.slice(0, 8).map((error) => (
                  <li key={`${error.row}-${error.source}`}>
                    Row {error.row} · {error.source}: {error.message}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">
                {sheet.rows.length} rows ready. Validate-before-commit uses the
                canonical RPCs only.
              </p>
            )}
          </div>
        ) : null}
        {status ? (
          <p className="text-xs text-muted-foreground">{status}</p>
        ) : null}
        {commitMutation.error instanceof Error ? (
          <p role="alert" className="text-xs text-destructive">
            {commitMutation.error.message}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => commitMutation.mutate()} disabled={!canCommit}>
            {commitMutation.isPending ? 'Importing…' : 'Validate and commit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
