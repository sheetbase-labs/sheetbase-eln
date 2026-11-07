/**
 * Open tables, ontology lookup and publishing as the app reads and changes
 * them. Each function is a thin wrapper over one RPC or one table read.
 */
import type { DataClient } from '#/lib/data-client'

type Rpc = Pick<DataClient, 'rpc'>
type Lister = Pick<DataClient, 'list'>

export interface LakeSettings {
  enabled: boolean
  exporterUserId: string | null
  lastRunAt: string | null
  lastStatus: string | null
  lastError: string | null
  refreshRequestedAt: string | null
  canIssueLogins: boolean
  tableCount: number
}

export interface LakeColumn {
  name: string
  type: string
}

export interface LakeTable {
  id: string
  source_kind: 'model_view' | 'dataset'
  source_label: string
  table_name: string
  status: 'pending' | 'ready' | 'failed' | 'retired'
  row_count: number
  byte_size: number
  file_count: number
  columns: LakeColumn[]
  snapshots: { snapshot_id: number; at: string }[]
  last_snapshot_at: string | null
  last_error: string | null
}

export interface LakeLogin {
  id: string
  name: string
  username: string
  created_at: string
  expires_at: string | null
  revoked_at: string | null
  last_used_at: string | null
  status: 'active' | 'expired' | 'revoked' | 'suspended'
}

export interface LakeLoginSecret {
  id: string
  username: string
  secret: string
  expires_at: string | null
}

export interface OntologySettings {
  enabled: boolean
  ontologies: string[]
}

export interface OntologyAnnotation {
  id: string
  target_kind:
    'model_field' | 'schema_field' | 'definition_field' | 'vocabulary_term'
  target_id: string
  ontology: string
  iri: string
  short_form: string | null
  label: string
}

export interface OntologyTermHit {
  iri: string
  label: string
  ontology: string
  shortForm?: string | null
  description?: string | null
}

export type RepositoryKind = 'zenodo' | 'invenio' | 'figshare' | 'dataverse'

export interface PublicationTarget {
  id: string
  kind: RepositoryKind
  name: string
  base_url: string
  collection: string | null
  license: string
  enabled: boolean
  token_set: boolean
}

export type PublicationStatus =
  | 'queued'
  | 'sending'
  | 'draft'
  | 'publishing'
  | 'published'
  | 'failed'
  | 'discarded'

export interface Publication {
  id: string
  target_id: string
  object_kind: 'experiment' | 'dataset_version'
  object_id: string
  title: string
  license: string
  status: PublicationStatus
  doi: string | null
  record_url: string | null
  draft_url: string | null
  package_name: string | null
  package_bytes: number | null
  includes_run_crate: boolean
  last_error: string | null
  created_at: string
  published_at: string | null
}

export const openDataKeys = {
  lake: (ws: string) => ['lake-settings', ws] as const,
  lakeTables: (ws: string) => ['lake-tables', ws] as const,
  lakeLogins: (ws: string) => ['lake-logins', ws] as const,
  ontology: (ws: string) => ['ontology-settings', ws] as const,
  annotations: (kind: string, id: string) =>
    ['ontology-annotations', kind, id] as const,
  targets: (ws: string) => ['publication-targets', ws] as const,
  publications: (kind: string, id: string) =>
    ['publications', kind, id] as const,
}

export const fetchLakeSettings = (c: Rpc, ws: string) =>
  c.rpc<LakeSettings>('lake_settings', { p_workspace_id: ws })

export const setLakeSettings = (c: Rpc, ws: string, enabled: boolean) =>
  c.rpc<LakeSettings>('set_lake_settings', {
    p_workspace_id: ws,
    p_enabled: enabled,
  })

export const requestLakeRefresh = (c: Rpc, ws: string) =>
  c.rpc<LakeSettings>('request_lake_refresh', { p_workspace_id: ws })

export const fetchLakeTables = (c: Lister) =>
  c.list<LakeTable>(
    'lake_tables',
    '?select=id,source_kind,source_label,table_name,status,row_count,byte_size,file_count,columns,snapshots,last_snapshot_at,last_error&status=neq.retired&order=table_name.asc',
  )

export const fetchLakeLogins = (c: Rpc, ws: string) =>
  c.rpc<LakeLogin[]>('list_lake_credentials', { p_workspace_id: ws })

export async function createLakeLogin(
  c: Rpc,
  ws: string,
  input: { name: string; expiresAt: string | null },
): Promise<LakeLoginSecret> {
  const rows = await c.rpc<LakeLoginSecret[] | LakeLoginSecret>(
    'create_lake_credential',
    {
      p_workspace_id: ws,
      p_name: input.name,
      p_expires_at: input.expiresAt,
    },
  )
  return Array.isArray(rows) ? rows[0] : rows
}

export const revokeLakeLogin = (c: Rpc, ws: string, id: string) =>
  c.rpc<void>('revoke_lake_credential', {
    p_workspace_id: ws,
    p_credential_id: id,
  })

export const fetchOntologySettings = (c: Rpc, ws: string) =>
  c.rpc<OntologySettings>('ontology_settings', { p_workspace_id: ws })

export const setOntologySettings = (
  c: Rpc,
  ws: string,
  input: { enabled: boolean; ontologies?: string[] | null },
) =>
  c.rpc<OntologySettings>('set_ontology_settings', {
    p_workspace_id: ws,
    p_enabled: input.enabled,
    p_ontologies: input.ontologies ?? null,
  })

