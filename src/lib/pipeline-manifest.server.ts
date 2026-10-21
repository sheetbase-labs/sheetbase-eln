/**
 * Signed pipeline run manifests.
 *
 * A succeeded run leaves a manifest: the pinned definition version, every input
 * Dataset Version with a digest of the rows the transform actually saw, the
 * parameters, the steps run and the output with a digest of the rows written.
 * The manifest is hashed (SHA-256 over canonical JSON), signed with the
 * deployment's Ed25519 key when one is configured, and chained to the
 * workspace's previous manifest. `verifyRunManifest` needs only the manifest,
 * the signature and the public key, so an auditor can check a run offline.
 *
 * What a manifest does not cover: effects. Actions and webhooks are recorded by
 * name; replaying a run replays its inputs, not its side effects.
 */
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from 'node:crypto'
import type { KeyObject } from 'node:crypto'

import type { QueryResultRow } from 'pg'

import { env } from '#/env.server'

export const MANIFEST_SCHEMA = 'sheetbase.pipeline-run-manifest/1'
export const SIGNATURE_ALGORITHM = 'ed25519'

export interface ManifestInput {
  name: string
  datasetId: string | null
  datasetVersionId: string
  schemaVersionId: string | null
  rowCount: number
  /** SHA-256 over the per-row digests of the rows in `_sb_row_id` order. */
  contentDigest: string
}

export interface ManifestStep {
  index: number
  name: string
  language: string
  statementDigest: string
}

export interface RunManifest {
  schema: typeof MANIFEST_SCHEMA
  run: {
    id: string
    workspaceId: string
    attempt: number
    retryOfRunId: string | null
    triggerKind: string
    triggerOccurrenceId: string | null
    scheduleId: string | null
    actorUserId: string | null
    inputDigest: string | null
    finishedAt: string | null
  }
  definition: {
    name: string
    versionId: string
    versionNumber: number
    configurationDigest: string
  }
  parameters: Record<string, unknown>
  inputs: ManifestInput[]
  steps: ManifestStep[]
  decisions: Array<{
    step: string
    decision: string | null
    answeredBy: string | null
    answeredAt: string | null
    valuesDigest: string | null
  }>
  outputs: {
    mode: string
    datasetId: string | null
    datasetVersionId: string | null
    label: string | null
    rowCount: number
    contentDigest: string
  }
  actions: Array<{ name: string; operation: string }>
  executor: { artifactVersion: string; sandboxRole: 'pipeline_sandbox' }
}

export interface StoredManifest {
  runId: string
  workspaceId: string
  sequence: number
  manifest: RunManifest
  manifestDigest: string
  previousDigest: string | null
  signature: string | null
  signatureAlgorithm: string | null
  keyId: string | null
  signedAt: string
}

interface ManifestConnection {
  query: <T extends QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: T[] }>
}

// ---------------------------------------------------------------------------
// Canonical form and digests.
// ---------------------------------------------------------------------------

/** JSON with object keys sorted at every depth: one byte string per value. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      !(v instanceof Date)
    ) {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
          a < b ? -1 : a > b ? 1 : 0,
        ),
      )
    }
    return v
  })
}

export function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

/**
 * Digest a result set independently of row order: each row's canonical JSON is
 * hashed, the hashes are sorted and hashed again. A transform without ORDER BY
 * may return rows in any order, which must not change the evidence.
 */
export function digestRows(rows: Array<Record<string, unknown>>): string {
  const hashes = rows.map((row) => sha256Hex(canonicalJson(row))).sort()
  return sha256Hex(hashes.join('\n'))
}

export function digestManifest(manifest: RunManifest): string {
  return sha256Hex(canonicalJson(manifest))
}

// ---------------------------------------------------------------------------
// Keys and signatures.
// ---------------------------------------------------------------------------

export interface SigningKey {
  privateKey: KeyObject
  publicKey: KeyObject
  keyId: string
}

/** First 16 hex characters of the SHA-256 of the public key's DER encoding. */
export function keyIdFor(publicKey: KeyObject): string {
  return sha256Hex(publicKey.export({ type: 'spki', format: 'der' })).slice(
    0,
    16,
  )
}

/**
 * The configured signing key, or null when the deployment has none. The value
 * is an Ed25519 private key in PKCS#8 PEM; `\n` escapes (as a single-line
 * environment variable would carry them) are accepted.
 */
