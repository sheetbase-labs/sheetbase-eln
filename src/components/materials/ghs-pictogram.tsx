import type { ReactNode } from 'react'

import { pictogramName } from '#/lib/material-safety'
import type { GhsPictogram as GhsCode } from '#/lib/material-safety'
import { cn } from '#/lib/utils'

/**
 * The nine GHS hazard pictograms, drawn as the standard red-bordered diamond with
 * the black symbol. The diamond stays white in the dark theme because it is a
 * physical label: its colours carry the meaning.
 */
const RED = '#d4001a'
const INK = '#111'

const SYMBOLS: Record<GhsCode, ReactNode> = {
  // Exploding bomb.
  GHS01: (
    <>
      <circle cx="46" cy="62" r="13" fill={INK} />
      <path
        d="M54 52 L62 44"
        stroke={INK}
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        d="M66 30 L69 38 L77 35 L72 42 L79 47 L70 47 L69 55 L63 49 L57 54 L58 46 L50 44 L58 40 L56 32 L62 37 Z"
        fill={INK}
      />
    </>
  ),
  // Flame.
  GHS02: (
    <path
      d="M50 24 C52 34 62 40 62 54 C62 62 58 70 50 71 C42 70 38 62 38 54 C38 48 41 44 44 41 C44 47 47 49 49 49 C47 42 48 32 50 24 Z"
      fill={INK}
    />
  ),
  // Flame over a circle.
  GHS03: (
    <>
      <circle cx="50" cy="63" r="10" fill="none" stroke={INK} strokeWidth="5" />
      <path
        d="M50 28 C51.5 36 58 40 58 49 C58 54 55 57 50 57 C45 57 42 54 42 49 C42 45 44 43 46 41 C46 45 48 46.5 49 46.5 C47.5 41 49 34 50 28 Z"
        fill={INK}
      />
      <path d="M34 78 H66" stroke={INK} strokeWidth="4" strokeLinecap="round" />
    </>
  ),
  // Gas cylinder.
  GHS04: (
    <>
      <rect x="41" y="38" width="18" height="38" rx="8" fill={INK} />
      <rect x="46" y="28" width="8" height="12" rx="2" fill={INK} />
      <rect x="42" y="27" width="16" height="4" rx="2" fill={INK} />
      <rect x="42" y="49" width="16" height="3.5" fill="#fff" />
    </>
  ),
  // Corrosion: two vessels dripping on a hand and a bar.
  GHS05: (
    <>
      <path d="M32 28 H46 L44 42 H34 Z" fill={INK} />
      <path d="M54 28 H68 L66 42 H56 Z" fill={INK} />
      <path
        d="M39 47 L39 53 M61 47 L61 56"
        stroke={INK}
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      <path
        d="M30 74 H48 L48 62 C48 59 52 59 52 62 V74 H70"
        fill="none"
        stroke={INK}
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="28" y="76" width="44" height="4" rx="1" fill={INK} />
    </>
  ),
  // Skull and crossbones.
  GHS06: (
    <>
      <path
        d="M32 66 L68 34 M68 66 L32 34"
        stroke={INK}
        strokeWidth="5"
        strokeLinecap="round"
      />
      <path
        d="M50 28 C40 28 35 35 35 43 C35 49 38 52 41 54 V60 H59 V54 C62 52 65 49 65 43 C65 35 60 28 50 28 Z"
        fill="#fff"
        stroke="#fff"
        strokeWidth="5"
        strokeLinejoin="round"
      />
      <path
        d="M50 29 C41 29 36 35 36 43 C36 48 38 51 41 53 V59 H59 V53 C62 51 64 48 64 43 C64 35 59 29 50 29 Z"
        fill={INK}
      />
      <circle cx="44" cy="43" r="4" fill="#fff" />
      <circle cx="56" cy="43" r="4" fill="#fff" />
      <path
        d="M50 47 L47.5 52 H52.5 Z M45 59 V54 M50 59 V55 M55 59 V54"
        fill="#fff"
        stroke="#fff"
        strokeWidth="1.4"
      />
    </>
  ),
  // Exclamation mark.
  GHS07: (
    <>
      <path d="M45.5 26 H54.5 L53 58 H47 Z" fill={INK} />
      <circle cx="50" cy="68" r="5" fill={INK} />
    </>
  ),
  // Health hazard: a figure with a star in the chest.
  GHS08: (
    <>
      <circle cx="50" cy="31" r="7" fill={INK} />
      <path
        d="M36 74 L38 50 C38 43 43 40 50 40 C57 40 62 43 62 50 L64 74 Z"
        fill={INK}
      />
      <path
        d="M50 47 L52.2 52.4 L58 52.8 L53.6 56.6 L55 62.2 L50 59.1 L45 62.2 L46.4 56.6 L42 52.8 L47.8 52.4 Z"
        fill="#fff"
      />
    </>
  ),
  // Environment: a dead tree and a fish.
  GHS09: (
    <>
      <path
        d="M31 52 V36 M31 42 L25 36 M31 46 L37 40"
        stroke={INK}
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M42 60 C48 52 60 52 66 60 C60 68 48 68 42 60 Z M66 60 L74 54 V66 Z"
        fill={INK}
      />
      <circle cx="49" cy="58.5" r="1.6" fill="#fff" />
      <path
        d="M22 74 H78"
        stroke={INK}
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    </>
  ),
}

export function GhsPictogram({
  code,
  size = 28,
  className,
  decorative = false,
}: {
  code: GhsCode
  /** Width and height in pixels. */
  size?: number
  className?: string
  /** True when the name is already shown beside the pictogram. */
  decorative?: boolean
}) {
  const name = pictogramName(code)

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={cn('shrink-0', className)}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative ? true : undefined}
      data-ghs={code}
    >
      {decorative ? null : <title>{name}</title>}
      <path
        d="M50 5 L95 50 L50 95 L5 50 Z"
        fill="#fff"
        stroke={RED}
        strokeWidth="8"
        strokeLinejoin="round"
      />
      {SYMBOLS[code]}
    </svg>
  )
}
