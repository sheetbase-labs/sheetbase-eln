import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import type { ReportingNames } from '#/lib/data-access-handles'
import { useDataAccess } from '#/lib/data-access'
import { notebookDataClient } from '#/lib/notebook-data'

interface ReportingModelRow {
  model_key: string
  model_name: string
  view_name: string
  kind: string
  parent_key: string | null
}

interface ReportingColumnRow {
  model_key: string
  view_name: string
  field_key: string
  column_name: string
  label: string
  sql_type: string
  unit: string | null
  ordinal: number
}

export const dataAccessKeys = {
  models: ['data-access', 'models'] as const,
  columns: ['data-access', 'columns'] as const,
}

/**
 * The names the database gave each model's reporting view and each field's
 * column, for members with data access. Nothing is fetched for anyone else.
 */
export function useReportingNames(): ReportingNames {
  const enabled = useDataAccess()
  const models = useQuery({
    queryKey: dataAccessKeys.models,
    queryFn: () =>
      notebookDataClient.rpc<ReportingModelRow[]>('reporting_models', {}),
    enabled,
    staleTime: 60_000,
  })
  const columns = useQuery({
    queryKey: dataAccessKeys.columns,
    queryFn: () =>
      notebookDataClient.rpc<ReportingColumnRow[]>('reporting_columns', {}),
    enabled,
    staleTime: 60_000,
  })
  return useMemo(() => {
    const views = new Map(
      (models.data ?? []).map((row) => [row.model_key, row.view_name]),
    )
    const names = new Map(
      (columns.data ?? []).map((row) => [
        `${row.model_key}\u0000${row.field_key}`,
        row.column_name,
      ]),
    )
    return {
      viewName: (modelKey) => views.get(modelKey),
      columnName: (modelKey, fieldKey) =>
        names.get(`${modelKey}\u0000${fieldKey}`),
    }
  }, [models.data, columns.data])
}
