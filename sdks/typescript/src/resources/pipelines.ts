/**
 * Pipelines: list them, trigger and watch runs, read logs and outputs, and save
 * a Python step from a local file or notebook as a draft version.
 *
 * Reads need `pipelines:read`. Saving a draft needs `pipelines:write` and a
 * personal token (the database refuses a service credential). A draft is not
 * runnable until a person publishes it.
 */
import type { HttpTransport } from "../http.js";

type Row = Record<string, any>;
type Params = Record<string, string | number | undefined>;

export type PipelineRunStatus =
  "running" | "waiting" | "succeeded" | "failed" | "cancelled";

const SETTLED: PipelineRunStatus[] = ["succeeded", "failed", "cancelled"];

export interface PipelineTriggerResult {
  runId: string;
  /** `running` when the run is still going; `failed` still returns a runId. */
  status: string;
}

export interface PipelineStepSource {
  /** The Python source. It must define `transform(inputs, parameters)`. */
  code: string;
  /** A named step in `steps`; omit to replace the main transform. */
  step?: string;
  /** Pinned `name==version` lines, replacing the pipeline's requirements. */
  requirements?: string[];
  /** The runner's runtime pin (from `/api/pipelines/runtime`) for a pipeline that has none yet. */
  pythonRuntime?: string;
}

/** `.ipynb` JSON to Python: code cells in order, magics and shell lines commented out. */
export function notebookToPython(notebook: unknown): string {
  const cells = (notebook as { cells?: unknown })?.cells;
  if (!Array.isArray(cells)) {
    throw new Error("Not a notebook: it has no cells.");
  }
  const chunks: string[] = [];
  for (const cell of cells as Row[]) {
    if (cell?.cell_type !== "code") continue;
    const source: string = Array.isArray(cell.source)
      ? cell.source.join("")
      : String(cell.source ?? "");
    const lines = source
      .split("\n")
      .map((line) => (/^\s*[%!]/.test(line) ? `# ${line}` : line));
    const text = lines.join("\n").trimEnd();
    if (text) chunks.push(text);
  }
  return chunks.join("\n\n") + "\n";
}

/**
 * Return `configuration` with one Python step's code (and optionally its
 * requirements and runtime pin) replaced. Pure: nothing is sent.
 */
