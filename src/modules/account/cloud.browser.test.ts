import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), from: vi.fn() }))
vi.mock('./supabase.browser', () => ({ getBrowserSupabase: () => ({ auth: { getUser: mocks.getUser }, from: mocks.from }) }))

import { listCloudSessions, saveCloudSession } from './cloud.browser'

const owner = 'b8506344-c88c-466d-a238-66725c48beaa'
const id = '30f96b58-b3fc-48fd-9e0b-995e7fce319b'

function chain(result: object) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const method of ['select', 'eq', 'order', 'range', 'insert', 'update']) query[method] = vi.fn(() => query)
  query.single = vi.fn(async () => result)
  query.maybeSingle = vi.fn(async () => result)
  query.then = vi.fn((resolve: (value: object) => unknown) => Promise.resolve(resolve(result)))
  return query
}

describe('browser cloud boundary', () => {
  beforeEach(() => { mocks.getUser.mockReset(); mocks.from.mockReset() })

  it('rejects an account change before any table access', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'another-account' } }, error: null })
    await expect(listCloudSessions({ data: { offset: 0, expectedOwnerId: owner } })).rejects.toThrow('Аккаунт изменился')
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('rejects a regular Supabase user with no server-issued marker profile claim', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: owner, app_metadata: {}, user_metadata: { marker_username: 'forged' } } }, error: null })
    await expect(listCloudSessions({ data: { offset: 0, expectedOwnerId: owner } })).rejects.toThrow('не имеет доступа')
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('filters reads and compare-and-swap updates by verified owner and revision', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: owner, app_metadata: { marker_username: 'owner' } } }, error: null })
    const read = chain({ data: [], error: null })
    const write = chain({ data: { id, revision: 3 }, error: null })
    mocks.from.mockReturnValueOnce(read).mockReturnValueOnce(write)
    await listCloudSessions({ data: { offset: 0, expectedOwnerId: owner } })
    expect(read.eq).toHaveBeenCalledWith('owner_id', owner)
    await saveCloudSession({ data: { id, expectedOwnerId: owner, expectedRevision: 2, document: { id } } })
    expect(write.eq).toHaveBeenCalledWith('owner_id', owner)
    expect(write.eq).toHaveBeenCalledWith('revision', 2)
    expect(write.update).toHaveBeenCalledWith(expect.objectContaining({ revision: 3 }))
  })
})
