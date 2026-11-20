import type { JSX } from "@solidjs/web";
import ArrowLeft from "~icons/lucide/arrow-left";
import ArrowUpRight from "~icons/lucide/arrow-up-right";
import BadgeCheck from "~icons/lucide/badge-check";
import Ban from "~icons/lucide/ban";
import Check from "~icons/lucide/check";
import ChevronDown from "~icons/lucide/chevron-down";
import ChevronRight from "~icons/lucide/chevron-right";
import ChevronUp from "~icons/lucide/chevron-up";
import CircleQuestionMark from "~icons/lucide/circle-question-mark";
import CircleSlash from "~icons/lucide/circle-slash";
import ClockCheck from "~icons/lucide/clock-check";
import Hourglass from "~icons/lucide/hourglass";
import IterationCcw from "~icons/lucide/iteration-ccw";
import LoaderCircle from "~icons/lucide/loader-circle";
import RefreshCw from "~icons/lucide/refresh-cw";
import RotateCw from "~icons/lucide/rotate-cw";
import SendHorizontal from "~icons/lucide/send-horizontal";
import SkipForward from "~icons/lucide/skip-forward";
import X from "~icons/lucide/x";

import googleG from "./brand/google-g.svg";
import { cx } from "./cx";

export const ArrowLeftIcon = icon(ArrowLeft);
export const ArrowUpRightIcon = icon(ArrowUpRight);
export const BanIcon = icon(Ban);
export const BadgeCheckIcon = icon(BadgeCheck);
export const CheckIcon = icon(Check);
export const ChevronDownIcon = icon(ChevronDown);
export const ChevronRightIcon = icon(ChevronRight);
export const ChevronUpIcon = icon(ChevronUp);
export const CircleQuestionMarkIcon = icon(CircleQuestionMark);
export const CircleSlashIcon = icon(CircleSlash);
export const ClockCheckIcon = icon(ClockCheck);
export const HourglassIcon = icon(Hourglass);
export const IterationCcwIcon = icon(IterationCcw);
export const LoaderCircleIcon = icon(LoaderCircle);
export const PauseIcon = icon(PauseGlyph);
export const PlayIcon = icon(PlayGlyph);
export const RefreshIcon = icon(RefreshCw);
export const RotateCwIcon = icon(RotateCw);
export const SendHorizontalIcon = icon(SendHorizontal);
export const SkipForwardIcon = icon(SkipForward);
export const XIcon = icon(X);

function PauseGlyph(props: JSX.SvgSVGAttributes<SVGSVGElement>): JSX.Element {
  return (
    <svg
      {...props}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-width="2"
      viewBox="0 0 24 24"
    >
      <path d="M9 5v14M15 5v14" />
    </svg>
  );
}

function PlayGlyph(props: JSX.SvgSVGAttributes<SVGSVGElement>): JSX.Element {
  return (
    <svg
      {...props}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="2"
      viewBox="0 0 24 24"
    >
      <path d="m7 4 12 8-12 8z" />
    </svg>
  );
}

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

const iconSize = { sm: 15, md: 17, lg: 20 };

type IconProps = {
  readonly class?: string;
  readonly size: keyof typeof iconSize;

  readonly spin?: boolean;
};
