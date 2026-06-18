/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { getIframeOrigins } from './utils.js';
import { isLlmConfigured } from './llmSettings.js';
import { initLlmSettingsUi, getSettings } from './llmSettingsUi.js';
import { initModelPicker } from './modelPicker.js';
import { runAgentChat, suggestPrompt } from './agentChat.js';

const statusDiv = document.getElementById('status');
const tbody = document.getElementById('tableBody');
const thead = document.getElementById('tableHeaderRow');
const copyToClipboard = document.getElementById('copyToClipboard');
const copyAsScriptToolConfig = document.getElementById('copyAsScriptToolConfig');
const copyAsJSON = document.getElementById('copyAsJSON');
const toolNames = document.getElementById('toolNames');
const inputArgsText = document.getElementById('inputArgsText');
const executeBtn = document.getElementById('executeBtn');
const toolResults = document.getElementById('toolResults');
const userPromptText = document.getElementById('userPromptText');
const promptBtn = document.getElementById('promptBtn');
const traceBtn = document.getElementById('traceBtn');
const resetBtn = document.getElementById('resetBtn');
const promptResults = document.getElementById('promptResults');

let currentTools;
let chatMessages = [];
let trace = [];
let userPromptPendingId = 0;
let lastSuggestedUserPrompt = '';

function updatePromptButtons() {
  const configured = isLlmConfigured(getSettings());
  promptBtn.disabled = !configured;
  resetBtn.disabled = !configured;
}

let modelPicker;

await initLlmSettingsUi({
  onChange: () => {
    updatePromptButtons();
    modelPicker?.refresh();
  },
});
modelPicker = initModelPicker();
updatePromptButtons();

(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const fromOrigins = await getIframeOrigins(tab.id);
    await chrome.tabs.sendMessage(tab.id, { action: 'LIST_TOOLS', fromOrigins }, { frameId: 0 });
  } catch (error) {
    statusDiv.textContent = error;
    statusDiv.hidden = false;
    copyToClipboard.hidden = true;
  }
})();

chrome.runtime.onMessage.addListener(async ({ message, tools, url }, sender) => {
  if (sender.frameId && sender.frameId !== 0) return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (sender.tab && sender.tab.id !== tab.id) return;

  tbody.innerHTML = '';
  thead.innerHTML = '';
  toolNames.innerHTML = '';

  statusDiv.textContent = message;
  statusDiv.hidden = !message;

  const haveNewTools = JSON.stringify(currentTools) !== JSON.stringify(tools);
  currentTools = tools;

  if (!tools || tools.length === 0) {
    const row = document.createElement('tr');
    row.innerHTML = `<td colspan="100%"><i>No tools registered yet in ${url || tab.url}</i></td>`;
    tbody.appendChild(row);
    inputArgsText.value = '';
    inputArgsText.disabled = true;
    toolNames.disabled = true;
    executeBtn.disabled = true;
    copyToClipboard.hidden = true;
    return;
  }

  inputArgsText.disabled = false;
  toolNames.disabled = false;
  executeBtn.disabled = false;
  copyToClipboard.hidden = false;

  const KEYS = ['description', 'inputSchema', 'readOnlyHint', 'untrustedContentHint', 'name'];
  const keys = KEYS.filter((key) => tools.some((tool) => key in tool));
  keys.forEach((key) => {
    const th = document.createElement('th');
    th.textContent = key;
    thead.appendChild(th);
  });

  tools.forEach((item) => {
    const row = document.createElement('tr');
    keys.forEach((key) => {
      const td = document.createElement('td');
      try {
        td.innerHTML = `<pre>${JSON.stringify(JSON.parse(item[key]), '', '  ')}</pre>`;
      } catch {
        td.textContent = item[key];
      }
      row.appendChild(td);
    });
    tbody.appendChild(row);

    const option = document.createElement('option');
    option.textContent = `"${item.name}"`;
    option.value = item.name;
    if (new Set(tools.map((t) => t.location)).size > 1) {
      option.textContent += ` | ${item.location || ''}`;
    }
    option.dataset.inputSchema = item.inputSchema || '{}';
    option.dataset.location = item.location || '';
    toolNames.appendChild(option);
  });
  updateDefaultValueForInputArgs();

  if (haveNewTools) suggestUserPromptIfEnabled();
});

tbody.ondblclick = () => {
  tbody.classList.toggle('prettify');
};

copyAsScriptToolConfig.onclick = async () => {
  const text = currentTools
    .map((tool) => {
      return `\
script_tools {
  name: "${tool.name}"
  description: "${tool.description}"
  input_schema: ${JSON.stringify(tool.inputSchema || { type: 'object', properties: {} })}
}`;
    })
    .join('\r\n');
  await navigator.clipboard.writeText(text);
};

copyAsJSON.onclick = async () => {
  const tools = currentTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema
      ? JSON.parse(tool.inputSchema)
      : { type: 'object', properties: {} },
  }));
  await navigator.clipboard.writeText(JSON.stringify(tools, '', '  '));
};

