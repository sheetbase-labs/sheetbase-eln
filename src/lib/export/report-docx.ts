/**
 * A generated report as a Word document: a real heading structure, so it can be
 * edited, with the version and fingerprint in the footer of every page.
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  TextRun,
} from 'docx'

import type { ReportDocument, ReportParagraph } from './report-document'

const GREY = '666666'

function bodyParagraph(part: ReportParagraph): Paragraph {
  switch (part.kind) {
    case 'heading':
      return new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun(part.text)],
      })
    case 'bullet':
      return new Paragraph({
        bullet: { level: 0 },
        children: [new TextRun(part.text)],
      })
    case 'meta':
      return new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun({ text: part.text, color: GREY, size: 17 })],
      })
    case 'code':
      return new Paragraph({
        spacing: { after: 120 },
        children: [
          new TextRun({
            text: part.text,
            font: 'Courier New',
            size: 16,
            color: GREY,
          }),
        ],
      })
    default:
      return new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun(part.text)],
      })
  }
}

export async function renderReportDocx(
  doc: ReportDocument,
): Promise<Uint8Array> {
  const children: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun(doc.title)],
    }),
  ]

  if (doc.subtitle) {
    children.push(
      new Paragraph({
        spacing: { after: 80 },
        children: [
          new TextRun({
            text: doc.subtitle,
            italics: true,
            color: GREY,
            size: 24,
          }),
        ],
      }),
    )
  }

  children.push(
    new Paragraph({
      spacing: { after: 240 },
      children: [
        new TextRun({
          text: [doc.meta, `Fingerprint ${doc.fingerprint}`]
            .filter(Boolean)
            .join('  ·  '),
          color: GREY,
          size: 18,
        }),
      ],
    }),
  )

  for (const section of doc.sections) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 360, after: 80 },
        border: {
          top: {
            style: BorderStyle.SINGLE,
            size: 6,
            color: 'E5E5E5',
            space: 8,
          },
        },
        children: [new TextRun(section.heading)],
      }),
    )

    for (const part of section.body) children.push(bodyParagraph(part))
  }

  const footerText = [doc.meta, `Fingerprint ${doc.fingerprint}`]
    .filter(Boolean)
    .join('  ·  ')

  const file = new Document({
    title: doc.title,
    description: `Fingerprint ${doc.fingerprint}`,
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 21 } },
      },
      paragraphStyles: [
        {
          id: 'Title',
          name: 'Title',
          basedOn: 'Normal',
          run: { bold: true, size: 44, color: '111111' },
          paragraph: { spacing: { after: 120 } },
        },
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { bold: true, size: 28, color: '111111' },
        },
        {
          id: 'Heading3',
          name: 'Heading 3',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { bold: true, size: 23, color: '111111' },
          paragraph: { spacing: { before: 120, after: 60 } },
        },
        {
          id: 'Footer',
          name: 'footer',
          basedOn: 'Normal',
          run: { size: 16, color: GREY },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.LEFT,
                children: [
                  new TextRun({
                    text: `${footerText}  ·  Page `,
                    color: GREY,
                    size: 16,
                  }),
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    color: GREY,
                    size: 16,
                  }),
                  new TextRun({ text: ' of ', color: GREY, size: 16 }),
                  new TextRun({
                    children: [PageNumber.TOTAL_PAGES],
                    color: GREY,
                    size: 16,
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  })

  return new Uint8Array(await Packer.toBuffer(file))
}
