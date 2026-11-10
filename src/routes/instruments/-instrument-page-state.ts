import { useState } from 'react'

import type { QualificationRow } from './-instrument-columns'
import { isoDay } from './-instrument-day'

/**
 * The instrument record's form and dialog state: which dialog is open, and
 * what has been typed into it.
 */
export function useInstrumentPageState() {
  const [recordOpen, setRecordOpen] = useState(false)
  const [downOpen, setDownOpen] = useState(false)
  const [upOpen, setUpOpen] = useState(false)
  const [performed, setPerformed] = useState(() => isoDay())
  const [due, setDue] = useState(() => isoDay(182))
  const [notes, setNotes] = useState('')

  const [certificate, setCertificate] = useState<{
    fileObjectId: string
    displayName: string
  } | null>(null)

  const [certificateProject, setCertificateProject] = useState('')
  const [setupStep, setSetupStep] = useState<1 | 3 | null>(null)
  const [grantOpen, setGrantOpen] = useState(false)
  const [grantUser, setGrantUser] = useState('')
  const [grantUntil, setGrantUntil] = useState(() => isoDay(365))
  const [grantScope, setGrantScope] = useState('')

  const [revokeTarget, setRevokeTarget] = useState<QualificationRow | null>(
    null,
  )

  return {
    recordOpen,
    setRecordOpen,
    downOpen,
    setDownOpen,
    upOpen,
    setUpOpen,
    performed,
    setPerformed,
    due,
    setDue,
    notes,
    setNotes,
    certificate,
    setCertificate,
    certificateProject,
    setCertificateProject,
    setupStep,
    setSetupStep,
    grantOpen,
    setGrantOpen,
    grantUser,
    setGrantUser,
    grantUntil,
    setGrantUntil,
    grantScope,
    setGrantScope,
    revokeTarget,
    setRevokeTarget,
  }
}
