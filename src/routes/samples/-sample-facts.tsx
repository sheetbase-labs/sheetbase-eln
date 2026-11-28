/** The four facts the sample's header shows beside its ID and status. */
import { Link } from '@tanstack/react-router'

import type { RecordFact } from '#/components/record-page/record-page'
import type { SampleRecord } from '#/lib/samples'
import { t } from '#/copy'

/** Volume, where it is stored, its type and its project, as the mock reads. */
export function sampleFacts(
  sample: SampleRecord,
  project: { id: string; title: string } | null,
): RecordFact[] {
  const facts: (RecordFact | null)[] = [
    sample.quantity == null
      ? null
      : {
          label: t('library.samples.record.volumeFact'),
          value: [sample.quantity, sample.quantityUnit]
            .filter((part) => part != null)
            .join(' '),
        },
    sample.storageLocation
      ? {
          label: t('library.samples.record.locationFact'),
          value: sample.storageLocation,
        }
      : null,
    sample.sampleType
      ? {
          label: t('library.samples.record.typeFact'),
          value: sample.sampleType,
        }
      : null,
    project
      ? {
          label: t('library.samples.record.projectFact'),
          value: (
            <Link
              to="/projects/$projectId"
              params={{ projectId: project.id }}
              className="text-link"
            >
              {project.title}
            </Link>
          ),
        }
      : null,
  ]

  return facts.filter((fact): fact is RecordFact => fact !== null)
}
