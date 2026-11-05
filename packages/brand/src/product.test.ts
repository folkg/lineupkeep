import { expect, it } from "vitest";

import { productName } from "./product";

it("identifies the independent product as Lineupgrade", () => {
  const expectedName = "Lineupgrade";

  const name = productName;

  expect(name).toBe(expectedName);
});
