/**
 * Real bytes for the demo's files.
 *
 * The design seed records the files that EXP-0142 and its neighbours cite (the
 * plate reader workbook, the turbidity export, the pressure log, the protocol
 * and the certificate of analysis) as uploads that never arrived: every one
 * failed to download with "the storage object for this file is absent", and the
 * nightly backup counted them as missing. This writes content for each into the
 * app's own file storage and finalises the upload, so a download, a backup and
 * a restore all have something real to carry.
 *
 * The content is small and made up, but it agrees with the records it belongs
 * to (the same samples, runs and protocol).
 */
import { createHash } from 'node:crypto'
import { strToU8, zipSync } from 'fflate'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { sql } from 'drizzle-orm'

import { withDesignClaims } from './claims'
import { DESIGN_SESSION_IDS } from './identities'
import type { SeedStep } from './run'

type Db = Parameters<SeedStep['run']>[0]

const PROCESS = '00000000-0000-4000-8000-000000000300'
const GARETH = '00000000-0000-4000-8000-000000000310'

/** Deterministic pseudo-random in [0, 1), so a reseed writes the same file. */
function unit(seed: string, n: number): number {
  const h = createHash('sha256').update(`${seed}:${n}`).digest()
  return h.readUInt32BE(0) / 2 ** 32
}

function pressureLog(): string {
  const rows = ['run,time_min,pressure_bar,flow_lpm']
  for (const [r, run] of ['A', 'B', 'C'].entries()) {
    for (let i = 0; i < 9; i++) {
      const t = i * 5
      const pressure = 0.2 + i * (0.028 + r * 0.011) + unit(run, i) * 0.01
      const flow = 1.2 - i * 0.004 * (r + 1) + unit(run, i + 20) * 0.01
      rows.push(`${run},${t},${pressure.toFixed(2)},${flow.toFixed(2)}`)
    }
  }
  return `${rows.join('\n')}\n`
}

const xmlEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** A minimal, valid workbook: three 8x12 plates of OD450 readings. */
function plateWorkbook(): Uint8Array {
  const column = (c: number) => String.fromCharCode(65 + c)
  const sheets = [1, 2, 3].map((plate) => {
    const rows: string[] = []
    const cell = (ref: string, value: string | number) =>
      typeof value === 'number'
        ? `<c r="${ref}"><v>${value}</v></c>`
        : `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`
    rows.push(
      `<row r="1">${cell('A1', `Plate ${plate}, OD450`)}${Array.from({ length: 12 }, (_, c) => cell(`${column(c + 1)}1`, c + 1)).join('')}</row>`,
    )
    for (let r = 0; r < 8; r++) {
      const label = String.fromCharCode(65 + r)
      const values = Array.from({ length: 12 }, (_, c) => {
        // Standard curve down the first columns, samples after.
        const od =
          c < 2 ? 2.4 / 2 ** r : 0.1 + unit(`p${plate}`, r * 12 + c) * 1.9
        return cell(`${column(c + 1)}${r + 2}`, Number(od.toFixed(3)))
      }).join('')
      rows.push(`<row r="${r + 2}">${cell(`A${r + 2}`, label)}${values}</row>`)
    }
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.join('')}</sheetData></worksheet>`
  })
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((_, i) => `<sheet name="Plate ${i + 1}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`,
    ),
  }
  sheets.forEach((xml, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(xml)
  })
  return zipSync(files, { mtime: new Date('2026-09-24T15:03:00Z') })
}

