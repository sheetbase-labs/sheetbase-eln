/** Record resource — list, get, create, update, archive, restore, link, iterate. */
import type { HttpTransport } from "../http.js";
import { iterTable } from "../pagination.js";
import { fromRecord, type SheetbaseRecord } from "../types.js";
import { NotFoundError } from "../errors.js";

export class RecordsResource {
  constructor(private transport: HttpTransport) {}

  async list(options?: {
    kind?: string;
    projectId?: string;
    select?: string;
    order?: string;
    limit?: number;
    offset?: number;
  }): Promise<SheetbaseRecord[]> {
    const params: Record<string, string | number | undefined> = {
      limit: options?.limit ?? 100,
      offset: options?.offset ?? 0,
    };
    if (options?.kind) params.kind = `eq.${options.kind}`;
    if (options?.projectId) params.project_id = `eq.${options.projectId}`;
    if (options?.select) params.select = options.select;
    if (options?.order) params.order = options.order;
    const rows = await this.transport.get("/api/db/records", { params });
    return rows.map(fromRecord);
  }

  async get(recordId: string): Promise<SheetbaseRecord> {
    const rows = await this.transport.get("/api/db/records", {
      params: { id: `eq.${recordId}`, limit: 1 },
    });
    if (rows.length === 0) {
      throw new NotFoundError("not_found", `Record ${recordId} not found.`);
    }
    return fromRecord(rows[0]);
  }

  async create(params: {
    projectId: string;
    kind: string;
    title: string;
    status: string;
    tags?: string[];
    properties?: Record<string, unknown>;
  }): Promise<SheetbaseRecord> {
    const result = await this.transport.post("/api/db/rpc/create_record", {
      jsonBody: {
        p_project_id: params.projectId,
        p_kind: params.kind,
        p_title: params.title,
        p_status: params.status,
        p_tags: params.tags ?? [],
        p_properties: params.properties ?? {},
      },
    });
    if (Array.isArray(result)) return fromRecord(result[0]);
    return fromRecord(result);
  }

  async update(
    recordId: string,
    fields: {
      title?: string;
      status?: string;
      tags?: string[];
      properties?: Record<string, unknown>;
      customFields?: Record<string, unknown>;
    },
  ): Promise<Record<string, any>[]> {
    const body: Record<string, unknown> = {};
    if (fields.title !== undefined) body.title = fields.title;
    if (fields.status !== undefined) body.status = fields.status;
    if (fields.tags !== undefined) body.tags = fields.tags;
    if (fields.properties !== undefined) body.properties = fields.properties;
    if (fields.customFields !== undefined) body.custom_fields = fields.customFields;
    return this.transport.patch("/api/db/records", {
      params: { id: `eq.${recordId}` },
      jsonBody: body,
    });
  }

  async archive(recordId: string, expectedMetadataVersion: number): Promise<any> {
    return this.transport.post("/api/db/rpc/archive_record", {
      jsonBody: { p_record_id: recordId, p_expected_metadata_version: expectedMetadataVersion },
    });
  }

  async restore(recordId: string, expectedMetadataVersion: number): Promise<any> {
    return this.transport.post("/api/db/rpc/restore_record", {
      jsonBody: { p_record_id: recordId, p_expected_metadata_version: expectedMetadataVersion },
    });
  }

  async transitionStatus(
    recordId: string,
    targetStatus: string,
    expectedMetadataVersion: number,
  ): Promise<any> {
    return this.transport.post("/api/db/rpc/transition_record_status", {
      jsonBody: {
        p_record_id: recordId,
        p_target_status: targetStatus,
        p_expected_metadata_version: expectedMetadataVersion,
      },
    });
  }

  async createLink(params: {
    sourceRecordId: string;
    targetKind: string;
    targetIdentifier: string;
    linkType: string;
    targetRecordId?: string | null;
    label?: string | null;
  }): Promise<any> {
    return this.transport.post("/api/db/rpc/create_record_link", {
      jsonBody: {
        p_source_record_id: params.sourceRecordId,
        p_target_kind: params.targetKind,
        p_target_identifier: params.targetIdentifier,
        p_link_type: params.linkType,
        p_target_record_id: params.targetRecordId ?? null,
        p_label: params.label ?? null,
      },
    });
  }

  async *iter(options?: {
    kind?: string;
    projectId?: string;
    select?: string;
    order?: string;
    pageSize?: number;
    maxItems?: number;
  }): AsyncGenerator<SheetbaseRecord> {
    const fetchPage = (limit: number, offset: number) => {
      const params: Record<string, string | number | undefined> = { limit, offset };
      if (options?.kind) params.kind = `eq.${options.kind}`;
      if (options?.projectId) params.project_id = `eq.${options.projectId}`;
      if (options?.select) params.select = options.select;
      if (options?.order) params.order = options.order;
      return this.transport.get("/api/db/records", { params });
    };
    for await (const row of iterTable(fetchPage, {
      pageSize: options?.pageSize ?? 100,
      maxItems: options?.maxItems,
    })) {
      yield fromRecord(row);
    }
  }
}
