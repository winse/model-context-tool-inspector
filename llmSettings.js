/**
 * LLM settings persisted in chrome.storage.local
 */

const STORAGE_KEY = 'llmSettings';

export const BUILTIN_MODELS = [
  'Composer 2.5',
  'Opus 4.8',
  'GPT-5.5',
  'Sonnet 4.6',
  'Codex 5.3',
  'Fable 5',
  'Opus 4.7',
  'Grok Build 0.1',
  'GPT-5.4',
  'GPT-5 Mini',
  'Gemini 2.5 Flash',
  'Kimi K2.5',
];

const DEFAULT_SETTINGS = {
  openaiApiKeyEnabled: false,
  openaiApiKey: '',
  openaiBaseUrlEnabled: false,
  openaiBaseUrl: 'https://api.openai.com/v1',
  anthropicApiKeyEnabled: false,
  anthropicApiKey: '',
  anthropicBaseUrlEnabled: false,
  anthropicBaseUrl: 'https://api.anthropic.com',
  models: [{ name: 'Kimi K2.5', enabled: true }],
  activeModel: 'Kimi K2.5',
  suggestUserPrompt: true,
  apiKeysSectionExpanded: false,
  addModelFormOpen: false,
  showAllModels: false,
};

function mergeModelList(savedModels) {
  if (!Array.isArray(savedModels)) return [...DEFAULT_SETTINGS.models];
  return savedModels
    .filter((m) => m?.name)
    .map((m) => ({ name: m.name, enabled: !!m.enabled }));
}

function mergeSettings(raw) {
  const settings = { ...DEFAULT_SETTINGS, ...raw };
  settings.models = mergeModelList(settings.models);
  if (!settings.models.some((m) => m.name === settings.activeModel && m.enabled)) {
    const firstEnabled = settings.models.find((m) => m.enabled);
    settings.activeModel = firstEnabled?.name || settings.models[0]?.name || '';
  }
  if (settings.openaiApiKeyEnabled && settings.anthropicApiKeyEnabled) {
    settings.anthropicApiKeyEnabled = false;
  }
  return settings;
}

export function getActiveApiConfig(settings) {
  if (settings.anthropicApiKeyEnabled && settings.anthropicApiKey.trim()) {
    return {
      provider: 'anthropic',
      apiKey: settings.anthropicApiKey.trim(),
      endpoint: getAnthropicEndpoint(settings),
    };
  }
  if (settings.openaiApiKeyEnabled && settings.openaiApiKey.trim()) {
    return {
      provider: 'openai',
      apiKey: settings.openaiApiKey.trim(),
      endpoint: getChatEndpoint(settings),
    };
  }
  return null;
}

export async function loadSettings() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const raw = stored[STORAGE_KEY];

  if (!raw && typeof localStorage !== 'undefined') {
    const legacyKey = localStorage.getItem('apiKey');
    const legacyModel = localStorage.getItem('model');
    if (legacyKey || legacyModel) {
      return mergeSettings({
        openaiApiKeyEnabled: !!legacyKey,
        openaiApiKey: legacyKey || '',
        models: legacyModel
          ? [{ name: legacyModel, enabled: true }]
          : DEFAULT_SETTINGS.models,
        activeModel: legacyModel || DEFAULT_SETTINGS.activeModel,
        suggestUserPrompt: localStorage.getItem('suggestUserPrompt') !== 'false',
      });
    }
  }

  return mergeSettings(raw || {});
}

export async function saveSettings(settings) {
  const merged = mergeSettings(settings);
  await chrome.storage.local.set({ [STORAGE_KEY]: merged });
  return merged;
}

export function getChatEndpoint(settings) {
  const base = settings.openaiBaseUrlEnabled
    ? settings.openaiBaseUrl.trim()
    : 'https://api.openai.com/v1';
  return `${base.replace(/\/$/, '')}/chat/completions`;
}

export function getAnthropicEndpoint(settings) {
  const base = settings.anthropicBaseUrlEnabled
    ? settings.anthropicBaseUrl.trim()
    : 'https://api.anthropic.com';
  const normalized = base.replace(/\/$/, '');
  if (normalized.endsWith('/v1/messages')) return normalized;
  if (normalized.endsWith('/v1')) return `${normalized}/messages`;
  return `${normalized}/v1/messages`;
}

export function isLlmConfigured(settings) {
  return !!settings.activeModel && !!getActiveApiConfig(settings);
}
