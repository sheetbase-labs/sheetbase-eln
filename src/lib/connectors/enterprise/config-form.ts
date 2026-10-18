/**
 * Browser-safe form model for an enterprise connector's non-secret settings.
 *
 * The server re-validates everything (`config-validation.ts`, plus the host policy);
 * this only gives the editor field-level feedback and keeps `update_connector`
 * from wiping keys the form does not show, because the RPC replaces `config`
 * wholesale.
 */
import type { EnterpriseAdapterId } from './types'

export type ConnectorConfigField = {
  name: string
  label: string
  hint?: string
  required?: boolean
  kind: 'text' | 'port' | 'select' | 'boolean'
  options?: readonly string[]
}

export const CONNECTOR_CONFIG_FIELDS: Record<
  EnterpriseAdapterId,
  readonly ConnectorConfigField[]
> = {
  s3: [
    { name: 'bucket', label: 'Bucket', required: true, kind: 'text' },
    {
      name: 'prefix',
      label: 'Prefix',
      hint: 'Only keys under this folder are listed and imported.',
      kind: 'text',
    },
    {
      name: 'endpoint',
      label: 'Endpoint URL',
      hint: 'Leave empty for AWS S3. Needed for S3-compatible stores.',
      kind: 'text',
    },
    { name: 'region', label: 'Region', kind: 'text' },
    {
      name: 'forcePathStyle',
      label: 'Use path-style addressing',
      hint: 'Required by most non-AWS stores.',
      kind: 'boolean',
    },
  ],
  postgres: [
    { name: 'host', label: 'Host', required: true, kind: 'text' },
    { name: 'port', label: 'Port', required: true, kind: 'port' },
    { name: 'database', label: 'Database', required: true, kind: 'text' },
    {
      name: 'sslMode',
      label: 'SSL mode',
      kind: 'select',
      options: ['disable', 'prefer', 'require'],
    },
  ],
}

export type ConnectorConfigValues = Record<string, string | boolean>

export function configFormValues(
  adapter: EnterpriseAdapterId,
  config: Record<string, unknown>,
): ConnectorConfigValues {
  const values: ConnectorConfigValues = {}
  for (const field of CONNECTOR_CONFIG_FIELDS[adapter]) {
    const raw = config[field.name]
    if (field.kind === 'boolean') values[field.name] = Boolean(raw)
    else if (field.kind === 'select')
      values[field.name] = typeof raw === 'string' ? raw : 'disable'
    else
      values[field.name] =
        typeof raw === 'string' || typeof raw === 'number' ? String(raw) : ''
  }
  return values
}

function validateField(
  field: ConnectorConfigField,
  value: string | boolean | undefined,
): string | null {
  const text = typeof value === 'string' ? value.trim() : ''
  if (field.required && !text) return `${field.label} is required.`
  if (field.kind === 'port') {
    const port = Number(text)
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      return 'Enter a port between 1 and 65535.'
  }
  if (
    field.name === 'bucket' &&
    text &&
    !/^[a-z0-9][a-z0-9._-]{1,251}$/i.test(text)
  )
    return 'Use a valid bucket name (letters, numbers, dots, hyphens).'
  return null
}

/** Required settings that are empty or invalid in the stored config. */
export function missingConfigLabels(
  adapter: EnterpriseAdapterId,
  config: Record<string, unknown>,
): string[] {
  const values = configFormValues(adapter, config)
  return CONNECTOR_CONFIG_FIELDS[adapter]
    .filter(
      (field) =>
        field.required && validateField(field, values[field.name]) !== null,
    )
    .map((field) => field.label.toLowerCase())
}

export type BuiltConnectorConfig =
  | { ok: true; config: Record<string, unknown> }
  | { ok: false; errors: Record<string, string> }

/** Merge edited values over the stored config, keeping keys the form does not own. */
export function buildConnectorConfig(
  adapter: EnterpriseAdapterId,
  existing: Record<string, unknown>,
  values: ConnectorConfigValues,
): BuiltConnectorConfig {
  const errors: Record<string, string> = {}
  const config: Record<string, unknown> = { ...existing }
  for (const field of CONNECTOR_CONFIG_FIELDS[adapter]) {
    const value = values[field.name]
    const error = validateField(field, value)
    if (error) {
      errors[field.name] = error
      continue
    }
    const text = typeof value === 'string' ? value.trim() : ''
    if (field.kind === 'boolean') config[field.name] = Boolean(value)
    else if (field.kind === 'port') config[field.name] = Number(text)
    else if (text) config[field.name] = text
    else delete config[field.name]
  }
  return Object.keys(errors).length > 0
    ? { ok: false, errors }
    : { ok: true, config }
}
