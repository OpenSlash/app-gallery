import { useRef, type ReactNode } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Cross2Icon } from '../icons'

export function Dialog({ title, children, onClose, className = '', dismissible = true }: {
  title: string; children: ReactNode; onClose: () => void; className?: string; dismissible?: boolean
}) {
  const returnFocus = useRef(document.activeElement as HTMLElement | null)
  return <DialogPrimitive.Root open onOpenChange={open => { if (!open && dismissible) onClose() }}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="dialog-overlay" />
      <DialogPrimitive.Content className={`dialog ${className}`}
        onEscapeKeyDown={event => { if (!dismissible) event.preventDefault() }}
        onInteractOutside={event => { if (!dismissible) event.preventDefault() }}
        onCloseAutoFocus={event => {
          event.preventDefault()
          // Do not steal focus when switching from details to the editor.
          queueMicrotask(() => {
            if (!document.querySelector('[role="dialog"], [role="alertdialog"]') && returnFocus.current?.isConnected) returnFocus.current.focus()
          })
        }}>
        <div className="dialog-header"><DialogPrimitive.Title asChild><h2>{title}</h2></DialogPrimitive.Title>
          <DialogPrimitive.Close asChild><button type="button" className="icon-button" aria-label="关闭" disabled={!dismissible}><Cross2Icon /></button></DialogPrimitive.Close></div>
        <DialogPrimitive.Description className="sr-only">{title}，可在此管理应用信息。按 Escape 关闭。</DialogPrimitive.Description>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>
}
