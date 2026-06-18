/**
 * Multi-provider chat agent (OpenAI-compatible + Anthropic Messages API).
 */

import { getChatEndpoint, getActiveApiConfig } from './llmSettings.js';

const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 4096;

/** Strip model reasoning blocks; return { suggestion, reasoning }. */
export function parseSuggestPromptResponse(raw) {
  const text = String(raw || '').trim();
  if (!text) return { suggestion: '', reasoning: '' };

  const thinkBlocks = [];
  let withoutBlocks = text.replace(
    /<(?:think|redacted_reasoning|redacted_thinking|reasoning)\b[^>]*>([\s\S]*?)<\/(?:think|redacted_reasoning|redacted_thinking|reasoning)>/gi,
    (_, inner) => {
      if (inner.trim()) thinkBlocks.push(inner.trim());
      return '';
    },
  );

  const orphanClose = withoutBlocks.match(/<\/(?:think|redacted_reasoning|redacted_thinking|reasoning)>/i);
  if (orphanClose) {
    const closeTag = orphanClose[0];
    const idx = withoutBlocks.lastIndexOf(closeTag);
    if (idx !== -1) {
      const before = withoutBlocks.slice(0, idx).trim();
      if (before) {
        thinkBlocks.unshift(
          before.replace(/^<(?:think|redacted_reasoning|redacted_thinking|reasoning)\b[^>]*>/i, '').trim(),
        );
      }
      withoutBlocks = withoutBlocks.slice(idx + closeTag.length);
    }
  }

  const suggestion = withoutBlocks.replace(/\n{3,}/g, '\n\n').trim();
  const reasoning = thinkBlocks.filter(Boolean).join('\n\n---\n\n').trim();
  return { suggestion, reasoning };
}

function buildTools(currentTools) {
  return currentTools.map((tool) => {
    const locationIndex = currentTools.findIndex((t) => t.location === tool.location);
    let parameters = { type: 'object', properties: {} };
    try {
      parameters = tool.inputSchema ? JSON.parse(tool.inputSchema) : parameters;
    } catch {
      /* keep default */
    }
    return {
      type: 'function',
      function: {
        name: `_${locationIndex}_${tool.name}`,
        description: tool.description || tool.name,
        parameters,
      },
    };
  });
}

function buildSystemPrompt() {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  return [
    'You are an assistant embedded in a browser tab.',
    'User prompts typically refer to the current tab unless stated otherwise.',
    'Use the provided tools to interact with the page when needed.',
    `Today's date is: ${today}`,
    'CRITICAL RULE: Whenever the user provides a relative date, calculate the exact calendar date.',
    'CRITICAL RULE: Only use the tools that are available to you.',
  ].join('\n');
}

function toAnthropicTools(openaiTools) {
  return (openaiTools || []).map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters,
  }));
}

function convertMessagesToAnthropic(messages) {
  let system = '';
  const anthropicMessages = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.role === 'system') {
      system = system ? `${system}\n${msg.content}` : msg.content;
      continue;
    }

    if (msg.role === 'user') {
      anthropicMessages.push({ role: 'user', content: msg.content });
      continue;
    }

    if (msg.role === 'assistant') {
      const blocks = [];
      if (msg.content) blocks.push({ type: 'text', text: msg.content });
      for (const toolCall of msg.tool_calls || []) {
        let input = {};
        try {
          input = JSON.parse(toolCall.function?.arguments || '{}');
        } catch {
          input = {};
        }
        blocks.push({
          type: 'tool_use',
          id: toolCall.id,
          name: toolCall.function.name,
          input,
        });
      }
      anthropicMessages.push({ role: 'assistant', content: blocks });
      continue;
    }

    if (msg.role === 'tool') {
      const toolResults = [
        {
          type: 'tool_result',
          tool_use_id: msg.tool_call_id,
          content: msg.content,
        },
      ];
      while (i + 1 < messages.length && messages[i + 1].role === 'tool') {
        i += 1;
        toolResults.push({
          type: 'tool_result',
          tool_use_id: messages[i].tool_call_id,
          content: messages[i].content,
        });
      }
      anthropicMessages.push({ role: 'user', content: toolResults });
    }
  }

  return { system, messages: anthropicMessages };
}

function fromAnthropicResponse(payload) {
  const textParts = [];
  const toolCalls = [];

  for (const block of payload.content || []) {
    if (block.type === 'text') textParts.push(block.text);
    if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input || {}),
        },
      });
    }
  }

  const text = textParts.join('').trim();
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: text || null,
          tool_calls: toolCalls.length ? toolCalls : undefined,
        },
      },
    ],
  };
}

