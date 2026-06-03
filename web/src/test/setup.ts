// Vitest global setup — referenced by vitest.config.ts setupFiles.
// Adds @testing-library/jest-dom custom matchers (toBeInTheDocument,
// toHaveTextContent, etc.) to expect() for the component tests in later plans.
import '@testing-library/jest-dom/vitest'
