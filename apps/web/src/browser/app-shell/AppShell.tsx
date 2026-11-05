import { productName } from "@lineupkeep/brand/product";
import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import type { Element } from "solid-js";

import { BrandLink } from "#browser/brand-ui/BrandLink.tsx";
import { Nav } from "#browser/shared-ui/Nav.tsx";
import { NavLink } from "#browser/shared-ui/NavLink.tsx";
import { PageShell } from "#browser/shared-ui/PageShell.tsx";
import { TextLink } from "#browser/shared-ui/TextLink.tsx";

import { ThemeProvider } from "./ThemeProvider";
import { useSessionActions } from "./useSessionActions";

export function AppShell(props: AppShellProps): JSX.Element {
  const session = useSessionActions();
  const footer = (): Element | undefined =>
    props.footer === false || !session.isSignedIn() ? undefined : <FeedbackFooter />;

  return (
    <ThemeProvider>
      <PageShell
        brand={
          <BrandLink aria-label={`${productName} home`} to="/">
            {productName}
          </BrandLink>
        }
        footer={footer()}
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
        <NavLink to="/account">Account</NavLink>
      </Nav>
    </Show>
  );
}

function FeedbackFooter(): JSX.Element {
  return (
    <TextLink size="caption" tone="quiet" to="/feedback">
      Feedback
    </TextLink>
  );
}

type AppShellProps = {
  readonly footer?: boolean;
  readonly children: Element;
};
