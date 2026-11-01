import { Config, Effect } from "effect";

import { runBackend } from "#server/backendEntry.ts";

export function handleFakeProvider(request: Request): Promise<Response> {
  return runBackend(
    request,
    "dev.provider_login",
    Effect.gen(function* () {
      const environment = yield* Config.Literals(
        ["development", "production", "test"],
        "APP_ENV",
      ).pipe(
        Config.orElse(() => Config.Literals(["development", "production", "test"], "NODE_ENV")),
        Config.withDefault("production"),
      );
      if (environment === "production") {
        return new Response("Not found", { status: 404 });
      }
      const url = new URL(request.url);
      if (request.method === "POST") {
        const form = yield* Effect.promise(() => request.formData().catch(() => undefined));
        const username = form?.get("username");
        if (typeof username === "string" && gmailAddress(username)) {
          return new Response(refusedIdentifierPage, {
            headers: {
              "cache-control": "no-store",
              "content-type": "text/html; charset=utf-8",
            },
          });
        }
        const counter = yield* Effect.sync(() => ++fakeTokenCounter);
        const headers = new Headers({
          "cache-control": "no-store",
          "content-type": "text/html; charset=utf-8",
        });
        headers.append("set-cookie", `T=fake-token-${counter}; Path=/; HttpOnly; SameSite=Lax`);
        headers.append("set-cookie", `Y=fake-user-${counter}; Path=/; HttpOnly; SameSite=Lax`);
        headers.append("set-cookie", `FAKE-SESSION=${counter}; Path=/; HttpOnly; SameSite=Lax`);
        return new Response(successPage, { headers });
      }
      const mode = url.searchParams.get("mode");
      return new Response(
        mode === "blocked" ? blockedPage : mode === "two-factor" ? twoFactorPage : loginPage,
        {
          headers: {
            "cache-control": "no-store",
            "content-type": "text/html; charset=utf-8",
          },
        },
      );
    }),
  );
}

let fakeTokenCounter = 0;

const loginPage = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Stand-in provider sign-in</title>
    <style>
      body { margin: 0; font-family: system-ui, sans-serif; background: #f4f1fb; color: #241b3a; }
      main { max-width: 420px; margin: 72px auto; padding: 32px; background: #fff; border-radius: 18px; box-shadow: 0 18px 48px rgba(54, 26, 120, 0.14); }
      h1 { margin: 0 0 8px; font-size: 24px; }
      p { margin: 0 0 24px; color: #5d5473; line-height: 1.5; }
      label { display: block; margin: 0 0 16px; font-weight: 600; }
      input { box-sizing: border-box; width: 100%; margin-top: 8px; padding: 11px 13px; border: 1px solid #cfc6e6; border-radius: 9px; font: inherit; }
      button { width: 100%; padding: 12px; border: 0; border-radius: 9px; background: #5b2bd1; color: #fff; font: inherit; font-weight: 700; }
      small { display: block; margin-top: 18px; color: #786f8c; }
    </style>
  </head>
  <body>
    <main>
      <h1>Stand-in provider sign-in</h1>
      <p>This test page exists only in development and automated tests. It never asks for a password.</p>
      <form method="POST" action="/api/dev/provider-login">
        <label>Username <input name="username" autofocus autocomplete="off"></label>
        <button type="submit">Sign in</button>
      </form>
      <p id="gmail-notice" hidden>To use a Gmail address, sign in with Google.</p>
      <small>This stand-in page runs only in development and automated tests.</small>
      <script>
        const input = document.querySelector('input[name="username"]');
        const notice = document.getElementById('gmail-notice');
        const submit = document.querySelector('button[type="submit"]');
        input.addEventListener('input', () => {
          const value = input.value.trim().toLowerCase();
          const gmail = value.endsWith('@gmail.com') || value.endsWith('@googlemail.com');
          notice.hidden = !gmail;
          submit.disabled = gmail;
        });
      </script>
    </main>
  </body>
</html>`;

const successPage = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Signed in</title></head>
<body><main><h1>Signed in</h1><p>You can return to Lineupkeep.</p></main></body></html>`;

const blockedPage = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Sign-in blocked</title></head>
<body><main><h1>Sign-in blocked</h1><p>This stand-in shows the blocked state.</p></main></body></html>`;

const twoFactorPage = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Additional verification</title></head>
<body><main><h1>Additional verification</h1><p>This stand-in shows the two-factor state.</p></main></body></html>`;

const refusedIdentifierPage = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Stand-in provider sign-in</title>
    <style>
      body { margin: 0; font-family: system-ui, sans-serif; background: #f4f1fb; color: #241b3a; }
      main { max-width: 420px; margin: 72px auto; padding: 32px; background: #fff; border-radius: 18px; box-shadow: 0 18px 48px rgba(54, 26, 120, 0.14); }
      h1 { margin: 0 0 8px; font-size: 24px; }
      p { margin: 0 0 16px; color: #5d5473; line-height: 1.5; }
      a { color: #5b2bd1; font-weight: 700; }
    </style>
  </head>
  <body>
    <main>
      <h1>Sign in</h1>
      <p>To use a Gmail address, sign in with Google.</p>
      <p>This stand-in shows the provider refusal.</p>
      <a href="/api/dev/provider-login">Use another address</a>
    </main>
  </body>
</html>`;

function gmailAddress(value: string): boolean {
  return /@(?:gmail|googlemail)\.com$/iu.test(value.trim());
}
