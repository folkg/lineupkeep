import "#web/styles.css";
import { render } from "@solidjs/web";
import { expect, it } from "vitest";
import { page } from "vitest/browser";

import { ActionBar } from "./ActionBar";
import { Button } from "./Button";

it("keeps one action order from wide screens down to phones", async () => {
  await page.viewport(900, 800);
  using _app = renderBar();

  const destructive = box("Discard");
  const tertiary = box("Cancel");
  const secondary = box("Schedule");
  const primary = box("Run now");
  expect(destructive.x).toBeLessThan(tertiary.x);
  expect(tertiary.x).toBeLessThan(secondary.x);
  expect(secondary.x).toBeLessThan(primary.x);

  await page.viewport(390, 844);
  const phoneTertiary = box("Cancel");
  const phoneSecondary = box("Schedule");
  const phonePrimary = box("Run now");
  const phoneDestructive = box("Discard");
  const bar = page.getByRole("group").element().getBoundingClientRect();
  expect(phoneTertiary.y).toBeLessThan(phonePrimary.y);
  expect(phoneSecondary.y).toBeLessThan(phonePrimary.y);
  expect(phonePrimary.width).toBeGreaterThanOrEqual(bar.width - 4);
  expect(phonePrimary.y).toBeLessThan(phoneDestructive.y);
});

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
        tertiary={<Button variant="quiet">Cancel</Button>}
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
