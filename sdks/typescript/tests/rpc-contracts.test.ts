import { describe, expect, it } from "vitest";
import { SheetbaseClient } from "../src/client.js";
import { BASE_URL, CREDENTIAL, createMockFetch, type MockRoute } from "./helpers.js";

function makeClient(paths: string[]) {
  const routes: MockRoute[] = paths.map((path) => ({
    method: "POST",
    path,
    handler: () => ({ status: 200, json: {} }),
  }));
  const fetch = createMockFetch(routes);
  const client = new SheetbaseClient({
    baseUrl: BASE_URL,
    credential: CREDENTIAL,
    scopes: [],
    fetch,
  });
  const body = (path: string) =>
    JSON.parse(fetch.calls.find((call) => call.url === path)!.body!);
  return { client, body };
}

describe("RPC resource contracts", () => {
  it("sends record mutation parameters", async () => {
    const paths = [
      "/api/db/rpc/archive_record",
      "/api/db/rpc/transition_record_status",
      "/api/db/rpc/create_record_link",
    ];
    const { client, body } = makeClient(paths);
    await client.records.archive("record", 3);
    await client.records.transitionStatus("record", "complete", 4);
    await client.records.createLink({
      sourceRecordId: "source",
      targetKind: "experiment",
      targetIdentifier: "EXP-1",
      linkType: "related",
    });
    expect(body(paths[0])).toEqual({ p_record_id: "record", p_expected_metadata_version: 3 });
    expect(body(paths[1])).toEqual({
      p_record_id: "record",
      p_target_status: "complete",
      p_expected_metadata_version: 4,
    });
    expect(body(paths[2])).toEqual({
      p_source_record_id: "source",
      p_target_kind: "experiment",
      p_target_identifier: "EXP-1",
      p_link_type: "related",
      p_target_record_id: null,
      p_label: null,
    });
  });

  it("sends dataset archive revision", async () => {
    const path = "/api/db/rpc/archive_dataset";
    const { client, body } = makeClient([path]);
    await client.datasets.archive("dataset", 7);
    expect(body(path)).toEqual({ p_dataset_id: "dataset", p_expected_revision: 7 });
  });

  it("sends sheet create, update, archive and materialize parameters", async () => {
    const paths = [
      "/api/db/rpc/create_sheet_instance",
      "/api/db/rpc/update_sheet_instance",
      "/api/db/rpc/archive_sheet_instance",
      "/api/db/rpc/materialize_sheet_instance",
    ];
    const { client, body } = makeClient(paths);
    await client.sheets.create({ workspaceId: "workspace", name: "Sheet", state: { rows: [] } });
    await client.sheets.update("sheet", 2, { rows: [1] });
    await client.sheets.archive("sheet", 3);
    await client.sheets.materialize({
      instanceId: "sheet",
      expectedInstanceRevision: 4,
      outputName: "Output",
      outputSchemaVersionId: "schema",
      previewDigest: "digest",
      idempotencyKey: "key",
    });
    expect(body(paths[0])).toEqual({
      p_workspace_id: "workspace", p_name: "Sheet", p_description: null,
      p_source_definition_version_id: null, p_project_id: null,
      p_notebook_record_id: null, p_state: { rows: [] },
    });
    expect(body(paths[1])).toEqual({ p_instance_id: "sheet", p_expected_revision: 2, p_state: { rows: [1] } });
    expect(body(paths[2])).toEqual({ p_instance_id: "sheet", p_expected_revision: 3 });
    expect(body(paths[3])).toEqual({
      p_instance_id: "sheet", p_expected_instance_revision: 4, p_output_name: "Output",
      p_output_schema_version_id: "schema", p_preview_digest: "digest", p_idempotency_key: "key",
    });
  });

  it("sends sheet local-state and calculation mutation parameters", async () => {
    const paths = [
      "/api/db/rpc/mutate_sheet_instance_local_state",
      "/api/db/rpc/mutate_sheet_instance_calculations",
    ];
    const { client, body } = makeClient(paths);
    const cells = [{ rowKey: "row", fieldId: "field", value: 1 }];
    await client.sheets.mutateLocalState({
      instanceId: "sheet", expectedRevision: 2, retryToken: "retry",
      fieldChanges: [{ name: "x" }], rows: [{ key: "row" }], cells,
    });
    await client.sheets.mutateCalculations({
      instanceId: "sheet", expectedRevision: 3, retryToken: "retry-2", changes: [{ op: "add" }],
    });
    expect(body(paths[0])).toEqual({
      p_instance_id: "sheet", p_expected_revision: 2, p_retry_token: "retry",
      p_field_changes: [{ name: "x" }], p_rows: [{ key: "row" }], p_cells: cells,
    });
    expect(body(paths[1])).toEqual({
      p_instance_id: "sheet", p_expected_revision: 3,
      p_retry_token: "retry-2", p_changes: [{ op: "add" }],
    });
  });

  it("sends notebook template parameters", async () => {
    const paths = [
      "/api/db/rpc/instantiate_notebook_template_version",
      "/api/db/rpc/preview_notebook_template_upgrade",
      "/api/db/rpc/apply_notebook_template_upgrade",
    ];
    const { client, body } = makeClient(paths);
    await client.catalogues.instantiateTemplate({
      versionId: "version", targetProjectId: "project", title: "Notebook",
      parameterInputs: { sample: 1 }, idempotencyKey: "key",
    });
    await client.catalogues.previewTemplateUpgrade("record", "target");
    await client.catalogues.applyTemplateUpgrade({
      recordId: "record", expectedStructureVersion: 5, targetVersionId: "target",
      decisions: { keep: true }, parameterInputs: { sample: 2 },
    });
    expect(body(paths[0])).toEqual({
      p_version_id: "version", p_target_project_id: "project", p_title: "Notebook",
      p_parameter_inputs: { sample: 1 }, p_idempotency_key: "key",
    });
    expect(body(paths[1])).toEqual({ p_record_id: "record", p_target_version_id: "target" });
    expect(body(paths[2])).toEqual({
      p_record_id: "record", p_expected_structure_version: 5, p_target_version_id: "target",
      p_decisions: { keep: true }, p_parameter_inputs: { sample: 2 },
    });
  });
});
