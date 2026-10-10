import { Link, useLocation, useMatches } from '@tanstack/react-router'
import { EmptyState } from '#/components/v3/ui/empty-state'

// Record layouts that already render a page header (and its h1) above their tabs.
const LAYOUTS = [
  '/_app/experiments/$expId',
  '/_app/datasets/$datasetId',
  '/_app/models/$modelId',
  '/_app/samples/$sampleId',
  '/_app/projects/$projectId',
  '/_app/pipelines/$pipelineId',
  '/_app/templates/$templateId',
]

// Unknown route or an ID that isn't in the demo data. Inside a record layout it renders without its own h1.
export function NotFound() {
  const { pathname } = useLocation()
  const nested = useMatches().some(
    (m) => LAYOUTS.includes(m.routeId) && m.status === 'success',
  )
  const body = (
    <EmptyState
      icon="search"
      title={
        nested ? (
          'Not in the demo data'
        ) : (
          <span className="mono text-body font-normal">{pathname}</span>
        )
      }
      className="pt-3"
      body={
        nested
          ? 'This part of the record isn’t in the demo data yet.'
          : 'There’s nothing at this address, or the record isn’t in the demo data yet.'
      }
    >
      <Link to="/">Go to Home</Link>
      <Link to="/search" search={{}}>
        Search
      </Link>
    </EmptyState>
  )
  if (nested)
    return <div className="flex-1 overflow-auto px-8 py-2">{body}</div>
  return (
    <div className="flex-1 overflow-auto px-8 py-6">
      <h1 className="text-title">Not found</h1>
      {body}
    </div>
  )
}
