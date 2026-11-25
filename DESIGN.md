---
name: Lineupgrade
description: "Your lineup. Looked after."
colors:
  canvas: "#f4efe4"
  paper: "#fffdf7"
  ink: "#141217"
  ink-soft: "#6a6470"
  ink-faint: "#6f6875"
  rule: "#cdc5b7"
  rule-strong: "#141217"
  action: "#5b21b6"
  action-hover: "#4c1d95"
  action-soft: "#f3eeff"
  on-action: "#fffdf7"
  accent: "#e0b64a"
  on-accent: "#101014"
  spot: "#d9482b"
  danger: "#a33432"
  danger-hover: "#802421"
  danger-soft: "#faece9"
  scrim: "rgb(16 16 20 / 0.55)"
  dark-canvas: "#12100d"
  dark-paper: "#1a1713"
  dark-ink: "#f4ede0"
  dark-ink-soft: "#b8ab99"
  dark-ink-faint: "#a89b89"
  dark-rule: "#3b332a"
  dark-rule-strong: "#b6a78f"
  dark-action: "#bda7ff"
  dark-action-hover: "#d3c2ff"
  dark-action-soft: "#2b2340"
  dark-on-action: "#171018"
  dark-accent: "#e0b64a"
  dark-on-accent: "#101014"
  dark-spot: "#ff9a76"
  dark-danger: "#ffb4a8"
  dark-danger-hover: "#ffd0c7"
  dark-danger-soft: "#452823"
  dark-scrim: "rgb(0 0 0 / 0.7)"
typography:
  display:
    fontFamily: "Archivo Variable, sans-serif"
    fontSize: "clamp(2.75rem, 5vw, 4.25rem)"
    fontWeight: 800
    lineHeight: 0.98
    letterSpacing: "-0.035em"
  page-title:
    fontFamily: "Archivo Variable, sans-serif"
    fontSize: "clamp(2.75rem, 5.4vw, 4.375rem)"
    fontWeight: 800
    lineHeight: 0.95
    letterSpacing: "-0.035em"
    textTransform: "uppercase"
  section-title:
    fontFamily: "Archivo Variable, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  card-title:
    fontFamily: "Archivo Variable, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Schibsted Grotesk Variable, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.55
  body-strong:
    fontFamily: "Schibsted Grotesk Variable, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.45
  meta:
    fontFamily: "Schibsted Grotesk Variable, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Schibsted Grotesk Variable, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.16em"
  badge:
    fontFamily: "Schibsted Grotesk Variable, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.16em"
rounded:
  badge: "0px"
  control: "0px"
  surface: "0px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  section: "32px"
  section-wide: "48px"
  control-min: "44px"
  content-max: "680px"
  table-max: "960px"
shadows:
  focus: "0 0 0 2px {colors.canvas}, 0 0 0 4px {colors.action}"
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.on-action}"
    borderColor: "{colors.rule-strong}"
    borderWidth: "2px"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    height: "44px"
    padding: "0 20px"
  button-primary-hover:
    backgroundColor: "{colors.action-hover}"
  button-secondary:
    textColor: "{colors.ink}"
    borderColor: "{colors.rule-strong}"
    borderWidth: "2px"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    height: "44px"
    padding: "0 20px"
  text-field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    borderColor: "{colors.rule-strong}"
    borderWidth: "2px"
    rounded: "{rounded.control}"
    height: "44px"
  badge:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.action}"
    borderColor: "{colors.rule-strong}"
    borderWidth: "2px"
    typography: "{typography.label}"
    rounded: "{rounded.badge}"
    padding: "4px 8px"
  section-title:
    borderColor: "{colors.rule-strong}"
    borderWidth: "3px"
    typography: "{typography.section-title}"
  queue-panel:
    backgroundColor: "{colors.paper}"
    borderColor: "{colors.rule-strong}"
    borderWidth: "2px"
---

# Design System: Lineupgrade

## Overview

**Creative North Star: "Ink and paper"**

Lineupgrade reads as a printed sports sheet: warm newsprint, near-black ink, a display face for the
page and the teams, and Schibsted for the work in between. Section rules are 3px ink; row hairlines
stay 1px. Team cards and queue groups are the same plain 2px-ruled box on paper, set at least 24px
apart. Royal violet
is spent on interaction, gold exists only in the mark, and one spot ink marks urgency. The product
is calm enough to check in the morning and precise enough to trust with a lineup.

