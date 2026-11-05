import { expect, it } from "vitest";

import { makeAuthClient } from "./authClient";

it.each(["email", "google"] as const)(
  "carries the raw signed OAuth query through %s sign-in",
  async (method) => {
    const rawQuery =
      "?client_id=https%3A%2F%2Fclient.test%2Fmeta&ba_param=client_id&ba_param=scope&scope=connections%3Aread+connections%3Awrite&sig=a%2Bb%2Fc%3D";
    using _history = setupHistory(rawQuery);
    const authClient = makeAuthClient((_input, init) => {
      if (typeof init?.body !== "string") {
        return Promise.reject(new Error("Expected a serialized sign-in body"));
      }
      const posted: unknown = JSON.parse(init.body);
      return Promise.resolve(Response.json({ posted }));
    });
    const response =
      method === "email"
        ? await authClient.signIn.emailOtp({ email: "reader@example.test", otp: "123456" })
        : await authClient.signIn.social({ provider: "google", callbackURL: "/account" });

    expect(response.error).toBeNull();
    expect(response.data).toMatchObject({ posted: { oauth_query: rawQuery.slice(1) } });
  },
);

function setupHistory(query: string): Disposable {
  using resources = new DisposableStack();
  const originalUrl = window.location.href;
  const originalState: unknown = window.history.state;
  resources.defer(() => window.history.replaceState(originalState, "", originalUrl));
  window.history.replaceState(null, "", query);
  return resources.move();
}
