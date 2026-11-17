import "#web/styles.css";
import { render } from "@solidjs/web";
import type { JSX } from "@solidjs/web";
import { expect, it } from "vitest";

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
