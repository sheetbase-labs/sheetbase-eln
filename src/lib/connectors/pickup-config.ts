/**
 * INT-02 — the connector `config.pickup` block that file pickup reads
 * (src/lib/connectors/pickup.server.ts), as edited on the connector page.
 * Pure helpers so the form stays testable.
 */
export interface PickupFormValues {
  projectId: string
  schemaVersionId: string
  datasetId: string
  datasetNamePattern: string
  autoDetect: boolean
  instrumentId: string
}

export const DEFAULT_DATASET_NAME_PATTERN = '{connector} — {file}'

export function pickupFormValues(
  config: Record<string, unknown>,
): PickupFormValues {
  const raw = config['pickup']
  const pickup =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const text = (key: string) =>
    typeof pickup[key] === 'string' ? pickup[key] : ''
  return {
    projectId: text('projectId'),
    schemaVersionId: text('schemaVersionId'),
    datasetId: text('datasetId'),
    datasetNamePattern:
      text('datasetNamePattern') || DEFAULT_DATASET_NAME_PATTERN,
    autoDetect: pickup['autoDetect'] === true,
    instrumentId: text('instrumentId'),
  }
}

/** Merges the form into the connector's existing config, keeping other keys. */
export function buildPickupConfig(
  config: Record<string, unknown>,
  values: PickupFormValues,
):
  | { ok: true; config: Record<string, unknown> }
  | { ok: false; errors: Partial<Record<keyof PickupFormValues, string>> } {
  const errors: Partial<Record<keyof PickupFormValues, string>> = {}
  if (!values.projectId)
    errors.projectId = 'Choose a project for the raw files.'
  if (!values.schemaVersionId) {
    errors.schemaVersionId = 'Choose the Schema the data is committed to.'
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  const pickup: Record<string, unknown> = {
    projectId: values.projectId,
    schemaVersionId: values.schemaVersionId,
    autoDetect: values.autoDetect,
    datasetNamePattern:
      values.datasetNamePattern.trim() || DEFAULT_DATASET_NAME_PATTERN,
  }
  if (values.datasetId) pickup.datasetId = values.datasetId
  if (values.instrumentId) pickup.instrumentId = values.instrumentId
  return { ok: true, config: { ...config, pickup } }
}

/** The command a lab PC runs; the credential stays in the environment. */
export function agentCommand(origin: string, connectorKey: string): string {
  return [
    `SHEETBASE_URL=${origin}`,
    'SHEETBASE_CREDENTIAL=<personal API token>',
    `node instrument-agent.mjs --connector ${connectorKey} --dir <results folder>`,
  ].join(' \\\n')
}
