import { Link } from '@tanstack/react-router'
import { t } from '#/copy'

export function InheritedChangeOn({
  source,
}: {
  source: { id: string; name: string }
}) {
  return (
    <Link
      to="/models/$modelId"
      params={{ modelId: source.id }}
      className="text-link hover:underline"
    >
      {t('library.models.inheritedFieldsTable.changeOn', { name: source.name })}
    </Link>
  )
}
