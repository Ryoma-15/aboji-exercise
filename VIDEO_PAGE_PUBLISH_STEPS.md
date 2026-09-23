# 朝6動画学習室：暫定公開の設定

## 1. GitHubで3ファイルを差し替える

リポジトリ `Ryoma-15/aboji-exercise` のルートに、同梱の次の3ファイルを上書きアップロードします。

- `_worker.js`
- `videos.html`
- `_headers`

GitHubのコミット完了後、Cloudflare Pagesが自動デプロイされるまで待ちます。

## 2. Cloudflare Pagesへ変数を登録する

Cloudflareダッシュボードで、`Workers & Pages` → `aboji-exercise` → `Settings` → `Variables and Secrets` を開きます。Productionへ次を登録します。

| 名前 | 値 | 種類 |
|---|---|---|
| `VIDEO_ACCESS_MODE` | `link` | Text |
| `VIDEO_ACCESS_TOKEN` | `42d62f50bf70a17f3e76df663fa16f9d510c3d888e98f085` | Secret（暗号化） |
| `YT_PLAYLIST_TUTORIAL` | `PLZy9PMSJuK3s` | Text |
| `YT_PLAYLIST_SHORT` | `PLVdxi87EbGQI` | Text |
| `YT_PLAYLIST_MESSAGE` | `PLByhPQpGuR4c` | Text |
| `YOUTUBE_API_KEY` | Google Cloudで発行したYouTube Data API v3のAPIキー | Secret（暗号化） |

保存後、最新デプロイを一度再実行します。

## 3. LINE公式アカウントのリッチメニューへ設定するURL

```text
https://aboji-exercise.pages.dev/videos?entry=42d62f50bf70a17f3e76df663fa16f9d510c3d888e98f085
```

このURLはリッチメニューにだけ設定し、一般公開しません。入口を開くと30日間有効な閲覧Cookieが発行され、アドレス欄は自動的に `https://aboji-exercise.pages.dev/videos` へ変わります。

## 4. 動作確認

1. SafariまたはChromeのプライベートブラウズで `https://aboji-exercise.pages.dev/videos` を直接開く → 動画は表示されず「公式LINEからお入りください」と表示される。
2. LINEのリッチメニューから開く → 3つの動画枠と各再生リストの動画一覧が表示される。
3. YouTube再生リストの順番を変える → 最大15分後、Web側も同じ順番に変わる。

## 注意

この暫定方式は本人認証ではありません。秘密の入口URL自体を第三者へ転送された場合、その人も初回閲覧できます。URLが漏れた場合は `VIDEO_ACCESS_TOKEN` を新しい値へ変更し、リッチメニューのURLも同じ値へ更新してください。以前発行したCookieも同時に無効になります。

正式なLINE Developers権限が得られたら、`VIDEO_ACCESS_MODE` を `line` に変更し、LIFF関連の変数を設定することで正式な友だち判定方式へ戻せます。
