// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// next/link needs the App Router context at runtime; for a unit test we render
// it as a plain anchor so we can assert this component's own nav configuration.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { AppNav } from "./app-nav";

describe("AppNav", () => {
  it("renders navigation to Dashboard, Sell, and Inventory pointing at the right routes", () => {
    render(<AppNav />);

    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
    expect(screen.getByRole("link", { name: "Sell" })).toHaveAttribute(
      "href",
      "/sell",
    );
    expect(screen.getByRole("link", { name: "Inventory" })).toHaveAttribute(
      "href",
      "/inventory",
    );
  });
});
