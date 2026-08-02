(() => {
  "use strict";

  const EDITOR_SELECTOR = '[data-testid^="tweetTextarea_"][contenteditable="true"]';
  const SUBMIT_TEST_ID = /^tweetButton(?:Inline)?$/;
  const DEDUPE_WINDOW_MS = 1_500;

  let activeEditor = null;
  let pointerSnapshot = null;
  let lastSubmission = { text: "", at: 0 };
  let overlay = null;
  let requestToken = 0;
  let debugLogging = false;
  let conversation = null;

  initializeDebugLogging();

  document.addEventListener("focusin", rememberEditor, true);
  document.addEventListener("input", rememberEditor, true);
  document.addEventListener("pointerdown", rememberPointerSnapshot, true);
  document.addEventListener("click", captureSubmission, true);

  function rememberEditor(event) {
    const editor = closestEditor(event.target);
    if (editor) {
      activeEditor = editor;
    }
  }

  function rememberPointerSnapshot(event) {
    const button = findSubmitButton(event.target);
    if (!button || isDisabled(button)) {
      return;
    }
    const snapshot = createSnapshot(button);
    if (snapshot) {
      pointerSnapshot = { button, snapshot, at: Date.now() };
    }
  }

  function captureSubmission(event) {
    const button = findSubmitButton(event.target);
    if (!button || isDisabled(button)) {
      return;
    }

    const freshPointerSnapshot = pointerSnapshot
      && pointerSnapshot.button === button
      && Date.now() - pointerSnapshot.at < 1_500
      ? pointerSnapshot.snapshot
      : null;
    pointerSnapshot = null;

    const snapshot = freshPointerSnapshot ?? createSnapshot(button);
    if (!snapshot || isDuplicate(snapshot.text)) {
      return;
    }

    contentLog("debug", "submission_captured", { textLength: snapshot.text.length });
    void checkSubmission(snapshot);
  }

  async function checkSubmission(snapshot) {
    const token = ++requestToken;
    conversation = null;
    showLoading(token);

    try {
      const response = await sendRuntimeMessage({
        type: "CLEARPOST_CHECK_TEXT",
        payload: { text: snapshot.text }
      });
      if (token !== requestToken) {
        return;
      }
      if (response?.skipped) {
        contentLog("debug", "check_skipped");
        dismissOverlay();
      } else if (response?.ok) {
        contentLog("debug", "check_completed", {
          verdict: response.result?.verdict ?? "unknown",
          issueCount: response.result?.issues?.length ?? 0
        });
        showResult(response.result, snapshot.text, token);
      } else {
        contentLog("error", "check_failed", {
          code: response?.error?.code ?? "UNKNOWN_ERROR",
          message: response?.error?.message ?? "Unknown error"
        }, true);
        showError(response?.error, snapshot, token);
      }
    } catch {
      if (token === requestToken) {
        contentLog("error", "runtime_message_failed", {
          message: "ClearPost could not start the DeepSeek check."
        }, true);
        showError({
          code: "EXTENSION_ERROR",
          message: "ClearPost could not start the DeepSeek check."
        }, snapshot, token);
      }
    }
  }

  function createSnapshot(button) {
    const editor = findEditorForButton(button);
    if (!editor) {
      return null;
    }
    const text = extractEditorText(editor);
    if (!text) {
      return null;
    }
    return { text, capturedAt: Date.now() };
  }

  function findEditorForButton(button) {
    const focusedEditor = closestEditor(document.activeElement);
    if (focusedEditor && isVisible(focusedEditor)) {
      return focusedEditor;
    }

    let container = button.parentElement;
    while (container && container !== document.body) {
      const candidates = [...container.querySelectorAll(EDITOR_SELECTOR)].filter(isVisible);
      if (candidates.length === 1) {
        return candidates[0];
      }
      container = container.parentElement;
    }

    if (activeEditor?.isConnected && isVisible(activeEditor)) {
      return activeEditor;
    }

    const visibleEditors = [...document.querySelectorAll(EDITOR_SELECTOR)].filter(isVisible);
    return visibleEditors.length === 1 ? visibleEditors[0] : null;
  }

  function findSubmitButton(target) {
    if (!(target instanceof Element)) {
      return null;
    }
    const candidate = target.closest("button, [role=\"button\"]");
    return candidate && SUBMIT_TEST_ID.test(candidate.getAttribute("data-testid") ?? "")
      ? candidate
      : null;
  }

  function closestEditor(target) {
    return target instanceof Element ? target.closest(EDITOR_SELECTOR) : null;
  }

  function extractEditorText(editor) {
    return (editor.innerText ?? editor.textContent ?? "")
      .replace(/\u200B/g, "")
      .replace(/\r\n?/g, "\n")
      .trim();
  }

  function isVisible(element) {
    return element.getClientRects().length > 0;
  }

  function isDisabled(button) {
    return button.matches(":disabled, [aria-disabled=\"true\"]");
  }

  function isDuplicate(text) {
    const now = Date.now();
    const duplicate = lastSubmission.text === text && now - lastSubmission.at < DEDUPE_WINDOW_MS;
    if (!duplicate) {
      lastSubmission = { text, at: now };
    }
    return duplicate;
  }

  function showLoading(token) {
    const ui = ensureOverlay();
    ui.shell.className = "shell loading";
    replaceChildren(ui.body,
      createHeader(() => cancelRequest(token)),
      element("p", { className: "loading-copy" }, "Checking your post…"),
      element("div", { className: "progress", role: "progressbar", "aria-label": "Checking with DeepSeek" },
        element("span", { className: "progress-bar" })
      )
    );
  }

  function showResult(result, originalText, token) {
    const ui = ensureOverlay();
    if (conversation?.token === token) {
      conversation.view = "result";
    }
    ui.shell.className = "shell result";
    const changed = result?.verdict === "changes" && result.correctedText !== originalText;
    const content = [createHeader(() => cancelRequest(token))];

    if (!changed) {
      content.push(
        element("div", { className: "result-heading-row" },
          successIcon(),
          element("h2", {}, "Your post looks clean")
        ),
        element("p", { className: "supporting" },
          result?.acknowledgement || "No grammar or spelling changes suggested."
        ),
        element("p", { className: "metadata" }, "Checked with DeepSeek"),
        element("div", { className: "actions" },
          button(conversationLabel(token), "primary-outline", () => openFollowUp(result, originalText, token)),
          button("Dismiss", "secondary", dismissOverlay)
        )
      );
    } else {
      const issueCount = Math.max(1, result?.issues?.length ?? 0);
      content.push(
        element("div", { className: "result-heading-row" },
          suggestionIcon(issueCount),
          element("h2", {}, `${issueCount} ${issueCount === 1 ? "suggestion" : "suggestions"}`)
        ),
        comparisonRow("Original", originalText),
        comparisonRow("Suggested", result.correctedText, true),
        result?.acknowledgement
          ? element("p", { className: "acknowledgement" }, result.acknowledgement)
          : null,
        element("p", { className: "metadata" }, "Checked with DeepSeek"),
        element("div", { className: "actions" },
          button(conversationLabel(token), "primary-outline", () => openFollowUp(result, originalText, token)),
          button("Dismiss", "secondary", dismissOverlay)
        )
      );
    }

    replaceChildren(ui.body, ...content.filter(Boolean));
  }

  function showError(error, snapshot, token) {
    const ui = ensureOverlay();
    ui.shell.className = "shell result";
    const missingKey = error?.code === "MISSING_API_KEY";
    replaceChildren(ui.body,
      createHeader(() => cancelRequest(token)),
      element("h2", { className: "error-heading" }, missingKey ? "Connect DeepSeek" : "Check unavailable"),
      element("p", { className: "supporting" }, error?.message || "ClearPost could not complete the check."),
      element("div", { className: "actions" },
        missingKey
          ? button("Open settings", "primary", openOptions)
          : button("Try again", "primary-outline", () => void checkSubmission(snapshot)),
        button("Dismiss", "secondary", dismissOverlay)
      )
    );
  }

  function conversationLabel(token) {
    return conversation?.token === token && conversation.turns.length > 0
      ? "Continue conversation"
      : "Ask a follow-up";
  }

  function openFollowUp(result, originalText, token) {
    if (!conversation || conversation.token !== token || conversation.context.originalText !== originalText) {
      conversation = {
        token,
        result,
        context: {
          originalText,
          suggestedText: result?.correctedText || originalText,
          acknowledgement: result?.acknowledgement || "",
          issues: Array.isArray(result?.issues) ? result.issues : []
        },
        turns: [],
        draft: "",
        pending: false,
        error: "",
        retryQuestion: ""
      };
    }
    showConversation(token);
  }

  function showConversation(token) {
    if (!conversation || conversation.token !== token) {
      return;
    }

    const ui = ensureOverlay();
    conversation.view = "conversation";
    ui.shell.className = "shell conversation";
    const thread = element("div", {
      className: "conversation-thread",
      role: "log",
      "aria-label": "ClearPost follow-up conversation"
    });

    if (conversation.turns.length === 0) {
      thread.append(element("p", { className: "conversation-empty" },
        "Ask why a change was suggested, request another wording, or clarify a grammar rule."
      ));
    } else {
      for (const turn of conversation.turns) {
        thread.append(
          element("div", { className: `message ${turn.role}` },
            element("span", { className: "message-label" }, turn.role === "user" ? "You" : "ClearPost"),
            element("p", { className: "message-text" }, turn.content)
          )
        );
      }
    }

    if (conversation.pending) {
      thread.append(element("div", { className: "message assistant pending-message" },
        element("span", { className: "message-label" }, "ClearPost"),
        element("p", { className: "message-text" }, "Thinking…")
      ));
    }

    if (conversation.error) {
      thread.append(element("div", { className: "conversation-error", role: "alert" },
        element("span", {}, conversation.error),
        conversation.retryQuestion
          ? button("Try again", "secondary compact", () => void retryFollowUp(token))
          : null
      ));
    }

    const input = element("textarea", {
      className: "follow-up-input",
      rows: "2",
      maxlength: "2000",
      placeholder: "Ask a follow-up question…",
      "aria-label": "Follow-up question"
    });
    input.value = conversation.draft;
    input.disabled = conversation.pending;
    input.addEventListener("input", () => {
      if (conversation?.token === token) {
        conversation.draft = input.value;
      }
    });

    const form = element("form", { className: "follow-up-form" });
    const sendButton = button("Send", "primary", () => {});
    sendButton.setAttribute("type", "submit");
    sendButton.disabled = conversation.pending;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void submitFollowUp(input.value, token);
    });
    form.append(
      input,
      element("div", { className: "actions conversation-actions" },
        button("Back to result", "secondary", () => showResult(conversation.result, conversation.context.originalText, token)),
        sendButton
      )
    );

    replaceChildren(ui.body,
      createHeader(() => cancelRequest(token)),
      element("div", { className: "conversation-heading" },
        element("h2", {}, "Ask about this check"),
        element("p", {}, "Your post and its suggestions stay in context for this conversation.")
      ),
      thread,
      form
    );

    if (!conversation.pending) {
      setTimeout(() => {
        if (input.isConnected) input.focus();
      }, 0);
    }
  }

  async function submitFollowUp(question, token, { retry = false } = {}) {
    const current = conversation;
    if (!current || current.token !== token || current.pending) {
      return;
    }

    const normalizedQuestion = typeof question === "string"
      ? question.replace(/\r\n?/g, "\n").trim()
      : "";
    if (!normalizedQuestion) {
      current.error = "Write a question before sending.";
      current.retryQuestion = "";
      if (current.view === "conversation") {
        showConversation(token);
      } else {
        showResult(current.result, current.context.originalText, token);
      }
      return;
    }
    if (normalizedQuestion.length > 2_000) {
      current.error = "Keep the question under 2,000 characters.";
      current.retryQuestion = "";
      showConversation(token);
      return;
    }

    if (!retry) {
      current.turns.push({ role: "user", content: normalizedQuestion });
    }
    current.draft = "";
    current.pending = true;
    current.error = "";
    current.retryQuestion = normalizedQuestion;
    contentLog("debug", "follow_up_started", {
      questionLength: normalizedQuestion.length,
      historyTurnCount: current.turns.length - 1,
      retry
    });
    showConversation(token);

    try {
      const response = await sendRuntimeMessage({
        type: "CLEARPOST_FOLLOW_UP",
        payload: {
          context: current.context,
          history: current.turns.slice(0, -1),
          question: normalizedQuestion
        }
      });
      if (conversation !== current || token !== requestToken) {
        return;
      }
      if (response?.ok && response.result?.answer) {
        current.turns.push({ role: "assistant", content: response.result.answer });
        current.pending = false;
        current.error = "";
        current.retryQuestion = "";
        contentLog("debug", "follow_up_completed", {
          answerLength: response.result.answer.length
        });
      } else {
        current.pending = false;
        current.error = response?.error?.message || "ClearPost could not answer that question.";
        contentLog("error", "follow_up_failed", {
          code: response?.error?.code ?? "UNKNOWN_ERROR",
          message: current.error
        }, true);
      }
      if (current.view === "conversation") {
        showConversation(token);
      } else {
        showResult(current.result, current.context.originalText, token);
      }
    } catch {
      if (conversation === current && token === requestToken) {
        current.pending = false;
        current.error = "ClearPost could not start the follow-up conversation.";
        contentLog("error", "follow_up_runtime_failed", { message: current.error }, true);
        if (current.view === "conversation") {
          showConversation(token);
        } else {
          showResult(current.result, current.context.originalText, token);
        }
      }
    }
  }

  function retryFollowUp(token) {
    if (!conversation?.retryQuestion) return;
    void submitFollowUp(conversation.retryQuestion, token, { retry: true });
  }

  function comparisonRow(label, text, suggested = false) {
    return element("div", { className: `comparison${suggested ? " suggested" : ""}` },
      element("span", { className: "comparison-label" }, label),
      element("p", { className: "comparison-text" }, text)
    );
  }

  function createHeader(closeHandler) {
    return element("div", { className: "header" },
      element("span", { className: "brand" }, "ClearPost"),
      iconButton("Close ClearPost", closeIcon(), closeHandler)
    );
  }

  function ensureOverlay() {
    if (overlay?.host?.isConnected) {
      return overlay;
    }

    const host = document.createElement("div");
    host.id = "clearpost-extension-root";
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = overlayStyles;
    const shell = element("section", {
      className: "shell loading",
      role: "status",
      "aria-live": "polite",
      "aria-label": "ClearPost result"
    });
    const body = element("div", { className: "body" });
    shell.append(body);
    shadow.append(style, shell);
    document.documentElement.append(host);
    overlay = { host, shadow, shell, body };
    return overlay;
  }

  function dismissOverlay() {
    overlay?.host?.remove();
    overlay = null;
    conversation = null;
  }

  function cancelRequest(token) {
    if (token === requestToken) {
      requestToken += 1;
    }
    dismissOverlay();
  }

  async function openOptions() {
    await sendRuntimeMessage({ type: "CLEARPOST_OPEN_OPTIONS" });
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
        } else {
          resolve(response);
        }
      });
    });
  }

  function initializeDebugLogging() {
    const storage = globalThis.chrome?.storage;
    if (!storage?.local) return;

    void storage.local.get({ clearPostSettings: { debugLogging: false } })
      .then((stored) => {
        debugLogging = stored.clearPostSettings?.debugLogging === true;
      })
      .catch(() => {});

    storage.onChanged?.addListener((changes, areaName) => {
      if (areaName === "local" && changes.clearPostSettings) {
        debugLogging = changes.clearPostSettings.newValue?.debugLogging === true;
      }
    });
  }

  function contentLog(level, event, details = {}, force = false) {
    if (!force && !debugLogging) return;
    const logger = level === "error" ? console.error : console.info;
    logger.call(console, "[ClearPost]", event, details);
  }

  function button(label, variant, handler) {
    const control = element("button", { className: `button ${variant}`, type: "button" }, label);
    control.addEventListener("click", handler);
    return control;
  }

  function iconButton(label, icon, handler) {
    const control = element("button", {
      className: "icon-button",
      type: "button",
      "aria-label": label,
      title: label
    }, icon);
    control.addEventListener("click", handler);
    return control;
  }

  function closeIcon() {
    const svg = svgElement("svg", { viewBox: "0 0 20 20", "aria-hidden": "true" });
    svg.append(
      svgElement("path", { d: "M5 5l10 10M15 5L5 15", fill: "none", stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round" })
    );
    return svg;
  }

  function successIcon() {
    const wrap = element("span", { className: "status-icon success", "aria-hidden": "true" });
    const svg = svgElement("svg", { viewBox: "0 0 20 20" });
    svg.append(svgElement("path", {
      d: "M5.2 10.1l3.1 3.1 6.5-7",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "1.8",
      "stroke-linecap": "round",
      "stroke-linejoin": "round"
    }));
    wrap.append(svg);
    return wrap;
  }

  function suggestionIcon(count) {
    return element("span", { className: "status-icon suggestion", "aria-hidden": "true" }, String(count));
  }

  function element(tagName, attributes = {}, ...children) {
    const node = document.createElement(tagName);
    for (const [name, value] of Object.entries(attributes)) {
      if (name === "className") {
        node.className = value;
      } else {
        node.setAttribute(name, value);
      }
    }
    for (const child of children) {
      if (child == null) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  function svgElement(tagName, attributes = {}) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tagName);
    for (const [name, value] of Object.entries(attributes)) {
      node.setAttribute(name, value);
    }
    return node;
  }

  function replaceChildren(parent, ...children) {
    parent.replaceChildren(...children);
  }

  const overlayStyles = `
    :host { all: initial; }
    *, *::before, *::after { box-sizing: border-box; }
    .shell {
      --cp-blue: #1769e8;
      --cp-ink: #111827;
      --cp-muted: #647084;
      --cp-border: #d7dee8;
      position: fixed;
      right: 24px;
      bottom: 24px;
      z-index: 2147483647;
      width: min(392px, calc(100vw - 24px));
      color: var(--cp-ink);
      background: #ffffff;
      border: 1px solid var(--cp-border);
      border-radius: 10px;
      box-shadow: 0 14px 38px rgba(15, 23, 42, 0.16), 0 2px 8px rgba(15, 23, 42, 0.08);
      font: 14px/1.45 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
      animation: cp-enter 180ms ease-out both;
    }
    .shell.loading { width: min(260px, calc(100vw - 24px)); }
    .body { padding: 18px; }
    .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 22px; }
    .brand { position: relative; font-size: 15px; font-weight: 700; line-height: 1.2; }
    .brand::after { content: ""; position: absolute; left: 0; bottom: -5px; width: 39px; height: 2px; border-radius: 2px; background: var(--cp-blue); }
    .icon-button { display: grid; place-items: center; width: 30px; height: 30px; margin: -6px -6px -6px 0; padding: 0; color: #465166; background: transparent; border: 0; border-radius: 7px; cursor: pointer; }
    .icon-button:hover { background: #f3f6fa; color: var(--cp-ink); }
    .icon-button:focus-visible, .button:focus-visible { outline: 3px solid rgba(23, 105, 232, 0.25); outline-offset: 2px; }
    .icon-button svg { width: 20px; height: 20px; }
    .loading-copy { margin: 0 0 14px; color: #273247; font-size: 14px; }
    .progress { height: 4px; overflow: hidden; background: #e4e9f0; border-radius: 999px; }
    .progress-bar { display: block; width: 36%; height: 100%; background: var(--cp-blue); border-radius: inherit; animation: cp-progress 1.25s ease-in-out infinite; }
    .result-heading-row { display: flex; align-items: center; gap: 11px; margin-bottom: 7px; }
    h2 { margin: 0; color: var(--cp-ink); font-size: 17px; font-weight: 700; line-height: 1.3; }
    .error-heading { margin: 2px 0 8px; }
    .status-icon { flex: 0 0 auto; display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; font-size: 12px; font-weight: 700; }
    .status-icon svg { width: 16px; height: 16px; }
    .status-icon.success { color: #10934d; border: 1.5px solid #20b765; }
    .status-icon.suggestion { color: #ffffff; background: #e98313; }
    .supporting { margin: 0 0 6px 33px; color: #313c50; font-size: 14px; }
    .error-heading + .supporting { margin-left: 0; }
    .metadata { margin: 0 0 16px 33px; color: var(--cp-muted); font-size: 12.5px; }
    .comparison { display: grid; grid-template-columns: 78px minmax(0, 1fr); gap: 10px; padding: 11px 0; border-top: 1px solid #e1e6ed; }
    .comparison.suggested { color: #117b41; border-bottom: 1px solid #e1e6ed; }
    .comparison-label { color: var(--cp-muted); font-size: 12.5px; }
    .comparison.suggested .comparison-label { color: #15924f; }
    .comparison-text { margin: 0; color: inherit; overflow-wrap: anywhere; white-space: pre-wrap; }
    .acknowledgement { margin: 12px 0 4px; color: #3a4659; font-size: 13px; }
    .comparison ~ .metadata { margin: 10px 0 15px; }
    .conversation-heading h2 { margin-bottom: 4px; }
    .conversation-heading p { margin: 0; color: var(--cp-muted); font-size: 12.5px; }
    .conversation-thread { max-height: 252px; overflow: auto; margin: 14px 0 12px; padding: 1px 2px 1px 0; }
    .conversation-empty { margin: 0; padding: 13px; color: #526074; background: #f7f9fc; border: 1px solid #e2e7ef; border-radius: 8px; font-size: 13px; }
    .message { margin: 0 0 10px; padding: 9px 11px; border-radius: 9px; }
    .message.user { margin-left: 26px; color: #1d385f; background: #f0f6ff; border: 1px solid #d7e7ff; }
    .message.assistant { margin-right: 26px; color: #2f3a4d; background: #f7f9fc; border: 1px solid #e2e7ef; }
    .message-label { display: block; margin-bottom: 3px; color: var(--cp-muted); font-size: 11px; font-weight: 700; letter-spacing: .01em; }
    .message-text { margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
    .pending-message .message-text { color: var(--cp-muted); font-style: italic; }
    .conversation-error { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0 0 10px; padding: 8px 10px; color: #9f241a; background: #fff6f5; border: 1px solid #f0c9c5; border-radius: 8px; font-size: 12px; }
    .follow-up-form { margin-top: 3px; }
    .follow-up-input { display: block; width: 100%; min-height: 70px; padding: 9px 11px; resize: vertical; color: var(--cp-ink); background: #ffffff; border: 1px solid #bfc9d7; border-radius: 8px; font: 14px/1.4 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; outline: none; }
    .follow-up-input::placeholder { color: #7a8799; }
    .follow-up-input:focus { border-color: var(--cp-blue); box-shadow: 0 0 0 3px rgba(23, 105, 232, 0.18); }
    .follow-up-input:disabled { color: #7f8a9a; background: #f7f9fc; }
    .conversation-actions { margin-top: 9px; }
    .actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 9px; margin-top: 14px; }
    .button { min-height: 36px; padding: 7px 14px; border-radius: 8px; font: 600 13px/1.2 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; cursor: pointer; }
    .button.compact { min-height: 28px; padding: 4px 9px; font-size: 12px; white-space: nowrap; }
    .button.primary { color: #ffffff; background: var(--cp-blue); border: 1px solid var(--cp-blue); }
    .button.primary:hover { background: #0f59cc; }
    .button.primary-outline { color: #0e61df; background: #ffffff; border: 1px solid #7aaef8; }
    .button.primary-outline:hover { background: #f3f7ff; border-color: var(--cp-blue); }
    .button.secondary { color: #283449; background: #ffffff; border: 1px solid #d4dae3; }
    .button.secondary:hover { background: #f5f7fa; }
    @keyframes cp-enter { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes cp-progress { 0% { transform: translateX(-110%); } 55%, 100% { transform: translateX(280%); } }
    @media (max-width: 520px) { .shell { right: 12px; bottom: 12px; } .comparison { grid-template-columns: 1fr; gap: 3px; } }
    @media (prefers-reduced-motion: reduce) { .shell, .progress-bar { animation: none; } .progress-bar { width: 55%; } }
  `;
})();