This is an Operate product: information before spectacle, familiar controls, direct labels, and
honest state. Light is warm newsprint; dark is the same paper after dark, with violet kept for interaction. Both are complete palettes.

**Key Characteristics:**

- Archivo Variable for the display, page title, name title, section title, and card title types at weight 800;
  Schibsted Grotesk Variable for body, body strong, meta, label, and badge
- Square everywhere; 3px ink section rules, 1px row hairlines, and a 2px ink rule around each team
  card
- One 680px measure and one solid action per view
- One 2px ink frame for every card, and no shadow beyond the focus ring
- Numbers aligned with tabular figures, never prose tracking
- Royal violet for interaction; gold only in the mark; spot ink only for urgency
- Light and dark designed together

Runtime values live in [brand-theme.css](apps/web/src/theme/brand-theme.css);
[design-system.css](apps/web/src/theme/design-system.css) maps them to Tailwind utilities. The
frontmatter and the [schema-v2 sidecar](.impeccable/design.json) carry the same primitives. Keep
all three aligned.

## Colour, exactly

Violet owns interaction. Ink and rule carry everything else. Gold is the brand mark's fill and is
never used for text, actions, status, or decoration. Spot ink is the one urgency accent; danger
remains the error and destructive colour.

### Paper light

| Token          | Value                  | Role                                                      |
| -------------- | ---------------------- | --------------------------------------------------------- |
| `canvas`       | `#f4efe4`              | Warm newsprint page field                                 |
| `paper`        | `#fffdf7`              | Inputs, badges, queue panels, and the mark's surroundings |
| `ink`          | `#141217`              | Primary text, headings, mark strokes                      |
| `ink-soft`     | `#6a6470`              | Secondary text, quiet links, quiet controls               |
| `ink-faint`    | `#6f6875`              | Metadata, labels, placeholders                            |
| `rule`         | `#cdc5b7`              | 1px hairlines between rows                                |
| `rule-strong`  | `#141217`              | 3px section rules, 2px control borders, active nav rule   |
| `action`       | `#5b21b6`              | The one solid action, action links, live controls, focus  |
| `action-hover` | `#4c1d95`              | Action hover                                              |
| `action-soft`  | `#f3eeff`              | Selection and quiet interactive ground                    |
| `on-action`    | `#fffdf7`              | Text on a solid action                                    |
| `accent`       | `#e0b64a`              | Brand mark fill only                                      |
| `on-accent`    | `#101014`              | Mark strokes only                                         |
| `spot`         | `#d9482b`              | Urgency only: runs immediately, illegal roster, stamp     |
| `danger`       | `#a33432`              | Errors, destructive actions, attention text               |
| `danger-hover` | `#802421`              | Danger hover                                              |
| `danger-soft`  | `#faece9`              | Danger hover ground                                       |
| `scrim`        | `rgb(16 16 20 / 0.55)` | Modal scrim                                               |

### Newsprint dark

| Token          | Value              | Role                                                     |
| -------------- | ------------------ | -------------------------------------------------------- |
| `canvas`       | `#12100d`          | Warm charcoal page field                                 |
| `paper`        | `#1a1713`          | Inputs and queue panels, one step above the field        |
| `ink`          | `#f4ede0`          | Primary text, headings                                   |
| `ink-soft`     | `#b8ab99`          | Secondary text, quiet links, quiet controls              |
| `ink-faint`    | `#a89b89`          | Metadata, labels, placeholders                           |
| `rule`         | `#3b332a`          | 1px hairlines between rows                               |
| `rule-strong`  | `#b6a78f`          | 3px section rules, 2px control borders, active nav rule  |
| `action`       | `#bda7ff`          | The one solid action, action links, live controls, focus |
| `action-hover` | `#d3c2ff`          | Action hover                                             |
| `action-soft`  | `#2b2340`          | Selection and quiet interactive ground                   |
| `on-action`    | `#171018`          | Text on a solid action                                   |
| `accent`       | `#e0b64a`          | Brand mark fill only                                     |
| `on-accent`    | `#101014`          | Mark strokes only                                        |
| `spot`         | `#ff9a76`          | Urgency only: runs immediately, illegal roster, stamp    |
| `danger`       | `#ffb4a8`          | Errors, destructive actions, attention text              |
| `danger-hover` | `#ffd0c7`          | Danger hover                                             |
| `danger-soft`  | `#452823`          | Danger hover ground                                      |
| `scrim`        | `rgb(0 0 0 / 0.7)` | Modal scrim                                              |

