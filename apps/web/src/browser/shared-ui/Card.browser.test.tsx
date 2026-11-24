import "#web/styles.css";
import { render } from "@solidjs/web";
import type { JSX } from "@solidjs/web";
import { expect, it } from "vitest";
import { page } from "vitest/browser";

import { Badge } from "./Badge";
import { Card } from "./Card";

it("owns the frame, the header rule, and the padding", () => {
  using mounted = mount(() => (
    <Card
      badge={<Badge>Checks on</Badge>}
      footer={<button type="button">Confirm</button>}
      header={<h2>Alpha</h2>}
      labelledBy="alpha-card"
      meta={<p>Football · NFL 2026</p>}
    >
      <p>Last check changed nothing.</p>
    </Card>
  ));

  const card = mounted.host.querySelector<HTMLElement>("[data-card]");
  expect(card, "the card frame").not.toBeNull();
  if (card === null) {
    return;
  }
  const header = card.querySelector<HTMLElement>("[data-card-header]");
  const meta = card.querySelector<HTMLElement>("[data-card-meta]");
  const body = card.querySelector<HTMLElement>("[data-card-body]");
  const footer = card.querySelector<HTMLElement>("[data-card-footer]");
  expect(header, "the header slot").not.toBeNull();
  expect(meta, "the meta slot").not.toBeNull();
  expect(body, "the body slot").not.toBeNull();
  expect(footer, "the footer slot").not.toBeNull();
  if (header === null || meta === null || body === null || footer === null) {
    return;
  }

  expect(getComputedStyle(card).borderTopWidth).toBe("2px");
  expect(getComputedStyle(card).boxShadow).toBe("none");
  expect(getComputedStyle(header).borderBottomWidth).toBe("2px");
  expect(getComputedStyle(footer).borderTopWidth).toBe("2px");
  for (const part of [header, body, footer]) {
    expect(getComputedStyle(part).paddingLeft).toBe("16px");
    expect(getComputedStyle(part).paddingRight).toBe("16px");
  }
  expect(card.getAttribute("aria-labelledby")).toBe("alpha-card");
  expect(header.compareDocumentPosition(meta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(meta.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(body.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("keeps the badge in the top-right corner when a phone title wraps", async () => {
  await page.viewport(390, 844);
  using mounted = mount(() => (
    <Card
      badge={<Badge>Needs your decision</Badge>}
      header={<h2>Time and Tye McGinn and the Extra Long Team Name</h2>}
      labelledBy="team-card"
      meta={<p>NHL · Hockey · 2026</p>}
    >
      <p>Add Brayden Schenn and drop Juraj Slafkovský.</p>
    </Card>
  ));

  const header = mounted.host.querySelector<HTMLElement>("[data-card-header]");
  const title = page
    .getByRole("heading", { name: "Time and Tye McGinn and the Extra Long Team Name" })
    .element();
  const badge = mounted.host.querySelector<HTMLElement>("[data-card-badge]");
  expect(header, "the header").not.toBeNull();
  expect(badge, "the badge").not.toBeNull();
  if (header === null || badge === null) {
    return;
  }
  const headerBox = header.getBoundingClientRect();
  const titleBox = title.getBoundingClientRect();
  const badgeBox = badge.getBoundingClientRect();
  expect(getComputedStyle(header).display).toBe("grid");
  expect(badgeBox.top).toBeLessThanOrEqual(titleBox.top + 1);
  expect(badgeBox.bottom).toBeLessThanOrEqual(headerBox.bottom);
  expect(badgeBox.left).toBeGreaterThanOrEqual(titleBox.right - 1);
  expect(titleBox.height).toBeGreaterThan(Number.parseFloat(getComputedStyle(title).lineHeight));
});

function mount(view: () => JSX.Element): {
  readonly host: HTMLDivElement;
  [Symbol.dispose](): void;
} {
  const host = document.body.appendChild(document.createElement("div"));
  const dispose = render(view, host);
  return {
    host,
    [Symbol.dispose](): void {
      dispose();
      host.remove();
    },
  };
}
