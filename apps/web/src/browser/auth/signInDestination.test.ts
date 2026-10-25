import { expect, it } from "vitest";

import { signInDestinations } from "./signInDestination";

it("preserves repeated signed OAuth parameters in the Google failure return", () => {
  const query =
    "?client_id=https%3A%2F%2Fclient.test%2Fmeta&ba_param=client_id&ba_param=scope&scope=notes%3Aread+notes%3Awrite&sig=a%2Bb%2Fc%3D";

  const destinations = signInDestinations(query, "/notes");

  expect(destinations).toEqual({ returnTo: "/notes", errorReturnTo: `/auth${query}` });
  expect(
    new URL(destinations.errorReturnTo, "https://app.test").searchParams.getAll("ba_param"),
  ).toEqual(["client_id", "scope"]);
});

it("returns to an application page without a custom OAuth continuation", () => {
  expect(signInDestinations("", "/notes?state=trashed").returnTo).toBe("/notes?state=trashed");
  expect(signInDestinations("", undefined).returnTo).toBe("/notes");
});

it.each(["https://evil.test/", "//evil.test/", "/\\\\evil.test/", "javascript:alert(1)"])(
  "rejects an external return destination %s",
  (destination) => {
    expect(signInDestinations("", destination).returnTo).toBe("/notes");
  },
);
