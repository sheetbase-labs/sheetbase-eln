/**
 * INT-03B — generic S3-compatible inbound connector adapter (server-only).
 *
 * Not AWS-specific: any S3-compatible object store (MinIO, Cloudflare R2,
 * Ceph, on-prem gateways) via custom endpoint + path-style addressing.
 * Reuses the INT-01 connector framework — runs, sealed secrets, provenance,
 * retry/idempotency — through the shared enterprise adapter seam. No second
 * integration framework.
 *
 * Safety model:
 *  - all network access happens server-side; the browser only receives
 *    metadata (keys, sizes, versions) and bounded previews;
 *  - credentials come from the sealed connector-secret subsystem and are
 *    decrypted only inside trusted server execution;
 *  - endpoint URLs pass the connector host policy before any request;
 *  - ETag is treated as opaque metadata — never assumed to be an MD5;
 *  - downloads are byte-capped and flow through the canonical file platform
 *    before parsing, so retained evidence is not just the external object.
 */
import {
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3'

import { parseS3Config } from './config-validation'
import { serverConnectorRunObservability } from '../observability.server'
import { ConnectorExecutionError, boundedErrorMessage } from './errors'
import {
  ConnectorEndpointError,
  validateConnectorEndpointUrl,
} from './host-policy.server'
import type {
  ConnectorAdapterContext,
  ConnectorImportRequest,
  EnterpriseConnectorAdapter,
} from './adapter'
import { retainExternalBytes } from './retain.server'
import { ingestExternalPayload } from '../tabular-ingestion'
import { registerParser } from '../registry'
import { parseImportText } from '#/lib/import-parse'
import { sha256Hex } from '../digest'
import type {
  S3ConnectorConfig,
  S3DiscoveryPage,
  S3ObjectDescriptor,
} from './types'

/** Stable parser identity for plain delimited S3 objects (provenance only). */
export const S3_PARSER_IDENTITY = 'sheetbase.delimited@1'

export { parseS3Config } from './config-validation'

function s3Client(
  source: S3ConnectorConfig,
  secrets: Record<string, string>,
): S3Client {
  return new S3Client({
    region: source.region || 'us-east-1',
    endpoint: source.endpoint,
    forcePathStyle: source.forcePathStyle ?? Boolean(source.endpoint),
    credentials: {
      accessKeyId: secrets['access_key_id'] ?? '',
      secretAccessKey: secrets['secret_access_key'] ?? '',
      sessionToken: secrets['session_token'] || undefined,
    },
    requestHandler: {
      requestTimeout: 30_000,
    } as never,
  })
}

/** Map any SDK failure onto a bounded, safe error code + message. */
function mapS3Error(error: unknown, code: string): ConnectorExecutionError {
  const name = (error as { name?: string } | null)?.name ?? ''
  const status = Number(
    (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata
      ?.httpStatusCode ?? 0,
  )
  const message = boundedErrorMessage(error)
  if (status === 403 || name === 'Forbidden' || /AccessDenied/i.test(message)) {
    return new ConnectorExecutionError(
      'source_forbidden',
      'Access to the source was denied by the object store.',
    )
  }
  if (
    status === 404 ||
    name === 'NotFound' ||
    /404|NoSuchBucket|NoSuchKey/i.test(message)
  ) {
    return new ConnectorExecutionError(
      'source_not_found',
      'The configured bucket or object was not found.',
    )
  }
  if (/InvalidAccessKeyId|SignatureDoesNotMatch|token/i.test(message)) {
    return new ConnectorExecutionError(
      'authentication_failed',
      'The stored credentials were rejected by the object store.',
    )
  }
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|getaddrinfo/i.test(message)) {
    return new ConnectorExecutionError(
      'connection_failed',
      'The object store could not be reached.',
    )
  }
  if (error instanceof ConnectorEndpointError) {
    return new ConnectorExecutionError('invalid_destination', error.message)
  }
  return new ConnectorExecutionError(code, message)
}

function keyUnderPrefix(key: string, prefix?: string): boolean {
  return !prefix || key.startsWith(prefix)
}

export const s3Adapter: EnterpriseConnectorAdapter<S3ConnectorConfig> = {
  id: 's3',
  requiredSecrets: ['access_key_id', 'secret_access_key'],
  optionalSecrets: ['session_token'],

  parseConfig: parseS3Config,

  async testConnection(
    context: ConnectorAdapterContext,
    source: S3ConnectorConfig,
  ) {
    try {
      validateConnectorEndpointUrl(
        source.endpoint ?? `https://${source.bucket}.s3.amazonaws.com`,
      )
      const client = s3Client(source, context.secrets)
      await client.send(new HeadBucketCommand({ Bucket: source.bucket }))
      // Prefix accessibility is proven by a bounded listing when configured.
      if (source.prefix) {
        const page = await client.send(
          new ListObjectsV2Command({
            Bucket: source.bucket,
            Prefix: source.prefix,
            MaxKeys: 1,
          }),
        )
        return {
          detail: {
            bucket: source.bucket,
            prefix: source.prefix,
            prefixPopulated: (page.Contents?.length ?? 0) > 0,
          },
        }
      }
      return { detail: { bucket: source.bucket } }
    } catch (error) {
      throw mapS3Error(error, 'connection_failed')
    }
  },

  async discover(context, source, query): Promise<S3DiscoveryPage> {
    const maxKeys = Math.min(Math.max(Number(query['maxKeys'] ?? 50), 1), 100)
    const continuationToken =
      typeof query['continuationToken'] === 'string' &&
      query['continuationToken']
        ? query['continuationToken']
        : undefined
    try {
      const client = s3Client(source, context.secrets)
      const page = await client.send(
        new ListObjectsV2Command({
          Bucket: source.bucket,
          Prefix: source.prefix,
          MaxKeys: maxKeys,
          ContinuationToken: continuationToken,
        }),
      )
      const objects: S3ObjectDescriptor[] = (page.Contents ?? [])
        .filter(
          (object) => object.Key && keyUnderPrefix(object.Key, source.prefix),
        )
        .map((object) => ({
          key: object.Key as string,
          byteSize: object.Size ?? 0,
          lastModified: object.LastModified?.toISOString() ?? null,
          contentType: null,
          // ListObjectsV2 does not surface version ids; version-aware
          // listing (ListObjectVersions) is deliberately out of INT-03
          // scope. GetObject still returns the version id for provenance.
          versionId: null,
          // Opaque metadata only: ETags are not guaranteed to be MD5s.
          etag: (object.ETag ?? '').replace(/"/g, '') || null,
        }))
      return {
        objects,
        // IsTruncated=false ⇒ null: the listing is complete.
        continuationToken: page.IsTruncated
          ? (page.NextContinuationToken ?? null)
          : null,
      }
    } catch (error) {
      throw mapS3Error(error, 'discovery_failed')
    }
  },

  async preview(context, source, selector) {
    // S3 has no server-side row query; preview = download + local parse of a
    // bounded text object (the same bytes the import retains).
    const download = await downloadObject(context, source, selector, {
      previewByteCap: 512 * 1024,
    })
    return parsePreviewBytes(download)
  },

  async ingest(
    context: ConnectorAdapterContext,
    source: S3ConnectorConfig,
    request: ConnectorImportRequest<Record<string, unknown>>,
  ) {
    const key =
      typeof request.source['key'] === 'string' ? request.source['key'] : ''
    const versionId =
      typeof request.source['versionId'] === 'string'
        ? request.source['versionId']
        : ''
    if (!key || !keyUnderPrefix(key, source.prefix)) {
      throw new ConnectorExecutionError(
        'source_not_found',
        'Choose an object under the configured prefix.',
      )
    }
    const projectId =
      typeof request.projectId === 'string' && request.projectId
        ? request.projectId
        : ''
    if (!projectId) {
      throw new ConnectorExecutionError(
        'no_target',
        'Choose a project to retain the source object in.',
      )
    }

    // The governed run starts FIRST; download, retention, parsing and commit
    // all happen inside it, so connection/auth/download/limit failures are
    // recorded as failed runs with bounded codes. The canonical content-aware
    // request digest is established inside the attempt before commit, so a
    // changed object under the same key is a new logical request and an
    // identical object replays the prior result without duplicating the
    // retained file.
    let downloaded: S3Download | null = null
    return ingestExternalPayload(context.client, {
      workspaceId: context.workspaceId,
      connectorId: context.connector.id,
      connectorType: 'storage',
      observability: serverConnectorRunObservability,
      parserIdentity: S3_PARSER_IDENTITY,
      sheetName: key,
      selectorSource: {
        kind: 's3_object',
        bucket: source.bucket,
        key,
        versionId: versionId || null,
      },
      resolveContent: async (log) => {
        await log('source', `Downloading ${key} from ${source.bucket}.`)
        const download = await downloadObject(
          context,
          source,
          request.source,
          {},
        )
        // Retained for the retention stage; the digest was established over
        // exactly these bytes.
        downloaded = download
        const checksum = await sha256Hex(download.bytes)
        return {
          parse: () => parseObjectText(download.text),
          parseErrorCode: 'parse_failed',
          source: {
            kind: 's3_object',
            bucket: source.bucket,
            key,
            versionId: download.versionId ?? (versionId || null),
            etag: download.etag,
            lastModified: download.lastModified,
            contentSha256: checksum,
          },
          contentSha256: checksum,
          byteSize: download.bytes.byteLength,
        }
      },
      retain: async (log, contentSha256) => {
        const download = downloaded
        if (!download) {
          throw new ConnectorExecutionError(
            'download_failed',
            'The source object was not read before retention.',
          )
        }
        const retained = await retainExternalBytes({
          workspaceId: context.workspaceId,
          projectId,
          fileName: key.split('/').pop() || key,
          mediaType: download.contentType ?? 'application/octet-stream',
          bytes: download.bytes,
          rpc: (name, args) => context.client.rpc(name, args),
          readFileObject: context.readFileObject,
        })
        void log
        void contentSha256
        return {
          fileRecordId: retained.fileRecordId,
          checksum: retained.checksum,
          byteSize: retained.byteSize,
        }
      },
      target: request.target,
      mappings: request.mappings,
      resultKind: 's3_import',
      metadataResultKey: 'contentMetadata',
      nameResultKey: 'sheetName',
    }).then((result) => ({
      runId: result.runId,
      attempt: result.attempt,
      alreadyCompleted: result.alreadyCompleted,
      rowCount: result.rowCount,
      datasetId: result.datasetId,
      datasetRevision: result.datasetRevision,
    }))
  },
}

interface S3Download {
  bytes: Uint8Array
  text: string
  contentType: string | null
  etag: string | null
  versionId: string | null
  lastModified: string | null
}

/**
 * Read a bounded byte stream, aborting as soon as the cap is exceeded. Never
 * buffers an untrusted external object beyond the configured cap: the reader
 * stops consuming (and destroys the stream) at cap + 1 bytes.
 */
export async function readBoundedBytes(
  body: AsyncIterable<Uint8Array> & { destroy?: () => void },
  cap: number,
  what: string,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for await (const chunk of body) {
      total += chunk.byteLength
      if (total > cap) {
        throw new ConnectorExecutionError(
          'row_limit_exceeded',
          `The source object exceeds the ${cap}-byte ${what} cap; the read was stopped at the cap.`,
        )
      }
      chunks.push(chunk)
    }
  } finally {
    // Stop the transfer as soon as we stop consuming (cap exceeded or error).
    body.destroy?.()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

async function downloadObject(
  context: ConnectorAdapterContext,
  source: S3ConnectorConfig,
  selector: Record<string, unknown>,
  options: { previewByteCap: number } | { previewByteCap?: undefined },
): Promise<S3Download> {
  const key = typeof selector['key'] === 'string' ? selector['key'] : ''
  if (!key || key.includes('..')) {
    throw new ConnectorExecutionError(
      'source_not_found',
      'Choose a valid object key.',
    )
  }
  if (!keyUnderPrefix(key, source.prefix)) {
    throw new ConnectorExecutionError(
      'source_forbidden',
      'The object is outside the configured prefix.',
    )
  }
  const versionId =
    typeof selector['versionId'] === 'string'
      ? selector['versionId']
      : undefined
  const cap = options.previewByteCap ?? context.limits.maxObjectBytes
  const what = options.previewByteCap ? 'preview' : 'import'
  try {
    const client = s3Client(source, context.secrets)
    const response = await client.send(
      new GetObjectCommand({
        Bucket: source.bucket,
        Key: key,
        VersionId: versionId,
      }),
    )
    if (!response.Body) {
      throw new ConnectorExecutionError(
        'download_failed',
        'The object bytes could not be read.',
      )
    }
    // Fail before reading when the store already declares the size.
    if (
      typeof response.ContentLength === 'number' &&
      response.ContentLength > cap
    ) {
      throw new ConnectorExecutionError(
        'row_limit_exceeded',
        `The source object is ${response.ContentLength} bytes and exceeds the ${cap}-byte ${what} cap.`,
      )
    }
    // Otherwise stream with an enforced cap: the read stops at the cap.
    const bytes = await readBoundedBytes(
      response.Body as AsyncIterable<Uint8Array> & { destroy?: () => void },
      cap,
      what,
    )
    return {
      bytes,
      text: new TextDecoder().decode(bytes),
      contentType: response.ContentType ?? null,
      etag: (response.ETag ?? '').replace(/"/g, '') || null,
      versionId: response.VersionId ?? null,
      lastModified: response.LastModified?.toISOString() ?? null,
    }
  } catch (error) {
    if (error instanceof ConnectorExecutionError) throw error
    throw mapS3Error(error, 'download_failed')
  }
}

/** Bounded local parse used by preview. */
export function parsePreviewBytes(download: S3Download) {
  const parsed = parseObjectText(download.text)
  return {
    columns: parsed.headers,
    rows: parsed.rows.slice(0, 100),
    truncated: parsed.rows.length > 100,
    metadata: parsed.metadata,
  }
}

export function parseObjectText(text: string) {
  try {
    const preview = parseImportText(text, { header: true })
    const sheet = preview.sheets[0]
    return {
      headers: sheet.headers,
      rows: sheet.rows,
      metadata: { format: preview.format } as Record<string, string>,
      warnings: [],
    }
  } catch (error) {
    if (error instanceof Error && /Import exceeds/.test(error.message)) {
      throw new ConnectorExecutionError(
        'row_limit_exceeded',
        'The source object exceeds the row cap for one import.',
      )
    }
    throw error
  }
}

// Register the provenance parser identity used by S3 imports. Pure text →
// sheet, matching the INT-01 parser contract (no network, no side effects).
registerParser({
  parserId: 'sheetbase.delimited',
  version: 1,
  label: 'Delimited text (CSV/TSV)',
  parse: (text) => parseObjectText(text),
})
