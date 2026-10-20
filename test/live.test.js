const assert = require('node:assert/strict');
const { access, cp, copyFile, mkdir, rm, stat } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { after, describe, test } = require('node:test');
const { isDeepStrictEqual } = require('node:util');

const { chromium } = require('playwright');

const extensionPath = path.resolve(__dirname, '..');
const chromeProfilePath = path.resolve(extensionPath, '.chrome-profile');
const chromiumProfilePath = path.resolve(extensionPath, '.chromium-profile');
const triggerSelector = 'button[data-codex-intelligence-trigger="true"]';
const sliderSelector = '[data-model-picker-power-slider] [role="slider"]';
// A row can follow the model name with a description, such as デフォルト and おすすめのモデルセット.
const modelNameSelector = '[data-menu-row-content] span';
const pickerTimeout = 5000;

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function copyPath(source, destination) {
  const sourceStat = await stat(source);
  if (sourceStat.isDirectory()) {
    await cp(source, destination, { force: true, recursive: true });
  } else {
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }
}

async function copyChromeSession() {
  if (process.platform !== 'darwin') {
    throw new Error('Chromeセッションの複製は現在macOSに対応しています');
  }

  const sourceRoot = path.join(
    os.homedir(),
    'Library',
    'Application Support',
    'Google',
    'Chrome',
  );
  const paths = [
    'Local State',
    path.join('Default', 'Cookies'),
    path.join('Default', 'Preferences'),
    path.join('Default', 'IndexedDB', 'https_chatgpt.com_0.indexeddb.leveldb'),
    path.join('Default', 'IndexedDB', 'https_chatgpt.com_0.indexeddb.blob'),
  ];

  try {
    for (const relativePath of paths) {
      await copyPath(
        path.join(sourceRoot, relativePath),
        path.join(chromeProfilePath, relativePath),
      );
    }
  } catch (error) {
    // Leave no partial copy behind, otherwise the next run would reuse it.
    await rm(chromeProfilePath, { force: true, recursive: true });
    throw error;
  }
}

async function launchHeadlessContext(userDataDir, options) {
  const browser = await chromium.launch({ channel: options.channel, headless: true });
  const page = await browser.newPage();
  const userAgent = await page.evaluate(() => navigator.userAgent);
  await browser.close();
  return chromium.launchPersistentContext(userDataDir, {
    ...options,
    headless: true,
    // ChatGPT keeps the HeadlessChrome user agent on the Cloudflare challenge page.
    userAgent: userAgent.replace('HeadlessChrome/', 'Chrome/'),
  });
}

async function readChromeSession() {
  const context = await launchHeadlessContext(chromeProfilePath, {
    channel: 'chrome',
    ignoreDefaultArgs: ['--use-mock-keychain'],
  });
  const page = context.pages()[0] || await context.newPage();
  await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded' });
  await page.locator(triggerSelector).waitFor({ state: 'visible', timeout: 60000 });
  const session = await context.storageState();
  await context.close();
  return session;
}

async function loadSession(context, session) {
  await context.addCookies(session.cookies);
  const localStorageByOrigin = Object.fromEntries(session.origins.map(({ origin, localStorage }) =>
    [origin, localStorage]));
  await context.addInitScript((storage) => {
    for (const { name, value } of storage[location.origin] || []) {
      localStorage.setItem(name, value);
    }
  }, localStorageByOrigin);
}

async function evaluateInExtension(page, expression) {
  const client = await page.context().newCDPSession(page);
  const contexts = [];
  client.on('Runtime.executionContextCreated', ({ context }) => contexts.push(context));
  try {
    await client.send('Runtime.enable');
    await page.waitForTimeout(100);

    for (const context of contexts) {
      try {
        const capability = await client.send('Runtime.evaluate', {
          contextId: context.id,
          expression: 'Boolean(globalThis.chrome?.storage?.local)',
          returnByValue: true,
        });
        if (!capability.result.value) continue;
        const result = await client.send('Runtime.evaluate', {
          awaitPromise: true,
          contextId: context.id,
          expression,
          returnByValue: true,
        });
        return result.result.value;
      } catch {
        // Navigation can invalidate unrelated execution contexts while they are inspected.
      }
    }
    return null;
  } finally {
    await client.detach().catch(() => {});
  }
}

