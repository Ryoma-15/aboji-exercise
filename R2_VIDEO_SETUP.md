# 最新動画（Cloudflare R2）設定

`/videos` にある「最新の動画」は、非公開のR2バケットからCloudflare Pages Worker経由で配信します。既存のYouTubeプレイリストは従来どおりです。

## Cloudflareで一度だけ行う設定

1. Cloudflare Dashboardの **R2 Object Storage** でStandardクラスのバケットを作成します（例：`aboji-private-videos`）。
2. バケット設定で **Public Development URL (`r2.dev`) を有効にしない**でください。カスタムドメインも設定不要です。
3. **Workers & Pages > `aboji-exercise` Pagesプロジェクト > Settings > Bindings > Add > R2 bucket** を開きます。
4. Variable name に `VIDEO_BUCKET`、R2 bucket に先ほどのバケットを選び、保存します。
5. 最新のGitHubデプロイを実行します。Bindingは再デプロイ後に有効になります。

既存の `VIDEO_ACCESS_MODE` と `VIDEO_ACCESS_TOKEN` は変更しません。現在の仮運用（`VIDEO_ACCESS_MODE=link`）では、リッチメニュー用の入口リンクで発行されたCookieが動画配信にも使われます。LINE認証モードでは、既存の友だち確認が成功した後に同じCookieが発行されます。

## 動画のアップロードと差し替え

- オブジェクトキーはバケット直下の **`latest-video.mp4`** 固定です（フォルダ不要）。
- Cloudflare Dashboardでバケットを開き、オブジェクト一覧からアップロードします。大容量ファイルは multipart upload 対応のS3クライアントを使うと、再試行しやすくなります。
- 動画形式はMP4（H.264映像 + AAC音声）を推奨します。
- 次回差し替えも同じキーのオブジェクトを置き換えるだけです。配信応答は `no-store` のため、同じファイル名でも古い動画を長期間キャッシュしません。

## 動作確認

- 動画ページを開き、最新動画枠に再生コントロールが出ることを確認します。
- 動画を再生し、途中へシーク・一時停止・再開・全画面表示を確認します。
- 未認証の状態で `/media/latest-video` に直接アクセスすると `403` になります。
- 認証済みでもR2未設定なら準備中表示、バケットに動画がない場合も準備中表示になります。
- 既存の3つのYouTubeプレイリストは別枠のままです。

## 保護と費用について

R2は非公開のままです。配信Workerは認証Cookieを確認し、固定キーの動画のみを返します。動画データはストリーミングし、Rangeリクエストには `206 Partial Content` で応答します。

これはDRMではありません。閲覧権限のある利用者は、画面録画やブラウザーの開発者機能などで複製できる可能性があります。URL共有だけを防ぎ、動画の複製を完全に防止することはできません。

Cloudflare R2 Standardの無料枠は月10 GB-monthの保存、Class A 100万操作、Class B 1,000万操作で、インターネット向けデータ転送は無料です。無料枠を超えた保存容量・操作には料金が発生するため、R2の利用状況とアカウントの請求画面を確認してください。大きな動画を長期間保存する場合、10 GB-monthの範囲を超える可能性があります。
