const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

const { chromium } = require('playwright');

const extensionPath = path.resolve(__dirname, '..');
const fixturePath = path.resolve(__dirname, 'fixture.html');

const modes = [
  {
    models: [
      { name: 'GPT-6', maximumEffort: 4 },
      { name: 'GPT-5.6 Sol', maximumEffort: 4 },
    ],
    value: 'chat',
  },
  {
    models: [
      { name: 'デフォルト', maximumEffort: 5 },
      { name: 'GPT-6.1 Sol', maximumEffort: 5 },
      { name: 'GPT-6 Astra', maximumEffort: 5 },
      { name: 'GPT-6 Sol', maximumEffort: 5 },
      { name: 'GPT-6 Luna', maximumEffort: 4 },
      { name: 'GPT-5.6 Sol', maximumEffort: 5 },
      { name: 'GPT-5.6 Terra', maximumEffort: 5 },
      { name: 'GPT-5.6 Luna', maximumEffort: 4 },
    ],
    value: 'codex',
  },
];

async function waitForRestore(page) {
  await page.waitForFunction(() =>
    document.querySelector('[data-codex-intelligence-trigger]')
      ?.getAttribute('aria-expanded') === 'false');
}

async function selectedSettings(page) {
  return page.evaluate(() => ({
    effort: Number(document.querySelector('[role="slider"]')?.getAttribute('aria-valuenow')),
    mode: document.querySelector('[data-mode][aria-pressed="true"]')?.dataset.mode,
    model: document.querySelector('[role="menuitemradio"][aria-checked="true"]')
      ?.querySelector('[data-menu-row-content] span')?.textContent,
  }));
}

async function selectSettings(page, mode, model, effort) {
  const modeButton = page.locator(`[data-mode="${mode}"]`);
  if (await modeButton.getAttribute('aria-pressed') !== 'true') {
    await modeButton.click();
    await waitForRestore(page);
  }

  const trigger = page.locator('[data-codex-intelligence-trigger]');
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();

  const item = page.getByRole('menuitemradio', { name: model, exact: true });
  await item.click();
  await page.waitForFunction((name) =>
    document.querySelector('[role="menuitemradio"][aria-checked="true"]')
      ?.querySelector('[data-menu-row-content] span')?.textContent === name, model);

  const slider = page.getByRole('slider');
  let current = Number(await slider.getAttribute('aria-valuenow'));
  while (current !== effort) {
    await slider.press(current < effort ? 'ArrowRight' : 'ArrowLeft');
    current = Number(await slider.getAttribute('aria-valuenow'));
  }

  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  await page.getByRole('menu').press('Escape');
  await waitForRestore(page);
}

test('Chromium上で全モデルと努力量を保存・復元できる', { timeout: 120000 }, async (t) => {
  const fixture = await readFile(fixturePath, 'utf8');
  const context = await chromium.launchPersistentContext('', {
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
    channel: 'chromium',
    headless: true,
  });
  t.after(() => context.close());

  await context.route('https://chatgpt.com/**', (route) => route.fulfill({
    body: fixture,
    contentType: 'text/html',
  }));

  const page = await context.newPage();
  await page.goto('https://chatgpt.com/');
  await waitForRestore(page);

  for (const mode of modes) {
    for (const model of mode.models) {
      for (let effort = 0; effort <= model.maximumEffort; effort += 1) {
        await selectSettings(page, mode.value, model.name, effort);
        await page.reload();
        await waitForRestore(page);

        assert.deepEqual(await selectedSettings(page), {
          effort,
          mode: mode.value,
          model: model.name,
        });
      }
    }
  }

  await selectSettings(page, 'chat', 'GPT-5.6 Sol', 1);
  await selectSettings(page, 'codex', 'GPT-6 Astra', 5);
  await page.locator('[data-mode="chat"]').click();
  await waitForRestore(page);
  assert.deepEqual(await selectedSettings(page), {
    effort: 1,
    mode: 'chat',
    model: 'GPT-5.6 Sol',
  });

  await page.locator('[data-mode="codex"]').click();
  await waitForRestore(page);
  assert.deepEqual(await selectedSettings(page), {
    effort: 5,
    mode: 'codex',
    model: 'GPT-6 Astra',
  });
});
