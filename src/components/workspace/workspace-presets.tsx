import { currentPlatform, formatShortcut } from '#/lib/shortcuts'
import type { LayoutPreset } from '#/lib/pane-tree'
import { t } from '#/copy'

const shortcut = (binding: string) => formatShortcut(binding, currentPlatform())

/** A 14px picture of how a preset tiles its panes. */
export function LayoutGlyph({ preset }: { preset: LayoutPreset }) {
  const frame = <rect x="1.5" y="2.5" width="11" height="9" rx="1.5" />

  const lines: Record<LayoutPreset, string> = {
    single: '',
    'columns-2': 'M7 2.5v9',
    'columns-3': 'M5.2 2.5v9M8.8 2.5v9',
    'primary-context': 'M8.5 2.5v9M8.5 7h4',
    'rows-2': 'M1.5 7h11',
  }

  return (
    <svg
      className="mx-glyph"
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      aria-hidden="true"
    >
      {frame}
      {lines[preset] ? <path d={lines[preset]} /> : null}
    </svg>
  )
}

const PRESETS: {
  preset: LayoutPreset
  label: string
  binding?: string
}[] = [
  {
    preset: 'single',
    label: t('projects.workspaceBar.presets.single'),
    binding: 'mod+shift+enter',
  },
  {
    preset: 'columns-2',
    label: t('projects.workspaceBar.presets.columns2'),
    binding: 'mod+\\',
  },
  {
    preset: 'columns-3',
    label: t('projects.workspaceBar.presets.columns3'),
  },
  {
    preset: 'primary-context',
    label: t('projects.workspaceBar.presets.primaryContext'),
  },
  {
    preset: 'rows-2',
    label: t('projects.workspaceBar.presets.rows2'),
    binding: 'mod+shift+\\',
  },
]

/** The layout-preset picker: one glyph button per tiling, pressed where active. */
export function WorkspacePresets({
  preset,
  maximized,
  onPreset,
}: {
  preset: LayoutPreset | null
  maximized: boolean
  onPreset: (preset: LayoutPreset) => void
}) {
  return (
    <span
      className="mx-presets"
      role="group"
      aria-label={t('projects.workspaceBar.layoutPresets')}
    >
      {PRESETS.map((item) => {
        const pressed =
          item.preset === 'single'
            ? maximized
            : !maximized && preset === item.preset

        return (
          <button
            key={item.preset}
            type="button"
            className="mx-preset"
            aria-pressed={pressed}
            aria-label={item.label}
            title={
              item.binding
                ? t('projects.workspaceBar.shortcutTitle', {
                    label: item.label,
                    shortcut: shortcut(item.binding),
                  })
                : item.label
            }
            onClick={() => onPreset(item.preset)}
          >
            <LayoutGlyph preset={item.preset} />
          </button>
        )
      })}
    </span>
  )
}
