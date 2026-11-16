import type { JSX } from "@solidjs/web";
import ArrowUpRight from "~icons/lucide/arrow-up-right";
import ChevronRight from "~icons/lucide/chevron-right";
import LoaderCircle from "~icons/lucide/loader-circle";
import RefreshCw from "~icons/lucide/refresh-cw";
import X from "~icons/lucide/x";

import googleG from "./brand/google-g.svg";
import { cx } from "./cx";

export const ArrowUpRightIcon = icon(ArrowUpRight);
export const ChevronRightIcon = icon(ChevronRight);
export const LoaderCircleIcon = icon(LoaderCircle);
export const RefreshIcon = icon(RefreshCw);
export const XIcon = icon(X);

export function GoogleGIcon(): JSX.Element {
  return <img alt="" height={20} src={googleG} width={20} />;
}

function icon(
  Svg: (props: JSX.SvgSVGAttributes<SVGSVGElement>) => JSX.Element,
): (props: IconProps) => JSX.Element {
  return (props: IconProps) => (
    <Svg
      class={cx(props.class, props.spin === true && "animate-spin motion-reduce:animate-none")}
      height={iconSize[props.size]}
      width={iconSize[props.size]}
    />
  );
}

const iconSize = { sm: 15, md: 17 };

type IconProps = {
  readonly class?: string;
  readonly size: keyof typeof iconSize;

  readonly spin?: boolean;
};
