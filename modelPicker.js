/**
 * Compact model picker for the prompt action bar.
 */

import { getSettings, setActiveModel } from './llmSettingsUi.js';

let menuOpen = false;
let searchQuery = '';

const els = {};

export function initModelPicker() {
  els.root = document.getElementById('modelPicker');
  els.trigger = document.getElementById('modelPickerTrigger');
  els.label = document.getElementById('modelPickerLabel');
  els.menu = document.getElementById('modelPickerMenu');
  els.search = document.getElementById('modelPickerSearch');
  els.list = document.getElementById('modelPickerList');
  els.addLink = document.getElementById('modelPickerAddLink');

  bindEvents();
  refresh();

  return { refresh };
}

function bindEvents() {
  els.trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMenu(!menuOpen);
  });

  els.search.addEventListener('input', () => {
    searchQuery = els.search.value;
    renderList();
  });

  els.search.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') closeMenu();
  });

  els.addLink.addEventListener('click', () => {
    closeMenu();
    focusModelsSettings();
  });

  document.addEventListener('click', (e) => {
    if (!els.root.contains(e.target)) closeMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  });
}

function toggleMenu(open) {
  menuOpen = open;
  els.menu.classList.toggle('is-hidden', !open);
  els.trigger.classList.toggle('is-open', open);
  els.trigger.setAttribute('aria-expanded', String(open));
  if (open) {
    searchQuery = '';
    els.search.value = '';
    renderList();
    els.search.focus();
  }
}

function closeMenu() {
  if (menuOpen) toggleMenu(false);
}

function focusModelsSettings() {
  const headers = [...document.querySelectorAll('.collapsible-header')];
  const llmHeader = headers.find((h) => h.textContent.trim() === 'LLM Settings');
  if (llmHeader?.classList.contains('collapsed')) llmHeader.click();

  const searchInput = document.getElementById('modelSearchInput');
  searchInput?.focus();
  searchInput?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function getEnabledModels() {
  return getSettings().models.filter((m) => m.enabled);
}

function renderList() {
  const settings = getSettings();
  const query = searchQuery.trim().toLowerCase();
  const models = getEnabledModels().filter(
    (m) => !query || m.name.toLowerCase().includes(query),
  );

  els.list.innerHTML = '';

  if (models.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'model-picker-empty';
    empty.textContent = query ? 'No matching models.' : 'Enable a model in LLM Settings.';
    els.list.appendChild(empty);
    return;
  }

  for (const model of models) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'model-picker-item';
    if (model.name === settings.activeModel) row.classList.add('is-selected');

    const name = document.createElement('span');
    name.className = 'model-picker-item-name';
    name.textContent = model.name;

    const check = document.createElement('span');
    check.className = 'model-picker-check';
    check.textContent = '✓';
    check.hidden = model.name !== settings.activeModel;

    row.append(name, check);
    row.addEventListener('click', async () => {
      await setActiveModel(model.name);
      closeMenu();
      refresh();
    });

    els.list.appendChild(row);
  }
}

export function refresh() {
  const settings = getSettings();
  const enabled = getEnabledModels();
  const active = enabled.find((m) => m.name === settings.activeModel) || enabled[0];

  if (active) {
    els.label.textContent = active.name;
    els.trigger.disabled = false;
    els.trigger.title = active.name;
  } else {
    els.label.textContent = 'No model';
    els.trigger.disabled = true;
    els.trigger.title = 'Enable a model in LLM Settings';
  }

  if (menuOpen) renderList();
}
