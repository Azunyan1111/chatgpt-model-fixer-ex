const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const test = require('node:test');

const {
  effortKey,
  effortTarget,
  matchingModel,
  modeName,
  modelSlug,
  preferencesUrl,
} = require('../preferences');

test('モデル名をURL用の値へ変換する', () => {
  assert.equal(modelSlug('GPT-6.1 Sol'), 'gpt-6.1-sol');
  assert.equal(modelSlug('Default'), null);
  assert.equal(modelSlug('デフォルト'), null);
});

test('モデル一覧から保存したモデルを特定する', () => {
  const models = ['GPT-6.1 Sol', 'GPT-6 Astra'];
  assert.equal(matchingModel(models, 'GPT-6 Astra'), 'GPT-6 Astra');
});

test('努力量を動かすキーを決定する', () => {
  assert.equal(effortKey(1, 2), 'ArrowRight');
  assert.equal(effortKey(2, 1), 'ArrowLeft');
  assert.equal(effortKey(2, 2), null);
});

test('画面上のモード名を保存値へ変換する', () => {
  assert.equal(modeName({ textContent: ' Chat ' }), 'chat');
  assert.equal(modeName({ textContent: ' Work ' }), 'codex');
  assert.equal(modeName({ textContent: 'Codex' }), 'codex');
  assert.equal(modeName({ textContent: 'Unknown' }), undefined);
});

test('保存した努力量をモデルの選択可能範囲に収める', () => {
  assert.equal(effortTarget(0, 1, 3), 1);
  assert.equal(effortTarget(2, 1, 3), 2);
  assert.equal(effortTarget(4, 1, 3), 3);
});

test('モデルとCodexモードを新規チャットのURLへ反映する', () => {
  const actual = preferencesUrl('https://chatgpt.com/?q=hello', {
    savedModel: 'GPT-6.1 Sol',
    savedMode: 'codex',
  });
  const url = new URL(actual);

  assert.equal(url.searchParams.get('model'), 'gpt-6.1-sol');
  assert.equal(url.searchParams.get('surface'), 'work');
  assert.equal(url.searchParams.get('q'), 'hello');
});

test('ChatモードではWork指定だけをURLから外す', () => {
  const actual = preferencesUrl(
    'https://chatgpt.com/?model=gpt-6.1-sol&surface=work',
    { savedModel: 'Default', savedMode: 'chat' },
  );
  const url = new URL(actual);

  assert.equal(url.searchParams.has('model'), false);
  assert.equal(url.searchParams.has('surface'), false);
});

test('既存チャットのURLは変更しない', () => {
  const current = 'https://chatgpt.com/c/123?model=gpt-6.1-sol';
  assert.equal(preferencesUrl(current, {
    savedModel: 'GPT-6 Astra',
    savedMode: 'codex',
  }), current);
});

test('共有ロジックをコンテンツスクリプトより先に読み込む', async () => {
  const manifest = JSON.parse(await readFile(
    `${__dirname}/../manifest.json`,
    'utf8',
  ));

  assert.deepEqual(manifest.content_scripts[0].js, ['preferences.js', 'content.js']);
});
