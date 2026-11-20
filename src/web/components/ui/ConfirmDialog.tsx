import * as AlertDialog from '@radix-ui/react-alert-dialog'
import { useRef } from 'react'

export function ConfirmDialog({ title, description, confirmLabel, busy, error, onCancel, onConfirm }: {
  title: string; description: string; confirmLabel: string; busy: boolean; error: string
  onCancel: () => void; onConfirm: () => Promise<void>
}) {
  const returnFocus = useRef(document.activeElement as HTMLElement | null)
  return <AlertDialog.Root open onOpenChange={open => { if (!open && !busy) onCancel() }}>
    <AlertDialog.Portal>
      <AlertDialog.Overlay className="dialog-overlay confirm-overlay" />
      <AlertDialog.Content className="dialog confirm-dialog" onEscapeKeyDown={event => { if (busy) event.preventDefault() }}
        onCloseAutoFocus={event => {
          event.preventDefault()
          if (returnFocus.current?.isConnected) returnFocus.current.focus()
        }}>
        <AlertDialog.Title className="confirm-title">{title}</AlertDialog.Title>
        <AlertDialog.Description className="confirm-description">{description}</AlertDialog.Description>
        {error && <p role="alert" className="form-error">{error}</p>}
        <div className="dialog-footer">
          <AlertDialog.Cancel asChild><button className="button secondary" disabled={busy}>取消</button></AlertDialog.Cancel>
          <AlertDialog.Action asChild><button className="button destructive" disabled={busy} onClick={event => {
            event.preventDefault()
            void onConfirm()
          }}>{busy ? '正在处理…' : confirmLabel}</button></AlertDialog.Action>
        </div>
      </AlertDialog.Content>
    </AlertDialog.Portal>
  </AlertDialog.Root>
}
