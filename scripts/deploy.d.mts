export function deploy(options?: {
  root?: string
  run?: (command: string, args: string[], options: { cwd: string; capture: boolean }) => string
  log?: (message: string) => void
}): void