function extensionStorage(page) {
  return evaluateInExtension(page, 'chrome.storage.local.get(null)');
}

const modeLabels = { chat: /^\s*chat\s*$/i, codex: /^\s*(work|codex)\s*$/i };

// Sidebar conversations are also role="group" and load later, so never locate the switch by index.
function modeButton(page, mode, { pressed = false } = {}) {
  const pressedSelector = pressed ? '[aria-pressed="true"]' : '';
  return page.locator(`[role="group"] > button[aria-pressed]${pressedSelector}`)
    .filter({ hasText: modeLabels[mode] });
}

async function selectedMode(page) {
  for (const mode of Object.keys(modeLabels)) {
    if (await modeButton(page, mode, { pressed: true }).count() === 1) return mode;
  }
  throw new Error('Chat／Codexのモード切替が実ページに見つかりません');
}

async function selectMode(page, mode) {
  const button = modeButton(page, mode);
  await button.waitFor({ state: 'visible' });
  const changed = await button.getAttribute('aria-pressed') !== 'true';
  if (changed) await button.click();
  await modeButton(page, mode, { pressed: true }).waitFor({ state: 'visible' });
  if (changed) await waitForExtensionRestore(page);
}

async function openModelMenu(page) {
  const trigger = page.locator(triggerSelector);
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
  await trigger.evaluate((element) => {
    if (element.getAttribute('aria-expanded') !== 'true') {
      throw new Error('実ページのモデルメニューを開けません');
    }
  });
  const triggerId = await trigger.getAttribute('id');
  const menu = page.locator(`[role="menu"][aria-labelledby="${triggerId}"][data-state="open"]`);
  await menu.waitFor({ state: 'visible', timeout: pickerTimeout });
  return menu;
}

async function showModelList(menu) {
  const visibleItems = menu.getByRole('menuitemradio');
  if (await visibleItems.count() === 0) {
    await menu.locator('[data-model-picker-view-toggle]').click({ timeout: pickerTimeout });
  }
  await visibleItems.first().waitFor({ state: 'visible', timeout: pickerTimeout });
  return visibleItems;
}

// ChatGPT can replace the picker while it is open, which detaches the menu being read.
async function readPicker(page, read) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      if (attempt === 3) throw error;
      await page.keyboard.press('Escape');
      await waitForExtensionRestore(page);
    }
  }
}

function modelNames(items) {
  return items.evaluateAll((candidates, selector) => candidates
    .map((candidate) => candidate.querySelector(selector)?.textContent.trim()), modelNameSelector);
}

async function discoverModels(page) {
  const menu = await openModelMenu(page);
  const items = await showModelList(menu);
  const names = (await modelNames(items)).filter(Boolean);
  await page.keyboard.press('Escape');
  assert.ok(names.length > 0, '実ページからモデルを取得できること');
  assert.equal(new Set(names).size, names.length, '実ページのモデル名が重複しないこと');
  return names;
}

async function selectModel(page, name) {
  const menu = await openModelMenu(page);
  const items = await showModelList(menu);
  const names = await modelNames(items);
  assert.equal(
    names.filter((candidate) => candidate === name).length,
    1,
    `${name}が実ページに1件だけ存在すること`,
  );
  await items.nth(names.indexOf(name)).click();
  await page.waitForFunction(
    ({ modelName, nameSelector, selector }) => [...document.querySelectorAll(selector)]
      .some((candidate) => candidate.getAttribute('aria-checked') === 'true'
        && candidate.querySelector(nameSelector)?.textContent.trim() === modelName),
    { modelName: name, nameSelector: modelNameSelector, selector: '[role="menuitemradio"]' },
  );
  return openModelMenu(page);
}

async function effortRange(menu) {
  const slider = menu.locator(sliderSelector);
  await slider.waitFor({ state: 'attached' });
  return {
    maximum: Number(await slider.getAttribute('aria-valuemax')),
    minimum: Number(await slider.getAttribute('aria-valuemin')),
  };
}

