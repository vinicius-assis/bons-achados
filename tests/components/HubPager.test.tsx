import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import HubPager from "@/components/HubPager";

const noop = () => {};

function render(props: Partial<Parameters<typeof HubPager>[0]> = {}): string {
  return renderToStaticMarkup(
    <HubPager
      currentPage={1}
      lastKnownPage={1}
      hasNext={false}
      exact
      disabled={false}
      onPageChange={noop}
      {...props}
    />
  );
}

describe("HubPager", () => {
  it("renders nothing for a single page with no next", () => {
    expect(render()).toBe("");
  });

  it("exact mode shows Primeira/Anterior/Próxima/Última around a mid page", () => {
    const html = render({ currentPage: 2, lastKnownPage: 13, hasNext: true });
    expect(html).toContain("Primeira");
    expect(html).toContain("‹ Anterior");
    expect(html).toContain("Próxima ›");
    expect(html).toContain("Última");
    // current page is marked, not a button
    expect(html).toContain('aria-current="page"');
  });

  it("exact mode hides Primeira/Anterior on the first page", () => {
    const html = render({ currentPage: 1, lastKnownPage: 5, hasNext: true });
    expect(html).not.toContain("Primeira");
    expect(html).not.toContain("Anterior");
    expect(html).toContain("Próxima ›");
  });

  it("exact mode hides Próxima/Última on the last page", () => {
    const html = render({ currentPage: 5, lastKnownPage: 5, hasNext: false });
    expect(html).toContain("‹ Anterior");
    expect(html).not.toContain("Próxima ›");
    expect(html).not.toContain("Última");
  });

  it("windowed mode never shows Primeira or Última", () => {
    const html = render({ currentPage: 3, lastKnownPage: 3, hasNext: true, exact: false });
    expect(html).not.toContain("Primeira");
    expect(html).not.toContain("Última");
    expect(html).toContain("Próxima ›");
  });

  it("windowed mode drops Próxima when the upstream signal says there is no more", () => {
    const html = render({ currentPage: 3, lastKnownPage: 3, hasNext: false, exact: false });
    expect(html).not.toContain("Próxima ›");
    expect(html).toContain("‹ Anterior");
  });

  it("disables every control while loading", () => {
    const html = render({ currentPage: 2, lastKnownPage: 13, hasNext: true, disabled: true });
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((tag) => tag.includes("disabled"))).toBe(true);
  });
});
