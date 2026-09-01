/**
 * Bulk transfer with provenance — a representative TypeScript domain workflow.
 *
 * 1. Resolve field labels from the dataset's schema version for readability.
 * 2. Bulk-upload measurement rows with batched, revision-chained commits.
 * 3. Download the rows back as expanded records.
 * 4. Read a record's revision history for its audit/provenance trail.
 *
 * Field IDs stay the canonical identifiers; the server remains authoritative
 * for validation, permissions and revision semantics.
 */
import { SheetbaseClient } from "@sheetbase/eln-sdk";

const BASE_URL = "https://app.sheetbase.co.uk";
const CREDENTIAL = "sb_01234567_...";
const DATASET_ID = "770e8400-e29b-41d4-a716-446655440020";
const TITER_FIELD = "fff00000-0000-0000-0000-000000000001";

async function main(): Promise<void> {
  const client = new SheetbaseClient({
    baseUrl: BASE_URL,
    credential: CREDENTIAL,
    scopes: ["datasets:read", "datasets:write", "projects:read"],
  });

  try {
    const dataset = await client.datasets.get(DATASET_ID);

    // 1. Field labels are display convenience; commits still use field IDs.
    const labels = await client.datasets.fieldLabelMap(dataset.schemaVersionId);

    // 2. Bulk upload — batches commit sequentially and chain revisions.
    const measurements: Array<Record<string, unknown>> = [
      { rowId: "aaa11111-2222-3333-4444-555555555501", [TITER_FIELD]: 1.2e9 },
      { rowId: "aaa11111-2222-3333-4444-555555555502", [TITER_FIELD]: 8.5e8 },
      { [TITER_FIELD]: 9.1e8 },
    ];
    const results = await client.datasets.uploadRecords(
      DATASET_ID,
      dataset.revision,
      measurements,
      { batchSize: 500, idempotencyKey: "purification-run-042" },
    );
    const finalRevision = results[results.length - 1]!.datasetRevision;
    console.log(`Uploaded ${measurements.length} rows; dataset at revision ${finalRevision}`);

    // 3. Download expanded records with labelled keys.
    const records = await client.datasets.downloadRecords(DATASET_ID, {
      fieldLabels: labels,
    });
    console.log(
      `Downloaded ${records.length} records; first titer: ${records[0]![labels[TITER_FIELD]!]}`,
    );

    // 4. Provenance: the record's immutable revision trail.
    const history = await client.records.history(DATASET_ID, { limit: 5 });
    for (const revision of history) {
      console.log(
        `  revision ${revision.id} (${revision.reason}) digest=${revision.integrityDigest}`,
      );
    }

    // Freeze the uploaded state as an immutable Dataset Version.
    const version = await client.datasets.snapshot(
      DATASET_ID,
      finalRevision,
      "run 042 upload",
    );
    console.log(`Frozen version ${version.id} pins revision ${version.sourceDatasetRevision}`);
  } finally {
    client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
