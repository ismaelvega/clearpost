export const STORAGE_KEYS = Object.freeze({
  apiKey: "deepseekApiKey",
  settings: "clearPostSettings"
});

export const DEFAULT_SETTINGS = Object.freeze({
  model: "deepseek-v4-flash",
  checks: Object.freeze({
    grammar: true,
    spelling: true,
    acknowledgement: true
  }),
  responseLanguage: "match",
  behavior: "after",
  debugLogging: false
});

const RESPONSE_LANGUAGES = new Set(["match", "english", "spanish"]);

export function normalizeSettings(value = {}) {
  const checks = value?.checks ?? {};
  const model = typeof value?.model === "string" && /^[a-zA-Z0-9._:-]{1,80}$/.test(value.model)
    ? value.model
    : DEFAULT_SETTINGS.model;

  return {
    model,
    checks: {
      grammar: typeof checks.grammar === "boolean" ? checks.grammar : DEFAULT_SETTINGS.checks.grammar,
      spelling: typeof checks.spelling === "boolean" ? checks.spelling : DEFAULT_SETTINGS.checks.spelling,
      acknowledgement: typeof checks.acknowledgement === "boolean"
        ? checks.acknowledgement
        : DEFAULT_SETTINGS.checks.acknowledgement
    },
    responseLanguage: RESPONSE_LANGUAGES.has(value?.responseLanguage)
      ? value.responseLanguage
      : DEFAULT_SETTINGS.responseLanguage,
    behavior: "after",
    debugLogging: value?.debugLogging === true
  };
}
