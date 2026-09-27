import { useEffect, useRef, type ReactNode } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { X } from '@phosphor-icons/react/dist/csr/X'

/** A modal bottom sheet sized to the visible viewport when the keyboard opens. */
export function Sheet({ open, onOpenChange, title, children }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  children: ReactNode
}) {
  const popup = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const viewport = window.visualViewport
    if (!viewport) return
    const fit = () => {
      if (!popup.current) return
      popup.current.style.setProperty('--sheet-visible-height', `${viewport.height}px`)
      popup.current.style.setProperty('--sheet-keyboard-offset', `${Math.max(0, window.innerHeight - viewport.offsetTop - viewport.height)}px`)
    }
    fit()
    viewport.addEventListener('resize', fit)
    viewport.addEventListener('scroll', fit)
    window.addEventListener('resize', fit)
    return () => {
      viewport.removeEventListener('resize', fit)
      viewport.removeEventListener('scroll', fit)
      window.removeEventListener('resize', fit)
    }
  }, [open])

  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Backdrop className="sheet-backdrop" />
      <Dialog.Popup ref={popup} className="sheet-popup">
        <div className="sheet-grip" aria-hidden="true" />
        <div className="sheet-heading"><Dialog.Title>{title}</Dialog.Title><Dialog.Close className="circle" aria-label="Закрыть"><X size={22} /></Dialog.Close></div>
        <div className="sheet-content">{children}</div>
      </Dialog.Popup>
    </Dialog.Portal>
  </Dialog.Root>
}
