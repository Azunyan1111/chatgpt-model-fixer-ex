# chatgpt-model-fixer-ex

ChatGPTのChat／Codexモードごとに選んだモデルと努力量を別々に保存し、再読み込みや新しいタブでも自動的に選択します。現在のChatGPT画面ではCodexモードが「Work」と表示されます。

Chromeの拡張機能管理画面でデベロッパーモードを有効にし、「パッケージ化されていない拡張機能を読み込む」からこのディレクトリを選択してください。

新規チャットではモデルを `model`、Codexモードを `surface=work` のURLパラメーターで指定します。Chatモードでは `surface=work` を外します。努力量には対応するURLパラメーターがないため、モデル選択ボタンの `data-codex-intelligence-trigger` とスライダーの `aria-valuenow` を使用します。画面操作の予備手段として、モデル一覧の `role="menuitemradio"` とChat／Codexモードの `aria-pressed` も使用します。保存した選択肢が現在の画面にない場合は、その項目を変更しません。

## テスト

Node.js 22とpnpmを用意し、次のコマンドを実行します。

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm run test
```

実行時依存はありません。開発時のみPlaywrightを使用し、実際のChromiumへ拡張機能を読み込んで、Chat／Codexそれぞれの全モデルと努力量の56組み合わせを保存・再読み込み・復元できることを検証します。ログインや外部通信は使わず、ChatGPTと同じURLへローカルの検証画面を割り当てます。URLパラメーターなどの純粋なロジックはNode.js標準のテストランナーで検証します。
