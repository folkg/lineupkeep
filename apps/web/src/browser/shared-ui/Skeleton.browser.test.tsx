import "#web/styles.css";
import { render } from "@solidjs/web";
import type { JSX } from "@solidjs/web";
import { expect, it } from "vitest";

import { Heading } from "./Heading";
import { TextSkeleton } from "./Skeleton";
import { Text } from "./Text";

it("gives body text skeletons the line height of the text they stand in for", () => {
  expect(heightOf(() => <Text type="body">Aa</Text>)).toBe(
    heightOf(() => <TextSkeleton type="body" />),
  );
  expect(heightOf(() => <Text type="body-strong">Aa</Text>)).toBe(
    heightOf(() => <TextSkeleton type="body-strong" />),
  );
  expect(heightOf(() => <Text type="meta">Aa</Text>)).toBe(
    heightOf(() => <TextSkeleton type="meta" />),
  );
  expect(heightOf(() => <Text type="label">Aa</Text>)).toBe(
    heightOf(() => <TextSkeleton type="label" />),
  );
});

it("gives title skeletons the line height of the title they stand in for", () => {
  expect(
    heightOf(() => (
      <Heading level={4} type="card-title">
        Aa
      </Heading>
    )),
  ).toBe(heightOf(() => <TextSkeleton type="card-title" />));
  expect(
    heightOf(() => (
      <Heading level={2} type="section-title">
        Aa
      </Heading>
    )),
  ).toBe(heightOf(() => <TextSkeleton type="section-title" />));
});

function heightOf(view: () => JSX.Element): number {
  const host = document.body.appendChild(document.createElement("div"));
  const dispose = render(view, host);
  const height = host.firstElementChild?.getBoundingClientRect().height ?? 0;
  dispose();
  host.remove();
  return height;
}
