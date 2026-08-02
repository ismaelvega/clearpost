# Visual QA ledger

Verified on 2026-08-01 in the Codex in-app Chromium browser. The production options files were served unchanged, and the production `content-script.js` was exercised by `tests/fixtures/x-compose.html`.

## Viewports

- Options desktop: 1440 × 1000, compared with `docs/concepts/options-page.png`.
- Result overlay desktop: 1440 × 900, compared with `docs/concepts/result-overlay.png`.
- Follow-up Markdown desktop: 1280 × 720 in the local fixture.
- Follow-up Markdown mobile: 390 × 844.
- Options narrow layout: 390 × 844 with a full-page capture.
- Loading overlay: 1440 × 900.

## Fidelity comparison

| Area | Concept evidence | Render evidence | Result |
| --- | --- | --- | --- |
| Copy and hierarchy | ClearPost wordmark, one-line description, section order, right-side status rail | Same header, section order, labels, actions, privacy statement, and footer | Matched. The current model value intentionally differs; see below. |
| Container model | Open white layout, fine section rules, one vertical right rail, no card grid | Main form remains open; only the result overlay is elevated | Matched. |
| Palette | True white, dark ink, cobalt controls, gray rules, green active state | CSS tokens render those same roles with accessible contrast | Matched. |
| Typography and controls | System-sans utility typography, 14–15px controls, 17px headings, 8–10px radii | Rendered headings, labels, switches, selects, radios, and buttons preserve the scale and geometry | Matched; no browser-default control typography remains. |
| Options spacing | Airy desktop rhythm with aligned labels and fields | Desktop composition and first viewport align closely to the concept; the full page remains compact | Matched. |
| Overlay anatomy | Underlined wordmark, loading line, correction rows, metadata, follow-up/dismiss actions | Production Shadow DOM render contains each state and preserves the 392px compact width | Matched. The implementation sits at the true bottom-right instead of being centered on a presentation board. |
| Markdown reply | Clear hierarchy for explanatory copy | Assistant replies render paragraphs, ordered lists, emphasis, line breaks, and bounded spacing without raw Markdown markers | Matched. Raw HTML remains inert and no unsafe elements are created. |
| Icon treatment | Thin close/check glyphs and a small numbered suggestion marker | Custom SVG close/check treatment and restrained orange issue count | Matched. |
| Responsive behavior | Practical responsive continuation implied by the concept | 390px render has no horizontal overflow; fields stack and the workflow rail follows the form | Matched. |
| Motion and focus | Short loading/transition cues and cobalt focus treatment | 180ms panel entry, indeterminate progress, reduced-motion override, and 3px focus rings | Matched. |

## Above-the-fold copy diff

The rendered options page adds no unapproved heading, subtitle, badge, metric, or product area. Two intentional state/data differences remain:

- `deepseek-v4-flash` replaces the concept's early `deepseek-chat` value to follow the current DeepSeek model documentation.
- `Settings saved` appears only after a successful save rather than on initial load.

The result acknowledgement is API output and therefore dynamic; the concept sentence remains the fallback.

## Interaction checks

- Grammar switch changed state successfully.
- Saving produced the localized in-page `Settings saved` success state.
- A simulated publish activation captured the exact composer text and rendered the correction result.
- The result action opened the contextual follow-up view, accepted a question, showed a loading turn, and rendered the assistant response.
- A Markdown follow-up response rendered two ordered items, bold emphasis, and deliberate line breaks; DOM inspection found no `script`, `style`, `img`, or `iframe` nodes.
- A delayed simulated response rendered the loading state first.
- Desktop browser console: no errors.

No material visual mismatch remains against the accepted concepts.