async function textPdf(title: string, lines: string[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setCreationDate(new Date('2026-09-21T09:00:00Z'))
  pdf.setModificationDate(new Date('2026-09-21T09:00:00Z'))
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const page = pdf.addPage([595, 842])
  page.drawText(title, { x: 50, y: 780, size: 16, font: bold })
  lines.forEach((line, i) => {
    page.drawText(line, {
      x: 50,
      y: 745 - i * 18,
      size: 11,
      font,
      color: rgb(0.15, 0.15, 0.15),
    })
  })
  return pdf.save({ useObjectStreams: false })
}

type Make = () => Uint8Array | Promise<Uint8Array>

/** What each seeded file contains, by the name it is shown under. */
const CONTENT: Record<string, Make | undefined> = {
  'PR-01_EXP-0142_plates1-3.xlsx': plateWorkbook,
  'pressure_logger_trains_A-C.csv': () => strToU8(pressureLog()),
  'PRT-021_v3_depth_filtration.pdf': () =>
    textPdf('PRT-021 v3: Depth-filter clarification screen', [
      'Controlled copy. Version 3.',
      '',
      'Purpose: screen depth filter trains for harvest clarification of AAV9,',
      'tracking step yield and filtrate turbidity across load conditions.',
      '',
      'Parameters: flux 100 LMH (+/- 5); load points 50, 100 and 150 L/m2;',
      'harvest held at 2-8 C for no more than 14 days; pressure logged every 10 L/m2.',
      '',
      '1. Prime each filter train with equilibration buffer; record the start pressure.',
      '2. Load harvest at constant flux; log pressure as above.',
      '3. Collect filtrate in 15 mL aliquots at each load point.',
      '4. Read turbidity (TB-02) and capsid titre for each aliquot.',
      '',
      'Acceptance: capsid step yield of at least 80 % and filtrate turbidity of',
      '20 NTU or less at the selected load.',
    ]),
  'CoA_L-77310.pdf': () =>
    textPdf('Certificate of analysis: plasmid lot L-77310', [
      'Product: pAAV-GOI transfer plasmid',
      'Lot: L-77310',
      'Supplier release date: 2026-08-14',
      '',
      'Concentration: 1.02 mg/mL (A260)',
      'A260/A280: 1.89',
      'Supercoiled fraction: 94 % (agarose gel)',
      'Endotoxin: below 5 EU/mg',
      'Sequence verified across the ITR and expression cassette: pass',
      '',
      'Result: released for research use.',
    ]),
}

export async function seedDemoFileBytes(db: Db): Promise<void> {
  const files = await db.execute<{
    id: string
    display_name: string
    storage_key: string
    version: number
    extracted_text: string | null
    status: string
  }>(sql`
    SELECT f.id, f.display_name, f.storage_key, f.version, f.extracted_text, f.status
      FROM api.file_objects f
     WHERE f.workspace_id = ${PROCESS}
       AND f.status = 'missing'
       AND NOT EXISTS (SELECT 1 FROM internal.file_blobs b WHERE b.storage_key = f.storage_key)`)
  for (const file of files.rows) {
    const make = CONTENT[file.display_name]
    const bytes = make
      ? await make()
      : file.extracted_text
        ? strToU8(`${file.extracted_text.trimEnd()}\n`)
        : null
    if (!bytes) continue
    const buffer = Buffer.from(bytes)
    const checksum = createHash('sha256').update(buffer).digest('hex')
    const key = `${PROCESS}/${file.id}/${createHash('md5').update(`${file.id}:${file.display_name}`).digest('hex')}`
    await db.execute(sql`
      INSERT INTO internal.file_blobs (storage_key, byte_size, checksum)
      VALUES (${key}, ${buffer.length}, ${checksum}) ON CONFLICT (storage_key) DO NOTHING`)
    await db.execute(sql`
      INSERT INTO internal.file_blob_chunks (storage_key, seq, data)
      VALUES (${key}, 0, ${buffer}) ON CONFLICT DO NOTHING`)
    await withDesignClaims(
      db,
      GARETH,
      PROCESS,
      async (client) => {
        await client.query(
          'select api.finalize_file_upload($1,$2,$3,$4,$5,$6)',
          [
            file.id,
            file.version,
            file.storage_key,
            key,
            buffer.length,
            checksum,
          ],
        )
      },
      DESIGN_SESSION_IDS.gareth,
    )
  }
}
