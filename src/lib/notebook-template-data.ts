import { z } from 'zod'

import { createDataClient } from './data-client'
import type { DataClient } from './data-client'
import {
  parseNotebookTemplateConfiguration,
  type NotebookTemplateConfiguration,
} from './notebook-template'
import { parameterUuidSchema } from './parameter'

const uuid = parameterUuidSchema
const timestamp = z.string().datetime({ offset: true })
const revision = z
  .union([z.number(), z.string().regex(/^\d+$/)])
  .transform(Number)
  .pipe(z.number().int().positive().safe())

export const notebookTemplateWireSchema = z
  .object({
    id: uuid,
    workspace_id: uuid,
    key: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    lifecycle: z.enum(['active', 'retired']),
    revision,
    created_at: timestamp,
    updated_at: timestamp,
    created_by_user_id: z.string().nullable(),
    updated_by_user_id: z.string().nullable(),
  })
  .strict()

export const notebookTemplateVersionWireSchema = z
  .object({
    id: uuid,
    template_id: uuid,
    version: z.number().int().positive(),
    lifecycle: z.enum(['draft', 'published', 'retired']),
    configuration_format_version: z.literal(1),
    configuration: z.unknown(),
    revision,
    created_at: timestamp,
    updated_at: timestamp,
    created_by_user_id: z.string().nullable(),
    updated_by_user_id: z.string().nullable(),
    published_at: timestamp.nullable(),
    published_by_user_id: z.string().nullable(),
    retired_at: timestamp.nullable(),
    retired_by_user_id: z.string().nullable(),
  })
  .strict()

export type NotebookTemplate = {
  id: string
  workspaceId: string
  key: string
  name: string
  description: string | null
  lifecycle: 'active' | 'retired'
  revision: number
  createdAt: string
  updatedAt: string
}

export type NotebookTemplateVersion = {
  id: string
  templateId: string
  version: number
  lifecycle: 'draft' | 'published' | 'retired'
  configuration: NotebookTemplateConfiguration
  revision: number
  publishedAt: string | null
}

export const notebookTemplateDataClient = createDataClient()

export function notebookTemplateFromWire(wire: unknown): NotebookTemplate {
  const parsed = notebookTemplateWireSchema.parse(wire)
  return {
    id: parsed.id,
    workspaceId: parsed.workspace_id,
    key: parsed.key,
    name: parsed.name,
    description: parsed.description,
    lifecycle: parsed.lifecycle,
    revision: parsed.revision,
    createdAt: parsed.created_at,
    updatedAt: parsed.updated_at,
  }
}

export function notebookTemplateVersionFromWire(
  wire: unknown,
): NotebookTemplateVersion {
  const parsed = notebookTemplateVersionWireSchema.parse(wire)
  return {
    id: parsed.id,
    templateId: parsed.template_id,
    version: parsed.version,
    lifecycle: parsed.lifecycle,
    configuration: parseNotebookTemplateConfiguration(parsed.configuration),
    revision: parsed.revision,
    publishedAt: parsed.published_at,
  }
}

export async function fetchNotebookTemplates(
  client: DataClient = notebookTemplateDataClient,
) {
  const rows = await client.list<unknown>(
    'notebook_templates',
    '?order=name.asc,id.asc',
  )
  return rows.map(notebookTemplateFromWire)
}

export async function fetchNotebookTemplateVersions(
  templateId: string,
  client: DataClient = notebookTemplateDataClient,
) {
  const rows = await client.list<unknown>(
    'notebook_template_versions',
    `?template_id=eq.${encodeURIComponent(templateId)}&order=version.asc`,
  )
  return rows.map(notebookTemplateVersionFromWire)
}

export async function createNotebookTemplate(
  input: {
    workspaceId: string
    key: string
    name: string
    description?: string | null
    configuration: NotebookTemplateConfiguration
  },
  client: DataClient = notebookTemplateDataClient,
) {
  const result = await client.rpc<{ template: unknown; version: unknown }>(
    'create_notebook_template',
    {
      p_workspace_id: input.workspaceId,
      p_key: input.key,
      p_name: input.name,
      p_description: input.description ?? null,
      p_configuration: input.configuration,
    },
  )
  return {
    template: notebookTemplateFromWire(result.template),
    version: notebookTemplateVersionFromWire(result.version),
  }
}

export async function publishNotebookTemplateVersion(
  versionId: string,
  expectedRevision: number,
  client: DataClient = notebookTemplateDataClient,
) {
  const row = await client.rpc<unknown>('publish_notebook_template_version', {
    p_version_id: versionId,
    p_expected_revision: expectedRevision,
  })
  return notebookTemplateVersionFromWire(row)
}

export async function createNotebookTemplateVersion(
  templateId: string,
  expectedTemplateRevision: number,
  configuration: NotebookTemplateConfiguration,
  client: DataClient = notebookTemplateDataClient,
) {
  const row = await client.rpc<unknown>('create_notebook_template_version', {
    p_template_id: templateId,
    p_expected_template_revision: expectedTemplateRevision,
    p_configuration: configuration,
  })
  return notebookTemplateVersionFromWire(row)
}
