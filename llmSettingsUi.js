/**
 * Cursor-style Models + API Keys settings panel.
 */

import { loadSettings, saveSettings } from './llmSettings.js';

const VISIBLE_MODEL_LIMIT = 8;

let settings = null;
let onChangeCallback = () => {};
let modelSearchQuery = '';
let skipRender = false;

const els = {};

export async function initLlmSettingsUi({ onChange }) {
  onChangeCallback = onChange;
  settings = await loadSettings();

  els.modelSearchInput = document.getElementById('modelSearchInput');
  els.modelRefreshBtn = document.getElementById('modelRefreshBtn');
  els.modelList = document.getElementById('modelList');
  els.addCustomModelBtn = document.getElementById('addCustomModelBtn');
  els.addModelForm = document.getElementById('addModelForm');
  els.newModelInput = document.getElementById('newModelInput');
  els.addModelBtn = document.getElementById('addModelBtn');
  els.cancelModelBtn = document.getElementById('cancelModelBtn');
  els.viewAllModelsBtn = document.getElementById('viewAllModelsBtn');
  els.clearAllModelsBtn = document.getElementById('clearAllModelsBtn');
  els.apiKeysToggle = document.getElementById('apiKeysToggle');
  els.apiKeysSection = document.getElementById('apiKeysSection');
  els.openaiKeyEnabled = document.getElementById('openaiKeyEnabled');
  els.openaiApiKey = document.getElementById('openaiApiKey');
  els.baseUrlEnabled = document.getElementById('baseUrlEnabled');
  els.openaiBaseUrl = document.getElementById('openaiBaseUrl');
  els.anthropicKeyEnabled = document.getElementById('anthropicKeyEnabled');
  els.anthropicApiKey = document.getElementById('anthropicApiKey');
  els.anthropicBaseUrlEnabled = document.getElementById('anthropicBaseUrlEnabled');
  els.anthropicBaseUrl = document.getElementById('anthropicBaseUrl');
  els.suggestUserPromptCheckbox = document.getElementById('suggestUserPromptCheckbox');

  bindEvents();
  render();
  return settings;
}

export function getSettings() {
  return settings;
}

export async function setActiveModel(name) {
  const model = settings.models.find((m) => m.name === name && m.enabled);
  if (!model) return;
  settings.activeModel = name;
  await persist();
}

async function persist(options = {}) {
  settings = await saveSettings(settings);
  onChangeCallback(settings);
  if (!options.skipRender) render();
}

function bindSectionToggle(toggleEl, sectionEl, expandedKey) {
  toggleEl.addEventListener('click', async () => {
    const expanded = sectionEl.classList.toggle('is-hidden') === false;
    toggleEl.classList.toggle('collapsed', !expanded);
    toggleEl.setAttribute('aria-expanded', String(expanded));
    settings[expandedKey] = expanded;
    await persist();
  });
}

function applySectionExpanded(toggleEl, sectionEl, expanded) {
  sectionEl.classList.toggle('is-hidden', !expanded);
  toggleEl.classList.toggle('collapsed', !expanded);
  toggleEl.setAttribute('aria-expanded', String(expanded));
}

function setAddModelFormOpen(open) {
  settings.addModelFormOpen = open;
  els.addModelForm.classList.toggle('is-hidden', !open);
  els.addCustomModelBtn.classList.toggle('is-hidden', open);
  if (!open) els.newModelInput.value = '';
}

async function addModel(name) {
  const trimmed = name.trim();
  if (!trimmed) return false;

  const existing = settings.models.find((m) => m.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) {
    existing.enabled = true;
    settings.activeModel = existing.name;
  } else {
    settings.models.unshift({ name: trimmed, enabled: true });
    settings.activeModel = trimmed;
  }

  modelSearchQuery = '';
  els.modelSearchInput.value = '';
  setAddModelFormOpen(false);
  await persist();
  return true;
}

async function deleteModel(name) {
  const index = settings.models.findIndex((m) => m.name === name);
  if (index < 0) return;

  const [removed] = settings.models.splice(index, 1);
  if (settings.activeModel === removed.name) {
    const nextEnabled = settings.models.find((m) => m.enabled);
    settings.activeModel = nextEnabled?.name || settings.models[0]?.name || '';
  }
  await persist();
}

async function clearAllModels() {
  if (settings.models.length === 0) return;
  if (!confirm('Remove all models from the list?')) return;

  settings.models = [];
  settings.activeModel = '';
  settings.showAllModels = false;
  modelSearchQuery = '';
  els.modelSearchInput.value = '';
  setAddModelFormOpen(false);
  await persist();
}