export function loadSigningKey(
  pem: string | undefined = env.PIPELINE_MANIFEST_SIGNING_KEY,
): SigningKey | null {
  if (!pem) return null
  const privateKey = createPrivateKey(pem.replaceAll('\\n', '\n'))
  if (privateKey.asymmetricKeyType !== 'ed25519')
    throw new Error('PIPELINE_MANIFEST_SIGNING_KEY must be an Ed25519 key.')
  const publicKey = createPublicKey(privateKey)
  return { privateKey, publicKey, keyId: keyIdFor(publicKey) }
}

export function signDigest(digest: string, key: SigningKey): string {
  return sign(null, Buffer.from(digest, 'hex'), key.privateKey).toString(
    'base64',
  )
}

export interface ManifestVerification {
  /** The stored digest matches the manifest content. */
  digestMatches: boolean
  /** The signature verifies under the supplied public key; null when unsigned. */
  signatureValid: boolean | null
  /** The chain link matches the previous manifest's digest, when one is given. */
  chainValid: boolean | null
}

/**
 * Verify a stored manifest offline. `previousDigest` is the digest of the
 * manifest one sequence earlier in the same workspace, when the caller has it.
 */
export function verifyRunManifest(
  stored: Pick<
    StoredManifest,
    'manifest' | 'manifestDigest' | 'previousDigest' | 'signature'
  >,
  publicKeyPem: string | null,
  previousDigest?: string | null,
): ManifestVerification {
  const digestMatches =
    digestManifest(stored.manifest) === stored.manifestDigest
  let signatureValid: boolean | null = null
  if (stored.signature) {
    signatureValid = false
    if (publicKeyPem && digestMatches) {
      try {
        signatureValid = verify(
          null,
          Buffer.from(stored.manifestDigest, 'hex'),
          createPublicKey(publicKeyPem),
          Buffer.from(stored.signature, 'base64'),
        )
      } catch {
        signatureValid = false
      }
    }
  }
  const chainValid =
    previousDigest === undefined
      ? null
      : (stored.previousDigest ?? null) === previousDigest
  return { digestMatches, signatureValid, chainValid }
}

// ---------------------------------------------------------------------------
// Building and recording.
// ---------------------------------------------------------------------------

export interface ManifestRunContext {
  id: string
  workspace_id: string
  attempt: number
  retry_of_run_id: string | null
  trigger_kind: string
  trigger_occurrence_id: string | null
  schedule_id: string | null
  actor_user_id: string | null
  input_digest: string | null
  parameters: Record<string, unknown>
  input_versions: Record<string, string>
  version_number: number
  configuration: Record<string, unknown>
  definition_name: string
  definition_version_id: string
}

export interface ManifestBuildInput {
  run: ManifestRunContext
  /** The temp table names the run's inputs were materialized under. */
  inputNames: string[]
  steps: Array<{ name: string; language: string; statement: string }>
  output: {
    mode: string
    datasetId: string | null
    datasetVersionId: string | null
    label: string | null
  }
  rows: Array<Record<string, unknown>>
  actions: Array<{ name: string; operation: string }>
  finishedAt: string | null
}

function quote(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}

/** Digest of one materialized input table, in a stable row order. */
async function digestInput(
  conn: ManifestConnection,
  name: string,
): Promise<{ rowCount: number; contentDigest: string }> {
  const { rows } = await conn.query<{ n: string; digest: string | null }>(
    `SELECT count(*)::text AS n,
            encode(sha256(convert_to(
              coalesce(string_agg(
                encode(sha256(convert_to(row_to_json(t)::text, 'UTF8')), 'hex'),
                '' ORDER BY t."_sb_row_id"), ''),
              'UTF8')), 'hex') AS digest
       FROM pg_temp.${quote(name)} t`,
  )
  return {
    rowCount: Number(rows[0]?.n ?? 0),
    contentDigest: rows[0]?.digest ?? sha256Hex(''),
  }
}

