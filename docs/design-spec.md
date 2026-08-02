# ClearPost design specification

The accepted visual references are:

- `docs/concepts/options-page.png` — full settings surface at 1440 × 1000.
- `docs/concepts/result-overlay.png` — loading and result states in an X timeline context at 1440 × 900.

## Visual system

- Background: true white (`#ffffff`).
- Ink: `#111827`; supporting text: `#2f3a4d`; muted text: `#687488`.
- Accent: cobalt `#1769e8`; success: `#149b50`; rules: `#d7dee8`.
- Typography: system sans, disciplined 12.5–15px UI chrome, 17px section/result headings, 30–42px wordmark.
- Geometry: 8–10px control radius, 1px rules, almost no options-page shadow, restrained overlay elevation.
- Container model: open sections separated by rules, one right rail, one overlay panel. No nested cards.
- Signature motif: a thin cobalt proofreading underline beneath part of the ClearPost wordmark.

## Interaction inventory

- Options: password input, model select, connection test, three switches, response-language select, post-submit radio state, save success state.
- Diagnostics: opt-in debug-logging switch with a short privacy explanation.
- Overlay: loading progress, clean result, correction comparison, follow-up conversation, dismiss, retry, and missing-key settings action.
- Follow-up conversation: contextual prompt, bounded message thread, question input, send, retry, and return-to-result actions.
- Motion: 180ms overlay entry and indeterminate progress; removed under `prefers-reduced-motion`.
- Focus: cobalt 3px focus ring; every action remains keyboard operable.

## Intentional implementation decisions

- The default model is `deepseek-v4-flash`, replacing the early concept's `deepseek-chat`, because it is the current low-latency model documented by DeepSeek.
- Result acknowledgement text is dynamic model output; the concept's clean-result sentence remains the fallback.
- The settings page uses no external font or raster production asset so the unpacked extension has no non-API network dependency.
