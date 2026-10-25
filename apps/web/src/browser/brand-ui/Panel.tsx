import type { JSX } from "@solidjs/web";
import { Show, createUniqueId } from "solid-js";
import type { Element } from "solid-js";

import { Heading } from "#browser/shared-ui/Heading.tsx";
import { PanelSurface } from "#browser/shared-ui/Surface.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";

import { Tape } from "./Tape";

export function Panel(props: PanelProps): JSX.Element {
  const titleId = createUniqueId();
  return (
    <PanelSurface>
      <section
        aria-labelledby={titleId}
        class="grid gap-3.5 rounded-surface bg-panel p-surface text-on-panel"
      >
        <div class="grid gap-2">
          <div class="flex items-center justify-between gap-4">
            <Heading id={titleId} level={2} size="subtitle">
              {props.title}
            </Heading>
            <Show when={props.marker}>{(marker) => <Tape size="glyph">{marker()}</Tape>}</Show>
          </div>
          <Show when={props.description}>
            {(description) => (
              <Text size="caption" tone="muted">
                {description()}
              </Text>
            )}
          </Show>
        </div>
        {props.children}
      </section>
    </PanelSurface>
  );
}

type PanelProps = {
  readonly title: string;
  readonly marker?: string;
  readonly description?: string;
  readonly children: Element;
};