export async function buildRunManifest(
  conn: ManifestConnection,
  input: ManifestBuildInput,
  artifactVersion: string = env.SHEETBASE_ARTIFACT_VERSION,
): Promise<RunManifest> {
  const { run } = input
  const inputs: ManifestInput[] = []
  for (const name of input.inputNames) {
    const versionId = run.input_versions[name]
    const { rows } = await conn.query<{
      dataset_id: string | null
      schema_version_id: string | null
    }>(
      `SELECT dataset_id, schema_version_id FROM api.dataset_versions WHERE id = $1`,
      [versionId],
    )
    const digest = await digestInput(conn, name)
    inputs.push({
      name,
      datasetId: rows[0]?.dataset_id ?? null,
      datasetVersionId: versionId,
      schemaVersionId: rows[0]?.schema_version_id ?? null,
      ...digest,
    })
  }
  const { rows: decisionRows } = await conn.query<{
    step_id: string
    answer: Record<string, unknown> | null
    answered_by_user_id: string | null
    answered_at: Date | null
  }>(
    `SELECT step_id, answer, answered_by_user_id, answered_at
       FROM api.pipeline_run_prompts
      WHERE run_id = $1 AND answer IS NOT NULL
      ORDER BY answered_at, step_id`,
    [run.id],
  )
  return {
    schema: MANIFEST_SCHEMA,
    run: {
      id: run.id,
      workspaceId: run.workspace_id,
      attempt: run.attempt,
      retryOfRunId: run.retry_of_run_id,
      triggerKind: run.trigger_kind,
      triggerOccurrenceId: run.trigger_occurrence_id,
      scheduleId: run.schedule_id,
      actorUserId: run.actor_user_id,
      inputDigest: run.input_digest,
      finishedAt: input.finishedAt,
    },
    definition: {
      name: run.definition_name,
      versionId: run.definition_version_id,
      versionNumber: run.version_number,
      configurationDigest: sha256Hex(canonicalJson(run.configuration)),
    },
    parameters: run.parameters,
    inputs,
    steps: input.steps.map((step, index) => ({
      index: index + 1,
      name: step.name,
      language: step.language,
      statementDigest: sha256Hex(step.statement),
    })),
    decisions: decisionRows.map((row) => ({
      step: row.step_id,
      decision:
        typeof row.answer?.decision === 'string' ? row.answer.decision : null,
      answeredBy: row.answered_by_user_id,
      answeredAt: row.answered_at ? row.answered_at.toISOString() : null,
      valuesDigest: row.answer?.values
        ? sha256Hex(canonicalJson(row.answer.values))
        : null,
    })),
    outputs: {
      mode: input.output.mode,
      datasetId: input.output.datasetId,
      datasetVersionId: input.output.datasetVersionId,
      label: input.output.label,
      rowCount: input.rows.length,
      contentDigest: digestRows(input.rows),
    },
    actions: input.actions,
    executor: { artifactVersion, sandboxRole: 'pipeline_sandbox' },
  }
}

/**
 * Write the run's manifest as the next entry in its workspace's chain. Call it
 * in the transaction that completes the run and while the workspace execution
 * lock is held, so the sequence and the previous digest cannot interleave.
 */
export async function recordRunManifest(
  conn: ManifestConnection,
  input: ManifestBuildInput,
  key: SigningKey | null = loadSigningKey(),
): Promise<StoredManifest> {
  const manifest = await buildRunManifest(conn, input)
  const manifestDigest = digestManifest(manifest)
  const { rows: tip } = await conn.query<{
    sequence: string
    manifest_digest: string
  }>(
    `SELECT m.sequence::text AS sequence, m.manifest_digest
       FROM api.pipeline_run_manifests m
      WHERE m.workspace_id = $1 ORDER BY m.sequence DESC LIMIT 1`,
    [input.run.workspace_id],
  )
  const sequence = Number(tip[0]?.sequence ?? 0) + 1
  const previousDigest = tip[0]?.manifest_digest ?? null
  const signature = key ? signDigest(manifestDigest, key) : null
  const { rows } = await conn.query<{ signed_at: Date }>(
    `INSERT INTO api.pipeline_run_manifests
       (run_id, workspace_id, sequence, manifest, manifest_digest,
        previous_digest, signature, signature_algorithm, key_id)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9)
     RETURNING signed_at`,
    [
      input.run.id,
      input.run.workspace_id,
      sequence,
      JSON.stringify(manifest),
      manifestDigest,
      previousDigest,
      signature,
      key ? SIGNATURE_ALGORITHM : null,
      key?.keyId ?? null,
    ],
  )
  return {
    runId: input.run.id,
    workspaceId: input.run.workspace_id,
    sequence,
    manifest,
    manifestDigest,
    previousDigest,
    signature,
    signatureAlgorithm: key ? SIGNATURE_ALGORITHM : null,
    keyId: key?.keyId ?? null,
    signedAt: rows[0].signed_at.toISOString(),
  }
}
