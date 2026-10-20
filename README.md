# chatgpt-model-fixer-ex

ChatGPTで選んだモデル、努力量、Chat／Codexモードを保存し、再読み込みや新しいタブでも自動的に選択します。現在のChatGPT画面ではCodexモードが「Work」と表示されます。

Chromeの拡張機能管理画面でデベロッパーモードを有効にし、「パッケージ化されていない拡張機能を読み込む」からこのディレクトリを選択してください。

新規チャットではモデルを `model`、Codexモードを `surface=work` のURLパラメーターで指定します。Chatモードでは `surface=work` を外します。努力量には対応するURLパラメーターがないため、モデル選択ボタンの `data-codex-intelligence-trigger` とスライダーの `aria-valuenow` を使用します。画面操作の予備手段として、モデル一覧の `role="menuitemradio"` とChat／Codexモードの `aria-pressed` も使用します。保存した選択肢が現在の画面にない場合は、その項目を変更しません。

## テスト

Node.js 22とpnpmを用意し、次のコマンドを実行します。

```sh
pnpm install --frozen-lockfile
pnpm test
```

実行時依存と開発時依存はありません。現行の全モデルと対応する全努力量の46組み合わせ、URLパラメーター、Chat／Codexモード、努力量の範囲、Manifest V3の読み込み順をNode.js標準のテストランナーで検証し、同じテストをGitHub Actionsでも実行します。