**Measured pairs.** Body and interface text pairs clear WCAG AA: ink 16.2:1 (light) and 15.3:1
(dark); ink-soft 5.0:1 and 7.9:1; ink-faint 4.7:1 and 6.6:1; action 7.8:1 on canvas and 9.2:1 on
the dark field; on-action on action 8.8:1 and 9.0:1; action on action-soft 7.9:1 and 7.2:1; danger
5.9:1 and 10.5:1; danger on danger-soft 5.9:1 and 7.8:1; on-accent on accent 9.9:1 in both.
Hairlines are non-text. The mark's strokes are a graphic and clear 9.9:1. Gold never carries text
on the page. Spot ink is 3.7:1 on canvas and 4.2:1 on paper in light, and 8.6:1 or better in dark;
it is reserved for short, bold urgency marks and the square, never for body copy.

**The One Violet Rule.** Per view, one solid violet element: the primary action. Links and live
controls carry violet as text, underline, or border. Everything else is ink, soft ink, and rule.
Danger is a semantic exception, used only for errors and destructive actions.

**The Gold Reserve Rule.** Gold belongs to the mark and nowhere else. It is not a status, a
highlight, a badge, or a second action.

**The Spot Ink Rule.** Spot ink is reserved for three urgency marks: a group that runs immediately,
a roster that blocks adds and drops, and the printed stamp. It is not an error colour; danger owns
errors and destructive actions.

## Typography

**Two faces with separate jobs.** Display type is Archivo Variable, self-hosted through
Fontsource (`@fontsource-variable/archivo`). Work type is Schibsted Grotesk Variable,
self-hosted through Fontsource. Archivo carries the display scale: display, page title, name
title, section title, and card title at weight 800. Schibsted carries the work scale: body, body strong, meta,
label, and badge. No serif, no third face. Google's branded button keeps Google's prescribed G and
type.

**One named set.** Every text element picks a type; no call site picks a raw size. Each type owns
one size, weight, line height, and tracking.

The display scale:

- **Display** — `clamp(44px, 5vw, 68px)`, weight 800, line height 0.98, `-0.035em`. The landing
  statement only.
- **Page title** — `clamp(44px, 5.4vw, 70px)`, weight 800, line height 0.95, `-0.035em`,
  uppercase. One per page.
- **Name title** — `clamp(32px, 3.2vw, 44px)`, weight 800, line height 1.1, `-0.025em`. A team
  name used as a page title. It keeps its case and sits above section titles.
- **Section title** — 24px, weight 800, line height 1.2, `-0.02em`. Section headings and the
  transaction day headings.
- **Card title** — 20px, weight 800, line height 1.15, `-0.02em`. Team names, group cards, and
  dialog titles.

The work scale:

- **Body** — 15px, weight 400, line height 1.55. Prose, rows, links, field values.
- **Body strong** — 15px, weight 600, line height 1.45. Move titles, connection-row titles, and
  emphasized prose.
- **Meta** — 12px, weight 400, line height 1.5. League context, timestamps, helper copy, feedback,
  field labels, and control labels. These labels are sentence case, never caps.
- **Label** — 11px, weight 600, line height 1.2, `0.16em` tracking. Nav items, table headers, and
  the masthead wordmark. These are the only places caps still carry a job.
- **Badge** — 11px, weight 600, line height 1, `0.16em` tracking. The status word in a badge.

Tracking belongs to display type and labels. Body and meta use normal tracking; display, page
titles, section titles, and card titles use `-0.02em` to `-0.035em`. Never add letter spacing to
body text.

**Numerals.** Use `font-variant-numeric: tabular-nums` for integers compared in a column, such as
`time`, counts, attempts, and record tallies. Apply it to the numeric element or line, never to
prose. Decimal figures stay proportional and right-aligned: in Schibsted Grotesk tabular figures
widen the decimal point and produce gaps inside values such as `0.00` and `2.04`.

