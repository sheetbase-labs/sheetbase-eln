/**
 * Instrument data in the Allotrope Simple Model (ASM): the shapes the app and
 * the API share, and the plain-words summary a run page shows. Browser-safe;
 * the conversion itself runs in the isolated Python runtime
 * (`connectors/converter.server.ts`).
 */
import { z } from 'zod'

/** A section of a converted document: JSON as the converter wrote it. */
type AsmJsonObject = Record<string, z.core.util.JSONType>

/** A converter the Python runtime offers, as read from its own list. */
export interface ConverterVendor {
  /** Stable name the converter is chosen by, for example `MOLDEV_SOFTMAX_PRO`. */
  key: string
  /** The instrument or software, for example `Molecular Devices SoftMax Pro`. */
  name: string
  /** The measurement technique, for example `Plate Reader`. */
  technique: string
  /** File types the converter reads, comma separated (`csv,xlsx`). */
  extensions: string
  /** How settled the converter is, as its maker labels it. */
  releaseState: string
}

/** What a conversion keeps beside the vendor-neutral document. */
export interface AsmCapture {
  document: AsmJsonObject
  technique: string
  manifest: string
  vendor: string
  converter: string
  converterVersion: string
  /** The immutable image that ran the converter. */
  imageDigest: string
  measurements: number
  device: AsmJsonObject
}

/** One stored document, as the instrument page lists it. */
export interface InstrumentRunDocument {
  id: string
  runId: string
  technique: string | null
  manifest: string | null
  vendor: string | null
  converter: string
  converterVersion: string | null
  imageDigest: string | null
  measurements: number
  device: AsmJsonObject
  createdAt: string
}

/** The largest document kept with a run. A bigger one is refused, not cut. */
export const ASM_DOCUMENT_BYTE_LIMIT = 16 * 1024 * 1024

/** Who made the instrument that wrote the file, from the document's device section. */
export function deviceLabel(device: AsmJsonObject): string {
  const text = (key: string) => {
    const value = z.string().safeParse(device[key])

    return value.success && value.data !== '' && value.data !== 'N/A'
      ? value.data
      : ''
  }

  const parts = [
    text('product manufacturer') || text('brand name'),
    text('model number'),
  ].filter(Boolean)

  return parts.join(' ')
}

/** `qubit4-dsdna.csv` → `qubit4-dsdna.asm.json`. */
export function asmFileName(fileName: string): string {
  const base = fileName.replace(/\.[A-Za-z0-9]{1,5}$/, '') || 'instrument-data'

  return `${base}.asm.json`
}

/** The signature a converter parser carries: which converter, nothing else. */
export type ConverterSignature = {
  converter: { kind: 'allotropy'; vendor: string }
}

export function converterSignature(vendor: string): ConverterSignature {
  return { converter: { kind: 'allotropy', vendor } }
}

/** The vendor a parser signature names, when it names a well-formed one. */
const converterVendorSchema = z.object({
  vendor: z.string().regex(/^[A-Z0-9_]{2,80}$/),
})

/** The converter a parser version uses, when it is one. */
export function converterTarget(
  signature: AsmJsonObject,
): { vendor: string } | null {
  const converter = converterVendorSchema.safeParse(signature['converter'])

  return converter.success ? { vendor: converter.data.vendor } : null
}
