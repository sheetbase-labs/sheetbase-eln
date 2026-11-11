/**
 * Suppliers (migration 0100). There is no supplier table: any record model can
 * be ticked as the lab's supplier list, and its records are the suppliers. A
 * ready-made Supplier model is offered for a lab that has none. A reagent
 * order names the supplier record it was placed with.
 */
import type { DataClient } from '#/lib/data-client'

export const supplierKeys = {
  all: ['suppliers'] as const,
  models: ['suppliers', 'models'] as const,
  list: (modelKeys: readonly string[]) =>
    ['suppliers', 'list', ...modelKeys] as const,
}

export interface SupplierRecord {
  id: string
  identifier: string
  title: string
  kind: string
}

/** The keys of the record models ticked as a supplier list. */
export async function fetchSupplierModelKeys(
  client: DataClient,
): Promise<string[]> {
  const rows = await client.list<{ model_key: string }>(
    'supplier_models',
    '?select=model_key&order=model_key.asc',
  )

  return rows.map((row) => row.model_key)
}

/** Every live supplier across the supplier lists, by name. */
export async function fetchSuppliers(
  client: DataClient,
  modelKeys: readonly string[],
): Promise<SupplierRecord[]> {
  if (modelKeys.length === 0) return []
  const list = modelKeys.map((key) => encodeURIComponent(key)).join(',')

  return client.list<SupplierRecord>(
    'records',
    `?kind=in.(${list})&deleted_at=is.null&archived_at=is.null&order=title.asc&limit=2000&select=id,identifier,title,kind`,
  )
}

export function setModelSupplierList(
  client: DataClient,
  modelKey: string,
  enabled: boolean,
): Promise<void> {
  return client.rpc('set_model_supplier_list', {
    p_model_key: modelKey,
    p_enabled: enabled,
  })
}

export interface StarterSupplierField {
  field_name: string
  label: string
  show_in_list?: boolean
}

/** The fields a ready-made Supplier model starts with. */
export const SUPPLIER_STARTER = {
  key: 'supplier',
  name: 'Supplier',
  prefix: 'SUP',
  description: 'The companies the lab buys from.',
  fields: [
    { field_name: 'contact', label: 'Contact', show_in_list: true },
    { field_name: 'email', label: 'Email', show_in_list: true },
    { field_name: 'phone', label: 'Phone' },
    { field_name: 'website', label: 'Website' },
    { field_name: 'account_number', label: 'Account number' },
    { field_name: 'payment_terms', label: 'Payment terms' },
    { field_name: 'currency', label: 'Usual currency' },
  ] satisfies StarterSupplierField[],
} as const

export async function createSupplierModel(client: DataClient): Promise<void> {
  await client.rpc('create_supplier_model', {
    p_key: SUPPLIER_STARTER.key,
    p_name: SUPPLIER_STARTER.name,
    p_prefix: SUPPLIER_STARTER.prefix,
    p_description: SUPPLIER_STARTER.description,
    p_fields: SUPPLIER_STARTER.fields,
  })
}
