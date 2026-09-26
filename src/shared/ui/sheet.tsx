import type { ReactNode } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { X } from '@phosphor-icons/react/dist/csr/X'

/** The prototype's bottom sheet, with focus trapping and keyboard dismissal. */
export function Sheet({ open, onOpenChange, title, children }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  children: ReactNode
}) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Backdrop className="sheet-backdrop" />
      <Dialog.Popup className="sheet-popup">
        <div className="dock-handle" />
        <div className="sheet-heading"><Dialog.Title>{title}</Dialog.Title><Dialog.Close className="circle" aria-label="Закрыть"><X size={22} /></Dialog.Close></div>
        {children}
      </Dialog.Popup>
    </Dialog.Portal>
  </Dialog.Root>
}
