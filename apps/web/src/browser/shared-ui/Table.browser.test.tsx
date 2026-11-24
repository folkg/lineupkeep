import { EffectArray } from "@lineupkeep/collections";

import "#web/styles.css";
import { render } from "@solidjs/web";
import type { JSX } from "@solidjs/web";
import { expect, it } from "vitest";

import { Table } from "./Table";
import { Text } from "./Text";

it("labels the table, its columns, and right-aligns numbers", () => {
  using mounted = mount(() => (
    <Table
      columns={[
        { label: "Category" },
        { label: "Stat", align: "end" },
        { label: "Place", align: "end" },
      ]}
      label="My categories"
      rows={[
        [<Text type="body">Goals</Text>, <Text type="meta">84</Text>, <Text type="meta">4th</Text>],
      ]}
    />
  ));

  const table = mounted.host.querySelector<HTMLTableElement>("table");
  expect(table, "the table").not.toBeNull();
  if (table === null) {
    return;
  }
  expect(table.getAttribute("aria-label")).toBe("My categories");
  const headers = [...table.querySelectorAll<HTMLTableCellElement>("th")];
  expect(EffectArray.map(headers, (header) => header.textContent)).toEqual([
    "Category",
    "Stat",
    "Place",
  ]);
  expect(EffectArray.every(headers, (header) => header.getAttribute("scope") === "col")).toBe(true);
  const cells = [...table.querySelectorAll<HTMLTableCellElement>("td")];
  expect(EffectArray.map(cells, (cell) => cell.textContent)).toEqual(["Goals", "84", "4th"]);
  expect(getComputedStyle(cells[0] ?? table).textAlign).toBe("left");
  expect(getComputedStyle(cells[1] ?? table).textAlign).toBe("right");
  expect(getComputedStyle(cells[2] ?? table).textAlign).toBe("right");
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
