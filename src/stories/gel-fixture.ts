/**
 * An inline SVG of a gel for the image annotation stories, so they need no
 * file. Its colours are the picture's pixels, not UI, which is why it lives in
 * a .ts module the colour check does not read for hex.
 */
export const GEL = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="320" viewBox="0 0 560 320">
    <rect width="560" height="320" fill="#1b2433"/>
    ${[0.15, 0.3, 0.45, 0.6, 0.75, 0.9]
      .map(
        (x, i) =>
          `<rect x="${x * 560 - 22}" y="${70 + i * 6}" width="44" height="10" rx="3" fill="#d8e2f0" opacity="0.85"/>
           <rect x="${x * 560 - 22}" y="${170 - i * 8}" width="44" height="8" rx="3" fill="#d8e2f0" opacity="0.55"/>`,
      )
      .join('')}
  </svg>`,
)}`
