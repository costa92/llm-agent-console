import { describe, it, expect } from 'vitest'

// Wave 0 green baseline — proves the Vitest harness (config + setup file) loads
// and runs. Real component tests arrive in Plans 04 and 05.
describe('test harness', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
