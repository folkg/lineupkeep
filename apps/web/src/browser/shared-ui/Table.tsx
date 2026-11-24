import type { JSX } from "@solidjs/web";
import { For } from "solid-js";
import type { Element } from "solid-js";

import { Text } from "./Text";

export function Table(props: TableProps): JSX.Element {
  return (
    <div class="w-full overflow-x-auto">
      <table
        aria-label={props.label}
        class="w-full min-w-[18rem] border-collapse border border-rule text-left sm:min-w-[26rem]"
      >
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
                  <Text type="label" tone="faint">
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
                    <td
                      class={
                        props.columns[index()]?.align === "end"
                          ? "px-2 py-2 text-right sm:px-3"
                          : "px-2 py-2 sm:px-3"
                      }
                    >
                      {cell}
                    </td>
                  )}
                </For>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}

type TableColumn = {
  readonly label: string;
  readonly align?: "end";
};

type TableProps = {
  readonly label: string;
  readonly columns: ReadonlyArray<TableColumn>;
  readonly rows: ReadonlyArray<ReadonlyArray<Element>>;
};