**The Wordmark Rule.** The wordmark stays continuous lowercase `lineupgrade` in Schibsted Grotesk at
the label type's size, weight, and tracking, beside the square mark. Archivo never sets the
wordmark. Use Lineupgrade in prose. Do not uppercase, split, outline, or colour the syllables.

**The Mark.** A 20px gold square with ink `lu` strokes: a lowercase l with a short foot so it
cannot read as an I, and a square u with a rounded inner corner, 6 units of stroke in a 64 unit
box. It sits at the masthead's left edge. The same artwork is the favicon. Gold appears nowhere
else.

## Layout

**Page headers.** The page title starts at the same top edge on every route. A route kicker,
when present, sits directly under the title in the meta type; it never pushes the title down and
never adds a second accent colour.

**Actions.** One `ActionBar` owns the order. On wide screens the destructive action is separated
at the left, and tertiary, secondary, then primary actions sit together at the right. On phones
every action shares one equal-width row, ordered destructive, tertiary, secondary, primary. A
lone action fills the row. An action area holds at most three actions; more belong in an overflow
menu. Labels never truncate. A label may wrap to a second line, and every button in the row takes
the tallest height. A cancel that only closes an editor is neutral; danger belongs to actions that
discard or delete.

**Action labels.** Start with a verb and name the outcome: `Run now`, `Save schedule`, `Discard`,
`Cancel`. Keep labels to one or two words. Do not use `OK`, `Yes`, or a bare `Submit`. Do not
shorten with an ellipsis or an unstated abbreviation when the full verb fits. A destructive label
names the action it performs.

**One measure.** The application column is 680px. Lists and tables may extend to 960px when their
columns genuinely need it; no content runs the viewport width. The masthead, section rules, row
rules, and controls share the column's left and right edges.

**The masthead** is one row inside the measure on wide screens: the brand mark and lowercase
wordmark at the left, the primary navigation at the right. Below 560px the navigation wraps under
the brand. There is no theme control or sign-out utility in the masthead. One 3px `rule-strong`
rule closes it. Navigation labels use the label type in caps; the active item carries a 2px ink
rule that spans exactly the item, not a short bar or an overhanging block. The links wrap as whole
items, with no utility action left on a line of its own.

**Rows and cards** use two columns from 560px: text at the left, one control cluster at the right. A team
card puts its provider jump-out at the far right of the control row; the checks toggle and pause
sit at the left, so every card has the same control shape and the league line stays calm. The
pause is a 28px square icon frame showing Pause or Play, so changing state never shifts the
cluster; its accessible name stays the full pause or resume sentence, and it stays in place and
is disabled while checks are off. The card header is a two-column grid: title and meta take the
remaining width, and the badge keeps the top-right corner at every size. A long team or league
name wraps inside its column; it never truncates and never pushes the badge below. Below 560px
the body stacks and the control row keeps the toggle and pause at the left and the provider link
at the right. Controls never overlap a name.

**Team detail order** is fixed: back link, title, one metadata line (sport and league), one
control row with toggle, pause, and the provider jump-out at the far right, then a season and week
split, the lineup runs behind their rule, and the owner note. The split is two
rule-led sections, not one card: season facts sit in a narrow side rail and the current week and
its category table take the main column. The week line leads with the week and keeps its regular
and playoff notes on their own lines. On phones the season facts come first. The provider
jump-out sits at the far right of the control row here and on the list. Nothing floats to the
right of the metadata line. Head-to-head category tables end on their last category; a running win
total is not shown because nothing has been won while the week is live. Rotisserie tables end
with total points.

**Current matchup.** The result leads. A head-to-head categories block starts with the
category record; a points block starts with the score, always at least two decimal places.
Projected points sit directly under the result in the meta type, followed by one meta line with
the opponent and the remaining games. That line reserves two lines so a long opponent name cannot
move the card. No other line in the block is bold. The week copy uses the same words on the
card and the detail page: `Week 9 of 23 regular`, `14 regular weeks left`, `3 playoff weeks`.

**Team cards.** The team list puts each team in its own card, sorted by sport then name; the
sport is already in the card's meta line, so there are no league headings or counts. A card has
a 2px ink rule and the normal `paper` ground. Team names on the list use the card-title type; a team name used as a page title uses the
name-title type.
the meta and status lines use the meta type.

