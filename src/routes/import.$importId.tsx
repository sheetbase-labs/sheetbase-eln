import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'

import {
  ImportMapCheckFlow,
  parseImportSearch,
} from '#/components/import/import-flow'
import type { ImportSearch } from '#/components/import/import-flow'

/**
 * R5-SURF-04 — an import is addressable: the path is the retained import
 * file's id (the identity the commit path pins as `p_file_id`), and the search
 * pins the target Dataset, parser and mapping plus the experiment and
 * instrument the receipt records. The map and check steps therefore reload,
 * resume and share by URL, and the server still decides what is valid.
 */
export const Route = createFileRoute('/import/$importId')({
  validateSearch: (search: Record<string, unknown>): ImportSearch =>
    parseImportSearch(search),
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect({ to: '/sign-in' })
    }
    return { context }
  },
  component: ImportMapCheckPage,
})

function ImportMapCheckPage() {
  const { importId } = Route.useParams()
  const search = Route.useSearch()
  const navigate = useNavigate()
  return (
    <ImportMapCheckFlow
      importId={importId}
      search={search}
      onSearch={(next) => {
        void navigate({
          to: '/import/$importId',
          params: { importId },
          search: next,
          replace: true,
        })
      }}
    />
  )
}