export function checkStepSource(code: string): void {
  if (!code.trim()) throw new Error("The step source is empty.");
  if (!/\bdef\s+transform\s*\(/.test(code)) {
    throw new Error("The source must define transform(inputs, parameters).");
  }
}

export function applyStepSource(
  configuration: Row,
  source: PipelineStepSource,
): Row {
  checkStepSource(source.code);
  const next: Row = structuredClone(configuration);
  if (source.step === undefined) {
    next.transform = {
      ...(next.transform ?? {}),
      language: "python",
      statement: source.code,
    };
  } else {
    const steps: Row[] = Array.isArray(next.steps) ? next.steps : [];
    const index = steps.findIndex((entry) => entry.name === source.step);
    if (index < 0) {
      throw new Error(`The pipeline has no step named "${source.step}".`);
    }
    steps[index] = {
      ...steps[index],
      language: "python",
      statement: source.code,
    };
    next.steps = steps;
  }
  if (source.requirements !== undefined) {
    next.pythonRequirements = source.requirements;
  }
  if (!next.pythonRuntime) {
    if (!source.pythonRuntime) {
      throw new Error(
        "This pipeline has no Python runtime pinned yet; pass pythonRuntime (see GET /api/pipelines/runtime).",
      );
    }
    next.pythonRuntime = source.pythonRuntime;
  } else if (source.pythonRuntime) {
    next.pythonRuntime = source.pythonRuntime;
  }
  return next;
}

export class PipelinesResource {
  constructor(private transport: HttpTransport) {}

  async list(options?: { params?: Params }): Promise<Row[]> {
    return this.transport.get("/api/db/pipeline_definitions", {
      params: { order: "key.asc", ...options?.params },
    });
  }

  /** A pipeline by `id`, or by `key` when a workspace has more than one. */
  async get(idOrKey: string): Promise<Row | null> {
    const column = /^[0-9a-f-]{36}$/i.test(idOrKey) ? "id" : "key";
    const rows: Row[] = await this.transport.get(
      "/api/db/pipeline_definitions",
      {
        params: { [column]: `eq.${idOrKey}`, limit: 1 },
      },
    );
    return rows[0] ?? null;
  }

  async versions(definitionId: string): Promise<Row[]> {
    return this.transport.get("/api/db/pipeline_definition_versions", {
      params: { definition_id: `eq.${definitionId}`, order: "version.desc" },
    });
  }

  async runs(options?: {
    definitionVersionId?: string;
    status?: PipelineRunStatus;
    limit?: number;
  }): Promise<Row[]> {
    return this.transport.get("/api/db/pipeline_runs", {
      params: {
        order: "started_at.desc",
        limit: options?.limit ?? 50,
        definition_version_id: options?.definitionVersionId
          ? `eq.${options.definitionVersionId}`
          : undefined,
        status: options?.status ? `eq.${options.status}` : undefined,
      },
    });
  }

  async getRun(runId: string): Promise<Row | null> {
    const rows: Row[] = await this.transport.get("/api/db/pipeline_runs", {
      params: { id: `eq.${runId}`, limit: 1 },
    });
    return rows[0] ?? null;
  }

  /** Ordered log entries; a Python step's carry `detail.logs` and `detail.line`. */
  async runLogs(runId: string): Promise<Row[]> {
    return this.transport.get("/api/db/pipeline_run_logs", {
      params: { run_id: `eq.${runId}`, order: "sequence.asc" },
    });
  }

  async runOutputs(runId: string): Promise<Row[]> {
    return this.transport.get("/api/db/pipeline_run_outputs", {
      params: { run_id: `eq.${runId}`, order: "created_at.asc" },
    });
  }

  /**
   * Start a run of the pipeline's published version through its webhook.
   *
   * `webhookToken` is the pipeline's own secret (shown once when the webhook is
   * enabled in the app), not your API credential. Repeating a call with the same
   * `idempotencyKey` and inputs returns the same run instead of starting another.
   */
  async trigger(params: {
    definitionId: string;
    webhookToken: string;
    idempotencyKey: string;
    parameters?: Record<string, unknown>;
    inputVersions?: Record<string, string>;
  }): Promise<PipelineTriggerResult> {
    const jsonBody: Record<string, unknown> = {};
    if (params.parameters !== undefined)
      jsonBody.parameters = params.parameters;
    if (params.inputVersions !== undefined) {
      jsonBody.inputVersions = params.inputVersions;
    }
    const { body } = await this.transport.sendWithBearer(
      "POST",
      `/api/pipelines/webhook/${params.definitionId}`,
      params.webhookToken,
      { jsonBody, headers: { "Idempotency-Key": params.idempotencyKey } },
    );
    return body as PipelineTriggerResult;
  }

  /** Poll until the run settles (or `timeoutMs` passes) and return its row. */
  async waitForRun(
    runId: string,
    options?: { timeoutMs?: number; intervalMs?: number },
  ): Promise<Row> {
    const deadline = Date.now() + (options?.timeoutMs ?? 300_000);
    const interval = options?.intervalMs ?? 2_000;
    for (;;) {
      const run = await this.getRun(runId);
      if (!run) throw new Error(`Run ${runId} was not found.`);
      if (SETTLED.includes(run.status)) return run;
      if (Date.now() + interval > deadline) {
        throw new Error(`Run ${runId} is still ${run.status}.`);
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }

  async createDraft(params: {
    workspaceId: string;
    definitionId: string;
    configuration: Row;
  }): Promise<Row> {
    return this.transport.post(
      "/api/db/rpc/create_pipeline_definition_version",
      {
        jsonBody: {
          p_workspace_id: params.workspaceId,
          p_definition_id: params.definitionId,
          p_configuration: params.configuration,
        },
      },
    );
  }

  async saveDraft(params: {
    workspaceId: string;
    versionId: string;
    expectedRevision: number | string;
    configuration: Row;
  }): Promise<Row> {
    return this.transport.post(
      "/api/db/rpc/update_pipeline_definition_version_draft",
      {
        jsonBody: {
          p_workspace_id: params.workspaceId,
          p_version_id: params.versionId,
          p_expected_revision: params.expectedRevision,
          p_configuration: params.configuration,
        },
      },
    );
  }

  /**
   * Put local Python (a script's text, or a notebook via `notebookToPython`) into
   * a pipeline step as a draft. It updates the open draft if there is one,
   * otherwise starts a new draft from the latest version. Nothing is published.
   */
  async syncStep(params: {
    workspaceId: string;
    definitionId: string;
    source: PipelineStepSource;
  }): Promise<{ version: Row; created: boolean }> {
    checkStepSource(params.source.code);
    const versions = await this.versions(params.definitionId);
    const draft = versions.find((entry) => entry.lifecycle === "draft");
    const base = draft ?? versions[0];
    if (!base) throw new Error("The pipeline has no version to start from.");
    const configuration = applyStepSource(base.configuration, params.source);
    if (draft) {
      const version = await this.saveDraft({
        workspaceId: params.workspaceId,
        versionId: draft.id,
        expectedRevision: draft.revision,
        configuration,
      });
      return { version, created: false };
    }
    const version = await this.createDraft({
      workspaceId: params.workspaceId,
      definitionId: params.definitionId,
      configuration,
    });
    return { version, created: true };
  }
}
