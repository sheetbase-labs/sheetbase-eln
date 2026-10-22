import { describe, expect, it } from "vitest";
import { SheetbaseClient } from "../src/client.js";
import {
  applyStepSource,
  notebookToPython,
  PermissionDeniedError,
} from "../src/index.js";
import {
  BASE_URL,
  CREDENTIAL,
  createMockFetch,
  type MockRoute,
} from "./helpers.js";

const WS = "11111111-1111-4111-8111-111111111111";
const DEF = "22222222-2222-4222-8222-222222222222";
const CODE = "def transform(inputs, parameters):\n    return inputs['a']\n";

function makeClient(routes: MockRoute[] = []) {
  const fetch = createMockFetch(routes);
  const client = new SheetbaseClient({
    baseUrl: BASE_URL,
    credential: CREDENTIAL,
    scopes: ["pipelines:read", "pipelines:write"],
    fetch,
  });
  return { client, fetch };
}

const config = {
  configVersion: 1,
  pythonRuntime: "sha256:abc",
  transform: { language: "none", statement: "" },
  steps: [{ name: "clean", language: "sql", statement: "select 1" }],
};

describe("PipelinesResource reads", () => {
  it("queries runs, logs and outputs through the table path", async () => {
    const { client, fetch } = makeClient([
      {
        method: "GET",
        path: "/api/db/pipeline_runs",
        handler: () => ({
          status: 200,
          json: [{ id: "r1", status: "failed" }],
        }),
      },
      {
        method: "GET",
        path: "/api/db/pipeline_run_logs",
        handler: () => ({ status: 200, json: [] }),
      },
      {
        method: "GET",
        path: "/api/db/pipeline_run_outputs",
        handler: () => ({ status: 200, json: [] }),
      },
    ]);
    expect(await client.pipelines.getRun("r1")).toEqual({
      id: "r1",
      status: "failed",
    });
    await client.pipelines.runLogs("r1");
    await client.pipelines.runOutputs("r1");
    await client.pipelines.runs({ status: "failed", limit: 5 });
    const urls = fetch.calls
      .map((call) => call.url)
      .filter((url) => url.startsWith("/api/db"));
    expect(urls[0]).toContain("id=eq.r1");
    expect(urls[1]).toContain("run_id=eq.r1");
    expect(urls[1]).toContain("order=sequence.asc");
    expect(urls[3]).toContain("status=eq.failed");
    expect(urls[3]).toContain("limit=5");
  });

  it("finds a pipeline by key or id", async () => {
    const { client, fetch } = makeClient([
      {
        method: "GET",
        path: "/api/db/pipeline_definitions",
        handler: () => ({ status: 200, json: [{ id: DEF }] }),
      },
    ]);
    await client.pipelines.get("nightly");
    await client.pipelines.get(DEF);
    expect(fetch.calls[1].url).toContain("key=eq.nightly");
    expect(fetch.calls[2].url).toContain(`id=eq.${DEF}`);
  });

  it("waits for a run to settle", async () => {
    let calls = 0;
    const { client } = makeClient([
      {
        method: "GET",
        path: "/api/db/pipeline_runs",
        handler: () => ({
          status: 200,
          json: [{ id: "r1", status: ++calls < 3 ? "running" : "succeeded" }],
        }),
      },
    ]);
    const run = await client.pipelines.waitForRun("r1", { intervalMs: 1 });
    expect(run.status).toBe("succeeded");
    expect(calls).toBe(3);
  });

  it("gives up when the run does not settle in time", async () => {
    const { client } = makeClient([
      {
        method: "GET",
        path: "/api/db/pipeline_runs",
        handler: () => ({
          status: 200,
          json: [{ id: "r1", status: "running" }],
        }),
      },
    ]);
    await expect(
      client.pipelines.waitForRun("r1", { timeoutMs: 5, intervalMs: 10 }),
    ).rejects.toThrow(/still running/);
  });
});

