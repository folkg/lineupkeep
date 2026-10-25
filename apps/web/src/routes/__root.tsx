import type { JSX } from "@solidjs/web";
import { productName } from "@sourdough/brand/product";
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
      { title: `${productName} — notes in reach` },
      {
        name: "description",
        content: "A focused notes workspace built on a production-ready application starter.",
      },
    ],
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
      <body
        data-design-finish="reviewed-and-documented"
        data-design-seed="sourdough-starter-r1"
        data-design-world="prompt-book"
      >
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
