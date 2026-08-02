import { buildProofreadMessages, parseProofreadResponse } from "./src/proofreading.js";
import { DEFAULT_SETTINGS, normalizeSettings, STORAGE_KEYS } from "./src/settings.js";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const REQUEST_TIMEOUT_MS = 30_000;
const LOG_PREFIX = "[ClearPost]";

chrome.runtime.onInstalled.addListener((details) => {
  void initializeStorage();
  if (details.reason === "install") {
    void chrome.runtime.openOptionsPage();
  }
});

chrome.action.onClicked.addListener(() => {
  void chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void routeMessage(message, sender)
    .then(sendResponse)
    .catch((error) => {
      logError("request_failed", {
        code: error?.code ?? "UNKNOWN_ERROR",
        message: error?.message ?? "Unknown error"
      });
      sendResponse(toErrorResponse(error));
    });
  return true;
});

async function routeMessage(message, sender) {
  if (!message || typeof message !== "object") {
    throw new ClearPostError("BAD_REQUEST", "ClearPost received an invalid request.");
  }

  switch (message.type) {
    case "CLEARPOST_CHECK_TEXT":
      assertXSender(sender);
      return checkSubmittedText(message.payload?.text);
    case "CLEARPOST_TEST_CONNECTION":
      assertOptionsSender(sender);
      return testConnection(message.payload);
    case "CLEARPOST_OPEN_OPTIONS":
      assertXSender(sender);
      await chrome.runtime.openOptionsPage();
      return { ok: true };
    default:
      throw new ClearPostError("BAD_REQUEST", "ClearPost does not recognize that request.");
  }
}

async function checkSubmittedText(text) {
  if (typeof text !== "string" || text.trim() === "") {
    throw new ClearPostError("EMPTY_TEXT", "There is no submitted text to check.");
  }

  const stored = await chrome.storage.local.get({
    [STORAGE_KEYS.apiKey]: "",
    [STORAGE_KEYS.settings]: DEFAULT_SETTINGS
  });
  const apiKey = normalizeApiKey(stored[STORAGE_KEYS.apiKey]);
  const settings = normalizeSettings(stored[STORAGE_KEYS.settings]);
  const requestId = crypto.randomUUID();
  const startedAt = performance.now();

  logDebug(settings, "check_started", {
    requestId,
    model: settings.model,
    textLength: text.length,
    checks: settings.checks,
    responseLanguage: settings.responseLanguage
  });

  if (!settings.checks.grammar && !settings.checks.spelling && !settings.checks.acknowledgement) {
    logDebug(settings, "check_skipped", { requestId, reason: "all_checks_disabled" });
    return { ok: true, skipped: true };
  }
  if (!apiKey) {
    throw new ClearPostError("MISSING_API_KEY", "Add your DeepSeek API key in ClearPost settings.");
  }

  const payload = {
    model: settings.model,
    messages: buildProofreadMessages(text, settings),
    response_format: { type: "json_object" },
    temperature: 0,
    max_tokens: 700,
    stream: false
  };
  const data = await callDeepSeek(apiKey, payload, {
    purpose: "proofread",
    requestId,
    settings,
    startedAt
  });
  const content = data?.choices?.[0]?.message?.content;
  let result;
  try {
    result = parseProofreadResponse(content, text);
  } catch (error) {
    logError("parse_failed", {
      requestId,
      code: error?.code ?? "INVALID_RESPONSE",
      message: error?.message ?? "DeepSeek response could not be parsed"
    });
    logDebug(settings, "parse_response_shape", {
      requestId,
      ...summarizeResponseShape(data)
    });
    throw error;
  }

  if (!settings.checks.grammar && !settings.checks.spelling) {
    result.verdict = "clean";
    result.correctedText = text;
    result.issues = [];
  }

  return {
    ok: true,
    requestId,
    result
  };
}

async function testConnection(payload = {}) {
  const stored = await chrome.storage.local.get({
    [STORAGE_KEYS.apiKey]: "",
    [STORAGE_KEYS.settings]: DEFAULT_SETTINGS
  });
  const apiKey = normalizeApiKey(payload.apiKey ?? stored[STORAGE_KEYS.apiKey]);
  const settings = normalizeSettings({
    ...stored[STORAGE_KEYS.settings],
    model: payload.model ?? stored[STORAGE_KEYS.settings]?.model
  });

  if (!apiKey) {
    throw new ClearPostError("MISSING_API_KEY", "Enter a DeepSeek API key first.");
  }

  const requestId = crypto.randomUUID();
  const startedAt = performance.now();
  logDebug(settings, "connection_test_started", {
    requestId,
    model: settings.model
  });

  await callDeepSeek(apiKey, {
    model: settings.model,
    messages: [
      { role: "system", content: "Reply with exactly OK." },
      { role: "user", content: "Connection test" }
    ],
    temperature: 0,
    max_tokens: 16,
    stream: false
  }, {
    purpose: "connection_test",
    requestId,
    settings,
    startedAt
  });

  return { ok: true, model: settings.model };
}

