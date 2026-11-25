import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import type { Element } from "solid-js";

import { Text } from "./Text";

export function Table(props: TableProps): JSX.Element {
  return (
    <div class="w-full overflow-x-auto">
      <table
        aria-label={props.label}
        class="w-full min-w-[18rem] table-fixed border-collapse border border-rule text-left"
      >
        <colgroup>
          <For each={props.columns}>{(column) => <col class={column.width} />}</For>
        </colgroup>
        <thead>
          <tr class="border-b border-rule">
            <For each={props.columns}>
              {(column) => (
                <th
                  class={
                    column.align === "end" ? "px-2 py-2 text-right sm:px-3" : "px-2 py-2 sm:px-3"
                  }
                  scope="col"
                >
                  <Text type="label" tone="muted">
                    {column.label}
                  </Text>
                </th>
              )}
            </For>
          </tr>
        </thead>
        <tbody>
          <For each={props.rows}>
            {(row) => (
              <tr class="border-b border-rule last:border-b-0">
                <For each={row}>
                  {(cell, index) => (
                    <td class={cellClass(props.columns[index()]?.align)}>{cell}</td>
                  )}
                </For>
              </tr>
            )}
          </For>
        </tbody>
        <Show when={props.footer}>
          {(footer) => (
            <tfoot>
              <tr class="border-t border-rule-strong">
                <td class="px-2 py-2 sm:px-3" colspan={props.columns.length}>
                  {footer()}
                </td>
              </tr>
            </tfoot>
          )}
        </Show>
      </table>
    </div>
  );
}

function cellClass(align: "end" | undefined): string {
  return align === "end" ? "px-2 py-2 text-right sm:px-3" : "px-2 py-2 sm:px-3";
}

type TableColumn = {
  readonly label: string;
  readonly align?: "end";
  readonly width?: string;
};

type TableProps = {
  readonly label: string;
  readonly columns: ReadonlyArray<TableColumn>;
  readonly rows: ReadonlyArray<ReadonlyArray<Element>>;
  readonly footer?: Element;
};
