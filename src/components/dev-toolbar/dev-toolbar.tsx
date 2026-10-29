'use client'

import * as React from 'react'

import { Segmented } from '#/components/ui/segmented'
import { useTheme } from '#/components/v3/lib/theme'
import type { ThemePref } from '#/components/v3/lib/theme'
import { cn } from '#/lib/utils'

import {
  buildDevCss,
  densities,
  devToolbarAvailable,
  exportTokens,
  formatOklch,
  hasOverrides,
  parseOklch,
  tunableTokens,
} from './dev-settings'
import type { DevSettings, Mode, Oklch, TunableToken } from './dev-settings'
import {
  applyDevCss,
  resetDevSettings,
  setDevSwitch,
  updateDevSettings,
  useDevSettings,
  useDevSwitch,
} from './dev-store'

const text = {
  title: 'Dev tools',
  hide: 'Hide',
  appearance: 'Appearance',
  density: 'Density',
  colour: 'Colour tuning',
  colourFor: (mode: Mode) => `Tuning the ${mode} theme`,
  hue: 'Hue',
  chroma: 'Chroma',
  lightness: 'Lightness',
  resetToken: 'Reset',
  outlines: 'Outline every element',
  reduceMotion: 'Turn off animations',
  compare: 'Show my changes',
  resetAll: 'Reset everything',
  copyTokens: 'Copy tuned colours',
  copied: 'Copied',
  noTokens: 'Nothing tuned yet',
  shortcut: 'Ctrl + Alt + D shows or hides this',
} as const

const themeLabels: Record<ThemePref, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
}

function currentMode(): Mode {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

function readToken(token: TunableToken): Oklch {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(
    `--${token}`,
  )
  return parseOklch(raw) ?? { l: 0.5, c: 0.1, h: 250 }
}

/**
 * The toolbar that lives inside the app, after Linear's: tune the theme and
 * density live, compare against the shipped look, and copy the result. Shown in
 * development builds, and in production only to owners and admins who switch it
 * on with Ctrl+Alt+D. Everything it does is local to this browser.
 */
export function DevToolbar({ role }: { role: string | null | undefined }) {
  const settings = useDevSettings()
  const stored = useDevSwitch()
  const dev = import.meta.env.DEV
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])

  // Automated browsers keep clear of the pill unless it was switched on.
  const automated = mounted && navigator.webdriver === true
  const enabled = stored === '1' || (dev && stored === null && !automated)
  const available =
    mounted &&
    !import.meta.env.VITE_PARITY &&
    devToolbarAvailable({ dev, role, enabled })
  const canToggle = dev || devToolbarAvailable({ dev, role, enabled: true })

  React.useEffect(() => {
    applyDevCss(available ? buildDevCss(settings) : '')
  }, [available, settings])

  React.useEffect(() => {
    if (!canToggle) return
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.altKey && event.code === 'KeyD') {
        event.preventDefault()
        setDevSwitch(!enabled)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canToggle, enabled])

  if (!available) return null
  return <Panel settings={settings} />
}

function Panel({ settings }: { settings: DevSettings }) {
  const changed = hasOverrides(settings)
  return (
    <section
      data-dev-toolbar
      aria-label={text.title}
      className="fixed inset-x-0 bottom-0 z-[60] flex h-9 items-center gap-3 overflow-x-auto border-t border-border bg-popover px-3 text-body text-popover-foreground shadow-overlay"
    >
      <span className="flex shrink-0 items-center gap-1.5 text-caption font-medium text-muted-foreground">
        <span
          aria-hidden
          className={cn(
            'size-1.5 rounded-full',
            changed ? 'bg-warning' : 'bg-success',
          )}
        />
        {text.title}
      </span>
      <Divider />
      <AppearanceSection />
      <Segmented
        aria-label={text.density}
        options={[...densities]}
        value={settings.density}
        onChange={(value) =>
          updateDevSettings({ density: value as DevSettings['density'] })
        }
      />
      <Divider />
      <ColourSection settings={settings} />
      <Divider />
      <Check
        label={text.outlines}
        checked={settings.outlines}
        onChange={(outlines) => updateDevSettings({ outlines })}
      />
      <Check
        label={text.reduceMotion}
        checked={settings.reduceMotion}
        onChange={(reduceMotion) => updateDevSettings({ reduceMotion })}
      />
      <div className="ml-auto flex shrink-0 items-center gap-3">
        <Check
          label={text.compare}
          checked={settings.overridesOn}
          onChange={(overridesOn) => updateDevSettings({ overridesOn })}
        />
        <button
          type="button"
          disabled={!changed}
          onClick={resetDevSettings}
          className="text-caption text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          {text.resetAll}
        </button>
        <button
          type="button"
          title={text.shortcut}
          onClick={() => setDevSwitch(false)}
          className="text-caption text-muted-foreground hover:text-foreground"
        >
          {text.hide}
        </button>
      </div>
    </section>
  )
}

