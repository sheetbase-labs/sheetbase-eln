/**
 * iOS has no splash screen from the manifest: it shows a launch image picked
 * by device size, and the page must list one per size. Images live in
 * public/splash, one light and one dark per size, named
 * `<pixel width>x<pixel height>-<light|dark>.png`.
 *
 * Colours match --background and --foreground in src/styles.css: light is
 * #fdfdff with a #111111 mark, dark is #111111 with a #e9e9e9 mark.
 *
 * iOS picks the launch image once, when the app is added to the Home Screen,
 * using the light or dark setting at that moment. Changing the phone's
 * setting later does not change it; removing and re-adding the app does.
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
  return SPLASH_SIZES.flatMap(([width, height, ratio]) =>
    (['light', 'dark'] as const).map((scheme) => ({
      rel: 'apple-touch-startup-image' as const,
      href: `/splash/${width * ratio}x${height * ratio}-${scheme}.png`,
      media: `(device-width: ${width}px) and (device-height: ${height}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: portrait) and (prefers-color-scheme: ${scheme})`,
    })),
  )
}
