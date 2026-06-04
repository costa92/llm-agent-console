// Vitest global setup — referenced by vitest.config.ts setupFiles.
// Adds @testing-library/jest-dom custom matchers (toBeInTheDocument,
// toHaveTextContent, etc.) to expect() for the component tests in later plans.
import '@testing-library/jest-dom/vitest'

// jsdom does not implement window.scrollTo; TanStack Router's scroll restoration
// calls it on navigation. Stub it so router-driven component tests stay quiet.
window.scrollTo = () => {}
