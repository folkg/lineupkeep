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
      actions={<AppActions />}
    >
      {props.children}
    </PageShell>
  );
}

function AppActions(): JSX.Element {
  const session = useSessionActions();

  return (
    <>
      <Nav label="Primary navigation">
        <NavLink to="/notes">Notes</NavLink>
        <Show fallback={<NavLink to="/auth">Sign in</NavLink>} when={session.isSignedIn()}>
          <Button
            pending={session.isSigningOut()}
            pendingLabel="Signing out…"
            variant="quiet"
            onClick={() => void session.signOut()}
          >
            Sign out
          </Button>
        </Show>
      </Nav>
      <ThemeToggle />
    </>
  );
}

type AppShellProps = {
  readonly children: Element;
};
