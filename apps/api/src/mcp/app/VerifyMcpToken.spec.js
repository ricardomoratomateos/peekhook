import { describe, it, expect } from 'vitest'
import crypto from 'node:crypto'
import { McpAuthRepository } from '../domain/McpAuthRepository.js'
import { VerifyMcpToken } from './VerifyMcpToken.js'

class FakeMcpAuthRepo extends McpAuthRepository {
  constructor() { super(); this.inboxes = new Map() }
  async findByInboxToken(token) { return this.inboxes.get(token) ?? null }
  async setMcpTokenHash(token, hashHex) {
    const prior = this.inboxes.get(token) ?? { token }
    this.inboxes.set(token, { ...prior, mcpTokenHash: hashHex })
  }
}

describe('VerifyMcpToken', () => {
  const hash = (raw) => crypto.createHash('sha256').update(raw).digest('hex')

  it('returns ok when the mcp token hashes to the stored hash', async () => {
    const repo = new FakeMcpAuthRepo()
    const inboxToken = 'inb_test_ok'
    const mcpToken = 'plaintext-secret'
    await repo.setMcpTokenHash(inboxToken, hash(mcpToken))

    const sut = new VerifyMcpToken({ mcpAuth: repo })
    const result = await sut.execute({ inboxToken, mcpToken })

    expect(result.ok).toBe(true)
    expect(result.inbox.token).toBe(inboxToken)
  })

  it('returns not-found reason when the inbox token is unknown', async () => {
    const repo = new FakeMcpAuthRepo()
    const sut = new VerifyMcpToken({ mcpAuth: repo })
    const result = await sut.execute({ inboxToken: 'inb_missing', mcpToken: 'whatever' })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('inbox not found')
  })

  it('returns wrong-hash reason when the mcpToken does not match', async () => {
    const repo = new FakeMcpAuthRepo()
    const inboxToken = 'inb_test_wrongo'
    await repo.setMcpTokenHash(inboxToken, hash('correct-secret'))

    const sut = new VerifyMcpToken({ mcpAuth: repo })
    const result = await sut.execute({ inboxToken, mcpToken: 'wrong-secret' })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('mcp_token invalid')
  })

  it('returns missing reason when the inbox token has no mcpTokenHash', async () => {
    const repo = new FakeMcpAuthRepo()
    repo.inboxes.set('inb_uninit', { token: 'inb_uninit' })

    const sut = new VerifyMcpToken({ mcpAuth: repo })
    const result = await sut.execute({ inboxToken: 'inb_uninit', mcpToken: 'whatever' })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('mcp not enabled for inbox')
  })

  it('returns missing reason when arguments are empty', async () => {
    const repo = new FakeMcpAuthRepo()
    const sut = new VerifyMcpToken({ mcpAuth: repo })
    expect((await sut.execute({ inboxToken: '', mcpToken: 'x' })).reason).toBe('inbox_token missing')
    expect((await sut.execute({ inboxToken: 'x', mcpToken: '' })).reason).toBe('mcp_token missing')
  })
})
