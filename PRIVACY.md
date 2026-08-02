# ClearPost privacy notes

ClearPost `0.2.1` has no analytics, telemetry, advertising, account system, or developer-operated server.

## Data sent to DeepSeek

After an X publish control is activated, ClearPost sends:

- the submitted text;
- the enabled check categories and response-language instruction;
- the selected model name; and
- the user's API key in the HTTPS authorization header.

When the user starts a follow-up conversation, ClearPost sends the follow-up question together with the active proofread result (original text, suggested text, issue explanations, and prior conversation turns). This gives DeepSeek enough context to answer clarification questions without storing a local conversation history.

The request goes directly from the extension service worker to `https://api.deepseek.com/chat/completions`. DeepSeek's own terms and privacy practices apply to that request.

## Data ClearPost does not send

ClearPost does not add any of the following to the DeepSeek request:

- the X username or account identifier;
- cookies or X authentication data;
- the X page URL;
- images, video, GIFs, polls, or other media;
- drafts before the publish action;
- timeline content; or
- browser history.

The content script can see the X page DOM because that is required to identify the active composer. The initial network-facing message contains only the captured composer text; a follow-up message additionally contains the explicit question and active proofread context described above.

## Local storage

The extension stores these values in `chrome.storage.local`:

- the DeepSeek API key;
- selected model;
- enabled checks;
- response-language preference; and
- behavior mode.
- debug-logging preference.

ClearPost does not persist submitted text, follow-up questions, model responses, or a checking history. Conversation data exists only while its result panel is open. Removing the extension removes its extension-local storage under normal Chromium behavior.

`chrome.storage.local` is isolated from ordinary webpages but is not an encrypted password vault. Protect the operating-system account and browser profile accordingly.

## Diagnostic logs

Debug logging is off by default and can be enabled in the settings page. When enabled, the extension console records request IDs, timings, model name, HTTP status, response length/type, and coarse response-shape flags. It does not record the API key, submitted text, or full model response. Failed-request error summaries are recorded without requiring the opt-in toggle.

## Permissions

- `storage`: saves the local API key and preferences.
- `https://x.com/*`: runs the submission listener on X pages.
- `https://api.deepseek.com/*`: allows the service worker to call only DeepSeek's API origin.

There is no broad browsing-site permission and no arbitrary cross-origin proxy capability.
