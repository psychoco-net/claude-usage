# Claude Usage Widget for Scriptable

iOS の Scriptable で動作する Claude 利用状況表示ウィジェットです。

Claude の Usage API から取得した使用状況を、ホーム画面・ロック画面ウィジェットで確認できます。

## Features

* Claude の使用量を iPhone のウィジェットで表示
* ホーム画面ウィジェット対応
* ロック画面ウィジェット対応

  * 円形ウィジェット
  * 長方形ウィジェット
  * インライン表示
* API の `limits` 配列を利用した動的表示
* モデル別制限の自動表示
* キャッシュ表示による高速表示
* Claude ロゴ表示対応

## Display Example

表示例:

```
Claude Usage

現在のセッション
  プラン使用量        5%

週間制限
  すべてのプラン     65%
  Fable            100%
```

## Requirements

* iPhone / iPad
* Scriptable
* Claude アカウント
* Safari で claude.ai にログイン済み

## Installation

1. App Store から Scriptable をインストール

2. Scriptable に新規スクリプトを作成

3. 本リポジトリのスクリプトをコピー

4. 初回実行

5. Safari の Claude ログイン状態を利用して認証

6. ホーム画面またはロック画面に Scriptable ウィジェットを追加

## Widget Parameters

ロック画面の円形ウィジェットでは Parameter を指定できます。

| Parameter | 表示       |
| --------- | -------- |
| `session` | 現在のセッション |
| `weekly`  | すべてのプラン  |
| `fable`   | モデル別制限   |

## Data Source

Claude Usage API のレスポンスに含まれる `limits` 配列を利用しています。

例:

```json
{
  "limits": [
    {
      "kind": "session",
      "group": "session",
      "percent": 5
    },
    {
      "kind": "weekly_all",
      "group": "weekly",
      "percent": 65
    },
    {
      "kind": "weekly_scoped",
      "group": "weekly",
      "percent": 100,
      "scope": {
        "model": {
          "display_name": "Fable"
        }
      }
    }
  ]
}
```

## Configuration

主な設定項目:

```javascript
const REFRESH_MINUTES = 15;
const CACHE_FRESH_MINUTES = 30;
const CACHE_STALE_MINUTES = 120;
```

更新間隔やキャッシュ有効時間を変更できます。

## Authentication

認証情報は以下の用途でのみ利用します。

* Organization ID の保存
* Claude API へのアクセス

Organization ID は Scriptable の Keychain に保存されます。

## Notes

* Claude 側の API 仕様変更により動作しなくなる可能性があります。
* 利用状況の表示は Claude 側の API レスポンスに依存します。
* 個人利用を目的としたスクリプトです。

## License

MIT License

自由に利用・変更・再配布できます。
ただし、Claude API の利用規約に従って使用してください。
