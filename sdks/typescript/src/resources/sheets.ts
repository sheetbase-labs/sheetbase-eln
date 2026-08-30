/** Sheet Instance resource — query rows, mutations, materialize, record write-back. */
import type { HttpTransport } from "../http.js";
import { iterRpc } from "../pagination.js";
import { fromSheetInstance, type SheetInstance } from "../types.js";
import { NotFoundError } from "../errors.js";

export class SheetsResource {
  constructor(private transport: HttpTransport) {}

  async list(options?: {
    select?: string;
    order?: string;
    limit?: number;
    offset?: number;
  }): Promise<SheetInstance[]> {
    const params: Record<string, string | number | undefined> = {
      limit: options?.limit ?? 100,
      offset: options?.offset ?? 0,
    };
    if (options?.select) params.select = options.select;
    if (options?.order) params.order = options.order;
    const rows = await this.transport.get("/api/db/sheet_instances", { params });
    return rows.map(fromSheetInstance);
  }

  async get(instanceId: string): Promise<SheetInstance> {
    const rows = await this.transport.get("/api/db/sheet_instances", {
      params: { id: `eq.${instanceId}`, limit: 1 },
    });
    if (rows.length === 0) {
      throw new NotFoundError("not_found", `Sheet instance ${instanceId} not found.`);
    }
    return fromSheetInstance(rows[0]);
  }

  async create(params: {
    workspaceId: string;
    name: string;
    description?: string | null;
    sourceDefinitionVersionId?: string | null;
    projectId?: string | null;
    notebookRecordId?: string | null;
    state: Record<string, unknown>;
  }): Promise<any> {
    return this.transport.post("/api/db/rpc/create_sheet_instance", {
      jsonBody: {
        p_workspace_id: params.workspaceId,
        p_name: params.name,
        p_description: params.description ?? null,
        p_source_definition_version_id: params.sourceDefinitionVersionId ?? null,
        p_project_id: params.projectId ?? null,
        p_notebook_record_id: params.notebookRecordId ?? null,
        p_state: params.state,
      },
    });
  }

  async createFromDefinition(params: {
    workspaceId: string;
    name: string;
    sourceDefinitionVersionId: string;
    state: Record<string, unknown>;
    parameterInputs: Record<string, unknown>;
    description?: string | null;
    projectId?: string | null;
    notebookRecordId?: string | null;
  }): Promise<any> {
    return this.transport.post(
      "/api/db/rpc/create_sheet_instance_from_definition",
      {
        jsonBody: {
          p_workspace_id: params.workspaceId,
          p_name: params.name,
          p_description: params.description ?? null,
          p_source_definition_version_id: params.sourceDefinitionVersionId,
          p_project_id: params.projectId ?? null,
          p_notebook_record_id: params.notebookRecordId ?? null,
          p_state: params.state,
          p_parameter_inputs: params.parameterInputs,
        },
      },
    );
  }

  async update(
    instanceId: string,
    expectedRevision: number,
    state: Record<string, unknown>,
  ): Promise<any> {
    return this.transport.post("/api/db/rpc/update_sheet_instance", {
      jsonBody: {
        p_instance_id: instanceId,
        p_expected_revision: expectedRevision,
        p_state: state,
      },
    });
  }

  async queryRows(params: {
    instanceId: string;
    limit?: number;
    offset?: number;
  }): Promise<Record<string, any>> {
    return this.transport.post("/api/db/rpc/query_sheet_instance_rows", {
      jsonBody: {
        p_instance_id: params.instanceId,
        p_limit: params.limit ?? 50,
        p_offset: params.offset ?? 0,
      },
    });
  }

  async *iterRows(
    instanceId: string,
    options?: { pageSize?: number; maxItems?: number },
  ): AsyncGenerator<Record<string, any>> {
    const fetchPage = (limit: number, offset: number) =>
      this.transport.post("/api/db/rpc/query_sheet_instance_rows", {
        jsonBody: {
          p_instance_id: instanceId,
          p_limit: limit,
          p_offset: offset,
        },
      });
    yield* iterRpc(fetchPage, {
      pageSize: options?.pageSize ?? 200,
      maxItems: options?.maxItems,
    });
  }

  async archive(instanceId: string, expectedRevision: number): Promise<any> {
    return this.transport.post("/api/db/rpc/archive_sheet_instance", {
      jsonBody: { p_instance_id: instanceId, p_expected_revision: expectedRevision },
    });
  }

  async restore(instanceId: string, expectedRevision: number): Promise<any> {
    return this.transport.post("/api/db/rpc/restore_sheet_instance", {
      jsonBody: { p_instance_id: instanceId, p_expected_revision: expectedRevision },
    });
  }

  async duplicate(
    instanceId: string,
    expectedRevision: number,
    name: string,
  ): Promise<any> {
    return this.transport.post("/api/db/rpc/duplicate_sheet_instance", {
      jsonBody: {
        p_instance_id: instanceId,
        p_expected_revision: expectedRevision,
        p_name: name,
      },
    });
  }

  async materialize(params: {
    instanceId: string;
    expectedInstanceRevision: number;
    outputName: string;
    outputSchemaVersionId: string;
    previewDigest: string;
    idempotencyKey: string;
  }): Promise<any> {
    return this.transport.post("/api/db/rpc/materialize_sheet_instance", {
      jsonBody: {
        p_instance_id: params.instanceId,
        p_expected_instance_revision: params.expectedInstanceRevision,
        p_output_name: params.outputName,
        p_output_schema_version_id: params.outputSchemaVersionId,
        p_preview_digest: params.previewDigest,
        p_idempotency_key: params.idempotencyKey,
      },
    });
  }

  async previewMaterialize(params: {
    instanceId: string;
    expectedInstanceRevision: number;
    outputSchemaVersionId: string;
  }): Promise<any> {
    return this.transport.post("/api/db/rpc/preview_sheet_materialization", {
      jsonBody: {
        p_instance_id: params.instanceId,
        p_expected_instance_revision: params.expectedInstanceRevision,
        p_output_schema_version_id: params.outputSchemaVersionId,
      },
    });
  }

  async mutateLocalState(params: {
    instanceId: string;
    expectedRevision: number;
    retryToken: string;
    fieldChanges: Record<string, unknown>[];
    rows: Record<string, unknown>[];
    cells: { rowKey: string; fieldId: string; value: unknown }[];
  }): Promise<any> {
    return this.transport.post(
      "/api/db/rpc/mutate_sheet_instance_local_state",
      {
        jsonBody: {
          p_instance_id: params.instanceId,
          p_expected_revision: params.expectedRevision,
          p_retry_token: params.retryToken,
          p_field_changes: params.fieldChanges,
          p_rows: params.rows,
          p_cells: params.cells,
        },
      },
    );
  }

  async mutateCalculations(params: {
    instanceId: string;
    expectedRevision: number;
    retryToken: string;
    changes: Record<string, unknown>[];
  }): Promise<any> {
    return this.transport.post(
      "/api/db/rpc/mutate_sheet_instance_calculations",
      {
        jsonBody: {
          p_instance_id: params.instanceId,
          p_expected_revision: params.expectedRevision,
          p_retry_token: params.retryToken,
          p_changes: params.changes,
        },
      },
    );
  }
}
