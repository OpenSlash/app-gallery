import * as SliderPrimitive from '@radix-ui/react-slider'

export function Slider({ value, onValueChange, label, min, max, step }: {
  value: number; onValueChange: (value: number) => void; label: string; min: number; max: number; step: number
}) {
  return <SliderPrimitive.Root className="ui-slider" value={[value]} min={min} max={max} step={step}
    onValueChange={values => onValueChange(values[0])}>
    <SliderPrimitive.Track className="ui-slider-track"><SliderPrimitive.Range className="ui-slider-range" /></SliderPrimitive.Track>
    <SliderPrimitive.Thumb className="ui-slider-thumb" aria-label={label} />
  </SliderPrimitive.Root>
}
