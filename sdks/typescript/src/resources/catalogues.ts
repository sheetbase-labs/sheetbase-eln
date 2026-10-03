/**
 * Catalogue resource — read-only access to schema definitions, sheet
 * definitions and templates.
 *
 * These are GET-only for external credentials (schema:read / templates:read).
 * Authoring RPCs stay fail-closed.
 */
import type { HttpTransport } from "../http.js";
import { type RecordModel, fromRecordModel } from "../types.js";

export class CataloguesResource {
  constructor(private transport: HttpTransport) {}

  // ── Record Models (MDL-01) ──────────────────────────────────────────

  async listRecordModels(options?: {
    limit?: number;
    offset?: number;
  }): Promise<RecordModel[]> {
    const rows = await this.transport.get("/api/db/record_models", {
      params: { limit: options?.limit ?? 100, offset: options?.offset ?? 0 },
    });
    return rows.map(fromRecordModel);
  }

  async getRecordModel(modelId: string): Promise<RecordModel | null> {
    const rows = await this.transport.get("/api/db/record_models", {
      params: { id: `eq.${modelId}`, limit: 1 },
    });
    return rows.length > 0 ? fromRecordModel(rows[0]) : null;
  }

  // ── Dataset Schema ──────────────────────────────────────────────────

  async listSchemaDefinitions(options?: {
    limit?: number;
    offset?: number;
    order?: string;
  }): Promise<Record<string, any>[]> {
    const params: Record<string, string | number | undefined> = {
      limit: options?.limit ?? 100,
      offset: options?.offset ?? 0,
    };
    if (options?.order) params.order = options.order;
    return this.transport.get("/api/db/dataset_schema_definitions", { params });
  }

  async getSchemaDefinition(
    definitionId: string,
  ): Promise<Record<string, any> | null> {
    const rows = await this.transport.get(
      "/api/db/dataset_schema_definitions",
      {
        params: { id: `eq.${definitionId}`, limit: 1 },
      },
    );
    return rows[0] ?? null;
  }

  async listSchemaVersions(options?: {
    limit?: number;
    offset?: number;
  }): Promise<Record<string, any>[]> {
    return this.transport.get("/api/db/dataset_schema_versions", {
      params: { limit: options?.limit ?? 100, offset: options?.offset ?? 0 },
    });
  }

  async listSchemaVersionFields(options?: {
    schemaVersionId?: string;
    limit?: number;
    offset?: number;
  }): Promise<Record<string, any>[]> {
    const params: Record<string, string | number | undefined> = {
      limit: options?.limit ?? 1000,
      offset: options?.offset ?? 0,
    };
    if (options?.schemaVersionId) {
      params.schema_version_id = `eq.${options.schemaVersionId}`;
    }
    return this.transport.get("/api/db/dataset_schema_version_fields", {
      params,
    });
  }

  // ── Sheet Definitions ───────────────────────────────────────────────

  async listSheetDefinitions(options?: {
    limit?: number;
    offset?: number;
  }): Promise<Record<string, any>[]> {
    return this.transport.get("/api/db/sheet_definitions", {
      params: { limit: options?.limit ?? 100, offset: options?.offset ?? 0 },
    });
  }

  async listSheetDefinitionVersions(options?: {
    limit?: number;
    offset?: number;
  }): Promise<Record<string, any>[]> {
    return this.transport.get("/api/db/sheet_definition_versions", {
      params: { limit: options?.limit ?? 100, offset: options?.offset ?? 0 },
    });
  }

  // ── Notebook Templates ──────────────────────────────────────────────

  async listTemplates(options?: {
    limit?: number;
    offset?: number;
  }): Promise<Record<string, any>[]> {
    return this.transport.get("/api/db/notebook_templates", {
      params: { limit: options?.limit ?? 100, offset: options?.offset ?? 0 },
    });
  }

  async listTemplateVersions(options?: {
    limit?: number;
    offset?: number;
  }): Promise<Record<string, any>[]> {
    return this.transport.get("/api/db/notebook_template_versions", {
      params: { limit: options?.limit ?? 100, offset: options?.offset ?? 0 },
    });
  }

  async instantiateTemplate(params: {
    versionId: string;
    targetProjectId: string;
    title: string;
    parameterInputs: Record<string, unknown>[];
    idempotencyKey: string;
  }): Promise<any> {
    return this.transport.post(
      "/api/db/rpc/instantiate_notebook_template_version",
      {
        jsonBody: {
          p_version_id: params.versionId,
          p_target_project_id: params.targetProjectId,
          p_title: params.title,
          p_parameter_inputs: params.parameterInputs,
          p_idempotency_key: params.idempotencyKey,
        },
      },
    );
  }

  async previewTemplateUpgrade(
    recordId: string,
    targetVersionId: string,
  ): Promise<any> {
    return this.transport.post(
      "/api/db/rpc/preview_notebook_template_upgrade",
      {
        jsonBody: {
          p_record_id: recordId,
          p_target_version_id: targetVersionId,
        },
      },
    );
  }

  async applyTemplateUpgrade(params: {
    recordId: string;
    expectedStructureVersion: number;
    targetVersionId: string;
    decisions: Record<string, unknown>[];
    parameterInputs: Record<string, unknown>[];
  }): Promise<any> {
    return this.transport.post("/api/db/rpc/apply_notebook_template_upgrade", {
      jsonBody: {
        p_record_id: params.recordId,
        p_expected_structure_version: params.expectedStructureVersion,
        p_target_version_id: params.targetVersionId,
        p_decisions: params.decisions,
        p_parameter_inputs: params.parameterInputs,
      },
    });
  }
}
