import { ICONS } from '#/components/icons'
import type { IconName } from '#/components/icons'

/** A plugin's icon name if the app has an icon by that name, otherwise the plug. */
export function pluginIcon(name: string | undefined): IconName {
  return name && Object.hasOwn(ICONS, name) ? (name as IconName) : 'plug'
}
