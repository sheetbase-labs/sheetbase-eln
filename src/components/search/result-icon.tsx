import { Icon } from '#/components/icons'
import { searchResultIconName } from './result-icon-name'
import type { IconResult } from './result-icon-name'

export function SearchResultIcon({ result }: { result: IconResult }) {
  return (
    <Icon
      name={searchResultIconName(result)}
      size={14}
      className="text-fg-muted"
      aria-hidden
    />
  )
}