export const fetchAnnotations = (c: Lister, kind: string, id: string) =>
  c.list<OntologyAnnotation>(
    'ontology_annotations',
    `?select=id,target_kind,target_id,ontology,iri,short_form,label&target_kind=eq.${kind}&target_id=eq.${id}&order=created_at.asc`,
  )

export const linkOntologyTerm = (
  c: Rpc,
  input: {
    workspaceId: string
    kind: OntologyAnnotation['target_kind']
    targetId: string
    term: OntologyTermHit
  },
) =>
  c.rpc<OntologyAnnotation>('link_ontology_term', {
    p_workspace_id: input.workspaceId,
    p_target_kind: input.kind,
    p_target_id: input.targetId,
    p_ontology: input.term.ontology,
    p_iri: input.term.iri,
    p_label: input.term.label,
    p_short_form: input.term.shortForm ?? null,
  })

export const unlinkOntologyTerm = (c: Rpc, id: string) =>
  c.rpc<void>('unlink_ontology_term', { p_annotation_id: id })

export async function searchOntology(
  query: string,
  signal?: AbortSignal,
): Promise<OntologyTermHit[]> {
  const res = await fetch(
    `/api/ontology/search?q=${encodeURIComponent(query)}`,
    { signal },
  )
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      message?: string
    } | null
    throw new Error(body?.message ?? 'Ontology search is not available.')
  }
  return ((await res.json()) as { terms: OntologyTermHit[] }).terms
}

export const fetchPublicationTargets = (c: Lister) =>
  c.list<PublicationTarget>(
    'publication_targets',
    '?select=id,kind,name,base_url,collection,license,enabled,token_set&order=name.asc',
  )

export const savePublicationTarget = (
  c: Rpc,
  input: {
    workspaceId: string
    id: string | null
    kind: RepositoryKind
    name: string
    baseUrl: string
    collection: string | null
    license: string
    enabled: boolean
  },
) =>
  c.rpc<PublicationTarget>('save_publication_target', {
    p_workspace_id: input.workspaceId,
    p_id: input.id,
    p_kind: input.kind,
    p_name: input.name,
    p_base_url: input.baseUrl,
    p_collection: input.collection,
    p_license: input.license,
    p_enabled: input.enabled,
  })

export const deletePublicationTarget = (c: Rpc, id: string) =>
  c.rpc<void>('delete_publication_target', { p_id: id })

const PUBLICATION_SELECT =
  'id,target_id,object_kind,object_id,title,license,status,doi,record_url,draft_url,package_name,package_bytes,includes_run_crate,last_error,created_at,published_at'

export const fetchPublications = (c: Lister, kind: string, objectId: string) =>
  c.list<Publication>(
    'publications',
    `?select=${PUBLICATION_SELECT}&object_kind=eq.${kind}&object_id=eq.${objectId}&order=created_at.desc`,
  )

export const requestPublication = (
  c: Rpc,
  input: {
    targetId: string
    kind: Publication['object_kind']
    objectId: string
    title: string
    license: string
  },
) =>
  c.rpc<Publication>('request_publication', {
    p_target_id: input.targetId,
    p_object_kind: input.kind,
    p_object_id: input.objectId,
    p_title: input.title,
    p_license: input.license,
  })

export const publishPublication = (c: Rpc, id: string) =>
  c.rpc<Publication>('publish_publication', { p_id: id })
export const discardPublication = (c: Rpc, id: string) =>
  c.rpc<Publication>('discard_publication', { p_id: id })
export const retryPublication = (c: Rpc, id: string) =>
  c.rpc<Publication>('retry_publication', { p_id: id })

/** Connection snippets for the three common engines. Data-access roles only. */
export function lakeSnippets(input: {
  workspaceId: string
  appUrl: string
  host: string
  port: number
  database: string
  username: string
  secret: string
}) {
  const hex = input.workspaceId.replace(/-/g, '')
  const filesUrl = `${input.appUrl.replace(/\/$/, '')}/api/lake/files/${input.workspaceId}/`
  const catalogue = `ducklake:postgres:dbname=${input.database} host=${input.host} port=${input.port} user=${input.username} password=${input.secret}`
  const duckdb = `INSTALL ducklake; INSTALL postgres; INSTALL httpfs;
CREATE SECRET lab_files (TYPE http, BEARER_TOKEN '${input.secret}');
ATTACH '${catalogue}' AS lab (
  DATA_PATH '${filesUrl}',
  OVERRIDE_DATA_PATH true,
  METADATA_SCHEMA 'lake_${hex}',
  READ_ONLY
);
SELECT * FROM lab.main.<table> LIMIT 10;`
  const polars = `import duckdb

con = duckdb.connect()
con.sql("""
${duckdb.replace('SELECT * FROM lab.main.<table> LIMIT 10;', '')}
""")
df = con.sql("SELECT * FROM lab.main.<table>").pl()  # a Polars DataFrame`
  const spark = `# Spark reads the Parquet files DuckDB lists for a table. Fetch them with the
# same login (an Authorization: Bearer header) or let DuckDB hand Spark a copy:
import duckdb

con = duckdb.connect()
con.sql("""
${duckdb.replace('SELECT * FROM lab.main.<table> LIMIT 10;', "COPY (SELECT * FROM lab.main.<table>) TO '/tmp/<table>.parquet';")}
""")
df = spark.read.parquet("/tmp/<table>.parquet")`
  return { duckdb, polars, spark, filesUrl }
}
