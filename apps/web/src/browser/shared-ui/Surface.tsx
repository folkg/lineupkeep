import type { JSX } from "@solidjs/web";
import { createContext, useContext } from "solid-js";
import type { Element } from "solid-js";

const SurfaceContext = createContext<Surface>("page");

export function PanelSurface(props: { readonly children: Element }): JSX.Element {
  return <SurfaceContext value="panel">{props.children}</SurfaceContext>;
}

export function useSurface(): Surface {
  return useContext(SurfaceContext);
}

export type Surface = "page" | "panel";
