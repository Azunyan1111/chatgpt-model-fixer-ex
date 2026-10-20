const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const preferences = require('../preferences');

const contentScript = readFileSync(`${__dirname}/../content.js`, 'utf8');

// 2026-10-20時点のChatGPTモデル選択画面と努力量の範囲です。
const codexModels = [
  { name: 'デフォルト', slug: null, maximumEffort: 5 },
  { name: 'GPT-6.1 Sol', slug: 'gpt-6.1-sol', maximumEffort: 5 },
  { name: 'GPT-6 Astra', slug: 'gpt-6-astra', maximumEffort: 5 },
  { name: 'GPT-6 Sol', slug: 'gpt-6-sol', maximumEffort: 5 },
  { name: 'GPT-6 Luna', slug: 'gpt-6-luna', maximumEffort: 4 },
  { name: 'GPT-5.6 Sol', slug: 'gpt-5.6-sol', maximumEffort: 5 },
  { name: 'GPT-5.6 Terra', slug: 'gpt-5.6-terra', maximumEffort: 5 },
  { name: 'GPT-5.6 Luna', slug: 'gpt-5.6-luna', maximumEffort: 4 },
];

const chatModels = [
  { name: 'GPT-6', slug: 'gpt-6', maximumEffort: 4 },
  { name: 'GPT-5.6 Sol', slug: 'gpt-5.6-sol', maximumEffort: 4 },
];

const modes = [
  { label: 'Chat', models: chatModels, value: 'chat' },
  { label: 'Codex', models: codexModels, value: 'codex' },
];

const efforts = [
  { name: 'low', value: 0 },
  { name: 'medium', value: 1 },
  { name: 'high', value: 2 },
  { name: 'xhigh', value: 3 },
  { name: 'max', value: 4 },
  { name: 'ultra', value: 5 },
];

function element(textContent, attributes = {}) {
  return {
    textContent,
    click() {},
    getAttribute(name) {
      return attributes[name] ?? null;
    },
    setAttribute(name, value) {
      attributes[name] = String(value);
    },
  };
}

async function runContentScript(mode, model, effort) {
  const initialModel = mode.models.find(({ name }) => name !== model.name).name;
  const initialEffort = effort.value === 0 ? model.maximumEffort : 0;
  const keys = [];
  let complete;
  const completed = new Promise((resolve) => { complete = resolve; });

  const items = mode.models.map(({ name }) => {
    const item = element(name, { 'aria-checked': name === initialModel ? 'true' : 'false' });
    item.querySelector = () => ({ textContent: name });
    item.closest = () => null;
    item.isConnected = true;
    item.click = () => {
      for (const candidate of items) candidate.setAttribute('aria-checked', 'false');
      item.setAttribute('aria-checked', 'true');
    };
    return item;
  });

  const slider = element('', {
    'aria-valuemin': '0',
    'aria-valuemax': String(model.maximumEffort),
    'aria-valuenow': String(initialEffort),
  });
  slider.dispatchEvent = ({ key }) => {
    keys.push(key);
    const direction = key === 'ArrowRight' ? 1 : -1;
    slider.setAttribute('aria-valuenow', Number(slider.getAttribute('aria-valuenow')) + direction);
  };
  slider.matches = () => true;

  const menu = {
    querySelector(selector) {
      if (selector === '[data-model-picker-power-slider] [role="slider"]') return slider;
      return null;
    },
    querySelectorAll() {
      return items;
    },
    dispatchEvent({ key }) {
      if (key === 'Escape') complete();
    },
    contains() {
      return true;
    },
  };

  const trigger = element('', {
    'aria-controls': 'model-menu',
    'aria-expanded': 'false',
  });
  trigger.dispatchEvent = () => trigger.setAttribute('aria-expanded', 'true');

  const chatButton = element('Chat', { 'aria-pressed': mode.value === 'codex' ? 'true' : 'false' });
  const workButton = element('Work', { 'aria-pressed': mode.value === 'chat' ? 'true' : 'false' });
  chatButton.click = () => {
    chatButton.setAttribute('aria-pressed', 'true');
    workButton.setAttribute('aria-pressed', 'false');
  };
  workButton.click = () => {
    chatButton.setAttribute('aria-pressed', 'false');
    workButton.setAttribute('aria-pressed', 'true');
  };
  const group = { querySelectorAll: () => [chatButton, workButton] };
  const search = new URLSearchParams();
  if (mode.value === 'codex') search.set('surface', 'work');
  if (model.slug) search.set('model', model.slug);
  const settings = {
    savedChatEffort: mode.value === 'chat' ? effort.value : 4,
    savedChatModel: mode.value === 'chat' ? model.name : 'GPT-6',
    savedCodexEffort: mode.value === 'codex' ? effort.value : 5,
    savedCodexModel: mode.value === 'codex' ? model.name : 'GPT-6.1 Sol',
    savedMode: mode.value,
  };

  const context = {
    ChatGPTPreferences: preferences,
    KeyboardEvent: class {
      constructor(type, options) {
        this.type = type;
        Object.assign(this, options);
      }
    },
    MutationObserver: class {
      disconnect() {}
      observe() {}
    },
    PointerEvent: class {
      constructor(type, options) {
        this.type = type;
        Object.assign(this, options);
      }
    },
    URL,
    chrome: {
      storage: {
        local: {
          get: async () => settings,
          set() {},
        },
      },
    },
    clearTimeout,
    document: {
      addEventListener() {},
      body: {},
      getElementById: () => menu,
      querySelector(selector) {
        if (selector === 'button[data-codex-intelligence-trigger="true"]') return trigger;
        if (selector === '[data-model-picker-power-slider] [role="slider"]') return slider;
        return null;
      },
      querySelectorAll: () => [group],
    },
    history: {
      state: null,
      replaceState() {},
    },
    location: {
      href: `https://chatgpt.com/?${search}`,
      replace(url) {
        throw new Error(`予期しないURL変更です: ${url}`);
      },
    },
    requestAnimationFrame: (callback) => callback(),
    setTimeout,
  };

  vm.runInNewContext(contentScript, context, { filename: 'content.js' });
  await completed;

  return {
    effort: Number(slider.getAttribute('aria-valuenow')),
    keys,
    mode: chatButton.getAttribute('aria-pressed') === 'true' ? 'chat' : 'codex',
    model: items.find((item) => item.getAttribute('aria-checked') === 'true').textContent,
  };
}

for (const mode of modes) {
  for (const model of mode.models) {
    for (const effort of efforts.filter(({ value }) => value <= model.maximumEffort)) {
      test(`${mode.label}で${model.name}を${effort.name}へ切り替えられる`, {
        timeout: 1000,
      }, async () => {
        const actual = await runContentScript(mode, model, effort);

        assert.equal(actual.mode, mode.value);
        assert.equal(actual.model, model.name);
        assert.equal(actual.effort, effort.value);
        assert.equal(actual.keys.length, Math.abs(
          (effort.value === 0 ? model.maximumEffort : 0) - effort.value,
        ));
      });
    }
  }
}
