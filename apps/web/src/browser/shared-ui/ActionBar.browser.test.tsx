import "#web/styles.css";
import { render } from "@solidjs/web";
import { expect, it } from "vitest";
import { page } from "vitest/browser";

import { ActionBar } from "./ActionBar";
import { Button } from "./Button";

it("keeps destructive first and the primary last from wide screens down to phones", async () => {
  await page.viewport(900, 800);
  using _app = renderBar();

  expect(box("Discard").x).toBeLessThan(box("Schedule").x);
  expect(box("Schedule").x).toBeLessThan(box("Run now").x);
  const primary = page.getByRole("button", { name: "Run now", exact: true }).element();
  const bar = primary.closest("fieldset");
  expect(bar, "the action bar owns the row").not.toBeNull();
  expect(
    Math.abs(box("Run now").right - (bar?.getBoundingClientRect().right ?? 0)),
    "the primary action sits at the trailing edge",
  ).toBeLessThanOrEqual(1);

  await page.viewport(390, 844);
  const destructive = box("Discard");
  const secondary = box("Schedule");
  const phonePrimary = box("Run now");
  expect(destructive.x).toBeLessThan(secondary.x);
  expect(secondary.x).toBeLessThan(phonePrimary.x);
  expect(destructive.y).toBe(secondary.y);
  expect(secondary.y).toBe(phonePrimary.y);
  expect(Math.abs(destructive.width - secondary.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(secondary.width - phonePrimary.width)).toBeLessThanOrEqual(1);
});

it("gives a two-action editor one equal row", async () => {
  await page.viewport(390, 844);
  using _app = renderEditor();

  const cancel = box("Cancel");
  const save = box("Save schedule");
  expect(cancel.y).toBe(save.y);
  expect(Math.abs(cancel.width - save.width)).toBeLessThanOrEqual(1);
});

it("wraps longer labels without cutting them off on a narrow phone", async () => {
  await page.viewport(320, 700);
  using _app = renderLongLabels();

  for (const name of ["Discard group", "Schedule later", "Save schedule"]) {
    const button = page.getByRole("button", { name, exact: true }).element();
    expect(button.textContent).toBe(name);
    expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth + 1);
  }
});

function renderEditor(): { [Symbol.dispose](): void } {
  const host = document.body.appendChild(document.createElement("div"));
  const dispose = render(
    () => (
      <ActionBar
        primary={<Button>Save schedule</Button>}
        tertiary={<Button variant="secondary">Cancel</Button>}
      />
    ),
    host,
  );
  return {
    [Symbol.dispose](): void {
      dispose();
      host.remove();
    },
  };
}

function renderLongLabels(): { [Symbol.dispose](): void } {
  const host = document.body.appendChild(document.createElement("div"));
  const dispose = render(
    () => (
      <ActionBar
        destructive={
          <Button tone="danger" variant="quiet">
            Discard group
          </Button>
        }
        primary={<Button>Save schedule</Button>}
        secondary={<Button variant="secondary">Schedule later</Button>}
      />
    ),
    host,
  );
  return {
    [Symbol.dispose](): void {
      dispose();
      host.remove();
    },
  };
}

function renderBar(): { [Symbol.dispose](): void } {
  const host = document.body.appendChild(document.createElement("div"));
  const dispose = render(
    () => (
      <ActionBar
        destructive={
          <Button tone="danger" variant="quiet">
            Discard
          </Button>
        }
        primary={<Button>Run now</Button>}
        secondary={<Button variant="secondary">Schedule</Button>}
      />
    ),
    host,
  );
  return {
    [Symbol.dispose](): void {
      dispose();
      host.remove();
    },
  };
}

function box(name: string): DOMRect {
  return page.getByRole("button", { name, exact: true }).element().getBoundingClientRect();
}
