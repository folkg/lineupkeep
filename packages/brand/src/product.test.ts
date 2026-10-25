import { expect, it } from "vitest";

import { productName } from "./product";

it("identifies the independent product as Lineupkeep", () => {
  const expectedName = "Lineupkeep";

  const name = productName;

  expect(name).toBe(expectedName);
});
