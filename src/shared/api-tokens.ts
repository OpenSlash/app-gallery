import { z } from 'zod'

export const apiTokenInput = z.object({
  name: z.string().trim().min(1).max(80),
  expiresInDays: z.union([z.literal(7), z.literal(30), z.literal(90), z.literal(365)]).default(30),
})

export interface ApiTokenSummary {
  id: string
  name: string
  prefix: string
  scope: 'applications:write'
  createdAt: number
  expiresAt: number
  lastUsedAt: number | null
  revokedAt: number | null
  invalidated: boolean
}