async function callDeepSeek(apiKey, payload, context = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = context.startedAt ?? performance.now();

  logDebug(context.settings, "api_request_started", {
    requestId: context.requestId,
    purpose: context.purpose ?? "unknown",
    model: payload.model
  });

  try {
    const response = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    logDebug(context.settings, "api_response_received", {
      requestId: context.requestId,
      purpose: context.purpose ?? "unknown",
      httpStatus: response.status,
      elapsedMs: Math.round(performance.now() - startedAt)
    });

    if (!response.ok) {
      throw apiStatusError(response.status);
    }

    const data = await response.json();
    if (!data || !Array.isArray(data.choices)) {
      throw new ClearPostError("INVALID_RESPONSE", "DeepSeek returned an unexpected response.");
    }
    logDebug(context.settings, "api_response_shape", {
      requestId: context.requestId,
      ...summarizeResponseShape(data)
    });
    return data;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new ClearPostError("TIMEOUT", "DeepSeek did not respond within 30 seconds.");
    }
    if (error instanceof ClearPostError) {
      throw error;
    }
    if (error?.code === "INVALID_RESPONSE") {
      throw new ClearPostError("INVALID_RESPONSE", "DeepSeek returned an unreadable result.");
    }
    throw new ClearPostError("NETWORK_ERROR", "ClearPost could not reach DeepSeek.");
  } finally {
    clearTimeout(timeout);
  }
}

function apiStatusError(status) {
  if (status === 401 || status === 403) {
    return new ClearPostError("INVALID_API_KEY", "DeepSeek rejected this API key.");
  }
  if (status === 402) {
    return new ClearPostError("NO_CREDIT", "The DeepSeek account has insufficient credit.");
  }
  if (status === 429) {
    return new ClearPostError("RATE_LIMITED", "DeepSeek is rate-limiting requests. Try again shortly.");
  }
  if (status >= 500) {
    return new ClearPostError("DEEPSEEK_UNAVAILABLE", "DeepSeek is temporarily unavailable.");
  }
  return new ClearPostError("API_ERROR", `DeepSeek returned HTTP ${status}.`);
}

async function initializeStorage() {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.apiKey, STORAGE_KEYS.settings]);
  const updates = {};
  if (typeof stored[STORAGE_KEYS.apiKey] !== "string") {
    updates[STORAGE_KEYS.apiKey] = "";
  }
  if (!stored[STORAGE_KEYS.settings]) {
    updates[STORAGE_KEYS.settings] = DEFAULT_SETTINGS;
  }
  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates);
  }
}

function assertXSender(sender) {
  let hostname = "";
  try {
    hostname = new URL(sender?.url ?? sender?.tab?.url ?? "").hostname;
  } catch {
    // The stable error below is more useful than exposing URL parsing details.
  }
  if (sender?.id !== chrome.runtime.id || (hostname !== "x.com" && !hostname.endsWith(".x.com"))) {
    throw new ClearPostError("FORBIDDEN", "ClearPost rejected a request outside x.com.");
  }
}

function assertOptionsSender(sender) {
  const extensionRoot = chrome.runtime.getURL("");
  if (sender?.id !== chrome.runtime.id || !sender?.url?.startsWith(extensionRoot)) {
    throw new ClearPostError("FORBIDDEN", "ClearPost rejected an untrusted settings request.");
  }
}

function normalizeApiKey(value) {
  return typeof value === "string" ? value.trim().slice(0, 256) : "";
}

function summarizeResponseShape(data) {
  const choices = Array.isArray(data?.choices) ? data.choices : [];
  const firstChoice = choices[0] ?? {};
  const content = firstChoice?.message?.content;
  const trimmed = typeof content === "string" ? content.trim() : "";

  return {
    choiceCount: choices.length,
    finishReason: firstChoice?.finish_reason ?? null,
    contentType: typeof content,
    contentLength: typeof content === "string" ? content.length : 0,
    contentShape: classifyContentShape(trimmed),
    hasJsonLikeFields: /["'](?:corrected_text|acknowledgement|issues)["']\s*:/.test(trimmed)
  };
}

function classifyContentShape(value) {
  if (!value) return "empty";
  if (value.startsWith("```") && value.endsWith("```")) return "markdown_fenced";
  if (value.startsWith("{")) return "object_like";
  if (value.startsWith("[")) return "array_like";
  return "other";
}

function logDebug(settings, event, details = {}) {
  if (!settings?.debugLogging) return;
  console.info(LOG_PREFIX, event, {
    timestamp: new Date().toISOString(),
    ...details
  });
}

function logError(event, details = {}) {
  console.error(LOG_PREFIX, event, {
    timestamp: new Date().toISOString(),
    ...details
  });
}

function toErrorResponse(error) {
  return {
    ok: false,
    error: {
      code: error?.code ?? "UNKNOWN_ERROR",
      message: error?.message ?? "ClearPost could not complete the check."
    }
  };
}

class ClearPostError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ClearPostError";
    this.code = code;
  }
}
