---
name: Sourdough Starter
description: A working prompt-book system for focused notes and adaptable product UI.
colors:
  canvas: "#f4f3ee"
  paper: "#ffffff"
  ink: "#181a19"
  action: "#215cff"
  action-hover: "#1549d8"
  accent: "#d8ff36"
  on-accent: "#162100"
  danger: "#b62f2f"
  panel: "#181a19"
  on-panel: "#eef0ed"
typography:
  display:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "clamp(4.2rem, 7.3vw, 5.75rem)"
    fontWeight: 700
    lineHeight: 0.88
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "clamp(2.7rem, 1.867rem + 3.556vw, 3.2rem)"
    fontWeight: 700
    lineHeight: 0.95
    letterSpacing: "-0.02em"
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
  supporting:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "0.94rem"
    fontWeight: 400
    lineHeight: 1.65
  control:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "0.9rem"
    fontWeight: 700
    lineHeight: 1
rounded:
  tape: "2px"
  sheet: "3px"
  control: "5px"
  surface: "8px"
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.paper}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "0 18px"
    height: "46px"
  button-accent:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "0 18px"
    height: "46px"
  field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "48px"
  note-card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
    padding: "22px"
---

# Design System: Sourdough Starter

## Overview

**Creative North Star: "The Prompt Book"**

Sourdough Starter looks like a working document prepared for use: paper, black cue rails, decisive controls, and compressed headings locate the task. This is a replaceable reference identity, not a brand requirement for seeded apps.

**Key Characteristics:**

- Working paper and flat reading surfaces.
- Compressed headings for orientation.
- Distinct action and cue signals.

## Colors

Cobalt marks digital action and focus; lime marks orientation and the next local cue, with dark on-accent text. Danger red is for destructive actions and errors. Paper, ink, and rules structure the workspace.

**The Two-Signal Rule.** Never swap action and cue roles for variety.

[Theme CSS](apps/web/src/theme/brand-theme.css) owns light/dark values; the frontmatter is a compact light-theme snapshot. Panels retain prompt-black identity in both themes. Surface context automatically adapts text, fields, and feedback—there is no field `on-panel` tone prop.

## Typography

Barlow Condensed carries statements and headings; platform sans carries reading and controls. Regular body text, semibold quiet controls, and bold headings/labels have distinct roles. Base field text and supporting reading text are separate tokens; `Text` body uses supporting size. [Utility mapping](apps/web/src/theme/design-system.css) owns the full hierarchy.

## Layout

Use asymmetrical spreads for introductions and a composer beside the working set on wide screens; collapse into document flow on compact screens. Keep headings near supporting copy and preserve safe-area gutters.

**The Native-Scroll Rule.** The document owns vertical scrolling; route content, lists, and cards remain overflow-visible.

## Elevation & Depth

Flat surfaces, contrast, and rules establish structure. The landing prompt sheet alone receives focal lift; keyboard focus uses the shared ring.

**The One-Lift Rule.** Routine surfaces do not combine borders and ambient shadows.

## Shapes

Fitted controls, nearly square sheets, and small tape markers create a workmanlike language rather than pills.

## Components

[Neutral primitives](apps/web/src/browser/shared-ui) isolate behavior; [brand compositions](apps/web/src/browser/brand-ui) supply identity. Component types own options. Fields own labels/errors and surface adaptation. Prefer named primitive options over local styling: semantic tokens isolate identity while wrappers focus accessibility fixes. Grow a primitive for a genuine requirement rather than adding style escape hatches; wrappers still need behavior tests as dependencies evolve. Motion follows theme tokens and respects reduced motion. [Web interactions](.agents/skills/web-interactions/SKILL.md) owns feedback and recovery.

## Do's and Don'ts

- **Do** adapt semantic tokens before individual routes.
- **Do** keep display type for orientation, not paragraphs.
- **Don't** decorate with lime or turn every surface into a floating card.
- **Don't** introduce nested vertical scrolling.