function getFilteredModels() {
  const query = modelSearchQuery.trim().toLowerCase();
  if (!query) return settings.models;
  return settings.models.filter((m) => m.name.toLowerCase().includes(query));
}

function getVisibleModels() {
  const filtered = getFilteredModels();
  if (settings.showAllModels || modelSearchQuery.trim() || filtered.length <= VISIBLE_MODEL_LIMIT) {
    return { models: filtered, hasMore: false };
  }
  return { models: filtered.slice(0, VISIBLE_MODEL_LIMIT), hasMore: true };
}

function bindEvents() {
  bindSectionToggle(els.apiKeysToggle, els.apiKeysSection, 'apiKeysSectionExpanded');

  els.modelSearchInput.addEventListener('input', () => {
    modelSearchQuery = els.modelSearchInput.value;
    renderModelList();
    updateViewAllVisibility();
  });

  els.modelSearchInput.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const query = els.modelSearchInput.value.trim();
    if (!query) return;

    const exact = settings.models.find((m) => m.name.toLowerCase() === query.toLowerCase());
    if (exact) {
      exact.enabled = true;
      settings.activeModel = exact.name;
      modelSearchQuery = '';
      els.modelSearchInput.value = '';
      await persist();
      return;
    }

    await addModel(query);
  });

  els.modelRefreshBtn.addEventListener('click', async () => {
    modelSearchQuery = '';
    els.modelSearchInput.value = '';
    settings.showAllModels = false;
    settings = await loadSettings();
    onChangeCallback(settings);
    render();
  });

  els.addCustomModelBtn.addEventListener('click', async () => {
    setAddModelFormOpen(true);
    els.newModelInput.focus();
    await persist({ skipRender: true });
  });

  els.addModelBtn.addEventListener('click', async () => {
    await addModel(els.newModelInput.value);
  });

  els.cancelModelBtn.addEventListener('click', async () => {
    setAddModelFormOpen(false);
    await persist();
  });

  els.newModelInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') els.addModelBtn.click();
    if (e.key === 'Escape') els.cancelModelBtn.click();
  });

  els.viewAllModelsBtn.addEventListener('click', async () => {
    settings.showAllModels = true;
    await persist();
  });

  els.clearAllModelsBtn.addEventListener('click', clearAllModels);

  els.openaiKeyEnabled.addEventListener('change', async () => {
    await handleApiKeyToggle('openai', els.openaiKeyEnabled.checked);
  });

  els.openaiApiKey.addEventListener('input', async () => {
    settings.openaiApiKey = els.openaiApiKey.value;
    skipRender = true;
    settings = await saveSettings(settings);
    onChangeCallback(settings);
    skipRender = false;
    syncApiFields();
  });

  els.baseUrlEnabled.addEventListener('change', async () => {
    settings.openaiBaseUrlEnabled = els.baseUrlEnabled.checked;
    await persist();
  });

  els.openaiBaseUrl.addEventListener('input', async () => {
    settings.openaiBaseUrl = els.openaiBaseUrl.value;
    skipRender = true;
    settings = await saveSettings(settings);
    onChangeCallback(settings);
    skipRender = false;
    syncApiFields();
  });

  els.anthropicKeyEnabled.addEventListener('change', async () => {
    await handleApiKeyToggle('anthropic', els.anthropicKeyEnabled.checked);
  });

  els.anthropicApiKey.addEventListener('input', async () => {
    settings.anthropicApiKey = els.anthropicApiKey.value;
    skipRender = true;
    settings = await saveSettings(settings);
    onChangeCallback(settings);
    skipRender = false;
    syncApiFields();
  });

  els.anthropicBaseUrlEnabled.addEventListener('change', async () => {
    settings.anthropicBaseUrlEnabled = els.anthropicBaseUrlEnabled.checked;
    await persist();
  });

  els.anthropicBaseUrl.addEventListener('input', async () => {
    settings.anthropicBaseUrl = els.anthropicBaseUrl.value;
    skipRender = true;
    settings = await saveSettings(settings);
    onChangeCallback(settings);
    skipRender = false;
    syncApiFields();
  });

  els.suggestUserPromptCheckbox.addEventListener('change', async () => {
    settings.suggestUserPrompt = els.suggestUserPromptCheckbox.checked;
    await persist();
  });
}

