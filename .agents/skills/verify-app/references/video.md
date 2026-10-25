# Annotated browser video

Record with `bun run verify --video`; footage cannot be added without another run. FFmpeg/ffprobe are required. If unavailable, report blocked delivery and retain raw capture. For claims without video see [harness reporting](harness.md#criteria-and-claims).

## Timing and citations

`results.json` supplies approximate primary-page `videoSeconds` windows. Inspect rendered frames to confirm them; never guess missing positions. Whole-test citations and secondary/multiple primary-page recordings have no reliable mapped assertion window.

Label scenes only with overlapping cited assertions. Use artifact-only scenes for context. Service-only/MCP-only claims belong in `notShown`; a mixed step needs an asserted browser checkpoint to carry a claim into footage. Headless tests produce no recording.

Keep footage and evidence from the same run/source. Preserve readable baseline/action/result sequences and disclose cuts, setup omissions, and simulation. Never splice separate runs into apparent continuous proof.

## Direction: `shots.json`

Write in the run directory using a listed run-relative recording:

```json
{
  "rawVideo": "test-results/<test>/video.webm",
  "scenes": [
    {
      "start": 0,
      "end": 3.5,
      "title": "Confirmed result",
      "text": "Where to look and what was observed",
      "claims": ["C1"],
      "artifacts": ["test-results/<test>/result.png"]
    }
  ],
  "notShown": [
    {
      "claim": "C2",
      "reason": "Protocol-only assertion; see its transcript"
    }
  ]
}
```

Scenes are ordered, non-overlapping, inside the recording, with nonblank title/text and claims/artifacts arrays. At least one array is nonempty. Every passed/failed criterion needs a scene or an explicit nonvisual evidence explanation. [Video validation](../../../../e2e/verify/renderVideo.ts) owns exact shape/alignment rules.

## Render and review

```sh
bun run verify:video "$RUN_DIR"
```

The renderer produces a silent annotated H.264 MP4 beneath the untouched capture, decode-checks it, and extracts start/middle/end review frames. **Inspect every frame** for truthful readable annotations, timing, unobscured UI, and a useful ending.

Write `visual-review.json`:

```json
{
  "walkthroughSha256": "<from media-check.json>",
  "reviewedFrames": ["scene-01-start.png", "..."],
  "approved": true,
  "findings": "What was checked and remaining caveats"
}
```

Any direction/claim change requires re-rendering and reviewing again; approval of an earlier artifact cannot approve its replacement. Run `bun run verify:review "$RUN_DIR"` to validate the current artifact, citations, and complete frame review. Deliver the reviewed MP4 with report and limitations—not raw capture described as an annotated walkthrough.
