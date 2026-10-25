import { isRedirect } from "@tanstack/solid-router";
import { expect, it } from "vitest";

import { requireAuthenticatedSession } from "./requireAuthenticatedSession";

it("redirects an anonymous Session to authentication and back", async () => {
  const result = await requireAuthenticatedSession(
    () => Promise.resolve({ status: "anonymous" }),
    "/connections?status=linking",
  ).then(
    () => undefined,
    (error: unknown) => error,
  );

  expect(isRedirect(result)).toBe(true);
  expect(isRedirect(result) ? result.options.search : undefined).toEqual({
    redirect: "/connections?status=linking",
  });
});