**Card badges.** `Card` takes a `badge` element, normally a `Badge`. The caller supplies the
meaning; `Card` owns the fixed top-right placement. A team list passes the short scoring label
(`Categories`, `Points`, or `Rotisserie`), and a transaction card passes its status. `Nov 1, 11:44 AM to 1:12 PM`. When the group is a
single instant, say `at Nov 1, 11:44 AM`; when it crosses the reader's midnight, show both full
dates.

**Alignment.** Text shares one left edge. Controls share one right edge above 560px and one left
edge below it. Toggle, pause, and provider controls sit on the text's first-line baseline; the
toggle and pause share one horizontal line.

## Elevation and shape

There are no rounded corners. Controls, toggles, inputs, badges, dialogs, and surfaces are square.
Radii are `0px` in the tokens, and a component must not add one.

Nothing casts a shadow. The focus ring is the only shadow in the interface; buttons, fields, team
cards, queue groups, notices, and quiet surfaces all cast none. There are no gradients except the
phone submit sheet fade. A surface earns a border when it is a control (an input, a button, the
hosted browser viewport, or a dialog), a team card, or a queue group. Cards sit at least 24px apart.
Prose, connection lists, notices, and empty states use rules, not boxes.

**The Rule, Not a Box Rule.** A section title owns one 3px ink rule. Connection rows own 1px
hairlines between them. Team cards and queue groups own the same 2px ink rule each.
Status and empty states use a leading rule or plain text, never a dashed or bordered card.

**The Phone Submit Sheet.** Below 560px the submit controls sit in a sheet fixed to the bottom with
no rule of their own. A 16px canvas fade above it takes the rule's place, so the page blends into
the action instead of stacking a second panel on top of it. The fade is the one gradient in the
product, and it exists only at that edge.

## Motion

Most of the interface does not move. Motion is spent on the few moments a person meets rarely: a
list arriving where an empty state was, and a submitted set settling into its outcome. Nothing on the
frequent path animates — no hover, focus, list row at rest, navigation, or control press. The one
continuous motion in the product is the hairline a working control draws.

**The Rare Moment Rule.** A moment earns motion when it is occasional or first-time and its purpose
is to prevent a jarring change or to make a state legible. If it repeats many times a day, or it only
looks nice, it stays still. A pending navigation is the one frequent exception: one hairline progress
bar appears as feedback while the destination loads. Loading shapes use a quiet opacity pulse, and
stop when the person asks for reduced motion.

- An arrival settles in once: `opacity` from 0 with a 4px rise, on `--theme-duration-reveal` with
  `--theme-ease-out`. It plays when content becomes populated while the page is open; a page load or
  a navigation never animates.
- The phone submit sheet settles in once when it first appears at the bottom: the same 4px rise and
  `opacity` entrance on the reveal token, and it holds still after that. It is the one fixed element
  that animates, and it holds still under reduced motion.
- Only `transform` and `opacity` move. Nothing animates a width, a height, a margin, a padding, or an
  offset.
- The working hairline travels in container units — a length, never a percentage of its own box — and
  asks for its own layer with `will-change: transform`. Its travel is then a value the compositor can
  take, so the line keeps its speed and its one-third width without resolving against layout every
  frame.
- Durations and easings come from the tokens beside them. A component never invents one, and the UI
  stays under 300ms. Constant motion — the working hairline — is `linear`.
- Motion is CSS: a transition where a state can change back, keyframes for a one-shot entrance. There
  is no animation library.
- `prefers-reduced-motion: reduce` is authoritative. Every duration collapses to zero, the working
  hairline holds still, and entrances are removed rather than shortened. The content is the same
  content.

