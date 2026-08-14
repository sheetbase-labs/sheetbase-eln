import { createDataClient } from './data-client'
import type { DataClient } from './data-client'
import { safeParseSheetInstanceState } from './sheet-instance'
import type { SheetInstanceState } from './sheet-instance'

export interface SheetInstanceWire { id: string; workspace_id: string; project_id: string | null; notebook_record_id: string | null; source_definition_version_id: string | null; name: string; description: string | null; lifecycle: 'active' | 'archived'; revision: number | string; state: unknown; duplicated_from_instance_id: string | null }
export type SheetInstance = Omit<SheetInstanceWire, 'workspace_id' | 'project_id' | 'notebook_record_id' | 'source_definition_version_id' | 'duplicated_from_instance_id' | 'revision' | 'state'> & { workspaceId: string; projectId: string | null; notebookRecordId: string | null; sourceDefinitionVersionId: string | null; duplicatedFromInstanceId: string | null; revision: number; state: SheetInstanceState }

export const sheetInstanceDataClient = createDataClient()
export function sheetInstanceFromWire(wire: SheetInstanceWire): SheetInstance | { error: 'invalid_state'; issues: unknown } {
  const state = safeParseSheetInstanceState(wire.state)
  if (!state.success) return { error: 'invalid_state', issues: state.error.issues }
  return { id: wire.id, workspaceId: wire.workspace_id, projectId: wire.project_id, notebookRecordId: wire.notebook_record_id, sourceDefinitionVersionId: wire.source_definition_version_id, duplicatedFromInstanceId: wire.duplicated_from_instance_id, name: wire.name, description: wire.description, lifecycle: wire.lifecycle, revision: Number(wire.revision), state: state.data }
}
export async function fetchSheetInstances(client: DataClient = sheetInstanceDataClient) { const rows = await client.list<SheetInstanceWire>('sheet_instances', '?order=created_at.asc,id.asc'); return rows.map(sheetInstanceFromWire) }
export async function createSheetInstance(input: { workspaceId: string; name: string; description?: string | null; sourceDefinitionVersionId?: string | null; projectId?: string | null; notebookRecordId?: string | null; state: SheetInstanceState }, client: DataClient = sheetInstanceDataClient) { const row = await client.rpc<SheetInstanceWire>('create_sheet_instance', { p_workspace_id: input.workspaceId, p_name: input.name, p_description: input.description ?? null, p_source_definition_version_id: input.sourceDefinitionVersionId ?? null, p_project_id: input.projectId ?? null, p_notebook_record_id: input.notebookRecordId ?? null, p_state: input.state }); return sheetInstanceFromWire(row) }
export async function updateSheetInstance(id: string, revision: number, state: SheetInstanceState, client: DataClient = sheetInstanceDataClient) { const row = await client.rpc<SheetInstanceWire>('update_sheet_instance', { p_instance_id: id, p_expected_revision: revision, p_state: state }); return sheetInstanceFromWire(row) }
export async function archiveSheetInstance(id: string, revision: number, client: DataClient = sheetInstanceDataClient) { const row = await client.rpc<SheetInstanceWire>('archive_sheet_instance', { p_instance_id: id, p_expected_revision: revision }); return sheetInstanceFromWire(row) }
export async function duplicateSheetInstance(id: string, revision: number, name: string, client: DataClient = sheetInstanceDataClient) { const row = await client.rpc<SheetInstanceWire>('duplicate_sheet_instance', { p_instance_id: id, p_expected_revision: revision, p_name: name }); return sheetInstanceFromWire(row) }
