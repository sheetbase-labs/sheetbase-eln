/** Licences offered when publishing, with the page that states each one. */
export interface PublicationLicense {
  id: string
  name: string
  url: string
}

export const PUBLICATION_LICENSES: readonly PublicationLicense[] = [
  {
    id: 'cc-by-4.0',
    name: 'Creative Commons Attribution 4.0',
    url: 'https://creativecommons.org/licenses/by/4.0/',
  },
  {
    id: 'cc0-1.0',
    name: 'Creative Commons Zero 1.0 (public domain)',
    url: 'https://creativecommons.org/publicdomain/zero/1.0/',
  },
  {
    id: 'cc-by-sa-4.0',
    name: 'Creative Commons Attribution-ShareAlike 4.0',
    url: 'https://creativecommons.org/licenses/by-sa/4.0/',
  },
  {
    id: 'cc-by-nc-4.0',
    name: 'Creative Commons Attribution-NonCommercial 4.0',
    url: 'https://creativecommons.org/licenses/by-nc/4.0/',
  },
  {
    id: 'odbl-1.0',
    name: 'Open Data Commons Open Database License 1.0',
    url: 'https://opendatacommons.org/licenses/odbl/1-0/',
  },
]

export function licenseById(id: string): PublicationLicense {
  return (
    PUBLICATION_LICENSES.find((l) => l.id === id) ?? {
      id,
      name: id,
      url: `https://spdx.org/licenses/${encodeURIComponent(id)}`,
    }
  )
}