The [action states](#action-states) keep their own timing: the switch, the pause, the refresh tick,
and note save are decided there and are not retimed by a motion pass.

## Components

### Actions

- **Primary:** solid `action`, `on-action` text, a 2px ink border, 44px high, 11px caps, square.
  One per view.
- **Secondary:** 2px `rule-strong` border, ink text, 44px, square.
- **Quiet:** 11px caps ink-soft text, no border; used for sign-out and other low-stakes controls.
- **Link:** action violet with a 2px underline, used for navigation and recovery. An inline
  recovery action such as `Reconnect` stays a link at the surrounding meta size; it never becomes
  a bordered button inside a sentence. Quiet links use ink-soft, not violet.
- **Pause:** an icon control in the 28px square frame inside a 44px hit area, beside the team's
  checks toggle. It shows Pause or Play so the control keeps its place; its accessible name
  remains the full pause or resume sentence.
- **Icon:** a 28px square frame with a 2px `rule-strong` border inside a 44px hit area. The frame
  sits flush with the column edge; the hit area may extend into the gutter. The pause control
  and the refresh control use this control; the provider jump-out is a meta text link at the far
  right of the row.
- **Google:** Google's G and prescribed light/dark fill, square to match the sheet, with its own
  14px type as the one branded exception.

Pressed, pending, disabled, and focus states remain native and accessible. Focus is a 2px action
ring with 2px separation; it is visible on every ground and does not rely on colour alone.

### Fields

Labels use the meta type in sentence case. Inputs are 44px, 15px body, square, with a 2px
`rule-strong` border and `paper` ground. Descriptions and errors are 12px; errors are danger and sit beside the field.
Placeholders are not labels. The caret and selection use action tokens.

### Toggle

A 40×22 track with a 2px ink edge, 3px padding, and a 16px square knob. The edge is drawn
inside the track so the outer size never changes. On fills the track with `action` and draws
the knob in `on-action`; off fills the track with `paper` and draws the knob in `ink`.
The track carries a 44px hit area. In a list of teams the label is hidden and the card's name
identifies the toggle; on a single team the `Lineup checks` label is visible. The pause control
always sits beside the toggle; when checks are off it is disabled with an explanatory title rather
than removed.

### Lists and status

Connection rows use body text with meta lines and a 1px bottom hairline. Team cards and
transaction group cards share one Card frame: a 2px ink rule on the `paper` ground, one header rule,
and one footer rule, with at least 24px between cards. A team name uses the card-title type where the
card is a primary destination. Status is a labelled word in caps, never a colour alone. Team cards keep one status
line under the league context in every state — the next check, a pause with its resume time,
checks off, or a check in progress — then what the last check did, when, and the recent tally. The
status line reserves two lines so its sentence cannot change the card's height. A provider
jump-out sits at the far right of the control row; the left cluster is the toggle and pause
only. A list never repeats a control label on every row.

Notices are a 2px leading rule with caps title and 12px detail. Empty states are a top rule with a
15px title and soft text. Loading never guesses a card shape. The team row stores its scoring
format at discovery, so a first load paints the known card frame and fills only its missing value
slots with typed skeletons; a card whose facts are already in the tab cache paints in full. A list
whose teams are still pending waits under one moving violet mark. Transactions uses the same mark
on first load. The only row skeleton is the already-run list on Transactions, where the real row
count is known and the fade ends the list. A value that is missing inside a real table keeps its
cell and uses a typed skeleton. A table skeleton stays inside its cell. A text
skeleton takes the type it stands in for, so its line box and every following section stay at the
settled height; the bar is 0.62em tall inside that line box. Use a named `TextSkeleton` type rather
than a pixel height. The live status region stays in the accessibility tree when empty (visually
hidden) and becomes visible when a message arrives.

### Browser and dialogs

The hosted browser viewport keeps a 1px border and square corners; it has no simulated traffic
lights, no shadow, and no panel treatment. A dialog uses a `paper` ground, a 1px border, the scrim
token, and the same square corners.

### Operational states

Connection health, team automation, actionable period, and run outcome stay explicit. Automation
off, paused, reconnect required, unavailable, queued, checking, verified unchanged, verified
updated, and needs reconciliation are distinct. Never flatten them into green/red or Done.

A pause is not a disable, expired connection is not lost enrollment, unavailable is not deleted,
and sent is not verified. Paused rows name the rest of the fantasy day and show the resume time in
the reader's locale. Reconnect-required rows retain enrollment and expose one explicit reconnect
path.

A run detail shows the target period, trigger, attempts, verified outcome, changes, and pending
reason without exposing credentials, cookies, provider GUIDs, raw payloads, or raw errors.

### Action states

Every `Button`, `ButtonLink`, `IconButton`, and `Switch` carries
`state?: "idle" | "working" | "done"`. A control that shows a value changes it the moment it is
pressed, then waits; a refusal returns the value and names the reason through `ActionFeedback`.
The control owns no value of its own.

While working, the control is natively disabled with `aria-busy`, keeps its label, and draws one
indeterminate hairline inside its own box: under a button's edge, inside a switch's track, inside
an icon's frame. `done` draws a tick only when the call site passes `confirmed`, because most
actions confirm themselves by changing something else. In an icon button the glyph fades fully out
before the tick draws alone in the same box, and returns after the tick has held; both are never
visible at once. A page never inserts words beside a control to describe its progress.
`ButtonLink` takes the action state as `actionState`, because TanStack Router owns `state` for
history.

`--theme-duration-work`, `--theme-duration-tick`, and `--theme-duration-confirm` in
[brand-theme.css](apps/web/src/theme/brand-theme.css) own the timing; components do not invent
durations, easings, or keyframes. Under `prefers-reduced-motion: reduce` the hairline holds still
and every state change is instant.

### Account

The Account page owns appearance, connections, sign-in sessions, data export, sign out, and
erasure. Appearance offers System, Light, and Dark; System follows the device and listens for
changes. Connect another account is a normal control inside Connections, under the description and
above the connection rows. A session row ends that session, and the current device carries the one
Sign out this device action. Your data holds one download action first, then the erase action with
its warning and required download step. Sign out is not in the masthead navigation. The page title and the
navigation label are both Account.

### Connections

The connection surface links through the hosted browser only; the web UI has no password field.
Each connection row names the provider, the teams it covers, when it was connected, and what its
current status can do. A connection that needs a new sign-in reopens the same hosted browser
session in place. The row's action column gives Reconnect the primary action when it is needed and
keeps Remove quiet beside it on the same row. Below 560px the pair stays on one left-aligned row,
so neither action becomes a full-width second row.

### Content and states

Use sentence case in prose and caps only for labels. Provider names appear only where a specific
connection, team, or run is named; the product stays provider neutral. Numbers are tabular when
compared; times are written in the reader's locale. Colour alone never communicates success, risk,
or connection health.

## Do's and Don'ts

### Do

- Do use semantic tokens and both complete themes.
- Do keep controls, inputs, badges, and dialogs square.
- Do keep the 680px measure and let tables exceed it only with a reason.
- Do use one 3px ink rule under a section title and 1px hairlines between list rows.
- Do set display, page titles, section titles, and card titles in Archivo at weight 800.
- Do choose a named text type and let it own its size, weight, line height, and tracking.
- Do spend violet once per view on the primary action.
- Do apply tabular numerals to comparable numbers only.
- Do keep the wordmark lowercase in Schibsted and the mark gold.
- Do frame every card with the same 2px ink rule and at least 24px between cards.
- Do reserve spot ink for urgency.
- Do keep motion to the rare moments named under [Motion](#motion), on the theme's duration and
  easing tokens.
- Do preserve keyboard access, visible focus, selection, zoom, and reduced motion.
- Do keep the provider jump-out at the far right of the control row and the pause control in place.
- Do let long names wrap and rows stack below 560px.

### Don't

- Don't add border radii, a shadow beyond the focus ring, a colour gradient beyond the phone
  submit sheet fade, or a second accent.
- Don't use gold outside the mark.
- Don't use a serif or a third face.
- Don't set body, body strong, meta, label, badge, or the wordmark in Archivo.
- Don't pick a raw text size or weight at a call site.
- Don't use spot ink for errors, destructive actions, or general status; danger owns those.
- Don't add a print texture.
- Don't box prose, connection rows, notices, or empty states.
- Don't add letter spacing to body text or apply tabular figures to prose.
- Don't repeat a control label on every row of a list.
- Don't remove a control or shift the cluster when it becomes unavailable; disable it in place.
- Don't float controls to the right of a metadata line.
- Don't use colour alone for connection, automation, or risk.
- Don't animate the frequent path: hover, focus, a list row at rest, navigation, or a control press.
- Don't expose credentials, cookies, provider GUIDs, raw payloads, or raw errors.

[Brand notes](docs/brand/BRAND.md) owns naming, voice, and placement. The [specimen](docs/brand/preview.html) illustrates the foundation; it is not a product prototype. This design does not authorize launch, waive the dependency blocker, or establish trademark/domain ownership.
