import { productName } from "@lineupkeep/brand/product";
import type { JSX } from "@solidjs/web";
import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from "@tanstack/solid-router";
import type { Element } from "solid-js";

import type { RouterContext } from "#browser/app-shell/routerContext.ts";
import { themeBootstrapScript } from "#browser/app-shell/theme.ts";
import { sessionQueries } from "#browser/session/sessionQueries.ts";

import "#web/styles.css";

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: `${productName} — Your lineup. Looked after.` },
      {
        name: "description",
        content:
          "Connect Yahoo once. Lineupkeep checks each enabled team's current scoring period every hour and makes the same teams available to an authorized MCP client.",
      },
    ],
    links: [{ rel: "icon", type: "image/svg+xml", href: "/brand/lineupkeep-mark.svg" }],
    scripts: [{ children: themeBootstrapScript }],
  }),

  loader: ({ context }) =>
    context.queryClient.prefetchQuery(sessionQueries.current(context.sessionRemote)),
  component: AppRoot,
  shellComponent: RootDocument,
});

function AppRoot(): JSX.Element {
  return <Outlet />;
}

function RootDocument(props: RootDocumentProps): JSX.Element {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {}
        {props.children}
        <Scripts />
      </body>
    </html>
  );
}

type RootDocumentProps = {
  readonly children: Element;
};
