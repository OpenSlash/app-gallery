import { useId } from 'react'
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { CheckIcon } from '../../icons'

export function Checkbox({ checked, onCheckedChange, label, disabled = false }: {
  checked: boolean; onCheckedChange: (checked: boolean) => void; label: string; disabled?: boolean
}) {
  const id = useId()
  return <div className="checkbox-label">
    <CheckboxPrimitive.Root id={id} className="ui-checkbox" checked={checked} disabled={disabled}
      onCheckedChange={value => onCheckedChange(value === true)}>
      <CheckboxPrimitive.Indicator><CheckIcon /></CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
    <label htmlFor={id}>{label}</label>
  </div>
}