async function suggestUserPromptIfEnabled() {
  const settings = getSettings();
  if (settings.suggestUserPrompt === false) return;
  if (!currentTools?.length || !isLlmConfigured(settings)) return;
  if (userPromptText.value !== lastSuggestedUserPrompt) return;

  const userPromptId = ++userPromptPendingId;
  try {
    const suggestion = await suggestPrompt(settings, currentTools, { onLog: logPrompt });
    if (userPromptId !== userPromptPendingId || userPromptText.value !== lastSuggestedUserPrompt) return;
    lastSuggestedUserPrompt = suggestion;
    userPromptText.value = suggestion;
  } catch (error) {
    logPrompt(`⚠️ Suggest prompt failed: ${error.message}`);
  }
}

userPromptText.onkeydown = (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    promptBtn.click();
  }
};

promptBtn.onclick = async () => {
  try {
    await promptAI();
  } catch (error) {
    trace.push({ error: String(error) });
    logPrompt(`⚠️ Error: "${error.message || error}"`);
  }
};

async function promptAI() {
  const settings = getSettings();
  if (!isLlmConfigured(settings)) {
    logPrompt('⚠️ Configure OpenAI API key and an active model in LLM Settings.');
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const message = userPromptText.value.trim();
  if (!message) return;

  userPromptText.value = '';
  lastSuggestedUserPrompt = '';
  logPrompt(`User prompt: "${message}"`);

  trace.push({ userPrompt: message, model: settings.activeModel });

  const result = await runAgentChat({
    settings,
    currentTools,
    userMessage: message,
    messages: chatMessages.length ? chatMessages : undefined,
    executeToolFn: async (_shortName, fullToolName, args) => {
      const match = fullToolName.match(/^_(\d+)_(.+)$/s);
      if (!match) throw new Error(`Invalid tool name: ${fullToolName}`);
      const locationIndex = Number(match[1]);
      const name = match[2];
      const location = currentTools[locationIndex]?.location;
      return executeTool(tab, name, JSON.stringify(args), location);
    },
    onLog: logPrompt,
  });

  chatMessages = result.messages;
  trace.push({ assistant: result.text });
  if (result.text) logPrompt(`AI result: ${result.text}\n`);
}

resetBtn.onclick = () => {
  chatMessages = [];
  trace = [];
  userPromptText.value = '';
  lastSuggestedUserPrompt = '';
  promptResults.textContent = '';
  suggestUserPromptIfEnabled();
};

traceBtn.onclick = async () => {
  await navigator.clipboard.writeText(JSON.stringify(trace, '', ' '));
};

executeBtn.onclick = async () => {
  toolResults.textContent = '';
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const name = toolNames.selectedOptions[0].value;
  const inputArgs = inputArgsText.value;
  const location = toolNames.selectedOptions[0].dataset.location;
  toolResults.textContent = await executeTool(tab, name, inputArgs, location).catch(
    (error) => `⚠️ Error: "${error}"`,
  );
};

async function executeTool(tab, name, inputArgs, location) {
  const options = !location || location === tab.url ? { frameId: 0 } : {};
  try {
    const result = await chrome.tabs.sendMessage(
      tab.id,
      { action: 'EXECUTE_TOOL', name, inputArgs, location },
      options,
    );
    if (result !== null) return result;
  } catch (error) {
    if (!error.message.includes('message channel is closed')) throw error;
  }
  await waitForPageLoad(tab.id);
  return await chrome.tabs.sendMessage(tab.id, {
    action: 'GET_CROSS_DOCUMENT_SCRIPT_TOOL_RESULT',
    location,
  });
}

toolNames.onchange = updateDefaultValueForInputArgs;

function updateDefaultValueForInputArgs() {
  const inputSchema = toolNames.selectedOptions[0].dataset.inputSchema || '{}';
  const template = generateTemplateFromSchema(JSON.parse(inputSchema));
  inputArgsText.value = JSON.stringify(template, '', ' ');
}

function logPrompt(text) {
  promptResults.textContent += `${text}\n`;
  promptResults.scrollTop = promptResults.scrollHeight;
}

function generateTemplateFromSchema(schema) {
  if (!schema || typeof schema !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(schema, 'const')) return schema.const;
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    return generateTemplateFromSchema(schema.oneOf[0]);
  }
  if (Object.prototype.hasOwnProperty.call(schema, 'default')) return schema.default;
  if (Array.isArray(schema.examples) && schema.examples.length > 0) return schema.examples[0];

  switch (schema.type) {
    case 'object': {
      const obj = {};
      if (schema.properties) {
        Object.keys(schema.properties).forEach((key) => {
          obj[key] = generateTemplateFromSchema(schema.properties[key]);
        });
      }
      return obj;
    }
    case 'array':
      return schema.items ? [generateTemplateFromSchema(schema.items)] : [];
    case 'string':
      if (schema.enum?.length) return schema.enum[0];
      if (schema.format === 'date') return new Date().toISOString().substring(0, 10);
      return 'example_string';
    case 'number':
    case 'integer':
      return schema.minimum !== undefined ? schema.minimum : 0;
    case 'boolean':
      return false;
    case 'null':
      return null;
    default:
      return {};
  }
}

function waitForPageLoad(tabId) {
  return new Promise((resolve) => {
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

document.querySelectorAll('.collapsible-header').forEach((header) => {
  header.addEventListener('click', () => {
    header.classList.toggle('collapsed');
    const content = header.nextElementSibling;
    if (content?.classList.contains('section-content')) {
      content.classList.toggle('is-hidden');
    }
  });
});
