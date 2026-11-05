/**
 * iOS has no splash screen from the manifest: it shows a launch image picked
 * by device size, and the page must list one per size. Images live in
 * public/splash, named `<pixel width>x<pixel height>.png`: the dark
 * background (#111111) with a #e9e9e9 mark, matching the dark --background
 * and --foreground in src/styles.css.
 *
 * Always dark: iOS picks the launch image once, when the app is added to the
 * Home Screen, and keeps it whatever the phone's setting later. A light image
 * would flash white for anyone who installed in light mode and now runs dark;
 * a dark one is easy on the eyes in both.
 */
export const SPLASH_SIZES: ReadonlyArray<readonly [number, number, number]> = [
  [430, 932, 3],
  [440, 956, 3],
  [402, 874, 3],
  [393, 852, 3],
  [428, 926, 3],
  [390, 844, 3],
  [414, 896, 3],
  [375, 812, 3],
  [414, 896, 2],
  [375, 667, 2],
  [1024, 1366, 2],
  [834, 1194, 2],
  [820, 1180, 2],
  [834, 1112, 2],
  [768, 1024, 2],
]

export interface SplashLink {
  rel: 'apple-touch-startup-image'
  href: string
  media: string
}

export function splashLinks(): SplashLink[] {
  return SPLASH_SIZES.map(([width, height, ratio]) => ({
    rel: 'apple-touch-startup-image' as const,
    href: `/splash/${width * ratio}x${height * ratio}.png`,
    media: `(device-width: ${width}px) and (device-height: ${height}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: portrait)`,
  }))
}

/**
 * The page background as hex, for the theme-color metas. iOS ignores a
 * theme-color it cannot parse (oklch) and falls back to white. Keep in step
 * with --background in src/styles.css.
 */
export const THEME_COLOURS = { light: '#fdfdff', dark: '#111111' } as const
