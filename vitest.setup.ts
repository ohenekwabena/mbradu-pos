// Registers jest-dom matchers (toBeInTheDocument, etc.) on Vitest's `expect`.
// Harmless for node-environment pure-module tests; required for component tests.
import "@testing-library/jest-dom/vitest";
