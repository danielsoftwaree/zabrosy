import { z } from 'zod'

const uuid = z.string().uuid()
const document = z.object({ id: uuid }).catchall(z.json())
const page = z.object({ offset: z.number().int().min(0).max(10_000), expectedOwnerId: uuid })

export const listSessionsInput = page
export const listCastsInput = page.extend({ sessionId: uuid })

const saveInput = z.object({
  id: uuid,
  expectedOwnerId: uuid,
  expectedRevision: z.number().int().min(0),
  document,
  deleted: z.boolean().default(false),
}).superRefine(({ id, document }, context) => {
  if (document.id !== id) {
    context.addIssue({ code: 'custom', message: 'Document ID does not match record ID', path: ['document', 'id'] })
  }
  if (JSON.stringify(document).length > 1_000_000) {
    context.addIssue({ code: 'custom', message: 'Document exceeds 1 MB', path: ['document'] })
  }
})

export const saveSessionInput = saveInput
export const saveCastInput = saveInput.safeExtend({ sessionId: uuid })
