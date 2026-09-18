# OpenCode 2版 Jev Warden：実装調整役への着手指示

本書 `../jev-warden-opencode2-design-v0.1.md` と参照用v0.2を正本として読む。目的は、既存の主モデルを大量の意味観測・証拠取得・検証で助け、その助け方を経験から自動改善すること。単なるblockerや警告集にはしない。

## 最初にすること

実際のCLI/server/plugin package/runtimeと公開型を確認する。本書のsource baselineは `anomalyco/opencode@a2594ddefb6557ecf7e7edb3e30ea50c71df8519`、そのソース内のpackageは `@opencode/plugin@2.0.7`。配布版が同じとは仮定しない。`@opencode-ai/plugin`や`ctx.catalog`の旧例と混ぜない。

手元のrepositoryと指示を読んで、解決済みの機能を再実装しない。新規のrepo作成・外部送信・API課金・commit/pushは、実装タスクで明示された権限に従う。

## 責務

server pluginはEffectを第一候補とする。Coreは純粋TS、TUIは表示client、Labは永続記録と自己改善。固定Kernel/promoterを候補生成器から分離する。最初から別serviceを多数作らず、必要なOS隔離だけ分ける。

## 最初の変更単位

空のserver/TUI入口、doctor、scope/permission/pinのCore、dummy transport、最小statusを作る。実機でprompt原文、context、tool before/after、permission順序、RPC、registry reload、cleanupを確認する。`appendix/acceptance-matrix.json`のNOT_RUNを、実際の証拠がある項目だけ更新する。

その後、event/原文/snapshot/receiptを記録し、specific sufficiencyの一本をつなぐ。EXPECTED_CALLSの定義不足を発見し、許可された定義取得、再判定、反証・支持・保留を保存する。

## 保持する不変条件

- user本文をWardenの意図へ置換しない。日常の助言はcontextへ。
- `ctx.location`だけで全sessionのscopeを決めない。server/epoch/location/sessionを検証する。
- 元のdeny/askを弱めない。Jevのconfidenceで許可を作らない。
- tool結果はそのまま返し、Wardenの障害で元の成功/失敗を書き換えない。
- cancel/after欠落は結果不明であって未実行とは限らない。
- policyはsessionにpin。global reloadを採用の原子操作にしない。
- RPC eventは通知。Labのsnapshot/deltaで切断から復旧する。
- TUIのclient数で推論と学習jobを増やさない。
- worktreeはsandboxではない。dirty/untrackedの再現とOS隔離を別に検証する。
- 当時の入力と後続ラベルを分離する。モデルの同意や苦情のなさを正解としない。
- 候補生成からreplay/shadow/E2E/canary/promotion/retireまで自動で閉じる。

## 自己改善の初期範囲

質問だけでなく、既存selectorの設定、必要定義の取得、検索順、助言時機、通知文を候補にする。grant、budget上限、評価基準、監査fixtureは変更不可。任意コードのhost内自動loadはしない。

## 報告

実装したファイル、固定した各版、実行したテストと結果、未実施の実Jev/host/E2E、実際の送信範囲、残った契約不確定点を分けて報告する。資料内の参照例のtsc成功を、実Pluginの互換性成功として扱わない。
