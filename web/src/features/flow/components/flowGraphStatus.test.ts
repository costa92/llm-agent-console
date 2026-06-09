import { describe, expect, it } from 'vitest'
import { CheckCircle, CircleDashed, CircleSlash, Loader, XCircle } from 'lucide-react'

import type { NodeStatus } from '@/features/flow/timeline/reducer'
import { STATUS_META } from './flowGraphStatus'

describe('flowGraphStatus STATUS_META', () => {
  it('maps each NodeStatus to its expected token + icon', () => {
    expect(STATUS_META.pending).toMatchObject({
      token: 'var(--status-unknown)',
      Icon: CircleDashed,
    })
    expect(STATUS_META.running).toMatchObject({
      token: 'var(--status-unknown)',
      Icon: Loader,
      spin: true,
    })
    expect(STATUS_META.done).toMatchObject({
      token: 'var(--status-up)',
      Icon: CheckCircle,
    })
    expect(STATUS_META.skipped).toMatchObject({
      token: 'var(--status-unknown)',
      Icon: CircleSlash,
      dim: true,
    })
    expect(STATUS_META.errored).toMatchObject({
      token: 'var(--status-down)',
      Icon: XCircle,
    })
  })

  it('marks ONLY running as the current live position (pulsing-ring emphasis)', () => {
    expect(STATUS_META.running.current).toBe(true)
    const others: NodeStatus[] = ['pending', 'done', 'skipped', 'errored']
    for (const s of others) expect(STATUS_META[s].current).toBeUndefined()
  })

  it('covers every NodeStatus exactly', () => {
    const all: NodeStatus[] = ['pending', 'running', 'done', 'skipped', 'errored']
    expect(Object.keys(STATUS_META).sort()).toEqual([...all].sort())
  })
})