async function selectEffort(menu, effort) {
  const slider = menu.locator(sliderSelector);
  const keyboardControl = menu.locator('[data-reasoning-slider="true"]');
  // ChatGPT can render a new slider for the changed value, so look it up again every time.
  const changed = (value) => menu.page().waitForFunction(
    ({ selector, previous }) => [...document.querySelectorAll(selector)].some((element) =>
      !element.closest('[inert]') && Number(element.getAttribute('aria-valuenow')) !== previous),
    { selector: sliderSelector, previous: value },
    { timeout: 3000 },
  ).then(() => true, () => false);
  let current = Number(await slider.getAttribute('aria-valuenow'));
  while (current !== effort) {
    const key = current < effort ? 'ArrowRight' : 'ArrowLeft';
    await keyboardControl.press(key);
    // ChatGPT occasionally drops a key press while the picker settles, so press it once more.
    if (!await changed(current)) await keyboardControl.press(key);
    if (!await changed(current)) {
      const state = await menu.page().evaluate((selector) => ({
        focused: document.activeElement?.getAttribute('data-reasoning-slider')
          ?? document.activeElement?.getAttribute('role'),
        sliders: [...document.querySelectorAll(selector)].map((element) => ({
          inert: Boolean(element.closest('[inert]')),
          locked: element.closest('[data-locked]')?.getAttribute('data-locked'),
          maximum: element.getAttribute('aria-valuemax'),
          value: element.getAttribute('aria-valuenow'),
        })),
        view: document.querySelector('[data-model-picker-view]')
          ?.getAttribute('data-model-picker-view'),
      }), sliderSelector);
      throw new Error(`実ページで努力量が変化しません: ${JSON.stringify(state)}`);
    }
    current = Number(await slider.getAttribute('aria-valuenow'));
  }
}

async function closeModelMenu(page) {
  await page.keyboard.press('Escape');
  await page.locator(triggerSelector).waitFor({ state: 'visible' });
  await page.waitForFunction((selector) =>
    document.querySelector(selector)?.getAttribute('aria-expanded') === 'false', triggerSelector);
}

function currentSettings(page) {
  return readPicker(page, async () => {
    const mode = await selectedMode(page);
    const menu = await openModelMenu(page);
    const effort = Number(await menu.locator(sliderSelector).getAttribute('aria-valuenow'));
    const items = await showModelList(menu);
    const model = await items.evaluateAll((candidates, selector) => candidates
      .find((candidate) => candidate.getAttribute('aria-checked') === 'true')
      ?.querySelector(selector)?.textContent.trim(), modelNameSelector);
    await closeModelMenu(page);
    assert.ok(model, '実ページで選択中のモデルを取得できること');
    return { effort, mode, model };
  });
}

async function assertStoredSettings(page, mode, model, effort) {
  const storage = await extensionStorage(page);
  const prefix = mode === 'codex' ? 'savedCodex' : 'savedChat';
  assert.deepEqual({
    savedChatEffort: storage.savedChatEffort,
    savedChatModel: storage.savedChatModel,
    savedCodexEffort: storage.savedCodexEffort,
    savedCodexModel: storage.savedCodexModel,
    savedMode: storage.savedMode,
  }, {
    savedChatEffort: mode === 'chat' ? effort : storage.savedChatEffort,
    savedChatModel: mode === 'chat' ? model : storage.savedChatModel,
    savedCodexEffort: mode === 'codex' ? effort : storage.savedCodexEffort,
    savedCodexModel: mode === 'codex' ? model : storage.savedCodexModel,
    savedMode: mode,
  }, `${prefix}の実際の保存内容が選択値と一致すること`);
}

async function waitForExtensionRestore(page) {
  const deadline = Date.now() + 180000;
  const settled = () => evaluateInExtension(page, 'globalThis.ChatGPTModelFixer?.isSettled() === true');
  // ChatGPT can still replace the picker shortly after a restore, so it must stay settled.
  let settledSince = null;
  while (settledSince === null || Date.now() - settledSince < 500) {
    if (Date.now() > deadline) throw new Error('実ページで拡張機能の復元が完了しません');
    if (!await settled()) settledSince = null;
    else settledSince ??= Date.now();
    await page.waitForTimeout(100);
  }
  await page.waitForFunction((selector) =>
    document.querySelector(selector)?.getAttribute('aria-expanded') === 'false', triggerSelector);
}

