/**
 * The ready-made compound registry and its lot model. The structure field is a
 * field type the Chemistry plugin provides, and repeats are caught with the
 * plugin's same-thing rule, so the plugin has to be installed and switched on
 * first.
 */
import { t } from '#/copy'
import type { DataClient } from '#/lib/data-client'
import { setSamenessRule } from '#/lib/registry-sameness'

export const COMPOUND_STARTER = {
  lot: {
    key: 'compound_lot',
    name: 'Compound lot',
    prefix: 'LOT',
    description: t('registry.chemistry.starters.lotDescription'),
    fields: [
      { field_name: 'lot_number', label: 'Lot number', show_in_list: true },
      { field_name: 'supplier', label: 'Supplier' },
      { field_name: 'amount', label: 'Amount' },
      {
        field_name: 'purity_percent',
        label: 'Purity (%)',
        logical_type: 'decimal',
      },
      { field_name: 'received_on', label: 'Received', logical_type: 'date' },
      { field_name: 'notes', label: 'Notes' },
    ],
  },
  compound: {
    key: 'compound',
    name: 'Compound',
    prefix: 'CMP',
    description: t('registry.chemistry.starters.compoundDescription'),
    fields: [
      { field_name: 'structure', label: 'Structure' },
      { field_name: 'cas_number', label: 'CAS number' },
      { field_name: 'target', label: 'Target', show_in_list: true },
      {
        field_name: 'ic50_nm',
        label: 'IC50 (nM)',
        logical_type: 'decimal',
        show_in_list: true,
      },
      {
        field_name: 'solubility_um',
        label: 'Solubility (µM)',
        logical_type: 'decimal',
      },
    ],
  },
} as const

const PLUGIN = 'chemistry'

export async function createCompoundStarter(client: DataClient): Promise<void> {
  const { lot, compound } = COMPOUND_STARTER
  await client.rpc('create_starter_model', {
    p_key: lot.key,
    p_name: lot.name,
    p_prefix: lot.prefix,
    p_description: lot.description,
    p_fields: lot.fields,
    p_incident_log: false,
  })
  await client.rpc('create_registry_model', {
    p_key: compound.key,
    p_name: compound.name,
    p_prefix: compound.prefix,
    p_description: compound.description,
    p_fields: compound.fields,
    p_key_fields: [],
    p_sequence_field: null,
  })
  await client.rpc('set_field_plugin_type', {
    p_kind: compound.key,
    p_field_name: 'structure',
    p_plugin_key: PLUGIN,
    p_type_id: 'structure',
  })
  await setSamenessRule(
    client,
    compound.key,
    `plugin.${PLUGIN}.parent-structure`,
  )
  await client.rpc('set_registry_lot_kind', {
    p_model_key: compound.key,
    p_lot_kind: lot.key,
  })
}
