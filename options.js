import { DEFAULT_SETTINGS, normalizeSettings, STORAGE_KEYS } from "./src/settings.js";

const form = document.querySelector("#settings-form");
const apiKeyInput = document.querySelector("#api-key");
const modelSelect = document.querySelector("#model");
const grammarInput = document.querySelector("#grammar");
const spellingInput = document.querySelector("#spelling");
const acknowledgementInput = document.querySelector("#acknowledgement");
const responseLanguageSelect = document.querySelector("#response-language");
const debugLoggingInput = document.querySelector("#debug-logging");
const testButton = document.querySelector("#test-connection");
const connectionStatus = document.querySelector("#connection-status");
const saveStatus = document.querySelector("#save-status");
const version = document.querySelector("#version");

let saveStatusTimer = null;

void initialize();

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveSettings();
});

testButton.addEventListener("click", () => {
  void testConnection();
});

async function initialize() {
  const stored = await storageGet({
    [STORAGE_KEYS.apiKey]: "",
    [STORAGE_KEYS.settings]: DEFAULT_SETTINGS
  });
  const settings = normalizeSettings(stored[STORAGE_KEYS.settings]);

  apiKeyInput.value = stored[STORAGE_KEYS.apiKey] ?? "";
  setSelectValue(modelSelect, settings.model);
  grammarInput.checked = settings.checks.grammar;
  spellingInput.checked = settings.checks.spelling;
  acknowledgementInput.checked = settings.checks.acknowledgement;
  responseLanguageSelect.value = settings.responseLanguage;
  debugLoggingInput.checked = settings.debugLogging;

  if (hasExtensionApi()) {
    version.textContent = chrome.runtime.getManifest().version;
  }
}

async function saveSettings() {
  const settings = normalizeSettings({
    model: modelSelect.value,
    checks: {
      grammar: grammarInput.checked,
      spelling: spellingInput.checked,
      acknowledgement: acknowledgementInput.checked
    },
    responseLanguage: responseLanguageSelect.value,
    behavior: "after",
    debugLogging: debugLoggingInput.checked
  });

  try {
    await storageSet({
      [STORAGE_KEYS.apiKey]: apiKeyInput.value.trim(),
      [STORAGE_KEYS.settings]: settings
    });
    setSaveStatus("Settings saved", "success");
  } catch {
    setSaveStatus("Could not save settings", "error");
  }
}

async function testConnection() {
  if (!apiKeyInput.value.trim()) {
    setInlineStatus("Enter an API key first.", "error");
    apiKeyInput.focus();
    return;
  }

  testButton.disabled = true;
  testButton.textContent = "Testing…";
  setInlineStatus("Contacting DeepSeek…", "");

  try {
    if (!hasExtensionApi()) {
      setInlineStatus("Load the folder as an extension to test.", "error");
      return;
    }
    const response = await runtimeMessage({
      type: "CLEARPOST_TEST_CONNECTION",
      payload: {
        apiKey: apiKeyInput.value.trim(),
        model: modelSelect.value
      }
    });
    if (response?.ok) {
      setInlineStatus("Connected", "success");
    } else {
      setInlineStatus(response?.error?.message || "Connection failed.", "error");
    }
  } catch {
    setInlineStatus("Connection failed.", "error");
  } finally {
    testButton.disabled = false;
    testButton.textContent = "Test connection";
  }
}

function setSelectValue(select, value) {
  if (![...select.options].some((option) => option.value === value)) {
    select.add(new Option(value, value));
  }
  select.value = value;
}

function setInlineStatus(message, state) {
  connectionStatus.textContent = message;
  connectionStatus.className = `inline-status${state ? ` ${state}` : ""}`;
}

function setSaveStatus(message, state) {
  clearTimeout(saveStatusTimer);
  saveStatus.textContent = message;
  saveStatus.className = `save-status ${state}`;
  saveStatusTimer = setTimeout(() => {
    saveStatus.textContent = "";
    saveStatus.className = "save-status";
  }, 3_500);
}

function hasExtensionApi() {
  return Boolean(globalThis.chrome?.storage?.local && globalThis.chrome?.runtime?.sendMessage);
}

function storageGet(defaults) {
  return hasExtensionApi() ? chrome.storage.local.get(defaults) : Promise.resolve(defaults);
}

function storageSet(value) {
  return hasExtensionApi() ? chrome.storage.local.set(value) : Promise.resolve();
}

function runtimeMessage(message) {
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
