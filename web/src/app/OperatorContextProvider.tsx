import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

/**
 * Operator context — the non-secret tenant/user/project/session scope the
 * operator is currently acting under. These values are sent to the BFF as
 * `X-Console-*` headers (see lib/api.ts) and persisted to localStorage so the
 * last-used scope survives reloads (CONTEXT D-07).
 *
 * D-01: the operator auth token is held in memory only and is NEVER part of
 * this context or localStorage. Only {tenantId, userId, projectId, sessionId}
 * are stored.
 */
export type OperatorContextValue = {
  tenantId: string
  userId: string
  projectId: string
  sessionId: string
}

export type OperatorContext = OperatorContextValue & {
  setContext: (partial: Partial<OperatorContextValue>) => void
}

const STORAGE_KEY = 'operator-context'

const EMPTY: OperatorContextValue = {
  tenantId: '',
  userId: '',
  projectId: '',
  sessionId: '',
}

const OperatorContextReact = createContext<OperatorContext | null>(null)

function readFromStorage(): OperatorContextValue {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...EMPTY }
    const parsed = JSON.parse(raw) as Partial<OperatorContextValue>
    return {
      tenantId: parsed.tenantId ?? '',
      userId: parsed.userId ?? '',
      projectId: parsed.projectId ?? '',
      sessionId: parsed.sessionId ?? '',
    }
  } catch {
    return { ...EMPTY }
  }
}

export function OperatorContextProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OperatorContextValue>(readFromStorage)

  const setContext = useCallback(
    (partial: Partial<OperatorContextValue>) => {
      setState((prev) => {
        const next: OperatorContextValue = {
          tenantId: partial.tenantId ?? prev.tenantId,
          userId: partial.userId ?? prev.userId,
          projectId: partial.projectId ?? prev.projectId,
          sessionId: partial.sessionId ?? prev.sessionId,
        }
        // Persist ONLY the non-secret scope (D-01: no auth token here).
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
        return next
      })
    },
    [],
  )

  const value = useMemo<OperatorContext>(
    () => ({ ...state, setContext }),
    [state, setContext],
  )

  return (
    <OperatorContextReact.Provider value={value}>
      {children}
    </OperatorContextReact.Provider>
  )
}

export function useOperatorContext(): OperatorContext {
  const ctx = useContext(OperatorContextReact)
  if (!ctx) {
    throw new Error(
      'useOperatorContext must be used within an OperatorContextProvider',
    )
  }
  return ctx
}
