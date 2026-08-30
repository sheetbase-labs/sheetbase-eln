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
    name: string;
    notebookRecordId?: string;
    configuration?: Record<string, unknown>;
  }): Promise<any> {
    const body: Record<string, unknown> = { p_name: params.name };
    if (params.notebookRecordId) body.p_notebook_record_id = params.notebookRecordId;
    if (params.configuration) body.p_configuration = params.configuration;
    return this.transport.post("/api/db/rpc/create_sheet_instance", { jsonBody: body });
  }

  async createFromDefinition(params: {
    sheetDefinitionVersionId: string;
    name: string;
    notebookRecordId?: string;
  }): Promise<any> {
    const body: Record<string, unknown> = {
      p_sheet_definition_version_id: params.sheetDefinitionVersionId,
      p_name: params.name,
    };
    if (params.notebookRecordId) body.p_notebook_record_id = params.notebookRecordId;
    return this.transport.post(
      "/api/db/rpc/create_sheet_instance_from_definition",
      { jsonBody: body },
    );
  }

  async update(
    instanceId: string,
    expectedRevision: number,
    options?: { name?: string },
  ): Promise<any> {
    const body: Record<string, unknown> = {
      p_instance_id: instanceId,
      p_expected_revision: expectedRevision,
    };
    if (options?.name !== undefined) body.p_name = options.name;
    return this.transport.post("/api/db/rpc/update_sheet_instance", { jsonBody: body });
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

  async archive(instanceId: string): Promise<any> {
    return this.transport.post("/api/db/rpc/archive_sheet_instance", {
      jsonBody: { p_instance_id: instanceId },
    });
  }

  async restore(instanceId: string): Promise<any> {
    return this.transport.post("/api/db/rpc/restore_sheet_instance", {
      jsonBody: { p_instance_id: instanceId },
    });
  }

  async duplicate(instanceId: string, options?: { name?: string }): Promise<any> {
    const body: Record<string, unknown> = { p_instance_id: instanceId };
    if (options?.name) body.p_name = options.name;
    return this.transport.post("/api/db/rpc/duplicate_sheet_instance", { jsonBody: body });
  }

  async materialize(instanceId: string, expectedRevision: number): Promise<any> {
    return this.transport.post("/api/db/rpc/materialize_sheet_instance", {
      jsonBody: {
        p_instance_id: instanceId,
        p_expected_revision: expectedRevision,
      },
    });
  }

  async previewMaterialize(instanceId: string): Promise<any> {
    return this.transport.post("/api/db/rpc/preview_sheet_materialization", {
      jsonBody: { p_instance_id: instanceId },
    });
  }

  async mutateLocalState(
    instanceId: string,
    expectedRevision: number,
    localState: Record<string, unknown>,
  ): Promise<any> {
    return this.transport.post(
      "/api/db/rpc/mutate_sheet_instance_local_state",
      {
        jsonBody: {
          p_instance_id: instanceId,
          p_expected_revision: expectedRevision,
          p_local_state: localState,
        },
      },
    );
  }

  async mutateCalculations(
    instanceId: string,
    expectedRevision: number,
    calculations: Record<string, unknown>[],
  ): Promise<any> {
    return this.transport.post(
      "/api/db/rpc/mutate_sheet_instance_calculations",
      {
        jsonBody: {
          p_instance_id: instanceId,
          p_expected_revision: expectedRevision,
          p_calculations: calculations,
        },
      },
    );
  }
}
