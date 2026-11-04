import { productName } from "@lineupkeep/brand/product";
import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import type { Element } from "solid-js";

import { BrandLink } from "#browser/brand-ui/BrandLink.tsx";
import { Nav } from "#browser/shared-ui/Nav.tsx";
import { NavLink } from "#browser/shared-ui/NavLink.tsx";
import { PageShell } from "#browser/shared-ui/PageShell.tsx";

import { ThemeProvider } from "./ThemeProvider";
import { useSessionActions } from "./useSessionActions";

export function AppShell(props: AppShellProps): JSX.Element {
  return (
    <ThemeProvider>
      <PageShell
        brand={
          <BrandLink aria-label={`${productName} home`} to="/">
            {productName}
          </BrandLink>
        }
        navigation={<PrimaryNavigation />}
      >
        {props.children}
      </PageShell>
    </ThemeProvider>
  );
}

function PrimaryNavigation(): JSX.Element {
  const session = useSessionActions();

  return (
    <Show when={session.isSignedIn()}>
      <Nav label="Primary navigation">
        <NavLink to="/teams">Teams</NavLink>
        <NavLink to="/connections">Connections</NavLink>
        <NavLink to="/feedback">Feedback</NavLink>
        <NavLink to="/account">Account</NavLink>
      </Nav>
    </Show>
  );
}

type AppShellProps = {
  readonly children: Element;
};
