/**
 * The tab icon must contrast with the browser's tab strip, which follows the
 * browser's light/dark setting, not the in-app theme. The adaptive
 * `favicon.svg` carries its own `prefers-color-scheme` rule, but some browsers
 * (Safari, Chrome with a theme set apart from the OS) draw it in a light
 * context and the black mark vanishes on a dark tab. This inline script asks
 * the page's own media query instead and points the SVG icon at a fixed light
 * or dark file, and follows the setting if it changes while the tab is open.
 */
export const FAVICON_LIGHT_UI = '/favicon.svg'
export const FAVICON_DARK_UI = '/favicon-dark.svg'

export const faviconScript = `(function(){try{var q=window.matchMedia('(prefers-color-scheme: dark)');var s=function(){var l=document.querySelector('link[rel="icon"][type="image/svg+xml"]');if(l)l.setAttribute('href',q.matches?'${FAVICON_DARK_UI}':'${FAVICON_LIGHT_UI}');};s();q.addEventListener('change',s);}catch(e){}})();`