async function handleApiKeyToggle(provider, enabled) {
  const isOpenai = provider === 'openai';
  const checkbox = isOpenai ? els.openaiKeyEnabled : els.anthropicKeyEnabled;
  const enabledKey = isOpenai ? 'openaiApiKeyEnabled' : 'anthropicApiKeyEnabled';
  const otherEnabledKey = isOpenai ? 'anthropicApiKeyEnabled' : 'openaiApiKeyEnabled';
  const label = isOpenai ? 'OpenAI API Key' : 'Anthropic API Key';
  const otherLabel = isOpenai ? 'Anthropic API Key' : 'OpenAI API Key';

  if (enabled && settings[otherEnabledKey]) {
    const confirmed = confirm(
      `Enabling ${label} will disable ${otherLabel}.\n\nDo you want to continue?`,
    );
    if (!confirmed) {
      checkbox.checked = settings[enabledKey];
      return;
    }
    settings[otherEnabledKey] = false;
  }

  settings[enabledKey] = enabled;
  await persist();
}

function syncApiFields() {
  els.openaiKeyEnabled.checked = settings.openaiApiKeyEnabled;
  els.openaiApiKey.disabled = !settings.openaiApiKeyEnabled;

  els.baseUrlEnabled.checked = settings.openaiBaseUrlEnabled;
  els.openaiBaseUrl.disabled = !settings.openaiBaseUrlEnabled;

  els.anthropicKeyEnabled.checked = settings.anthropicApiKeyEnabled;
  els.anthropicApiKey.disabled = !settings.anthropicApiKeyEnabled;

  els.anthropicBaseUrlEnabled.checked = settings.anthropicBaseUrlEnabled;
  els.anthropicBaseUrl.disabled = !settings.anthropicBaseUrlEnabled;
}

function updateViewAllVisibility() {
  const { hasMore } = getVisibleModels();
  const show = hasMore && !settings.showAllModels && !modelSearchQuery.trim();
  els.viewAllModelsBtn.classList.toggle('is-hidden', !show);
}

function render() {
  if (skipRender) return;

  applySectionExpanded(
    els.apiKeysToggle,
    els.apiKeysSection,
    settings.apiKeysSectionExpanded === true,
  );

  setAddModelFormOpen(settings.addModelFormOpen === true);

  renderModelList();
  updateViewAllVisibility();
  syncApiFields();

  els.clearAllModelsBtn.disabled = settings.models.length === 0;

  els.openaiApiKey.value = settings.openaiApiKey;
  els.openaiBaseUrl.value = settings.openaiBaseUrl;
  els.anthropicApiKey.value = settings.anthropicApiKey;
  els.anthropicBaseUrl.value = settings.anthropicBaseUrl;
  els.suggestUserPromptCheckbox.checked = settings.suggestUserPrompt !== false;
}

function renderModelList() {
  const { models: visibleModels } = getVisibleModels();
  els.modelList.innerHTML = '';

  if (visibleModels.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'cursor-model-empty';
    empty.textContent = modelSearchQuery.trim() ? 'No models match your search.' : 'No models configured.';
    els.modelList.appendChild(empty);
    return;
  }

  visibleModels.forEach((model) => {
    const index = settings.models.findIndex((m) => m.name === model.name);
    if (index < 0) return;

    const row = document.createElement('div');
    row.className = 'cursor-model-row';
    if (model.name === settings.activeModel && model.enabled) {
      row.classList.add('is-active');
    }

    const name = document.createElement('span');
    name.className = 'cursor-model-name';
    name.textContent = model.name;
    name.title = model.name === settings.activeModel ? 'Active model for chat' : 'Click to set as active model';
    name.addEventListener('click', async () => {
      if (!model.enabled) return;
      await setActiveModel(model.name);
    });

    const actions = document.createElement('div');
    actions.className = 'cursor-model-actions';

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'cursor-model-delete';
    deleteBtn.title = `Remove ${model.name}`;
    deleteBtn.setAttribute('aria-label', `Remove ${model.name}`);
    deleteBtn.textContent = '×';
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await deleteModel(model.name);
    });

    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'cursor-toggle';
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = model.enabled;
    toggle.addEventListener('change', async () => {
      settings.models[index].enabled = toggle.checked;
      if (toggle.checked) {
        settings.activeModel = model.name;
      } else if (settings.activeModel === model.name) {
        const next = settings.models.find((m) => m.enabled);
        settings.activeModel = next?.name || '';
      }
      await persist();
    });
    const track = document.createElement('span');
    track.className = 'cursor-toggle-track';
    toggleLabel.append(toggle, track);

    actions.append(deleteBtn, toggleLabel);
    row.append(name, actions);
    els.modelList.appendChild(row);
  });
}
