# アボジ体操 ホーム画面追加テスト

サイトのルートに以下のファイルをまとめてアップロードしてください。

- home-screen-test.html
- manifest.webmanifest
- sw.js
- app-icon-180.png
- app-icon-192.png
- app-icon-512.png

公開後に `https://あなたのサイト/home-screen-test.html` をiPhoneのSafariで開きます。

1. 「ホーム画面に追加する」を押す
2. 画面の案内どおり Safari の共有 → ホーム画面に追加 → 追加
3. Safariを閉じる
4. ホーム画面の「アボジ体操」アイコンを押す
5. 「テスト成功です」と表示されればOK

※ iPhone/iPadではWebページのボタンから「ホーム画面に追加」を直接実行するAPIはありません。
このテストでは端末を判定し、iPhoneでは迷いにくい3ステップ案内を表示します。
Android/PCでブラウザがPWAインストールAPIに対応している場合は、同じボタンからインストール確認を出します。