describe("PipelinesResource.trigger", () => {
  it("uses the pipeline secret, not the access token, and sends the idempotency key", async () => {
    const { client, fetch } = makeClient([
      {
        method: "POST",
        path: `/api/pipelines/webhook/${DEF}`,
        handler: () => ({
          status: 200,
          json: { runId: "r1", status: "succeeded" },
        }),
      },
    ]);
    const result = await client.pipelines.trigger({
      definitionId: DEF,
      webhookToken: "secret-token",
      idempotencyKey: "batch-7",
      parameters: { n: 1 },
    });
    expect(result).toEqual({ runId: "r1", status: "succeeded" });
    const call = fetch.calls.find((entry) => entry.url.includes("/webhook/"))!;
    expect(call.headers?.Authorization).toBe("Bearer secret-token");
    expect(call.headers?.["Idempotency-Key"]).toBe("batch-7");
    expect(JSON.parse(call.body!)).toEqual({ parameters: { n: 1 } });
    expect(fetch.calls.some((entry) => entry.url === "/api/token")).toBe(false);
  });

  it("returns a failed run instead of throwing, and throws on a refusal", async () => {
    const failing = makeClient([
      {
        method: "POST",
        path: `/api/pipelines/webhook/${DEF}`,
        handler: () => ({
          status: 422,
          json: { runId: "r2", status: "failed" },
        }),
      },
    ]);
    expect(
      await failing.client.pipelines.trigger({
        definitionId: DEF,
        webhookToken: "t",
        idempotencyKey: "k",
      }),
    ).toEqual({ runId: "r2", status: "failed" });

    const refused = makeClient([
      {
        method: "POST",
        path: `/api/pipelines/webhook/${DEF}`,
        handler: () => ({
          status: 403,
          json: { error: "The webhook could not start a run." },
        }),
      },
    ]);
    await expect(
      refused.client.pipelines.trigger({
        definitionId: DEF,
        webhookToken: "t",
        idempotencyKey: "k",
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe("step source", () => {
  it("replaces the main transform or a named step, keeping the rest", () => {
    const main = applyStepSource(config, {
      code: CODE,
      requirements: ["pandas==2.2.2"],
    });
    expect(main.transform).toEqual({ language: "python", statement: CODE });
    expect(main.pythonRequirements).toEqual(["pandas==2.2.2"]);
    expect(config.transform.language).toBe("none");

    const step = applyStepSource(config, { code: CODE, step: "clean" });
    expect(step.steps[0]).toEqual({
      name: "clean",
      language: "python",
      statement: CODE,
    });
  });

  it("refuses sources that cannot run and unknown steps", () => {
    expect(() => applyStepSource(config, { code: "  " })).toThrow(/empty/);
    expect(() => applyStepSource(config, { code: "x = 1" })).toThrow(
      /transform/,
    );
    expect(() => applyStepSource(config, { code: CODE, step: "nope" })).toThrow(
      /no step named/,
    );
  });

  it("needs a runtime pin when the pipeline has none", () => {
    const bare = { ...config, pythonRuntime: undefined };
    expect(() => applyStepSource(bare, { code: CODE })).toThrow(
      /pythonRuntime/,
    );
    expect(
      applyStepSource(bare, { code: CODE, pythonRuntime: "sha256:def" })
        .pythonRuntime,
    ).toBe("sha256:def");
  });

  it("turns a notebook into a script of its code cells", () => {
    const text = notebookToPython({
      cells: [
        { cell_type: "markdown", source: ["# title"] },
        {
          cell_type: "code",
          source: ["%matplotlib inline\n", "import pandas as pd"],
        },
        {
          cell_type: "code",
          source: "def transform(inputs, parameters):\n    return []",
        },
      ],
    });
    expect(text).toBe(
      "# %matplotlib inline\nimport pandas as pd\n\ndef transform(inputs, parameters):\n    return []\n",
    );
    expect(() => notebookToPython({})).toThrow(/no cells/);
  });
});

describe("PipelinesResource.syncStep", () => {
  const version = (lifecycle: string, revision = 3) => ({
    id: "v-" + lifecycle,
    lifecycle,
    version: lifecycle === "draft" ? 2 : 1,
    revision,
    configuration: config,
  });

  it("updates the open draft with its revision", async () => {
    const { client, fetch } = makeClient([
      {
        method: "GET",
        path: "/api/db/pipeline_definition_versions",
        handler: () => ({
          status: 200,
          json: [version("draft"), version("published")],
        }),
      },
      {
        method: "POST",
        path: "/api/db/rpc/update_pipeline_definition_version_draft",
        handler: () => ({ status: 200, json: { id: "v-draft" } }),
      },
    ]);
    const result = await client.pipelines.syncStep({
      workspaceId: WS,
      definitionId: DEF,
      source: { code: CODE },
    });
    expect(result.created).toBe(false);
    const sent = JSON.parse(
      fetch.calls.find((call) => call.url.includes("update_pipeline"))!.body!,
    );
    expect(sent.p_version_id).toBe("v-draft");
    expect(sent.p_expected_revision).toBe(3);
    expect(sent.p_configuration.transform.statement).toBe(CODE);
  });

  it("starts a draft from the latest version when none is open", async () => {
    const { client, fetch } = makeClient([
      {
        method: "GET",
        path: "/api/db/pipeline_definition_versions",
        handler: () => ({ status: 200, json: [version("published")] }),
      },
      {
        method: "POST",
        path: "/api/db/rpc/create_pipeline_definition_version",
        handler: () => ({ status: 200, json: { id: "new" } }),
      },
    ]);
    const result = await client.pipelines.syncStep({
      workspaceId: WS,
      definitionId: DEF,
      source: { code: CODE },
    });
    expect(result.created).toBe(true);
    expect(
      fetch.calls.some((call) => call.url.includes("update_pipeline")),
    ).toBe(false);
  });
});
