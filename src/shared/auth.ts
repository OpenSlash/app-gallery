export type PasswordConfigurationIssue = 'missing' | 'too_short' | 'too_long' | null

export function passwordConfigurationIssue(value: unknown): PasswordConfigurationIssue {
  if (typeof value !== 'string' || !value.length) return 'missing'
  if (value.length > 256) return 'too_long'
  if (value.trim().length < 16) return 'too_short'
  return null
}
