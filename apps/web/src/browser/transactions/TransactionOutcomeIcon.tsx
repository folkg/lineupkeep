import type { JSX } from "@solidjs/web";

import {
  BadgeCheckIcon,
  BanIcon,
  CheckIcon,
  CircleQuestionMarkIcon,
  CircleSlashIcon,
  ClockCheckIcon,
  HourglassIcon,
  IterationCcwIcon,
  RotateCwIcon,
  SendHorizontalIcon,
  SkipForwardIcon,
  XIcon,
} from "#browser/shared-ui/icons.tsx";
import { StatusIcon } from "#browser/shared-ui/StatusIcon.tsx";
import type { TransactionMoveView } from "#contracts/connections/transactionContract.ts";

import { moveOutcome } from "./transactionTimes";
import type { MoveOutcome, MoveOutcomeIcon } from "./transactionTimes";

export function TransactionOutcomeIcon(props: TransactionOutcomeIconProps): JSX.Element {
  const outcome = (): MoveOutcome =>
    moveOutcome(props.move) ?? { label: "Ended", icon: "circle-slash", tone: "muted" };
  return (
    <StatusIcon label={outcome().label} tone={outcome().tone}>
      {glyph(outcome().icon)}
    </StatusIcon>
  );
}

function glyph(icon: MoveOutcomeIcon): JSX.Element {
  switch (icon) {
    case "badge-check":
      return <BadgeCheckIcon size="lg" />;
    case "ban":
      return <BanIcon size="lg" />;
    case "check":
      return <CheckIcon size="lg" />;
    case "circle-question-mark":
      return <CircleQuestionMarkIcon size="lg" />;
    case "circle-slash":
      return <CircleSlashIcon size="lg" />;
    case "clock-check":
      return <ClockCheckIcon size="lg" />;
    case "hourglass":
      return <HourglassIcon size="lg" />;
    case "iteration-ccw":
      return <IterationCcwIcon size="lg" />;
    case "rotate-cw":
      return <RotateCwIcon size="lg" />;
    case "send-horizontal":
      return <SendHorizontalIcon size="lg" />;
    case "skip-forward":
      return <SkipForwardIcon size="lg" />;
    case "x":
      return <XIcon size="lg" />;
  }
}

type TransactionOutcomeIconProps = {
  readonly move: TransactionMoveView;
};