function Divider() {
  return <span aria-hidden className="h-4 w-px shrink-0 bg-border" />
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-caption">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-3.5 accent-[var(--primary)]"
      />
      {label}
    </label>
  )
}

function AppearanceSection() {
  const { pref, setPref } = useTheme()
  const labels = Object.values(themeLabels)
  return (
    <Segmented
      aria-label={text.appearance}
      options={labels}
      value={themeLabels[pref]}
      onChange={(label) => {
        const next = (Object.keys(themeLabels) as ThemePref[]).find(
          (key) => themeLabels[key] === label,
        )
        if (next) setPref(next)
      }}
    />
  )
}

function ColourSection({ settings }: { settings: DevSettings }) {
  // Re-render when the appearance changes so the sliders follow the live theme.
  const { pref } = useTheme()
  const [left, setLeft] = React.useState<number | null>(null)
  const open = left !== null
  const [copied, setCopied] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)
  const mode = currentMode()
  void pref
  const tuned =
    Object.keys(settings.tokens.light).length +
      Object.keys(settings.tokens.dark).length >
    0

  React.useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setLeft(null)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLeft(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const setToken = (token: TunableToken, value: Oklch | undefined) => {
    const next = { ...settings.tokens[mode] }
    if (value) next[token] = value
    else delete next[token]
    updateDevSettings({ tokens: { ...settings.tokens, [mode]: next } })
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(exportTokens(settings))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked: nothing else to do */
    }
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={(event) =>
          setLeft(
            open ? null : event.currentTarget.getBoundingClientRect().left,
          )
        }
        className="flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-caption hover:bg-accent"
      >
        <span
          aria-hidden
          className="size-3.5 rounded-sm border border-border"
          style={{ background: 'var(--primary)' }}
        />
        {text.colour}
        {tuned ? (
          <span aria-hidden className="size-1.5 rounded-full bg-warning" />
        ) : null}
      </button>
      {open ? (
        // Fixed, not absolute: the bar scrolls sideways on a narrow screen and
        // would clip a popover positioned inside it.
        <div
          style={{ left: Math.max(8, left) }}
          className="fixed bottom-11 flex w-72 flex-col gap-2 rounded-lg border border-border bg-popover p-3 shadow-dialog"
        >
          <p className="text-caption text-faint-foreground">
            {text.colourFor(mode)}
          </p>
          <div className="flex flex-col gap-1">
            {tunableTokens.map((token) => (
              <TokenRow
                key={token}
                token={token}
                override={settings.tokens[mode][token]}
                onChange={(value) => setToken(token, value)}
              />
            ))}
          </div>
          <button
            type="button"
            disabled={!tuned}
            onClick={copy}
            className="self-start text-caption text-primary-text hover:underline disabled:text-muted-foreground disabled:no-underline"
          >
            {copied ? text.copied : tuned ? text.copyTokens : text.noTokens}
          </button>
        </div>
      ) : null}
    </div>
  )
}

function TokenRow({
  token,
  override,
  onChange,
}: {
  token: TunableToken
  override: Oklch | undefined
  onChange: (value: Oklch | undefined) => void
}) {
  const [expanded, setExpanded] = React.useState(false)
  const value = override ?? readToken(token)
  const sliders: Array<{
    key: keyof Oklch
    label: string
    min: number
    max: number
    step: number
  }> = [
    { key: 'h', label: text.hue, min: 0, max: 360, step: 1 },
    { key: 'c', label: text.chroma, min: 0, max: 0.4, step: 0.005 },
    { key: 'l', label: text.lightness, min: 0, max: 1, step: 0.005 },
  ]
  return (
    <div className="rounded-md border border-border-subtle">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-2 py-1 text-left text-body hover:bg-accent"
      >
        <span
          aria-hidden
          className="size-4 rounded-sm border border-border"
          style={{ background: formatOklch(value) }}
        />
        <span className="flex-1 capitalize">{token}</span>
        {override ? (
          <span aria-hidden className="size-1.5 rounded-full bg-warning" />
        ) : null}
        <span className="font-mono text-caption text-muted-foreground">
          {formatOklch(value).slice(6, -1)}
        </span>
      </button>
      {expanded ? (
        <div className="flex flex-col gap-1.5 border-t border-border-subtle px-2 py-2">
          {sliders.map((slider) => (
            <label
              key={slider.key}
              className="grid grid-cols-[4.5rem_1fr] items-center gap-2 text-caption text-muted-foreground"
            >
              {slider.label}
              <input
                type="range"
                min={slider.min}
                max={slider.max}
                step={slider.step}
                value={value[slider.key]}
                onChange={(event) =>
                  onChange({
                    ...value,
                    [slider.key]: Number(event.target.value),
                  })
                }
                className="accent-[var(--primary)]"
              />
            </label>
          ))}
          <button
            type="button"
            disabled={!override}
            onClick={() => onChange(undefined)}
            className="self-start text-caption text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {text.resetToken}
          </button>
        </div>
      ) : null}
    </div>
  )
}