const modeTitles = { chat: 'Chat', codex: 'Codex' };

async function launchTestContext() {
  // The machine's Chrome is read only to create these profiles; later runs reuse them as they are.
  let session;
  if (!await exists(chromiumProfilePath)) {
    if (!await exists(chromeProfilePath)) await copyChromeSession();
    session = await readChromeSession();
  }
  const context = await launchHeadlessContext(chromiumProfilePath, {
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
    channel: 'chromium',
    ignoreDefaultArgs: ['--disable-extensions'],
  });
  if (session) await loadSession(context, session);
  return context;
}

async function discoverSettings(page) {
  const discovered = {};
  for (const mode of Object.keys(modeTitles)) {
    await selectMode(page, mode);
    discovered[mode] = [];
    for (const model of await discoverModels(page)) {
      const menu = await selectModel(page, model);
      discovered[mode].push({ model, ...await effortRange(menu) });
      await closeModelMenu(page);
    }
  }
  return discovered;
}

async function selectSettings(page, mode, model, effort) {
  await selectMode(page, mode);
  await selectEffort(await selectModel(page, model), effort);
  await closeModelMenu(page);
}

function visibleModels(page) {
  return readPicker(page, async () => {
    const names = await modelNames(await showModelList(await openModelMenu(page)));
    await closeModelMenu(page);
    return names;
  });
}

// After a reload ChatGPT occasionally keeps showing the Chat models in Codex mode until the
// next load, so reload a few times until the page lists the models found for the mode.
async function reloadUntilListed(page, models) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.evaluate(() => history.replaceState(history.state, '', '/'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForExtensionRestore(page);
    const listed = isDeepStrictEqual(await visibleModels(page), models);
    // Reading the list may have held back a restore for a picker that replaced the first one.
    await waitForExtensionRestore(page);
    if (listed) return;
  }
}

// Each combination is its own test so that a failure can be rerun alone with --test-name-pattern.
describe('実際のChatGPT', async () => {
  const context = await launchTestContext();
  after(() => context.close());
  const page = context.pages()[0] || await context.newPage();
  await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded' });
  await waitForExtensionRestore(page);
  const discovered = await discoverSettings(page);

  test('拡張機能のコンテンツスクリプトが読み込まれる', async () => {
    assert.notEqual(await extensionStorage(page), null);
  });

  for (const [mode, models] of Object.entries(discovered)) {
    const names = models.map(({ model }) => model);
    for (const { model, minimum, maximum } of models) {
      for (let effort = minimum; effort <= maximum; effort += 1) {
        test(`${modeTitles[mode]}／${model}／努力量${effort}を保存し再読み込み後に復元する`, async () => {
          await selectMode(page, mode);
          if (!isDeepStrictEqual(await visibleModels(page), names)) {
            await reloadUntilListed(page, names);
          }
          await selectSettings(page, mode, model, effort);
          await page.waitForTimeout(100);
          await assertStoredSettings(page, mode, model, effort);

          await reloadUntilListed(page, names);
          assert.deepEqual(await currentSettings(page), { effort, mode, model });
        });
      }
    }
  }

  test('ChatとCodexを切り替えるとそれぞれの設定を復元する', async () => {
    const chat = discovered.chat.at(-1);
    const codex = discovered.codex.at(-1);
    await selectSettings(page, 'chat', chat.model, chat.minimum);
    await selectSettings(page, 'codex', codex.model, codex.maximum);

    await selectMode(page, 'chat');
    assert.deepEqual(await currentSettings(page), {
      effort: chat.minimum,
      mode: 'chat',
      model: chat.model,
    });
    await selectMode(page, 'codex');
    assert.deepEqual(await currentSettings(page), {
      effort: codex.maximum,
      mode: 'codex',
      model: codex.model,
    });
  });
});
