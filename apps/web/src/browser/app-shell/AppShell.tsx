import { productName } from "@lineupkeep/brand/product";
import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import type { Element } from "solid-js";

import { BrandLink } from "#browser/brand-ui/BrandLink.tsx";
import { Button } from "#browser/shared-ui/Button.tsx";
import { Nav } from "#browser/shared-ui/Nav.tsx";
import { NavLink } from "#browser/shared-ui/NavLink.tsx";
import { PageShell } from "#browser/shared-ui/PageShell.tsx";

import { ThemeToggle } from "./ThemeToggle";
import { useSessionActions } from "./useSessionActions";

export function AppShell(props: AppShellProps): JSX.Element {
  return (
    <PageShell
      brand={
        <BrandLink aria-label={`${productName} home`} to="/">
          {productName}
        </BrandLink>
      }
      navigation={<PrimaryNavigation />}
      controls={<ThemeToggle />}
    >
      {props.children}
    </PageShell>
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
        <NavLink to="/account">Your data</NavLink>
        <Button
          pending={session.isSigningOut()}
          pendingLabel="Signing out…"
          variant="quiet"
          onClick={() => void session.signOut()}
        >
          Sign out this device
        </Button>
      </Nav>
    </Show>
  );
}

type AppShellProps = {
  readonly children: Element;
};