function parseApiError(payload, fallback) {
  return (
    payload.error?.message ||
    payload.message ||
    (typeof payload.error === 'string' ? payload.error : null) ||
    fallback
  );
}

async function requestOpenAI(apiConfig, settings, body) {
  const endpoint = apiConfig.endpoint || getChatEndpoint(settings);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiConfig.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(parseApiError(payload, response.statusText || 'Request failed'));
  }
  return payload;
}

async function requestAnthropic(apiConfig, body) {
  const { system, messages } = convertMessagesToAnthropic(body.messages);
  const requestBody = {
    model: body.model,
    max_tokens: DEFAULT_MAX_TOKENS,
    messages,
  };

  if (system) requestBody.system = system;
  if (body.temperature != null) requestBody.temperature = body.temperature;
  if (body.tools?.length) requestBody.tools = toAnthropicTools(body.tools);

  const response = await fetch(apiConfig.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiConfig.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(requestBody),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(parseApiError(payload, response.statusText || 'Request failed'));
  }
  return fromAnthropicResponse(payload);
}

async function requestChat(settings, body) {
  const apiConfig = getActiveApiConfig(settings);
  if (!apiConfig) {
    throw new Error('Configure an API key for the active model in LLM Settings.');
  }

  if (apiConfig.provider === 'anthropic') {
    return requestAnthropic(apiConfig, body);
  }
  return requestOpenAI(apiConfig, settings, body);
}

export async function suggestPrompt(settings, currentTools, { onLog } = {}) {
  const content = [
    '**Context:**',
    `Today's date is: ${new Date().toLocaleDateString('en-US')}`,
    '**Tool Rules:**',
    '1. **Bank Transaction Filter:** Use **PAST** dates only.',
    '2. **Flight Search:** Use **FUTURE** dates only.',
    '3. **Accommodation Search:** Use **FUTURE** dates only.',
    '**Task:**',
    'Generate one natural user query for the tools below, ideally chaining them together.',
    'Output only the final query text. Do not include reasoning or think tags.',
    '**Tools:**',
    JSON.stringify(currentTools),
  ].join('\n');

  onLog?.(`Suggesting user prompt (model: ${settings.activeModel})…`);

  const payload = await requestChat(settings, {
    model: settings.activeModel,
    messages: [{ role: 'user', content }],
    temperature: 0.7,
  });

  const raw = payload.choices?.[0]?.message?.content?.trim() || '';
  const { suggestion, reasoning } = parseSuggestPromptResponse(raw);

  if (reasoning) {
    onLog?.(`Suggest prompt reasoning:\n${reasoning}`);
  }
  if (suggestion) {
    onLog?.(`Suggested prompt: "${suggestion}"`);
  } else if (raw) {
    onLog?.(`Suggest prompt returned empty text after stripping reasoning.`);
  }

  return suggestion;
}

/**
 * Run agent loop: user message → tool calls → final assistant text.
 */
export async function runAgentChat({
  settings,
  currentTools,
  userMessage,
  messages: priorMessages,
  executeToolFn,
  onLog,
}) {
  const tools = buildTools(currentTools);
  const messages =
    priorMessages && priorMessages.length > 0
      ? [...priorMessages]
      : [{ role: 'system', content: buildSystemPrompt() }];

  messages.push({ role: 'user', content: userMessage });

  while (true) {
    const payload = await requestChat(settings, {
      model: settings.activeModel,
      messages,
      tools: tools.length ? tools : undefined,
      tool_choice: tools.length ? 'auto' : undefined,
    });

    const choice = payload.choices?.[0];
    if (!choice) throw new Error('Empty response from LLM');

    const assistantMessage = choice.message;
    messages.push(assistantMessage);

    const toolCalls = assistantMessage.tool_calls || [];
    if (toolCalls.length === 0) {
      return {
        messages,
        text: assistantMessage.content?.trim() || '',
      };
    }

    for (const toolCall of toolCalls) {
      const toolName = toolCall.function?.name;
      let args = {};
      try {
        args = JSON.parse(toolCall.function?.arguments || '{}');
      } catch {
        args = {};
      }

      const parsed = toolName?.match(/^_\d+_(.+)$/s);
      const shortName = parsed?.[1] || toolName;
      onLog?.(`AI calling tool "${shortName}" with ${JSON.stringify(args)}`);

      try {
        const result = await executeToolFn(shortName, toolName, args);
        onLog?.(`Tool "${shortName}" result: ${result}`);
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: typeof result === 'string' ? result : JSON.stringify(result),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        onLog?.(`⚠️ Error executing tool "${shortName}": ${message}`);
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: message }),
        });
      }
    }

    await new Promise((r) => setTimeout(r, 500));
  }
}
