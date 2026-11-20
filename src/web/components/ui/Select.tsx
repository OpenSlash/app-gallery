import * as SelectPrimitive from '@radix-ui/react-select'
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from '../../icons'

export function Select<T extends string>({ value, onValueChange, options, label, disabled = false, className = '' }: {
  value: T
  onValueChange: (value: T) => void
  options: readonly { value: T; label: string }[]
  label: string
  disabled?: boolean
  className?: string
}) {
  return <SelectPrimitive.Root value={value} disabled={disabled} onValueChange={value => {
    if (options.some(option => option.value === value)) onValueChange(value as T)
  }}>
    <SelectPrimitive.Trigger aria-label={label} className={`ui-select-trigger ${className}`}>
      <SelectPrimitive.Value /><SelectPrimitive.Icon><ChevronDownIcon /></SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content className="ui-select-content" position="popper" sideOffset={6} collisionPadding={12}>
        <SelectPrimitive.ScrollUpButton className="ui-select-scroll"><ChevronUpIcon /></SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport className="ui-select-viewport">
          {options.map(option => <SelectPrimitive.Item className="ui-select-item" key={option.value} value={option.value}>
            <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
            <SelectPrimitive.ItemIndicator className="ui-select-indicator"><CheckIcon /></SelectPrimitive.ItemIndicator>
          </SelectPrimitive.Item>)}
        </SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton className="ui-select-scroll"><ChevronDownIcon /></SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  </SelectPrimitive.Root>
}
