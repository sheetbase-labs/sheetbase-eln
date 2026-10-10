/** Project resource — list, get, create, update, iterate. */
import type { HttpTransport } from "../http.js";
import { iterTable } from "../pagination.js";
import { fromProject  } from "../types.js";
import type {Project} from "../types.js";
import { NotFoundError } from "../errors.js";

export class ProjectsResource {
  constructor(private transport: HttpTransport) {}

  async list(options?: {
    select?: string;
    order?: string;
    limit?: number;
    offset?: number;
  }): Promise<Project[]> {
    const params: Record<string, string | number | undefined> = {
      limit: options?.limit ?? 100,
      offset: options?.offset ?? 0,
    };
    if (options?.select) params.select = options.select;
    if (options?.order) params.order = options.order;
    const rows = await this.transport.get("/api/db/projects", { params });
    return rows.map(fromProject);
  }

  async get(projectId: string): Promise<Project> {
    const rows = await this.transport.get("/api/db/projects", {
      params: { id: `eq.${projectId}`, limit: 1 },
    });
    if (rows.length === 0) {
      throw new NotFoundError("not_found", `Project ${projectId} not found.`);
    }
    return fromProject(rows[0]);
  }

  async getByKey(key: string): Promise<Project> {
    const rows = await this.transport.get("/api/db/projects", {
      params: { key: `eq.${key}`, limit: 1 },
    });
    if (rows.length === 0) {
      throw new NotFoundError("not_found", `Project key=${key} not found.`);
    }
    return fromProject(rows[0]);
  }

  async create(title: string): Promise<Project> {
    const result = await this.transport.post("/api/db/rpc/create_project", {
      jsonBody: { p_title: title },
    });
    if (Array.isArray(result)) return fromProject(result[0]);
    return fromProject(result);
  }

  async update(
    projectId: string,
    fields: {
      title?: string;
      status?: string;
      customFields?: Record<string, unknown>;
    },
  ): Promise<Record<string, any>[]> {
    const body: Record<string, unknown> = {};
    if (fields.title !== undefined) body.title = fields.title;
    if (fields.status !== undefined) body.status = fields.status;
    if (fields.customFields !== undefined)
      body.custom_fields = fields.customFields;
    return this.transport.patch("/api/db/projects", {
      params: { id: `eq.${projectId}` },
      jsonBody: body,
      headers: { Prefer: "return=representation" },
    });
  }

  async *iter(options?: {
    select?: string;
    order?: string;
    pageSize?: number;
    maxItems?: number;
  }): AsyncGenerator<Project> {
    const fetchPage = (limit: number, offset: number) => {
      const params: Record<string, string | number | undefined> = {
        limit,
        offset,
      };
      if (options?.select) params.select = options.select;
      if (options?.order) params.order = options.order;
      return this.transport.get("/api/db/projects", { params });
    };
    for await (const row of iterTable(fetchPage, {
      pageSize: options?.pageSize ?? 100,
      maxItems: options?.maxItems,
    })) {
      yield fromProject(row);
    }
  }
}
