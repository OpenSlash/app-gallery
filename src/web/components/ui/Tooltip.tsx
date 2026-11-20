import type { ReactElement } from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'

export const TooltipProvider = TooltipPrimitive.Provider

export function Tooltip({ label, children }: { label: string; children: ReactElement }) {
  return <TooltipPrimitive.Root>
    <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
    <TooltipPrimitive.Portal><TooltipPrimitive.Content className="ui-tooltip" sideOffset={10} collisionPadding={12}>
      {label}<TooltipPrimitive.Arrow className="ui-tooltip-arrow" />
    </TooltipPrimitive.Content></TooltipPrimitive.Portal>
  </TooltipPrimitive.Root>
}
