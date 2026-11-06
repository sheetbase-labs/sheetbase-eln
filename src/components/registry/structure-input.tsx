/**
 * Drawing a structure for the registry: a picture, a button that opens the
 * drawing tool in a dialog, and a box for pasting a SMILES line. It hands back
 * what the database needs to know about the drawing.
 */
import DOMPurify from 'dompurify'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'

import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import { Muted } from '#/components/ui/layout'
import { t } from '#/copy'
import { parseMolfile, structureSvg } from '#/lib/chemistry-draw'
import type { Ocl } from '#/lib/chemistry-draw'
import { describeStructure } from '#/lib/compound-registry'
import type { StructureDescriptor } from '#/lib/compound-registry'

import { useOcl } from './use-ocl'

/** A structure as a picture. Pass a molfile or the code of a parent structure. */
export function StructurePicture({
  svg,
  label,
  height,
}: {
  svg: string | null
  label: string
  height?: number
}) {
  const clean = useMemo(
    () =>
      svg ? DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true } }) : null,
    [svg],
  )
  if (!clean) return null
  return (
    <div
      role="img"
      aria-label={label}
      style={height ? { height } : undefined}
      className="flex items-center justify-start overflow-hidden text-fg [&>svg]:h-full [&>svg]:max-h-full [&>svg]:w-auto [&>svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  )
}

/** A molfile drawn small, or nothing while the library loads. */
export function MolfilePicture({
  molfile,
  label,
  height = 160,
}: {
  molfile: string
  label: string
  height?: number
}) {
  const ocl = useOcl()
  const svg = useMemo(
    () => (ocl && molfile ? structureSvg(ocl, molfile, height) : null),
    [ocl, molfile, height],
  )
  return <StructurePicture svg={svg} label={label} />
}

/** The drawing tool in a dialog; it hands back the molfile when used. */
export function StructureDialog({
  open,
  onOpenChange,
  initial,
  mode = 'structure',
  onUse,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initial: string
  mode?: 'structure' | 'query'
  onUse: (molfile: string) => void
}) {
  const ocl = useOcl()
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  const editor = useRef<InstanceType<Ocl['CanvasEditor']> | null>(null)
  const [changed, setChanged] = useState(false)

  useLayoutEffect(() => {
    if (!open || !ocl || !host) return
    const canvas = new ocl.CanvasEditor(host, { initialMode: 'molecule' })
    editor.current = canvas
    const molecule = parseMolfile(ocl, initial)
    if (molecule) canvas.setMolecule(molecule)
    setChanged(false)
    canvas.setOnChangeListener((event) => {
      if (event.isUserEvent) setChanged(true)
    })
    return () => {
      editor.current = null
      canvas.destroy()
    }
  }, [open, ocl, host, initial])

  function use() {
    const canvas = editor.current
    if (!canvas) return
    const molecule = canvas.getMolecule()
    onUse(molecule.getAllAtoms() === 0 ? '' : molecule.toMolfile())
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[6vh] max-h-[88vh] w-[min(1000px,calc(100vw-32px))]">
        <DialogHeader
          title={
            mode === 'query'
              ? t('registry.chemistry.search.draw')
              : t('registry.chemistry.input.drawTitle')
          }
          description={
            mode === 'query'
              ? t('registry.chemistry.search.hint')
              : t('registry.chemistry.input.drawDescription')
          }
        />
        <DialogBody>
          <div
            ref={setHost}
            data-testid="registry-structure-canvas"
            className="h-[min(520px,60vh)] w-full overflow-hidden rounded-md border border-border bg-white"
          />
          {!ocl ? <Muted>{t('registry.chemistry.input.loading')}</Muted> : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button variant="primary" disabled={!ocl || !changed} onClick={use}>
            {t('registry.chemistry.input.useDrawing')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The structure field of the register form: the picture, what the structure
 * is, and how to change it. `onChange` gets the descriptor, or null when it is
 * cleared.
 */
export function StructureInput({
  value,
  onChange,
  disabled,
  label,
}: {
  value: StructureDescriptor | null
  onChange: (value: StructureDescriptor | null) => void
  disabled?: boolean
  label?: string
}) {
  const ocl = useOcl()
  const [drawing, setDrawing] = useState(false)
  const [smiles, setSmiles] = useState('')
  const [error, setError] = useState<string | null>(null)

  function take(text: string) {
    if (!ocl) return
    if (!text.trim()) {
      onChange(null)
      setError(null)
      return
    }
    const described = describeStructure(ocl, text)
    if (!described) {
      setError(t('registry.chemistry.input.unreadable'))
      return
    }
    setError(null)
    onChange(described)
  }

  return (
    <div className="flex flex-col gap-2 md:col-span-2">
      <span className="text-xs text-fg-muted">
        {label ?? t('registry.chemistry.input.label')}
      </span>
      {value ? (
        <div className="flex flex-wrap items-start gap-4 rounded-md border border-border bg-surface p-3">
          <MolfilePicture
            molfile={value.molfile}
            label={t('registry.chemistry.input.label')}
            height={150}
          />
          <div className="flex min-w-0 flex-col gap-1 text-label">
            <span className="font-medium">
              {t('registry.chemistry.input.summary', {
                formula: value.formula,
                mass: value.mass,
              })}
            </span>
            {value.salts.length > 0 ? (
              <span className="text-fg-muted">
                {t('registry.chemistry.input.saltsSetAside', {
                  salts: value.salts.join(', '),
                })}
              </span>
            ) : null}
          </div>
        </div>
      ) : (
        <Muted>{t('registry.chemistry.input.empty')}</Muted>
      )}
      <span className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          disabled={disabled || !ocl}
          onClick={() => setDrawing(true)}
        >
          {value
            ? t('registry.chemistry.input.change')
            : t('registry.chemistry.input.draw')}
        </Button>
        {value ? (
          <Button
            type="button"
            variant="quiet"
            disabled={disabled}
            onClick={() => take('')}
          >
            {t('registry.chemistry.input.remove')}
          </Button>
        ) : null}
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <Input
          className="h-8 max-w-md flex-1 font-mono text-xs"
          value={smiles}
          disabled={disabled}
          placeholder={t('registry.chemistry.input.smilesPlaceholder')}
          aria-label={t('registry.chemistry.input.smilesLabel')}
          onChange={(e) => setSmiles(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              take(smiles)
              setSmiles('')
            }
          }}
        />
        <Button
          type="button"
          disabled={disabled || !smiles.trim() || !ocl}
          onClick={() => {
            take(smiles)
            setSmiles('')
          }}
        >
          {t('registry.chemistry.input.useSmiles')}
        </Button>
      </span>
      {error ? (
        <span role="alert" className="text-label text-danger-text">
          {error}
        </span>
      ) : null}
      <StructureDialog
        open={drawing}
        onOpenChange={setDrawing}
        initial={value?.molfile ?? ''}
        onUse={(molfile) => take(molfile)}
      />
    </div>
  )
}
