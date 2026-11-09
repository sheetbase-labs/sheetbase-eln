import type { RequestRow, RequestStatus } from '#/lib/requests'
import type { Tone } from '#/components/ui/status'

export function statusTone(status: RequestStatus): Tone {
  switch (status) {
    case 'requested':
      return 'warn'
    case 'accepted':
      return 'progress'
    case 'completed':
      return 'ok'
    default:
      return 'none'
  }
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value.trim()

  if (typeof value === 'number') return String(value)

  if (typeof value === 'boolean') return value ? 'Yes' : 'No'

  return ''
}

/** The answers the form collected, labelled, in the order they were set. */
export function requestDetails(
  request: RequestRow,
  fieldLabels: Map<string, string>,
): Array<[string, string]> {
  return Object.entries(request.custom_fields ?? {})
    .map(([key, value]): [string, string] => [
      fieldLabels.get(key) ?? key,
      asText(value),
    ])
    .filter(([, value]) => value !== '')
}

/** The one line a list shows beside a title: the first few answers. */
export function requestSummary(request: RequestRow): string {
  return Object.values(request.custom_fields ?? {})
    .map(asText)
    .filter((value) => value !== '')
    .slice(0, 3)
    .join(' · ')
}

export function requestText(request: RequestRow, asker: string): string {
  return [request.identifier, request.title, asker, requestSummary(request)]
    .join(' ')
    .toLowerCase()
}
