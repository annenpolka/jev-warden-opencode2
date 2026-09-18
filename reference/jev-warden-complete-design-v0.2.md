# Jev Warden
## Claude Mods起点の自己改善型開発制御層 — 統合設計書

**Version 0.2 · 2026-09-18 · 設計提案 / 未実装**

大量の意味観測を、根拠・探索・検証・自動改善へつなぐ。

本書は、`jev-crosscheck`、Relation Checker、TypeSafe Cookbook、Claude Code Hooks／Mods、永続worker、自己改善ループ、実装計画を一冊に統合したもの。v0.1を継承し、Claude Modsの実行環境と責務境界に合わせて更新した。

**実施状態：** 文書・公開ソースの確認と本設計書の作成のみ。repositoryの作成・変更、Pluginのinstall、実Jev評価、worker稼働、学習policyの採用は行っていない。

Markdownを編集用の正本とし、同じ内容を目次付きHTMLでも提供する。外部事実は第1章、設計上の契約・例・数値未決定事項はそれ以降に分ける。

---

## 目次

- [0. 要旨と設計の読み方](#s00)
- [1. 事実：確認した基盤と、未確認の境界](#s01)
- [2. 推測（示唆）：目標・非目標・固定境界](#s02)
- [3. 全体構成：Mod / Core / Lab / Kernel](#s03)
- [4. 三つのループ](#s04)
- [5. Runtimeの機能](#s05)
- [6. Relation Checker：根拠・挙動・検証の関係](#s06)
- [7. 証拠とデータモデル](#s07)
- [8. Jev利用の実行設計](#s08)
- [9. 介入の調停と型付き能力](#s09)
- [10. Claude Modsとの接続契約](#s10)
- [11. Lab・永続化・ジョブ・プロセス管理](#s11)
- [12. 経験化と学習トリガー](#s12)
- [13. 自己改善の対象：PolicyBundle](#s13)
- [14. 候補の比較・採用・撤回](#s14)
- [15. 成熟後の進化と、過剰な自動化を避ける方向](#s15)
- [16. セキュリティ・データ境界](#s16)
- [17. UI・操作・通常運用](#s17)
- [18. Cookbook・先行実装から取り込む設計パターン](#s18)
- [19. 代表的なend-to-endシナリオ](#s19)
- [20. Repository構成・build・配布](#s20)
- [21. 実装ロードマップ：先に「育つ一本」を通す](#s21)
- [22. テスト戦略と受入条件](#s22)
- [23. 指標・性能・予算の設計](#s23)
- [24. 設計判断記録と未決定事項](#s24)
- [25. 実装調整役への引継ぎと作業分担](#s25)
- [26. 議論との対応表・v0.1からの変更](#s26)
- [27. 参照資料と確認記録](#s27)
- [付録A. 中核データ型の叩き台](#appendix-a)
- [付録B. 設定・request・policy例](#appendix-b)
- [付録C. 故障時の扱いと運用runbook](#appendix-c)
- [付録D. 用語と一文での定義](#appendix-d)

---

<a id="s00"></a>

## 0. 要旨と設計の読み方

**Jev Wardenは、Jevを大量の意味観測に使い、主モデルの読む・考える・試す・確かめるを助け、その助け方を実際の開発結果から自動で改善する制御層である。**

初期実装はClaude Mods、すなわちfunction hooksを使うClaude Code Pluginを主たる入口とする。即時制御はClaude Code host管理下のMod実行環境に置き、移植可能なCoreをそこへ組み込む。永続記録、重い分析、セッションをまたぐ改善実験は外部のWarden Labへ分離する。

Jevを「危険な操作を止めるclassifier」や「固定候補から選ぶだけの装置」に限定しない。意味検索、仕様と実装の関係、証拠十分性、仮説比較、次の観測、Skill推薦、原文付きの作業記憶を扱う。guardはその中の一機能である。

### 0.1 二つの中心命題

> Jevを惜しまず観測に使う。節約するのは主モデルの再読、依存する往復、人間への割り込みである。
>
> 改善候補を作る主体と、その候補の成功条件・権限を決める主体を分離する。

多数のprobeは使ってよい。しかし同じ問題で主モデルを何度も中断しない。改善候補を作ってよい。しかし自分が勝てるように評価条件を書き換えない。

### 0.2 到達像

普段どおり開発すると、Wardenが関連資料・反証・不足する定義・有効な検証を整える。後から得た実行結果や明示的な決定を以前の判断へ結び付け、経験として保存する。Labは失敗の原因を診断し、質問だけでなく入力構築、検索順、介入時機、再利用手順の候補を作る。固定基準による比較を通過した候補だけを、承認済みの範囲内で自動採用する。悪化した版は退役する。

**「反省文を追加する」のではなく、「次回の処理が変わり、その差分を検証できる」ことを自己改善と呼ぶ。** 何も変えない、候補を保留する、不要なprobeを消すことも正常な改善ループの結果である。

### 0.3 本書の区分

- 第1章は一次資料で確認した外部事実。対象環境での利用可能性を保証するものではない。
- 第2章以降は推測（示唆）・設計案。本文の「必須」「禁止」は提案する内部契約であり、外部製品の仕様ではない。
- コード、レコード、コマンド例は設計上のインターフェース案。特記した公式コマンド以外は未実装である。
- 初版では一本の閉ループを完成させる。全文で扱う能力を初版ですべて実装するという意味ではない。

### 0.4 読み順

全体像は第0〜4章、意味判断の設計は第5〜9章、Modsとプロセス境界は第10〜11章、自己改善は第12〜15章、実装着手は第20〜22章を参照する。付録Aに中核の型、付録Bに設定の叩き台、付録Cに障害時の扱いを置く。

<a id="s01"></a>

## 1. 事実：確認した基盤と、未確認の境界

参照日は2026-09-18。過去の会話で挙げたすべての製品仕様を、そのまま確定事項として再利用しない。

### 1.1 Claude Mods

公式の定義では、Modはhooks moduleに振る舞いを持つPluginであり、`register(on, options)`と`($, e, next)`の関数でengineのイベントへ接続する。公式には`diff`、`sec-default`、`telemetry`の実装例が公開されている。early accessで、APIはリリース間で変更され得る。[S9](https://github.com/anthropics/claude-code/blob/main/mods/README.md)

**今回の重要な確認：公開型宣言の冒頭は、Modが「独自の環境、DOMなし、Nodeなし」で実行されると明記する。** 参照した宣言はClaude Code **2.1.273**が生成したものだった。これは推奨バージョンや最新版の宣言ではなく、読んだ契約の出所である。副作用は`$`の能力を介し、型は手元のバイナリで`/plugin-types`を再生成して固定する。[S10](https://github.com/anthropics/claude-code/blob/main/mods/types/claude-code.d.ts)

従って、Node用SDK、`node:fs`、SQLite driverをそのままModにimportする設計は採らない。物理的なプロセス配置や性能を「普通のNode内ミドルウェア」と同一視しない。

公式のテスト環境は`claude plugin test <dir>`でhook chainを動かし、clock・store・env等をmockできる。これは制御契約のテスト基盤であり、Jevの判断品質や介入の効果を自動で保証しない。[S9](https://github.com/anthropics/claude-code/blob/main/mods/README.md) [S10](https://github.com/anthropics/claude-code/blob/main/mods/types/claude-code.d.ts)

`sec-default`は組織のmanaged設定・prompt等をuser tierから保護する。`next.to`によるtier越えはmanaged tierに制限される。user Modが最外周にいる、すべてのイベントを自由に観測・改変できる、と仮定してはならない。[S11](https://github.com/anthropics/claude-code/blob/main/mods/sec-default/README.md)

### 1.2 Classic HooksとPlugin

Classic Hook、MCP、SkillはModとは別の接点として存在する。`PreToolUse`で判断を返さないことと`allow`は同じではない。Pluginには永続データ領域があるが、アンインストール時の削除規則があり、無期限保存やバックアップを保証するものではない。[S1](https://code.claude.com/docs/en/hooks) [S2](https://code.claude.com/docs/en/plugins-reference)

`claude plugin eval`はPluginあり／なしの比較基盤となる。結果にはモデル由来のgraderもあり得るため、Wardenでは独立した受入条件を別途持つ。実験レポートはローカル保存を既定にし、利用する版が対応する`--no-publish`を明示する。[S6](https://code.claude.com/docs/en/plugin-evals)

### 1.3 Jev

Jevはstateに対するChoice、Score、Noulの型付き判断を返す。同一requestの質問は互いの回答を参照せず、同じstateから独立に評価される。先に準備できる分岐の質問は同時に投げられるが、前の回答から資料を取得する場合は別requestが必要である。[S3](https://docs.typesafe.ai/primitives) [S12](https://docs.typesafe.ai/patterns/fan-out)

NoulはYesの確率推定を返し、独立したconfidence項目を持たない。Choice／Scoreのconfidenceは正答率の保証ではない。返り値が型を満たすことと、判断内容が正しいことは別である。[S4](https://docs.typesafe.ai/confidence) [S14](https://docs.typesafe.ai/primitives/noul)

参照したModelsページでは`jev-1.13.0`、入力100万token当たり$0.042、出力無料が公表されている。rate limitは変動し得ると明記されており、料金・上限をコードに永続固定しない。アカウントの実請求・SLA・日本語性能は本作業では確認していない。[S36](https://docs.typesafe.ai/models)

### 1.4 既存jev-crosscheck

現在の`SKILL.md`を取得したblob SHAは`df31ddde532a5a26f013d7889bbc3c21be56eda9`。具体的なsufficiency assertion、テストの契約・誤実装・許容変更の観点、自己の結論も照合すること、期待する答えを質問へ混ぜないこと、inspect/send分離、外部送信境界、確率をacceptanceにしない原則を含む。[S7](https://github.com/annenpolka/skills/blob/main/jev-crosscheck/SKILL.md)

同Skillが記載する試行数値は作者側の記録であり、本書作成時に実APIで再現していない。また、共有Coreや学習基盤が既に実装済みであるという意味ではない。

### 1.5 先行例から分かる範囲

TypeSafeのAutoresearchは、質問の提案・修正・削除を評価結果へ結び付ける。これは特徴発見の先例であり、開発への介入効果は別途測る。[S5](https://docs.typesafe.ai/cookbooks/autoresearch_feature_discovery)

`jev-ultrafast`は観測済み要素から動的な操作・対象を作り、投機的に同時評価する。自由な文字列が必要な時は生成モデルへ委ね、実行前に対象を再確認する。本書へ移すのはこの分業と鮮度確認であり、ブラウザデモの速度・成功率を開発制御へ流用しない。[S13](https://github.com/browser-use/jev-ultrafast/blob/main/README.md)

### 1.6 確認状態

| 対象 | 本書作成時の状態 |
|---|---|
| 旧設計書v0.1 | 会話添付の全文を確認 |
| Mods README／型冒頭／sec-default | 公式リポジトリから確認 |
| jev-crosscheck | 現在のSKILL.mdを確認 |
| Cookbook主要ページ | 第18章・参照資料に列挙したページを確認 |
| 手元のClaude CodeでModsをload | 未実施 |
| Jev実APIの呼出・日本語eval | 未実施 |
| Warden実装、インストール、worker起動 | 未実施 |
| 既存repositoryや設定の変更 | 実施していない |

Jev 1.13 jaggednessページは索引上の存在を確認できたが、本文の再取得に失敗した。したがって、そのページ固有の性能上の注意を今回の確認済み事実として再掲しない。大きなstate、間接参照、数値処理の評価は本書独自の必須試験に含める。[S37](https://docs.typesafe.ai/llms.txt)

<a id="s02"></a>

## 2. 推測（示唆）：目標・非目標・固定境界

### 2.1 成功の定義

同等の依頼・初期状態・モデル条件において、成果の正しさを損なわず、次を改善する。

- 根拠のない仕様補完と、誤った完了報告を減らす。
- 必要な情報や反証へ早く到達する。
- 検証の抜け、古い検証結果の流用、同じ無効な試行を減らす。
- 主モデルの手戻りと、人間の訂正・割り込みを減らす。
- その改善を、ユーザーが毎回振り返りを指示せずに継続する。

アラート件数、Jev呼び出し回数、テスト件数、agentの自己評価を主目標にしない。

### 2.2 非目標

汎用plannerをもう一つ作ること、主モデルを常に置き換えること、Jevで全仕様の正しさを証明すること、モデル重みを自動更新することは初期目標ではない。巨大な知識グラフ製品、汎用DSL、独立したマイクロサービス群も先に作らない。

許可判断と安全な実行の基盤をPluginだけで完全に置き換えない。Hookやモデルをsandboxと呼ばない。

### 2.3 固定する境界

以下は学習workerの自動変更対象にしない。人間が別の操作として更新できる設定であり、永久固定という意味ではない。

- ユーザーが与えた仕様、優先順位、明示的な禁止・承認。
- 外部送信可能なデータ、プロジェクト、宛先。
- 実行能力、公開・送信・削除等の承認要件。
- 各種予算の上限、停止操作。
- 採用判定基準、評価器、監査セットへのアクセス。
- 署名・型検査・認可・記録の最小信頼基盤。

守るべき分離：

```text
ユーザーの依頼 ≠ agentの計画
agentの報告 ≠ 実行証拠
Jevの出力 ≠ 確定事実
正しい指摘 ≠ 有益な介入
自動採用 ≠ 権限拡張
```

### 2.4 自動化に与える自由

承認された範囲内では、Jevの観測、資料探索、候補生成、隔離実験、比較、advisory policyの採用・撤回を毎回の確認なしに行う。

初版で自動採用するのはデータとして検証可能なPolicyBundleの変更と、許可済みの証拠収集操作の組合せである。生成された任意のプラグインコードを、そのままホスト上で自動実行する方式にはしない。

### 2.5 非機能要求

| 要求 | 設計上の扱い |
|---|---|
| 主作業を止めない | advisory失敗は縮退。固定の権限経路は保存 |
| 介入の説明可能性 | 所見から原文・版・質問・結果・後続検証へ辿れる |
| 大量観測 | questionsを人手で過度に絞らず、scopeと依存関係でbatch化 |
| 情報量の制御 | 観測量とcontext注入量・通知回数の予算を分離 |
| 再現性 | policy、model、host型契約、snapshot、評価armをpin |
| 可搬性 | CoreはNode・DOM・Claude固有型へ依存しない |
| 耐障害性 | 永続キュー、冪等化、途中再開、縮退状態の表示 |
| 非侵襲性 | AGENTS.mdやCLAUDE.mdを自動で書き換えて常駐しない |
| 削除・撤回 | 原資料だけでなく派生記録・cache・policy依存を追跡 |

Jevを使うこと自体は目的ではない。実行結果、型検査、計算、exact lookupで分かるものはその機構を使う。ただし新しい意味判断の探索を、最初から固定した少数のルールへ閉じ込めない。

<a id="s03"></a>

## 3. 全体構成：Mod / Core / Lab / Kernel

```text
ユーザー → Claude Code / 主モデル
                 │
         host管理下のMod実行環境
         ┌──────────────────────────────────┐
         │ Warden Mod                       │
         │ event middleware / session cache │
         │ prompt補助 / Pane / commands     │
         │       ↓                          │
         │ Warden Core（純粋なTS）          │
         │ relation・batch・調停・状態遷移   │
         └───────┬──────────┬───────────────┘
                 │          │ 許可された$の能力
                 │          ├─ hostのtool / fs / UI
                 │          └─ Jev transport / scoped reviewer
                 │ durable protocol
                 ▼
         ┌──────────────────────────────────┐
         │ Warden Lab（外部Nodeプロセス）    │
         │ SQLite writer / evidence store   │
         │ jobs / replay / candidate生成    │
         │ 隔離executor / 継続評価           │
         └──────────────┬───────────────────┘
                        │ immutable candidate / reports
                        ▼
         ┌──────────────────────────────────┐
         │ Kernel + Evaluator / Promoter     │
         │ 認可・予算・固定評価・採用・撤回   │
         └──────────────┬───────────────────┘
                        │ validated PolicyBundle
                        └────────→ 次のsessionへ

jev-crosscheck ── 明示的な照合入口（確認・送信契約は別）
```

### 3.1 責務と配置

| 部分 | 持つもの | 持たないもの |
|---|---|---|
| Mod | hostのeventと結果の対応、軽いsession状態、Jevの即時判断、UI、許可済みの追加context | Node標準API、SQLite driver、長期ジョブの唯一の保存先 |
| Core | domain types、入力構築、probe計画、解釈、調停、policy検証の純粋ロジック | Claudeの生event、process、network、filesystemへの直接依存 |
| Lab | 永続DB、証拠ファイル、job scheduler、候補生成、比較実験、export | 主セッションの全権限や未許可資料への包括アクセス |
| Kernel | 認可・予算・固定基準・採用記録・active pointer | 自己都合で成功条件を緩める最適化 |

Coreは論理的に独立したライブラリであり、独立サービスを必須にしない。Mod内にもLab内にも同じ版を組み込める。初期repositoryは一つ。OSプロセスは、Claude hostと一つのLabサービスを基本にし、別権限の評価／実験が必要な時だけworkerを起動する。

### 3.2 Jevへの二つの接続経路

**第一候補：Mod → `$.http.fetch`等の承認済みhost transport → Jev。** session内で準備できる小さな判断を、毎回の外部process起動なしで行う。具体的なrequest／response型、timeout、鍵取得は手元の型と契約テストで確定する。

**代替：Mod → 認証済みローカルbroker → Jev。** host側の鍵やtransport能力が合わない場合、接続再利用、共通予算、鍵を扱う場所の集中のために使う。外部brokerを経ても、介入とsession状態の責任はMod/Coreに残す。

いずれも、認められた宛先とデータだけを送る。経路変更で認可を迂回しない。外部通信が速いことを、Modの同期処理全体が速い保証へ読み替えない。

### 3.3 生成モデルとの分業

| 担当 | 仕事 |
|---|---|
| 通常のコード | ID、版、計算、lookup、実行、認可、予算、記録、最終的な介入適用 |
| Jev | relation、状態評価、適合度、反証性、仮説の比較、観測／候補の選択 |
| 主モデル | 開かれた計画、実装、深い推論、説明 |
| scoped reviewer | 特定の未解決事項の詳しい照合。自己評価ではなく限定した再検討 |
| 学習用モデル | 原因診断、probe／selector／手順の候補生成、対照fixture提案 |
| 評価器 | 独立した証拠で判断・介入・最終成果を比較 |

レビュー用のfork等は、現行hostが提供し、適切なcontext・権限を設定できる場合に限って使用する。汎用Coreは特定の`model.fork`シグネチャへ依存しない。

<a id="s04"></a>

## 4. 三つのループ

### 4.1 即時ループ

```text
イベント → 版付きの状態 → 小さな証拠集合 → Jevの並列判断
        → 不足の解消または介入候補 → 一つの調停器 → 主モデル
```

一般の実行前境界では軽いローカル判定を優先する。意味検索や大量の照合は先読みできる時に実行し、ツール群終了などの境界で必要なものを渡す。結果が遅れた時は、古い判断で現在の作業を止めない。

### 4.2 経験化ループ

```text
過去の所見 + 後続の原文・実行・人間の決定
    → 対応付け
    → 判断の結果と介入効果を分離
    → 解決済み / 未解決 / 観測打切り
    → 再現可能なEpisode
```

不足する証拠は、許可済みの読み取りまたは隔離検証で収集する。人間の感想だけを待たない。ただし、ユーザーの意思や仕様の未決定箇所は、実行しても確定できない。そうした項目は未決定のまま記録する。

### 4.3 改善ループ

```text
Episode群 → 失敗パターンと見逃しの診断
   → CandidateBundle生成
   → 固定契約検査 → 履歴比較 → shadow → 実作業比較/canary
   → 採用 / 保留 / 棄却 → 次の学習材料
```

Jevの大量評価はこのループの安い内側に置く。高コストの生成モデルや作業再実行は、その外側で候補を選んで使う。

### 4.4 三つの時間と、判断の時点

`occurred_at`は元の事象、`observed_at`はWardenが知った時点、`resolved_at`は根拠が確定した時点として区別する。過去の時点で未取得だった定義は、後に取得できても当時の入力へ遡って足さない。

即時ループが使うのはその時に利用可能な証拠だけ。経験化ループは後続の結果をラベル側へ追加する。改善ループは両者を参照できるが、評価では当時の入力と許可範囲を復元する。

<a id="s05"></a>

## 5. Runtimeの機能

### 5.1 Semantic Retrieval

原文・ファイル・節・シンボル・テストをコードで索引化し、広めに取得した候補をJevで絞る。複数経路を残して探索し、名前の類似だけで一つに決めない。

候補集合の相対順位と、要求への絶対的な適合は分ける。実在するIDだけを返し、該当なしを許す。部分集合しか見ていない場合は、検索範囲を明示する。

階層の細かい場所を断定できない時は、残る候補が共通して属するモジュールまで返す。上位候補の親を機械的に正解へ昇格しない。

### 5.2 原文付き作業記憶

会話や文書を、要求・制約・提案・仮説・採用決定・訂正・撤回・未解決事項として整理する。すべて原文参照、話者、取得時点、資料版を保持する。

意味的に抽出した「決定候補」と、ユーザーの明示的な意思として認める情報は別にする。agentの提案や報告は承認記録を作らない。既存の `AGENTS.md` / `CLAUDE.md` に反省文を自動追記しない。

文章を要約して原文を捨てず、検索・再確認できる形にする。識別子や表現が似ている所見は束ねても、同じ原因だという根拠がなければ統合して消さない。

### 5.3 支持・反証・不足を分けたcontext構築

主モデルへ渡す資料を「現在の仮説を支持する資料」「前提に反する資料」「まだ必要な定義」に分ける。反証を無関係として除かない。

省略した資料と選別理由を記録し、必要なら取り直せるようにする。主モデル向けcontextの長さとJevでの観測量を別に管理する。

### 5.4 Relation Checker

成果物の関係を単位に検査する。詳しい契約と質問設計は第6章で定義する。

### 5.5 Verification Planner

変更から「何を守るべきか」「どんな誤実装を弾くべきか」を抽出し、仕様・実装・テスト・実行証拠の対応表を作る。

重要なのは、テストコードが通るかだけでなく、その契約を拘束しているかである。mockや内部呼び出し回数の検証は、契約に必要なら適切である。

Jevは実行する価値のあるmutationや確認候補を選ぶ。実際に回帰を検出できたかは隔離実行の結果で確かめる。任意のテスト成功を全要件の検証完了として扱わない。

### 5.6 Hypothesis / Next-observation Planner

複数の原因仮説を残し、どの資料や実行で区別できるかを評価する。失敗回数だけで停滞と判定しない。TDDの意図的な失敗、調査で得た新しい情報、実装途中のstubを文脈から分ける。

Jev出力は探索のヒューリスティックであり、校正なしに厳密な事後確率や期待情報利得へ読み替えない。手段がない場合は、生成モデルに新たな仮説・観測方法の提案を依頼する。

### 5.7 Skill / Procedure Selection

関連Skillや有効だった調査手順を推薦する。既知の候補の相対順位に加え、対象要求・対象サービス・プロジェクトへの適合を確認する。[S8](https://docs.typesafe.ai/cookbooks/skill_suggestion)

観測済みの環境が変わった時には、手順の前提条件を再確認する。あるプロジェクトで有効だった手順を全プロジェクトに昇格するには、別の評価を必要とする。

### 5.8 Action Guard / Completion Check

確認可能な明示禁止はローカルルールで扱う。Jevの新しいrisk probeはまず観測・助言に使い、未検証の確率を自動拒否や許可へ直結しない。

完了状態は「実装済み」「実行確認済み」「仮決定あり」「未検証あり」に分ける。不確定箇所を正直に報告して終わることも正常終了とする。すべてのテストを実行しなければ終了できない共通ルールは作らない。

### 5.9 原文の構造回復と値の取り出し

段落・発言・code blockを安定したIDで切り出し、Jevには役割・関係・適用先を選ばせる。元の本文、値、識別子はコピーする。抽出のためだけに数値や文言を再生成しない。別表現の結び付けでは、同一性・属性の矛盾を分け、誤った統合を取り消せるようにする。[S19](https://docs.typesafe.ai/cookbooks/autoformat) [S20](https://docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook) [S21](https://docs.typesafe.ai/cookbooks/entity_alignment)

### 5.10 仮決定と適応的な作業手順

未定義な箇所を発見しても、常に人間を呼ばない。既に許可された可逆・局所的な設計判断なら、理由と代替案を付けて仮決定として進める。外部契約、データ互換性、依頼目的の変更に触れるなら確認へ戻す。

有効だった手順を再利用する場合は、開始条件、必要な証拠、停止条件、適用できない反例を持たせる。過去の成功を無条件の命令にしない。

<a id="s06"></a>

## 6. Relation Checker：根拠・挙動・検証の関係

### 6.1 最小の定義

```text
R(source, target | context, relation_definition)
    → typed observation + evidence coverage + provenance
```

「対象が良いか」ではなく、「この根拠がこの主張を支えるか」「このテストがこの契約を拘束するか」を問う。方向は明示する。図の矢印は因果や論理証明を自動的に意味しない。

| Relation | 向き | 主な観測 |
|---|---|---|
| support | evidence → claim | 支持／反証／関係なし／判断不能 |
| grounding | specification → behavior | 明示要求／導出／非必須だが両立／矛盾 |
| compliance | implementation → requirement | 規定の満足／違反／非適用／判断不能 |
| test coverage | test → behavior | 観測・assertionの対応／部分的な拘束／未検証 |
| test justification | specification → asserted behavior | テストが固定する期待値の根拠 |
| consistency | docs ↔ code/config | 説明と実体の一致・衝突 |
| alignment | request/plan → action | 依頼との関係、計画との一致。権限とは別 |
| relevance | query → passage | 実際に問いへ答えるか、同じ話題だけか |

初版はsupport、grounding、test coverageの三族を中心にする。全relationへ一つの万能taxonomyを適用しない。

### 6.2 一つの報告を分解する

「仕様通りにキャッシュを無効化し、テストも追加した」という報告は、少なくとも次に分解できる。

```text
spec → behavior       その無効化条件を誰が決めたか
implementation → behavior   コードがその条件を実装しているか
test → behavior       assertionがその条件を区別するか
receipt → test        該当するテストを、対象版に対して実行したか
report → evidence     報告の各部分に対応する証拠はどれか
```

グラフ状に記録してよいが、データ構造はIDを持つ小さなレコードで十分である。グラフの閉包や推移性で真実を増やさない。例えばspec→behaviorが支持され、test→behaviorが支持されても、suite全体が仕様を満たす証明にはならない。

### 6.3 仕様上の根拠を四つの軸へ分ける

| 軸 | 値の例 | 注意 |
|---|---|---|
| 根拠関係 | explicitly_required / entailed / compatible_not_required / contradicted / indeterminate | entailedは明示前提を挙げられる場合。自然な実装というだけでは不可 |
| 仕様の状態 | addressed / unaddressed_in_scope / ambiguous / internally_conflicting / scope_unknown | absentを言える範囲をSourceCoverageで限定 |
| 追加判断 | adopted_decision / provisional_assumption / unresolved / not_needed | 採用を認める主体と原文を記録 |
| 証拠の状態 | sufficient_for_question / missing_definition / missing_source / truncated / stale / unknown | relationのYes/Noとは別 |

これらは独立した観測軸であり、すべてを毎回問う必要はない。`ambiguous`な仕様に対して`provisional_assumption`を追加した実装は正常にあり得る。`assumed`はエラー名ではない。

根拠となる節が衝突している時は、その矛盾から任意の実装を正当化しない。明示的な優先順位・改訂日・適用範囲を確認する。実装済みであることやテストが緑であることを、仕様決定の代わりにしない。

### 6.4 具体的な証拠十分性

証拠十分性は「材料が十分ですか」という総論ではなく、主張が依存する事実を名前で問う。既存Skillで守っている方針を引き継ぐ。[S7](https://github.com/annenpolka/skills/blob/main/jev-crosscheck/SKILL.md)

```text
弱い問い：
  このテストを評価する情報は十分か？

具体的な問い：
  この資料にはEXPECTED_CALLSの実際の定義が含まれ、
  期待する合計呼出回数を定数名から推測せずに読み取れるか？
```

必要な定義の存在を構文的に確認できる場合はコードで確認する。どの定義が必要か、別スコープの同名定義ではないか、といった意味的な部分だけをJevで補う。

全く資料がない主張はJevへ投げず、`not_evaluated`として必要なsourceを列挙する。未提示の定義値を「意味解釈上の仮定」として埋めない。仮の値で条件付き評価するなら、無仮定の評価も残し、条件付きの結果は実際の主張の支持に数えない。

### 6.5 テストの性質を契約に結び付ける

最初に、守る契約、検出すべき具体的な誤実装、許容すべき実装変更を特定する。その上で以下を問う。

| 観点 | 問う内容 |
|---|---|
| 観測可能性 | テストが契約上の出力・状態・副作用を観測しているか |
| 識別力 | 具体的な誤実装でもassertionが通ってしまわないか |
| 境界・mock | mockが検証すべき挙動まで取り除いていないか |
| リファクタ許容 | 契約を保つ変更に不要な制約を置いていないか |
| 期待値の出所 | 期待値が実装と同じ未検証の前提から作られていないか |
| 失敗・境界条件 | 今回の契約に必要な異常系・境界値を区別しているか |

「通知は一度だけ」という契約ならクライアントの呼出回数は重要な観測になり得る。private helperの回数が契約と無関係なら、不必要な結合になり得る。内部依存という分類だけで品質判断をしない。

実行で確認する場合も、mutation後の失敗が型エラーや環境障害によるものではなく、対象のassertionによるものかを分ける。テストが落ちたという事実だけで、その契約に対する検出力を確定しない。

### 6.6 原文・反証・仮定を混ぜない

一つのclaimは一つの読みとscopeに固定する。複数の解釈で結論が変わり得るなら、解釈ごとに別のprobeを作る。質問に「実装は無効化していないので」といった観測済みの結論を書き込まない。

spec→behaviorを問う時、agentの「仕様通りです」という自己報告は不要なら渡さない。report→diffは別に問う。無関係な資料を削ることと、反証を都合よく落とすことを区別する。

仕様本文をJev用に英訳して置き換えない。日本語原文を保ち、日英questionの対照実験は同一source上で別のprobe版として記録する。日本語性能が保証されたとは扱わない。

### 6.7 相対選択と絶対適合

候補から一つを選べたことは、その候補が根拠である保証ではない。重要なChoiceでは`none`／`unclear`を許し、候補ごとの支持・適合を必要に応じて別に問う。[S8](https://docs.typesafe.ai/cookbooks/skill_suggestion)

複数の節を合わせる必要がある時は、一個のwinnerに潰さず、小さな根拠集合を構築して検査する。モデルは節IDやdiff block IDを選び、行番号・引用文は原資料からコードで解決する。[S22](https://docs.typesafe.ai/cookbooks/citation_check)

### 6.8 二段階と投機的fan-out

第一段では多くの狭い観点を同時に観測する。第二段では、不足・反証・未決定が作業に影響する項目について、追加資料や具体的な検証を用意する。

既にすべての候補資料が手元にあれば、各候補の適合確認を第一段と一緒に投げてよい。第一段で選ばれたIDに応じて資料を取得する場合は二段になる。同一requestのQ2がQ1の結果を読めるとは想定しない。[S12](https://docs.typesafe.ai/patterns/fan-out)

### 6.9 全体の穴を見落とさない

局所的なrelationが全件高い値でも、検査すべきclaimを抽出し損ねている可能性がある。原文→claim抽出の対応、抽出対象のscope、拾わなかった変更、検索候補の取りこぼしも記録する。

関係の結果と、それに基づく最終結論の適格性を分ける。raw回答は残すが、根拠不足なら最終結論は保留する。モデルがconfidenceを高く返したことは、この保留を解除する理由にならない。

<a id="s07"></a>

## 7. 証拠とデータモデル

初版はSQLiteのテーブルとJSONの小さなレコードで実装する。汎用グラフDBや独立したschema言語は不要。

### 7.1 中核レコード

| レコード | 必須の情報 |
|---|---|
| EventEnvelope | event ID、session/agent/worktree、ツールID、時刻と順序、origin、当時のpolicy版、関連snapshot |
| EvidenceRef | 原文または結果への参照、内容hash、資料の版と範囲、話者・資料種別、取得時点、送信許可区分 |
| Claim | 原子的主張、原文参照、対象、抽出方法、依存する前提、必要な証拠、採用決定か仮説か |
| Observation | probe版、使用した証拠、raw request/response参照、返却モデル、確率、エラー、計測値 |
| Finding | 一つの調査項目、関連Observation、具体的不足、解決状態、更新履歴 |
| VerificationReceipt | check ID、対象snapshot、コマンドと環境、実行結果、出力参照、確認できた範囲 |
| Intervention | 介入の内容、理由、根拠、対象版、通知時点、評価arm、重複排除ID |
| Episode | 当時の入力と判断、後から得たラベル・実行結果、未確定項目、dataset group |
| PolicyBundle | 親版、変更内容、適用範囲、対応するengine/model、評価状態、採用証拠 |
| Job | 種類、入力参照、予算、lease、試行回数、冪等性キー、実行結果、親実験 |

内部では参照の向きを明示し、`evidence supports claim`と`claim explains evidence`を同じ関係として記録しない。

### 7.2 VerificationReceipt

成功したチェックの記録は、次を含む。

```text
check_id
argv / cwd / runner_version
snapshot_id
source・test・fixture・config・lockfileの対象hash
対象環境と依存関係の版
開始時点 / 終了時点
exit_status / 結果形式の検証
実行されたテストの識別情報（取得可能な場合）
output_ref
検証範囲
実行中に対象が変更されたか
```

`HEAD`だけでは不十分。未コミットの変更、テスト、設定も対象にする。実行中の書き換えがあり、固定snapshot上の実行でない場合は適用性を不確定とする。開始時と終了時のhash一致だけでは、途中の変更と復元まで否定した保証にはならない。

receiptの状態は `current / stale / applicability_unknown` とし、テストの成功・失敗とは別に持つ。古い成功記録は削除しないが、現在の変更への証拠として流用しない。

依存関係を限定できない場合、初期実装では保守的にsnapshot全体の版で失効させる。後から静的依存解析やモジュール単位の対象集合を導入する。Jevの「関係なさそう」だけで失効を免除しない。

### 7.3 証拠強度と意味判断を分ける

`observed_execution`、`direct_source`、`explicit_user_decision`、`model_inferred`などの由来を残す。ただし、この分類は証拠の適用範囲を自動的に拡大しない。

実行証拠はその実行で観測した性質を支える。別モデルの同意は補助的判断であってground truthではない。ユーザーの決定は仕様や意思を定め得るが、その実装の正しさを証明しない。

同一UIDで動くローカル実装では、記録を暗号学的に偽造不能とは主張しない。悪意あるコードからの保護が必要なら、collector・executor・採用器を権限分離した環境へ置く。

### 7.4 部分観測を明示する

Hook入力、diff、抜粋、fixtureなどには `complete / truncated / missing / stale` を残す。全変更を観測できたという保証がなければ、その範囲を示す。

「この抜粋に要求が見つからなかった」と「仕様全体で未定義」を分ける。検索した資料の版・範囲が確定していない時は、仕様全体のabsenceを主張しない。

### 7.5 永続化と出所の信頼度

Modのevent wrapperで見た引数は、その層で観測した引数である。後段Modが書き換えた場合の最終実行引数と一致するかは、hostの契約・結果・別の実行記録で確かめる。`requested`と`effective`が不明なら混同しない。

Hook外のshellや別ツールによる変更は、同じ観測経路に現れる保証がない。ファイル変更検知とsnapshotの再取得で補い、`capture_gap`を記録する。外部processが出した成功文は、信頼したrunnerによる実行記録と区別する。

証拠は内容hashだけでなくscope namespaceを持つ。異なるprojectや同意範囲で同じbytesがあっても、情報公開権限を共有しない。hashは改変検出の道具であり、作成者の認証や実行の証明そのものではない。

<a id="s08"></a>

## 8. Jev利用の実行設計

### 8.1 多数の質問、小さなstate

同一の必要十分な証拠集合を共有できる質問はまとめる。不要な会話・自己評価・無関係なdiffを一つの巨大stateにしない。

権限範囲、snapshot、必要証拠の境界が異なる問い合わせは分ける。stateが混ざると回答の根拠が変わるため、batchを増やすこと自体を目的にしない。

question IDに意味を隠さず、instructionsだけで対象と判断基準が分かるようにする。日本語の仕様は原文で扱い、日英対照は評価用変種として別に記録する。

### 8.2 依存と投機を区別

既に用意できる各分岐の判断はfan-outする。選んだ候補を使って追加資料を取得しないと次を問えない場合だけ、次requestへ進む。同一requestのQ1の回答をQ2から参照できると想定しない。[S3](https://docs.typesafe.ai/primitives)

判断結果の相関を無視して確率を掛け合わせたり、多数決を独立証人の合意として扱ったりしない。Noulの0.5は程度の中間ではなく不確かさであり、低confidenceが情報不足を必ず検出するとも扱わない。

### 8.3 二つの処理経路

- 即時経路：今のmodel requestに間に合わせる証拠・介入。待ち時間上限を持つ。
- 先読み経路：関連資料探索、未解決所見の再確認、候補probeのshadow評価。永続キューへ送る。

即時のJev呼び出しが失敗した時は `unavailable` と記録し、「問題なし」へ変換しない。advisory処理は縮退し、固定の禁止・認可方針は残す。ネットワーク復旧のためにendpointを勝手に切り替えない。

### 8.4 キャッシュ

キャッシュキーは少なくとも次を含む。

```text
snapshot / evidence content hashes
probe定義と入力構築のhash
criteria / 言語 / 仮定
モデル識別情報とrequest option
対象範囲 / data policy版
```

返却モデルが変わる可変aliasを使う場合は、短い寿命や再確認を設ける。キャッシュ再生と新規推論を区別する。校正・安定性評価では意図的に再評価する経路を残す。

### 8.5 実際に測る値

request数だけでなく、queue待ち、process起動、接続、Jev往復、直列段数、input tokens、主モデルへの追加tokens、失敗率、cache hit、後続作業時間を測る。

Jevの推論速度だけをHook全体の待ち時間や実作業の短縮へ読み替えない。目標値は初期実測後に設定する。SDKの制限とAPIの制限は区別し、質問数の固定値を思い込みで設けない。

### 8.6 モデル出力の検証

typed APIでも受信値を検証する。質問IDの対応、Choice候補、Scoreのrubric範囲、Noulの0〜1、有限数、必要field、確率分布を確認する。丸め許容はprovider契約に基づく設定として固定し、無効な分布を黙って正規化しない。

一部の質問だけが壊れた場合に使える回答があるかはprotocol契約で決める。少なくとも、その回答に依存する所見を「問題なし」にしない。処理状態は`completed / unavailable / invalid_response / budget_exhausted / cancelled / superseded`等で区別する。

### 8.7 回数ではなく、待ちの構造を最適化する

一request当たりの独立質問数、state取得、候補作成、直列段数、queue待ち、接続再利用を別々に測る。API上限はdocument・モデル・account・SDKの層を分けて扱う。32問等を全モデル共通の固定上限として採用しない。

実行済みの同じ判断は再利用できる一方、校正・安定性測定ではfresh inferenceを区別して取得する。少数の質問に絞り込む前に、広い観測を実データで評価する。不要と分かったprobeは後から退役させる。

### 8.8 初期の計測モード

最初のdoctorと計測では、小／中／大のstateと、少数／多数の独立質問を組み合わせる。日本語・英語、冷接続・接続再利用、同時実行、cancel、429も扱う。測るのは推論単体でなくevent受信から有用な補助が届くまでである。

固定の「常に200ms」「ほぼ無料だから無制限」を性能契約にしない。観測は潤沢に行いながら、request数・token数・予算予約・timeout後の課金不明を記録する。

<a id="s09"></a>

## 9. 介入の調停と型付き能力

### 9.1 調停器は一つ

各probeは所見だけを返す。独立したguardがそれぞれ主モデルへ通知しない。

調停器が、同じ原因らしい指摘、既読の指摘、解決済み・期限切れ・版違いの結果を整理する。次に一番役立つ根拠と行動候補を短く返す。初期の通知件数や文字数は設定値であり、効果測定に応じて変更可能とする。

通知例：

```text
[Warden / 証拠不足 / finding:F18]
再試行回数について、テストが参照する EXPECTED_CALLS の定義が
まだ提示されていない。現在の成功ログだけでは「合計2回」を裏付けられない。
次の候補：定義 D7 を確認する。
対象：snapshot S12。詳細：Observation O41。
```

モデルへの補助通知は、リポジトリから読んだ文章をそのまま高優先度の命令として再投入しない。固定の封筒、引用境界、原文参照を用い、データ内の指示を権限へ変換しない。

### 9.2 介入結果

| 内部結果 | 意味 |
|---|---|
| `abstain` | 介入しない。通常のClaude Code権限経路を維持 |
| `nudge` | 根拠、反証、不足、次の候補を提供 |
| `request_review` | 論点を限定した深い照合を依頼 |
| `ask_permission` | 固定の承認方針が要求する確認へ進む |
| `deny_by_rule` | 確認可能な明示禁止に基づき拒否 |

`nudge`と`request_review`は自動学習で調整可能。許可能力や拒否条件の強制部分は固定境界に置く。初版はJevの確率だけを理由に許可・拒否しない。

### 9.3 既知の能力をbrokerが実行する

```text
read_evidence(evidence_id)
find_definition(symbol_id)
inspect_callers(symbol_id)
compare_artifacts(source_id, target_id, relation_kind)
suggest_checks(snapshot_id, claim_ids)
run_registered_check(check_id, snapshot_id)
request_focused_review(finding_id, evidence_ids)
```

これらは設計上の候補。実際のMCP tool名や引数は実装時に固定する。

読み取りも公開範囲・symlink・実体パスを検証する。checkはargv、cwd、環境、ネットワーク、secretへのアクセスを登録し、実行直前にも適用性を確認する。package scriptの内容が変わっていれば承認済みコマンド名が同じでも再検証する。

Jevの出力を任意shell、JavaScript、動的SQLとして評価しない。新しい能力が必要なら候補を提案できるが、能力そのものの登録は別の認可操作とする。

### 9.4 反射的な行動選択と、権限判断を分離する

Jevに「今は追加定義の確認、反証探索、検証候補のどれが有益か」を選ばせてよい。これはブラウザの動的action spaceと似た設計である。[S13](https://github.com/browser-use/jev-ultrafast/blob/main/README.md)

しかし`allow / deny`を単なるJevの候補ラベルとして最終権限にしない。候補はあらかじめ許可能力でfilterし、選択後もbrokerが対象版・前提条件・grant・予算を再確認する。`none`と生成モデルへの問い直しを残す。

最初の自動実行は許可済みの読み取り・隔離検証へ限定する。主作業のコード変更や外部副作用は通常のClaude Code権限経路へ戻す。自動化可能な範囲の拡張は、PolicyBundle更新とは別の人間の操作である。

### 9.5 介入の負担と因果関係

同じ根本不足から出た十個の警告を一つにまとめる。TDD・探索・実装・検証・報告の段階を考慮するが、段階分類が不明な時は強い介入を避ける。実装途中のstubと、完成品として残したstubを同一視しない。

介入後に改善しても、その介入が原因だったとは直ちに決めない。いつ何を見せたか、主モデルが見たか、採用したか、既に同じ調査を予定していたかを記録し、独立比較で有益さを評価する。

<a id="s10"></a>

## 10. Claude Modsとの接続契約

### 10.1 起動と互換性

Mod packageは公式形式の`.claude-plugin/plugin.json`、`hooks/hooks.json`、登録module、テストを持つ。`modules`経由でloadする形は公式例にあるが、使用可能なバイナリ、feature flag、設定、eventと型はdoctorで確認する。[S9](https://github.com/anthropics/claude-code/blob/main/mods/README.md) [S10](https://github.com/anthropics/claude-code/blob/main/mods/types/claude-code.d.ts)

公開型の版が2.1.273だから、それ以降がすべて互換とはしない。`doctor`はCLI版、生成`.d.ts`のhash、必須能力、禁止されている能力、実際のeffect結果を記録する。Coreの型へ生のClaude event型を輸入せず、adapterで小さなEventEnvelopeに変換する。

### 10.2 接続点の割り当て案

以下は公開例に見えるevent族を使った設計案である。`turn.*`等の具体的event名、入力・出力、agentごとの適用は生成型とfixtureで確定する。Classic Hookのevent名を機械的に小文字化して流用しない。[S9](https://github.com/anthropics/claude-code/blob/main/mods/README.md) [S11](https://github.com/anthropics/claude-code/blob/main/mods/sec-default/README.md)

| event／能力の族 | Wardenの用途 | 契約上の注意 |
|---|---|---|
| `session.start` / `session.*` | policy pin、復元、agentとsessionの対応 | 再開・clear・終了の違いを確かめる |
| `prompt.submit` | 依頼の原文、関連Skill・資料の先読み | 元の依頼を置換して権限を増やさない |
| `tool.call` | before/after対応、所見と実行結果の記録 | deny・throw・cancelも結果の一部 |
| `tool.check` | 固定した認可方針との接続候補 | ネイティブ権限を上書きする用途にはしない |
| `turn.*` | 所見の集約、完了根拠、通知の消費 | 正式なbarrierがなければ擬似barrierと明示 |
| `agent.spawn` / `agent.*` | 委譲scope、親子関係、review job | loopのagentIdと呼出主体を分ける |
| `fs.*` / `process.run` | 許可済み読み取り、補助処理の記録 | shell内部の全副作用を網羅すると主張しない |
| `http.fetch` | Jevまたはローカルbrokerへの通信 | 宛先、redirect、timeout、鍵を確認 |
| `store.*` / `clock.*` | 小さな状態、debounce、session内timer | timerはdurable jobの代用ではない |
| `ui.*` / `command.*` | Pane、status、説明、停止操作 | 表示失敗で主ツールの結果を変えない |
| `engine.create` | 将来の`$.warden`追加 | 初版では不要。能力を公開する認可は別 |
| `classic.*` | 必要時の互換adapter | 同じ操作を二重記録・二重通知しない |

### 10.3 continuationを壊さない

次は設計意図を示す擬似コードであり、現在のAPIへそのまま貼るコードではない。

```text
on tool.call:
  if diagnostic recursion should be skipped:
      return await next(original_event)

  correlation = capture_minimal_before(original_event)
  try:
      outcome = await next(original_event)   # 一回だけ呼ぶ
      enqueue_observed_result(correlation, outcome)
      schedule_advisory_analysis()
      return outcome                        # 元の結果を保持
  catch original_error:
      enqueue_failure_without_throwing(correlation, original_error)
      rethrow original_error                # Jev障害で隠さない
  finally:
      release_session_resources()
```

Wardenの記録・Jev・UI処理の失敗で、元のtoolの成功を失敗に変えない。逆にtoolの失敗を成功へ変えない。`next`へ再試行して同じ副作用を二重実行しない。beforeとafterで同じevent objectを共有していることにも依存しない。

副作用を伴う操作には、`requested → dispatched → returned / denied / failed / cancelled / outcome_unknown`を区別して残す。中断したというだけで「実行されなかった」と断定しない。

### 10.4 chain・origin・agent

Mod順序は観測可能な入力・出力へ影響する。自分のlayerで見えたeventを全体の真実とみなさず、mod orderingとprovider/originを記録する。組織のprepend／appendとmanaged policyを迂回しない。[S11](https://github.com/anthropics/claude-code/blob/main/mods/sec-default/README.md)

公開型は、`next.origin`が呼出を生じたplugin側の軸、`agentId`がどのmodel loopかという軸であることを区別する。これらを一つの「実行者」に潰さない。[S10](https://github.com/anthropics/claude-code/blob/main/mods/types/claude-code.d.ts)

自分の`$.http.fetch`や`$.store`が再度hookへ現れる可能性を考え、観測再帰を抑える。初期版は必要なevent族を明示登録し、`*`を使った無差別な常時観測を必須にしない。再帰抑止で、自分の副作用が認可・監査を免除される設計にはしない。

### 10.5 native UIとcontextを分ける

通常の成功観測はPaneへ表示し、主モデルのcontextへ流さない。重要な反証、具体的な不足、今役立つ資料だけを追加contextとして渡す。native UIが使えないsurfaceではCLI／MCPのstatusへ縮退する。

contextを挿入できる正式な境界がなければ、その能力を無いものとして扱う。`ui.status`に表示したことはモデルが読んだ証拠ではない。表示・context注入・ユーザー確認を別のInterventionとして記録する。

### 10.6 reviewer・fork・追加能力

hostにscoped model callやforkがあり、許可される場合は限定レビューへ使える。可用性、context複製の範囲、toolsの有無、戻り方、課金、キャンセルはdoctorで検査する。存在しないAPIを仮定せず、外部reviewer adapterへの縮退を用意できる構造にする。

将来`engine.create`で`$.warden.observe`等を提供する場合は、呼出側Modに見せてよい証拠と操作を限定する。別Modの入力はuntrustedとし、「外部Modが付けたverifiedフラグ」をreceiptに変換しない。

### 10.7 Classic Hookとの互換

Classic Hookは初版の主経路ではない。必要な環境だけ別adapterとし、共有Coreへ同じdomain eventを渡す。ModとClassicを併用する場合は対応付けの根拠を持ち、片方をprimaryにして二重介入を防ぐ。

Classicの`allow`とModの`next(e)`は同義ではない。`abstain`は各接続先で「既存の権限と処理を保つ」に写像する。batch barrierやStop継続などを完全再現できない場合は、互換ではなく縮退として表示する。[S1](https://code.claude.com/docs/en/hooks)

### 10.8 lifecycleの終端

session close時は観測をflushし、durable jobをLabへ残す。shutdown時にJevを無制限に待たない。既存セッションが同じpolicy版を使うこと、緊急失効時だけ通知付きで無効化することを保証する。

終了時の照合を理由に主モデルを無限継続させない。同じfinding・同じsnapshot・新証拠なしで再介入しない。不確定部分を明示して正常終了する経路を持つ。

<a id="s11"></a>

## 11. Lab・永続化・ジョブ・プロセス管理

### 11.1 初期技術選択

| 領域 | 選択案 | 理由・確定条件 |
|---|---|---|
| Mod/Core | host互換のTypeScript、外部副作用はport化 | Node・DOMに依存しないことをbuildで検査 |
| Lab/CLI | Node.js + TypeScript | 対応するLTS系を実装時にpin。Modのruntimeとは別 |
| DB | ローカルSQLite、Labがprimary writer | migration・transaction・job leaseを一箇所で管理 |
| 証拠 | scope別content-addressedファイル | 原文と版を追跡。DBは参照とメタデータ |
| IPC | hostから到達できる認証済みlocal transport | `$.http.fetch`等で実機確認。loopbackだけでは認証にならない |
| モデル | Jevおよび生成モデルの独立adapter | endpoint、認証、利用枠、送信範囲を明示 |
| 実験 | 固定snapshotを持つ隔離executor | 任意のinstall/testコードを主環境から分離 |
| テスト | pure Core / native Mod / replay / fault / E2E | 契約と意味精度と介入効果を別に検証 |

GEPAやCatBoost等は拡張候補であり、初版の必須依存にしない。まず小さな変種生成と固定比較で一周を完成させる。

### 11.2 永続状態の所有者

Modはhot cacheと処理中のcorrelationを持つ。長期の正本はLabが管理する。Modの`store`には必要最小限の設定参照・durable cursor等を置けるが、Lab DBとの二重の正本を作らない。

Mod起動時に、scope・schema版・policy pin・最後に確定したcursorを使ってLabと同期する。Labから得たbundleのhashと互換性を検査してから使用する。破損・未署名という理由を隠して勝手に新しい設定へ移行しない。

### 11.3 サービスの寿命

学習はセッションの寿命と独立させる。初回に有効化した場合はOSサービス等としてLabを動かす。Mac先行案では起動管理・鍵・IPCをOS adapterに分離し、Windows対応をCoreの再実装にしない。

ModやMCP serverが閉じても、記録済みjobは失われない。Labが停止した時は、許可された範囲の小さなspoolまたはhost storeへ未送信eventを残す。容量・保存不能を検出し、`durability_degraded`を表示する。記録が欠けた状態で完全な学習・監査を主張しない。

serviceの自動起動は一つのinstance lockで直列化する。各HookやModがそれぞれLabを起動しない。

### 11.4 Queue契約

```text
queued → leased → running → succeeded
                    ├→ retry_wait → queued
                    ├→ failed
                    └→ cancelled / result_unknown
```

at-least-onceを前提に、入力hash・scope・snapshot・policy・operationから冪等性キーを作る。exactly-onceを宣言しない。副作用を持つjobは実行IDとdispatch記録を持ち、結果不明時に無条件再実行しない。

Jobにはowner、lease期限、試行回数、予算予約、origin、親実験、dataset group、必要な能力を持たせる。worker停止後はlease expiryで回収するが、失効したgrantやsnapshotのjobは再開前に再検証する。

### 11.5 外部通信の障害

認証失敗、429、5xx、timeout、schema違反、キャンセルを区別する。許可されたretryは期限と予算の中で行い、endpointやproviderを暗黙に切り替えない。timeoutは「課金も実行もなかった」ことを意味しない。

advisory処理が使えなければ既存のClaude Code処理を継続し、未評価と記録する。固定禁止やネイティブの権限確認は残す。通信が落ちた時に、前回の高い確率を別snapshotへ転用しない。

### 11.6 再帰と自己観測

各jobとeventに`origin=main_work / warden / experiment / audit`を付け、親を記録する。実験内でWardenを有効にする場合でも、そこから別の学習schedulerを起動しない。結果は親実験へ返す。

観測の再帰抑止と、認可・予算・auditの免除を分ける。自身が起こした通信・読み取りも固定境界には従う。

### 11.7 予算と優先度

予算をJev観測、学習用生成、主モデルE2E、隔離実行、context注入、保存容量へ分ける。Jevには広い観測枠を与え、生成モデルと実作業再現は外側で候補を絞って使う。

即時補助、所見の答え合わせ、監査、候補比較の順に優先度を持つ。常に高優先度だけでLabが飢餓しないよう、同意済みの保留実験にも実行枠を予約する。上限を改善workerが拡大しない。

### 11.8 保存・再開・移行

SQLite schema migration、bundle migration、Mod API migrationを別にする。active bundle変更と評価記録への紐付けはtransaction内で行い、不完全な版を公開しない。互換性がない時は停止理由を示し、旧版で動ける部分だけ縮退する。

アンインストール時のPluginデータ削除規則を前提に、exportと保持方針を明示する。データが残っていることと、workerを継続してよいことは別である。[S2](https://code.claude.com/docs/en/plugins-reference)

<a id="s12"></a>

## 12. 経験化と学習トリガー

### 12.1 Episodeの時間境界

```text
decision_time:
  その時に見えていた依頼・資料・コード・状態
  active policy / model / chosen intervention

outcome_time:
  後で得た定義・実行・人間の判断
  label source / verification method
  unresolved / observation_window_closed
```

後から読んだ正解をdecision側に混ぜない。欠けた資料を補う改善候補は、当時の許可と当時のsnapshotから取り直す。現在の最新版を過去の証拠として使わない。

### 12.2 ラベルの原則

判断の正しさと介入の効果を別に残す。labelには由来、対象範囲、時点、確度、訂正履歴を付ける。

- 実行による具体的反例は、そのケースの強い証拠になる。
- 原文照合は、読み取れる範囲の証拠になる。
- 別モデルによる判定は `weak/model_label` として区別する。
- 苦情がない、会話が終わる、提案が実行されない、は原則として `unknown`。
- 保留後の承認は、保留が誤検知だったことを自動的に意味しない。
- artifact品質、ユーザー意思、制御介入の必要性を一つのlabelに潰さない。

時限まで結果が得られなかったケースは観測打切りとして扱い、成功labelを補完しない。weak labelが多数派になっても、独立検証済み件数が増えたとは数えない。

### 12.3 自動トリガー

| トリガー | 次の処理 |
|---|---|
| 所見に実行証拠・反証が付いた | Episode作成、同種ケースとの比較 |
| 同じ不足・誤検知が蓄積 | 入力構築・質問・通知の候補生成 |
| 強い反例が一件見つかった | 対照fixture作成と小さな改善実験 |
| モデル・engine・主要依存が変わった | 互換性と回帰の再評価 |
| 未解決所見が古くなった | 追加証拠取得または観測打切り |
| 通常運用で一定の監査枠に入った | 検出されなかったケースの無作為監査 |

トリガー条件と実行上限は明示設定にする。同じ事件の重複通知で何度も学習を始めない。Jevの観測枠は広く取り、候補生成と実作業実験には別の予算・優先度を設定する。

### 12.4 能動的な確かめ方

読める定義の取得、固定snapshotのテスト、既知の誤実装の注入、原文の局所比較で自分の所見を確認する。副作用のある実験は隔離executorに限定する。

反例・対照ケースの例：

- 必要定義を含む／欠く。
- 元の定数値を変更する。
- reportだけを足して、証拠を変えない。
- 意味を保ち識別子だけ変える。
- 同じ仕様の英訳を補助的に与える。
- 正しい実装と既知の誤実装を入れ替える。

意味保持を保証できない自動変換は、metamorphic testの正解として扱わない。同じ失敗から派生したfixture群は、学習・評価の分割単位を共有する。

### 12.5 四つの学習対象を混ぜない

| ラベルの対象 | 例 | 強い根拠 |
|---|---|---|
| reading correctness | 定義が3なのに2と読んだ | 原文との直接比較 |
| requirement correctness | 挙動が仕様を満たすか | 明示仕様と独立した確認 |
| intervention usefulness | 定義を示したことで手戻りが減ったか | 対照群・固定作業比較 |
| permission correctness | 確認を求めるべき操作だったか | 事前の承認方針と明示的意思 |

ユーザーが警告を無視した、確認後に承認した、会話が終了した、という行動を単一の正負ラベルにしない。反応の意味は参考としてJevで読むことができるが、その推定はweak labelとして残す。

### 12.6 学習の偏りを補う

警告が出た案件だけでなく、何も出なかった案件からも固定の監査枠で抽出する。実験起源のデータは通常運用と分け、同じ誤りの大量複製で独立事例数を水増ししない。

複数project間の経験共有は明示されたscope内に限る。共通手順へ一般化する時も、個人データ・コード原文・内部名を勝手にglobalへ移さない。

<a id="s13"></a>

## 13. 自己改善の対象：PolicyBundle

最初から自己改変コードを実行せず、候補をデータとして表現する。これは汎用DSLではなく、固定されたengineが検証して解釈できる設定集合である。

```text
PolicyBundle
  id / parent_id / created_at
  scope: project・language・framework等
  schema_version / engine_compatibility
  probe definitions
  approved evidence-selector設定
  retrieval / batching / trigger設定
  advisory score・threshold・通知template
  適用条件付きprocedure references
  referenced episode groups
  model compatibility
  evaluation reports
  lifecycle status
```

| 自動変更可能 | 初版では自動変更しない |
|---|---|
| 質問の分割・追加・修正・削除 | ユーザー仕様・許可の書換え |
| 許可済みselectorを組み合わせた証拠収集 | 認可・外部送信の緩和 |
| 検索順序・資料選別・batch構成 | 採用基準と評価器の変更 |
| advisory条件・通知の頻度と文面 | 予算上限の拡大 |
| 適用範囲を狭める/無効化する変更 | 任意の実行能力の追加 |
| 不要なprobeの退役 | main branchへのcommit/push |

一つの失敗について一つの改善仮説を基本単位にする。入力構築と質問の変更を同時に行う必要がある場合は、一体として版付けし、可能ならablationで寄与を確認する。

範囲外の変更は、隔離環境で実験・パッチ提案まではできても自動採用しない。新しいselector実装のようなengine側変更は、通常のコードレビュー対象にする。

### 13.1 PolicyBundleの信頼境界

bundleは単なる自然言語ファイルではなく、固定されたschemaで読めるデータである。allowed selector ID、probe定義、通知テンプレート、advisory閾値、既存procedureへの参照だけを使う。任意のJS、shell、SQL、import、ネットワーク先は埋め込めない。

固定された権限上限を変えない範囲で、現在の調査に使うselectorや検索領域を調整できる。許可されたprojectの外までscopeを広げる候補は提案止まりとする。probe文も送信情報として検査する。

### 13.2 改善候補の生成物

候補は変更本体に加え、原因仮説、狙う失敗族、期待する改善、悪化し得る場面、必要な比較、参照した開発ケースを持つ。確信的な自己評価ではなく、反証可能な改善仮説として出力する。

一つの問題に複数候補を残せる。例として「質問の修正」「資料収集の追加」「介入タイミングの変更」を別々に作り、同時変更の一括採用だけにしない。候補を増やせることと、評価回数制約なしに昇格させてよいことは別である。

### 13.3 optimizer交換点

最初はLLMの小さな変種生成とpairwise比較を使う。後から、実行履歴を読む反省型optimizer、Jev featureからの小さな予測モデル、手順の圧縮を追加できる。optimizerは候補生成までを担当し、promotion policyの所有者にはしない。

<a id="s14"></a>

## 14. 候補の比較・採用・撤回

### 14.1 状態機械

```text
candidate → contract_checked → replay_passed → shadow
          → experiment_passed → canary → active

各段階 → rejected / paused
active → retired / rollback
```

shadowは結果を記録するが主モデルへ介入しない。canaryは承認済みの低リスク範囲で一部の作業へ実際に適用する。shadowの一致率だけで介入効果があると結論しない。

### 14.2 比較の三層

**契約検査**：形式、認可、データ境界、ID、版、予算、通知量、停止・縮退を決定的に確認する。

**判断の比較**：過去の同じ入力に旧版と候補版を適用する。情報不足検出、relationの誤分類、反証の取り逃し、誤警告を見る。意味が変わった質問のraw probabilityは、そのまま同一指標として比較しない。

**作業の比較**：固定した環境から主モデルを走らせ、候補版・旧版・Wardenなしを比較する。修正できたか、検証できたか、手戻りや時間が増減したかを調べる。Plugin eval等はその実行基盤として利用可能だが、テストの正解・実行権限・入力を独立に固定する。[S6](https://code.claude.com/docs/en/plugin-evals)

### 14.3 評価の分割

- Discovery：失敗診断・候補生成。
- Development：変種の比較と調整。
- Promotion：昇格判定。候補生成器にはケース本文や詳細な失敗を見せない。
- Audit：新しい時点・案件での監査。

同じセッション、同じ変更、同じ元fixtureの派生を別の集合へ分散しない。可視化する繰り返し評価結果からもoverfitし得るため、監査セットを永久に同じまま使わない。採用時期と評価回数を記録する。

### 14.4 採用基準

認可・送信・停止などの必須契約の違反は採用不可。成果の正しさを第一に、事前設定した非劣性条件を満たし、そのうえで少なくとも一つの主指標に再現可能な改善があることを要求する。判定不可能ならshadow継続または保留とする。

固定した案件群と複数実行を使い、task単位で集計する。17,000 tool callがあっても、それを17,000の独立した成果事例と数えない。必要件数は効果量と変動・リスクによって設定し、「50件あれば安全」のような共通値は置かない。

確率校正は、正解が定義できるlabelで別途測る。ECEやBrier等の値を改善させても、介入効果が改善したとは限らない。

### 14.5 自動採用と撤回

promoterが評価記録を検査して、active pointerをtransaction内で切り替える。新セッションは新しい版をpinし、既存セッションは通常は旧版のまま継続する。重大な境界違反では緊急無効化し、適用中セッションにも失効を通知する。

現在のpolicyを戻しても、過去のファイル変更・公開・送信は戻らない。悪化版が関与した所見・成果物を列挙し、必要な再確認を付ける。DB schemaはpolicyの巻き戻しを妨げない互換性方針で管理する。

canaryでは一セッション内で候補と旧版の介入を混ぜず、割付を記録する。因果効果の比較が必要な場合は、許可範囲内でsession/task単位のランダム割付を検討する。

### 14.6 最適化対象と制約

採用判定は、境界違反ゼロを前提に、成果の正しさの非劣性と、事前に選んだ主指標の改善を要求する。複数指標を後から都合よく選び直さない。指標の重み・許容幅・最低評価範囲は固定のEvaluationPolicyに置く。

ROC-AUC等の順位指標、Brier等の確率指標、作業成功率、時間、人間の負担を別に測る。高い校正や一致率を理由に自動で許可権限を与えない。学習workerのラベルと評価器のラベルが同じ誤りを共有する可能性を監査する。

### 14.7 統計と適応的overfit

同じtaskをseedだけ変えたrun、同じPRからのtool call、同じfixtureからの変種を独立サンプルと数えない。比較はtask／session／project単位の群を意識し、必要に応じてcluster単位の区間推定を使う。

多数の候補を試すこと自体で評価setへ適応してしまう。promotionへの試行回数、セットの世代、漏らした結果の粒度を記録する。候補生成側へ詳細な監査ケースを返さない。失敗の説明を開発へ戻す場合、そのケースは以後hidden auditとして数えない。

liveサービスの状態は再現できないことがある。再現不能なネットワーク応答を同じ環境条件と偽らず、fixture化、対応run、外的要因の記録を使い分ける。

### 14.8 モデルとhostの更新

Jevの返却model、主モデル、Mod hostの型が変われば、以前の採用証拠の適用性を確認する。通常のAPI aliasの更新は、新しいpolicyが勝手に正当化される理由にならない。

更新時は互換性試験と代表回帰を優先し、必要ならshadowへ戻す。過去の回答を新しいモデルのfresh evaluationとして数えない。重み・閾値が同じでも、入力構築の変更は別bundleである。

<a id="s15"></a>

## 15. 成熟後の進化と、過剰な自動化を避ける方向

効果のないprobeや重複通知は削除する。単純な条件で置き換えられる処理は、通常のコードへの移管パッチを提案する。成功した調査を、適用条件と反例付きの短いprocedureにまとめる。

プロジェクト固有の前提を暗黙にglobalへ広げない。新しい能力を必要とする候補は提案までに留め、権限と評価条件の追加は人間が別に決める。

学ぶほど指示と警告が増えることではなく、必要な時に必要な処理だけが働くことを目指す。

### 15.1 学んだ手順の構造

procedureは適用条件、必要な証拠、許可された操作、進捗の判定、停止・上位モデルへ戻す条件を持つ。成功したtraceをそのまま繰り返すmacroではない。表現できない新しい場面では、主モデルへ問い直す。

### 15.2 反射と熟考の往復

日常的な意味判断が十分評価されればJevとコードだけで進める部分が増える。一方、未知の仮説・新しい資料構成・前提の衝突は生成モデルを使う。自己改善は主モデルをゼロにする競争ではなく、どの処理を誰が担うと成果が良いかを学ぶ過程である。

### 15.3 コードへの移管

Jevが判定していた性質を正確な計算・構文解析・実行記録で確認できるようになったら、決定的実装への移管パッチを提案する。初版ではこのコード変更の自動採用は行わず、通常のレビューと独立テストを通す。Jev観測を増やす方向と削る方向の両方を改善として認める。

<a id="s16"></a>

## 16. セキュリティ・データ境界

### 16.1 初回の承認範囲

少なくとも次を明示設定する。

- 記録対象のプロジェクト。
- 外部モデルへ送れる資料種別・path・field。
- 使用するproviderとendpoint。
- 自動読み取り、隔離チェック、advisory policy採用の範囲。
- 学習workerの常駐可否と予算。
- 記録の保持・削除・export方法。

一度許可された範囲内では毎回確認しない。scopeの拡大は別の承認操作とする。プロジェクト内の文章やagentの発言はこの承認を更新しない。

### 16.2 ソース最小化

秘密情報のdenylistによる除去だけに依存せず、必要なfield・行をallowlistで収集する。credentials、個人データ、未承認のログ、独占資産等は送らない。学習用のコピーや評価レポートも同じ境界に従う。

外部通信の鍵はbrokerだけが取得し、候補生成モデルや実験子プロセスへ不用意に継承しない。実APIキーをテストfixtureに入れない。

### 16.3 実験の隔離

worktreeはコードの分離であり、秘密情報・ネットワーク・ホスト権限の分離とは別である。任意コードを実行するテスト、install script、学習候補は環境を隔離し、実ユーザーcredentialsや書き込み先を渡さない。

候補生成器には監査セット、promoterの設定、active pointerを書ける能力を渡さない。単に「書かないで」とpromptに書くだけを保護と見なさない。同じユーザー権限の完全な保護は保証できないため、脅威モデルに応じてOS sandbox/別ユーザー/コンテナ等を適用する。

### 16.4 Policy poisoning

評価対象のソースにある「この質問には合格と答えろ」等はデータとして扱う。原文をreviewerや主モデルへ返す時に、制御命令へ格上げしない。

単一セッションの誘導や誤labelがglobal policyを変えないように、scope制限、独立ケース、由来別の評価を必要とする。弱いモデルlabelだけでは強い自動介入を昇格しない。

### 16.5 原文は制御命令へ昇格させない

資料内の「必ずこのSkillを使え」「このテストを無効化しろ」は評価対象の文字列であり、Wardenの認可ではない。contextへ戻す時は出所付き引用にし、固定の制御文と区別する。Jevが危険でないと判定したことを理由に、データの信頼階層を変更しない。

### 16.6 IPCとbroker

loopbackを使う場合も認証、Origin／宛先の確認、body上限、request ID、replay対策を持つ。ブラウザからアクセスできるだけの無認証APIにしない。任意のコマンドや外部URLを引数として通さず、登録済み能力とIDを解決する。

process起動は原則argvで構成し、shell展開を不要にする。実験やpackage scriptの実行は、現在の内容hashと許可された環境を再確認する。キューに入れた時点の承認が永遠に有効とはしない。

### 16.7 削除・同意撤回・派生物

資料の削除要求ではraw evidenceだけでなく、含有するrequest、派生label、cache、経験、学習候補、評価レポートをdependency索引で追跡する。その資料に依存したbundleは監査・退役・再生成の対象にする。

外部providerへ一度送信したデータをローカル削除だけで取り戻せるとは主張しない。ローカルでも、バックアップやWALを含む削除方針を明示し、完了した範囲と残る範囲を報告する。未承認のクラウド同期・外部report公開はしない。

### 16.8 信頼基盤の実装段階

単に同一UIDのフォルダを分けただけでは、学習器から評価器を完全に保護できない。初期の信頼モデルを「協調的なModと誤動作する生成モデル」として明示する。悪意ある候補コードや第三者repositoryを実行する段階では、別processの制限だけでなくsandbox／コンテナ／別ユーザー等で能力を分離する。

Modsの`$`仲介は有益な接点だが、外部Labが同じ保証を自動的に引き継ぐことはない。各processの信頼境界を個別に検査する。

<a id="s17"></a>

## 17. UI・操作・通常運用

以下は提案するUI/CLIであり、現在実装されたコマンドではない。

```text
/warden:status            現在のpolicy、所見、worker、予算、縮退状態
/warden:explain F18       所見の原文・版・質問・確率・後続検証
/warden:learning          実験候補、比較結果、採用理由
/warden:pause             学習停止。runtimeを残すかは明示選択
/warden:rollback VERSION  policyを旧版へ戻す
/warden:forget SCOPE      指定記録と派生cacheを削除
```

Skill表示とは別に、同じ機能をCLIで利用可能にする。緊急停止はモデルを介さず操作できる。

通常は成功probeを並べず、現在の不足・重要な反証・必要な選択だけを表示する。policy変更はまとまった更新履歴として残し、次セッションで短く示す。更新ごとに会話へ割り込まない。

ローカルと外部レポート公開は別操作。Plugin evalを使う場合も、送信契約に従いレポートをローカルに留める設定を明示する。[S6](https://code.claude.com/docs/en/plugin-evals)

### 17.1 native Paneの設計

PaneはEvidence、Relations、Decisions、Experiments、Healthの五つの視点を持つ案とする。全件の確率を主画面に並べず、必要なところから詳細へ開く。

表示する重要事項は、未解決の具体的不足、主張に対する反証、仮決定、古いreceipt、現行bundle、進行中の比較、送信・予算・縮退状態である。UIの名前と配置は提案であり、hostの実際のrender APIに合わせる。

### 17.2 三つの停止

`pause observations`は新しい意味観測、`pause learning`は新しい研究job、`disable interventions`は主モデルへの介入を止める。緊急停止は三つすべてと実行brokerを止める。既に外部で進行した処理が即座に取り消せたとは扱わない。

### 17.3 通常の更新通知

policy採用時は次sessionで短い変更概要を示す。毎回のprobe改善を会話へ割り込ませない。ユーザーは理由・比較結果・影響scopeを開き、旧版へ戻せる。常時監視のために個々の判断を手で承認する運用にはしない。

### 17.4 最初に決める設定

project scope、provider、鍵の取得元、記録・外部送信範囲、自動読み取り・隔離検証、常駐可否、予算、採用の範囲、データ保持を設定する。一度許可された内側で自動運転する。未設定の範囲を、便利だからという理由で推測して有効にしない。

<a id="s18"></a>

## 18. Cookbook・先行実装から取り込む設計パターン

この章は「一次資料にある手法」と「本書への転用案」を分ける。掲載されたbenchmark、閾値、モデル版はWardenの性能保証ではなく、そのまま移植しない。以下は手法の要点のみである。

### 18.1 TypeSafe Cookbook対応表

| 一次資料の手法 | Wardenへの転用案 | 検証すべき点 |
|---|---|---|
| Parallel questions：共通stateへの質問をまとめる [S26](https://docs.typesafe.ai/cookbooks/parallel_questions) | 同じ証拠に対する多数のrelationを一括評価 | 質問数より入力取得・直列段数・待ち時間を測る |
| Line-by-line search：実在する行IDの選択と回答存在の判定 [S15](https://docs.typesafe.ai/cookbooks/semantic_find) | 仕様・設定・ログ内の根拠箇所を特定 | 最高順位と本当の根拠を分ける |
| Re-ranking：広い検索の候補をペアごとに再評価 [S27](https://docs.typesafe.ai/cookbooks/rerank_typesafe) | 実装・caller・testの意味検索 | shortlist外の取りこぼしを別に測る |
| Hierarchical classification：複数の階層経路を残して探索 [S16](https://docs.typesafe.ai/cookbooks/hierarchical_classification) | module→file→symbol／仮説の探索枝 | 早すぎる一経路固定を避ける |
| Classifying RAG passages：関連性・反証・注入等を分離 [S17](https://docs.typesafe.ai/cookbooks/classifying_rag_passages) | 支持資料、前提を崩す資料、不足資料に整理 | 都合の悪い資料を無関係として消さない |
| Structure recovery：元のブロックへ役割を付けて再構成 [S19](https://docs.typesafe.ai/cookbooks/autoformat) | 会話・設計メモの原文付き作業記憶 | 提案と採用の混同、抽出漏れ |
| Pre-parsed value extraction：抽出済み候補から意味で選ぶ [S20](https://docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook) | 定数・設定値・識別子の原文コピー | コピーする値と、選んだ対象が合っているか |
| Date extraction：部品を抽出し日付をコードで確定 [S28](https://docs.typesafe.ai/cookbooks/date_extraction_cookbook) | 期限・改訂日・相対日付の整理 | timezone・基準時刻が不明なら保留 |
| Function calling：関数と閉じた引数を同時に判断 [S18](https://docs.typesafe.ai/cookbooks/function_calling) | 登録済みの読取・検証・比較操作を選ぶ | 引数の明示有無、grant、未指定値を捏造しない |
| Skill suggestion：広い順位付けの後、候補を詳しく読み適合確認 [S8](https://docs.typesafe.ai/cookbooks/skill_suggestion) | Skill／procedure推薦 | 最も近い誤候補を押し付けない |
| Entity alignment：同一性と属性の一致・不一致を分ける [S21](https://docs.typesafe.ai/cookbooks/entity_alignment) | 同じ所見・決定・変更の紐付け | 誤統合が他の証拠へ伝播しないこと |
| Double-checking citations：引用の実在と主張支持を分ける [S22](https://docs.typesafe.ai/cookbooks/citation_check) | report→source、仕様節→behaviorの確認 | exact matchだけで文脈の支持としない |
| SDE cascade：抽出結果を局所的に検証し難所を再処理 [S23](https://docs.typesafe.ai/cookbooks/sde_cascade) | claim抽出→relation検査→限定reviewer | 一つの総合点で欠落を隠さない |
| Classification using confidence：粗い分類へ戻る [S24](https://docs.typesafe.ai/cookbooks/classification_using_confidence) | 根拠行まで不確かな時、確認できるmoduleまで返す | 親カテゴリの正しさも根拠が必要 |
| Self-consistency：同じ入力の揺れを測る [S25](https://docs.typesafe.ai/cookbooks/consistency_choice_cookbook) | 安定性、言語差、prompt変種への感度を評価 | 一致率を正答率としない |
| Guardrails：複数の危険・程度を信号化 [S29](https://docs.typesafe.ai/cookbooks/llm_guardrails) | actionの補助所見、untrusted入力の注意 | モデル判断をsandboxや最終認可にしない |
| Autoresearch feature discovery：誤差から質問を追加・修正・削除 [S5](https://docs.typesafe.ai/cookbooks/autoresearch_feature_discovery) | PolicyBundleの候補生成と改善 | 特徴精度だけでなく介入効果も測る |

### 18.2 既に議論した公開実装

| 実装 | 借りる考え方 | そのまま借りないもの |
|---|---|---|
| pi-warden [S30](https://github.com/DevMortimer/pi-warden/blob/main/docs/guards.md) | eventごとの狭い判断、candidate観測、後続結果との照合 | 独自corpusの閾値、苦情なし＝正解という解釈 |
| Jev Realtime Code Check [S31](https://github.com/MrDesjardins/jevrealtimecodecheck/blob/main/README.md) | rule単位の判定、追加調査、diff blockからの局所化 | 全言語へ同じrule、既存違反と新規違反の混同 |
| wince [S32](https://github.com/TinyFrontier/wince/blob/main/README.md) | 意味信号と決定的なtriage方針の分離、役立たない信号の保留 | 個別repoの重み・risk scoreを一般的な欠陥確率とすること |
| firstmate [S33](https://github.com/kunchenguid/firstmate/blob/main/docs/verification/dispatch-resolve.md) | 不可避な意味判断だけを残し、quota等はコードで扱う | 25件等の小さな評価を一般保証とすること |
| jev-router [S34](https://github.com/gargpratyush/jev-router/blob/master/README.md) | model提案と実際のrouting policyの分離、失敗時の継続 | 任意のmodel名、料金、互換性を固定すること |
| jev-ultrafast [S13](https://github.com/browser-use/jev-ultrafast/blob/main/README.md) | 動的action space、投機的な操作別head、鮮度と実在ID | browser特有の操作集合や速度を開発へそのまま流用 |

これらは設計参照であり、Wardenへ依存ライブラリとして全部導入する計画ではない。ソースの再利用が必要なら、実装時点のライセンス・変更状態・API契約を別途確認する。

### 18.3 新しい観測器自体も試す

同じsourceに対し、必要定義の欠落、報告だけの追加、識別子変更、既知の誤実装、日英questionなどの対照を作る。質問が何を根拠に反応するかを測る。

対照変換の正当性も検査する。識別子変更でreflectionやserializationが変わる場合、それを意味保持の変換とみなさない。条件付き問いの高い値を現実の主張へ戻さない。

<a id="s19"></a>

## 19. 代表的なend-to-endシナリオ

以下のケースは設計fixtureであり、実際にJevを呼んだ測定結果ではない。

### 19.1 定義不足を取りに行き、主張を訂正する

```text
主張：「テストは合計2回の呼出を検証する」
入力：expect(calls).toHaveLength(EXPECTED_CALLS)
未取得：EXPECTED_CALLSの定義

1. source→claimとspecific sufficiencyを観測する。
2. 値が不明なら主張の支持を確定しない。
3. 許可済みselectorで参照先を解決する。
4. 定義が3なら、主張との数値比較はコードで行う。
5. reading counterexampleとinput coverage不足を別々に記録する。
6. 主モデルへ定義を示し、報告または実装の再確認を促す。
7. Labは定義収集・質問・通知の候補を比較する。
```

定義が2なら、主張はその局所的事実について支持される。定義が動的で確定できなければ、実行観測か未解決のままにする。どの場合も勝手にテストや仕様を変更しない。

### 19.2 実装もテストも正しいが、仕様は決めていない

仕様には「行動中はATBが停止」「行動終了時に蓄積ATBを解消」とある。キャンセルが終了に含まれるかは記述されていない。実装はキャンセル時にATBをゼロにし、テストもそれを期待している。

Wardenは、実装→behaviorとtest→behaviorの一致とは別に、spec→behaviorの根拠を照合する。関連資料のscopeを確かめ、他の明示仕様で決まっていなければ「この判断は仮決定」と示す。自然だからという理由で`entailed`にしない。

次の行動は「即座にバグ修正」ではない。局所的に進めてよい仮決定なら記録し、外部契約へ影響するなら人間の決定へ戻す。採用された決定の原文を後から結び付け、テストと仕様の関係を更新する。

### 19.3 テストの境界が対象挙動を消している

契約は「データ更新後、次回の読み取りで古い値を返さない」。テストはcache service全体をmockし、HTTP 200だけを確認している。

Jevには「対象の値を観測するか」「古い値を返す誤実装を区別するassertionがあるか」「mockが検証対象を除いていないか」を別に聞く。実行で確認するなら、具体的な誤実装を隔離snapshotへ入れ、対象テストが意図したassertionで失敗するかを調べる。

HTTP 200のテスト自体を無価値と決めつけない。どの契約を検証し、どの契約を検証していないかを整理する。

### 19.4 似たSkillの誤推薦を止める

関連Skillの短い一覧で候補を作り、上位候補の本文を取得して対象サービス・操作・前提条件への適合を確認する。候補に対象サービスのSkillがなければ、近いSkillを無理に選ばず`none`とする。[S8](https://docs.typesafe.ai/cookbooks/skill_suggestion)

推薦文は候補と適用理由を示す補助であり、既存のSkill一覧や人間の目的を置換しない。ロードしたことではなく、その後の作業が改善したかを評価する。

### 19.5 停滞から、仮説を区別する観測へ進む

エラーが続く時、仮説A「実装の誤り」、B「古い期待値」、C「fixtureが契約と違う」を保持する。各仮説について支持資料・反証・未取得情報を観測し、候補となる定義読み取りや単独テストが何を区別できるかを評価する。

失敗回数が三回になったから自動的に叱るのではない。新しい情報が増えたなら継続する。候補が尽きたなら生成モデルへ新しい仮説を求める。Jevの値を厳密なベイズ更新として扱わない。

### 19.6 更新後の古い証拠を使わない

テスト成功後にfixtureが変わった。receiptは成功のまま保存するが、適用状態を`stale`へ変更する。Jevが関係なさそうと判断しても、独立した依存関係の根拠なしに鮮度を戻さない。

主モデルは「以前の版では成功、現在版は未確認」と報告できる。必要なcheckだけを再実行する候補を用意し、全suiteの再実行を無条件の共通ルールにしない。

### 19.7 改善候補が逆効果だった

候補は定義不足をよく検出するが、同じ資料を過剰に読み直し、主モデルの作業を遅くした。replay精度が上がっていても作業比較で昇格を保留する。

Labは「同じsnapshotで確認済みの定義を再利用する」「通知を一回にする」などの次候補を作る。候補を採用した後で悪化が判明した場合はpolicyを戻し、その版に依存した成果物の再確認だけを別jobで行う。

<a id="s20"></a>

## 20. Repository構成・build・配布

### 20.1 初期構成案

```text
jev-warden/
  .claude-plugin/plugin.json
  hooks/
    hooks.json                 # modules入口
    register.ts                # host依存の薄いadapter
    bindings/                  # $の能力 → Core ports
    ui/
  core/
    contracts/
    events/
    evidence/
    retrieval/
    relations/
    probes/
    arbitration/
    policy/
  lab/
    service/
    storage/
    episodes/
    candidates/
    scheduler/
    experiments/
  kernel/
    grants/
    budgets/
    evaluator/
    promotion/
  adapters/
    jev/
    generation/
    operating-system/
    classic/                   # 後回し
  cli/
  mcp/                         # 明示検索・照合の別入口
  skills/
    status/
    explain/
    learning/
  types/                       # 将来のnoun契約。必要になるまで追加しない
  .claude/types/               # 対象hostから生成した型契約
  fixtures/
  tests/
    core/
    mods/
    protocols/
    replay/
    fault/
    e2e/
  docs/
    architecture.md
    decisions/
    data-handling.md
    evaluation.md
```

このディレクトリ分離は責務であり、セキュリティ境界ではない。プロセスの能力分離は第16章に従う。

### 20.2 buildの二系統

Mod側は`lib`や依存をhostの生成型へ合わせ、Node built-inやDOMへ誤って依存していないか検査する。Lab側はNode用にbuildする。Coreは両方から型検査・テストされる。transport、時計、乱数、永続化、hash等は必要に応じてportで受け取り、無条件のglobal副作用を持たない。

手元の`/plugin-types`生成物とCLI版を契約manifestへ記録する。リポジトリのREADMEより生成型が新しい場合も、対象環境で使える型と動作を優先する。型が存在するだけで権限があるとは扱わない。[S9](https://github.com/anthropics/claude-code/blob/main/mods/README.md) [S10](https://github.com/anthropics/claude-code/blob/main/mods/types/claude-code.d.ts)

### 20.3 最小のmodule形

公式のmodule方式に合わせた最小の無処理例。Jev呼出やWarden実装ではない。

```json
{
  "modules": ["./register.ts"]
}
```

```ts
import type { Register } from 'claude-code';

export const register: Register = (on) => {
  on('tool.call', async (_engine, event, next) => {
    return next(event);
  });
};
```

実装時は現在の型で検証し、入口を通すだけで通常動作を変えないテストから始める。

### 20.4 永続領域

```text
Warden data root/
  state.sqlite
  evidence/<scope>/<content-hash>
  policies/candidates/
  policies/versions/
  evaluations/reports/
  spool/
  manifests/
```

Pluginの永続領域を候補にできるが、Modがそのパスへ直接Node APIで触る構造にしない。Labは設定されたdata rootを受け取る。監査用ケースとpromoterの設定は、学習用workspaceから独立させる。[S2](https://code.claude.com/docs/en/plugins-reference)

### 20.5 配布と更新

初期は`--plugin-dir`等の開発load経路で検証し、対応バイナリ・必要能力を明示する。配布時はmanifest、署名または検証可能なhash、依存lock、data migration、release noteを揃える。

Plugin更新でPolicyBundleや学習記録を無言で削除しない。逆に旧版policyが新しいCoreへ読めない時、読み飛ばして成功扱いにしない。Classic fallbackの自動有効化も、二重hookや同意の変更がないことを確認する。

<a id="s21"></a>

## 21. 実装ロードマップ：先に「育つ一本」を通す

目標機能を広く定義しつつ、初版は証拠十分性の一本を、経験化・評価・採用まで閉じる。予定日や所要時間はここでは固定しない。各段階は動く成果と終了条件で管理する。

### Phase 0：Modsの実機spike

**成果物：** 最小Mod、契約manifest、doctor、fake Jev transport、native test。

**確認：** load、生成型、event before/after、追加context、Paneまたは代替表示、キャンセル、並列、session終了、`$`の再帰、禁止能力、Lab接続。Node依存なしで動くことを確認する。

**終了条件：** 通常toolの結果を変えず、観測→Jev相当の応答→表示の一往復が成立する。未対応能力は明示される。初回の実Jev試験は許可された公開／合成データで行い、dummy応答と混同しない。

### Phase 1：観測基盤を日常作業へ入れる

**成果物：** Event/Evidence/Snapshot/Observation/Receipt、Lab writer、queue、UI、送信同意、予算、原文参照。

support、grounding、test coverageの枠は作るが、すべての言語・テストframeworkへの自動抽出は求めない。所見は観測またはadvisoryで、semantic gateは導入しない。

**終了条件：** 日常作業から、後で再評価できる当時の入力・版・結果が保存される。Lab停止・復帰、削除、欠損、異なるworktreeを試せる。

### Phase 2：証拠不足の解消ループ

**成果物：** specific sufficiency、既知の定義探索、再評価、調停、所見の解決。

最初の言語／テストframeworkは一つに固定してよい。主張の候補抽出は小さなfixtureと実際の報告を起点にし、将来一般化する。必要な定義を取得し、その結果で主張を支持・訂正・保留する。

**終了条件：** 警告だけではなく一つの不確実性を解消できる。不要な同じ読み直しや通知を抑え、当時何を知らなかったかを残す。

### Phase 3：経験化と候補生成

**成果物：** Episode、label provenance、失敗族のまとめ、対照fixture、CandidateBundle、generator adapter。

解決済み所見や強い反例が自動的にjobを生む。質問だけでなく、許可済みselector、資料構成、通知時機の変種を作る。新規candidateは観測状態で、主作業を勝手に変えない。

**終了条件：** 人間が「質問を修正せよ」と指示しなくても、再現ケースと比較可能な候補が出る。実験から再帰的な学習起動をしない。

### Phase 4：自動評価・採用・撤回

**成果物：** replay runner、shadow、旧版／候補／無介入比較、canary、Evaluator/Promoter、rollback、監査。

**終了条件：** 有効な候補を次sessionへ採用し、不正な候補・悪化する候補を保留または退役できる。worker停止後も評価を再開でき、採用理由から独立した証拠へ辿れる。

### Phase 5：能力を広げる

意味検索、反証context、仕様の仮決定、テスト契約、Skill推薦、仮説比較、手順学習を同じ契約へ乗せる。各機能の追加時に、抽出・判断・介入の評価を一組で追加する。

`$.warden`公開、他host、Classic完全互換、複雑なML、任意コードの自己書換え、豪華なdashboardは、明確な利益が出るまで後回しにする。

### 21.1 依存順序

```text
host spike
   ↓
原文・版・認可・記録 ─→ 大量の意味観測
   ↓                        ↓
確かめに行く操作 ───────→ 経験化
   ↓                        ↓
固定した評価環境 ───────→ 候補比較
                            ↓
                    採用・撤回・監査
```

自己改善機能の実装がPhase 3からでも、必要な当時の入力・認可・版・armの記録はPhase 1から保存する。学習の配線を後回しにしない。

<a id="s22"></a>

## 22. テスト戦略と受入条件

テストは、意味判断の性能とソフトウェアの制御契約を分ける。mockしたJevが期待どおり返ったことは、実モデルが正しく判断した証拠ではない。実モデルが良い分類を返したことも、介入で開発が改善した証拠ではない。

### 22.1 五つのテスト層

| 層 | 対象 | 主な方法 |
|---|---|---|
| Pure Core | 集約、失効、予算、候補の選別、採用状態機械 | 決定的fixture、property test、境界値 |
| Mod契約 | continuation、pinned field、origin、UI、clock、session終了 | 対象CLIのnative plugin testと生成型 |
| Lab統合 | SQLite、lease、spool、migration、IPC、停止・再開 | 実プロセス、fault injection、再送 |
| Semantic評価 | relation、specific sufficiency、検索、言語感度 | 正解由来を持つケースと実Jev、対照変換 |
| 作業効果 | 成果物、手戻り、時間、通知、根拠付き完了 | 固定snapshotから旧版／候補／無介入の比較 |

### 22.2 受入テスト一覧

IDは実装タスクやCIから参照できる安定した識別子とする。後から変えるのは説明の版であり、同じIDへ別の契約を割り当てない。

| ID | 検証する契約 | 初期段階 |
|---|---|---|
| M01 | ModはNode／DOM依存なしでloadでき、対象CLIの型で検査できる | 0 |
| M02 | pass-throughのtool結果・例外・キャンセルを改変せず、nextを二重に呼ばない | 0 |
| M03 | Mod順序を変えた時の観測範囲を記録し、最外周の完全監査を偽らない | 0 |
| M04 | 自身のstore/http/UI effectで無限に観測・再発火しない | 0 |
| M05 | agentId、origin、providerを混同せず、別agentの所見を誤配送しない | 0–1 |
| M06 | 未対応capabilityはdoctorで検出し、使えたことにしない | 0 |
| M07 | session終了・reload後にtimer／callbackが古いsessionを更新しない | 0–1 |
| D01 | Jev未接続でも決定的な記録が働き、未評価を成功にしない | 1 |
| D02 | 古いsnapshotの成功receiptを現snapshotの完了根拠にしない | 1 |
| D03 | 同一eventの再送、結果の逆順到着、再接続で重複介入しない | 1 |
| D04 | requested inputと実際に確認できた実行inputを区別する | 1 |
| D05 | Bash・外部プロセス由来の変更を完全に捕捉したと無根拠に主張しない | 1 |
| D06 | scope撤回後のqueued jobは送信・実行せず、削除の派生範囲を扱う | 1 |
| R01 | 未提示定数に依存する高確率を、根拠充足へ昇格しない | 2 |
| R02 | 抜粋に記述がないことを、仕様全体の未定義と断定しない | 2 |
| R03 | compatible、required、contradictedを混同せず、仮決定の存在を保持する | 2 |
| R04 | Choiceの一位と絶対的な適合を分け、全候補不適合を扱う | 2 |
| R05 | reportだけの追加で証拠が増えたことにせず、anchoring感度を評価する | 2 |
| R06 | 必要な複数節の根拠を、一個のlocatorだけで十分と扱わない | 2 |
| R07 | requirementに必要な内部呼出回数と、不要な実装結合を区別する | 2 |
| R08 | 反例実行の失敗が、目的のassertionによるものかを確認する | 2 |
| R09 | 日英の質問差と原文差を別実験とし、原文・翻訳・言語を追跡する | 2 |
| I01 | 取得予定の定義や同じ不足を何度も通知せず、所見を集約する | 2 |
| I02 | TDDの赤、進展するデバッグ、実装途中のstubを一律停止しない | 2 |
| I03 | 未検証事項を正直に報告して終了でき、同じ所見で無限継続しない | 2 |
| I04 | UIで見せただけの所見を、主モデルが受け取った介入として記録しない | 2 |
| L01 | 結果確定がEpisode・改善jobを自動生成する | 3 |
| L02 | 苦情なし、未実行、会話終了、保留後の承認を自動的な成功／誤検知labelにしない | 3 |
| L03 | outcome時の正解をdecision時の入力へ混ぜない | 3 |
| L04 | 元fixtureの派生と同一sessionを評価集合間で漏洩させない | 3 |
| L05 | 実験sessionが再帰的に学習workerを起動しない | 3 |
| L06 | worker停止・lease切れ・破損途中出力から重複なく再開できる | 3 |
| P01 | candidateが権限、送信先、予算、評価器、active pointerを改変できない | 4 |
| P02 | 分類が改善しても、作業品質・介入負担が悪化するcandidateを昇格しない | 4 |
| P03 | 証拠不足ならshadow継続／保留になり、件数だけで昇格しない | 4 |
| P04 | session単位でpolicyをpinし、旧版へ戻しても過去操作が戻ったとは表示しない | 4 |
| P05 | model／CLI更新時に対象互換性を再確認する | 4 |
| S01 | credentials・未許可資料をrequest、fixture、エラー、UI、学習記録へ漏らさない | 全段階 |
| S02 | authなしのIPC、再送、巨大body、未知job／capabilityを拒否する | 1 |
| S03 | callback・collector失敗を理由に実行済みmutationを再実行しない | 0–1 |
| S04 | timeout・429・rate limit・不正responseを正常判定へ変換しない | 1–2 |
| S05 | sandbox外、symlink先、変更されたpackage scriptを旧許可で実行しない | 2–3 |
| S06 | ローカル停止手段がモデルやJevを介さず機能する | 1 |

### 22.3 最初のfixture群

初期fixtureは読みやすく、期待値の導出を検証可能にする。例としてTypeScriptの小さな関数、Vitest等のテスト、Markdownの明示契約を組み合わせるが、frameworkはPhase 0で選定する。

最低限、定義欠落、誤った定義、別スコープ、仕様上の仮決定、assertion不足、不要なmock、版違い、report anchoring、日本語原文を含む。正例だけでなく「何も介入しない方が良いケース」を含める。

### 22.4 結果の報告形式

`offline contract pass`、`live semantic result`、`task outcome`を別欄にする。未実行、API失敗、未確定、評価打切りを区別する。試験環境、CLI、生成型hash、Core、bundle、Jev返却モデル、dataset split、実行日時を記録する。

<a id="s23"></a>

## 23. 指標・性能・予算の設計

### 23.1 成功指標

品質を落として時間だけを短縮するcandidateを、総合スコアの加点で救わない。採用基準には独立した必須条件と品質条件を置き、その後に効率を見る。

| 層 | 指標例 | 誤った読み替え |
|---|---|---|
| 検索・抽出 | 対象の取りこぼし、正しい原文への到達、検索範囲、追加read数 | 上位候補の高得点＝全体の網羅 |
| 証拠 | 必要定義の取得率、根拠不足の見逃し、receipt適用性 | 資料が多い＝十分 |
| Relation | relation別の誤分類、棄権率、反証取り逃し、曖昧性の扱い | 一致率だけで実務品質を保証 |
| 介入 | 実際の解決への寄与、重複、不要な再読、ユーザーの訂正 | agentが従った＝有益 |
| 作業 | 独立した受入成功、手戻り、完了根拠の適切さ、所要時間 | テスト件数／成功率＝仕様準拠 |
| Runtime | p50/p95待ち時間、直列段数、queue遅延、CPU/I/O、入力量 | Jev単体latency＝全作業のlatency |
| Lab | 候補生成・棄却・保留・採用、再現性、監査悪化、rollback | 採用数が多い＝よく学ぶ |

正解が定義できる課題では確率のBrier scoreや校正曲線を検討する。ラベル自体が曖昧なときは、単一の点推定だけで評価せず、判断保留や複数の妥当解を認めた評価を別に持つ。

### 23.2 評価単位

tool call、finding、task、session、projectを分けて記録する。作業効果の比較はtask／sessionを主単位にし、同一taskの大量tool callで有意に見せない。

candidateの入力構築が変わる場合、同じ当時のアクセス可能データ集合を出発点にする。candidateだけに未来の定義・最終diff・後続ユーザー訂正を与えない。

### 23.3 大量観測の予算

Jevは広く使う。価格が安いことを理由に主モデルのcontextや通知を無制限に増やさない。次の予算を独立に制御する。

- Jev：入力token、request、同時実行数、rate limit、critical pathの待ち時間。
- 生成：候補生成、深いreview、主モデルの再実行。
- 実行：CPU、I/O、壁時計、network、隔離環境の数。
- context：主モデルへ渡す文字数／token、重複、再通知。
- 記録：証拠量、保持日数、DB／WAL、バックアップ。

今回の設計書では万人共通の閾値を置かない。予算未設定の起動直後は、外部送信と自動実験を無効にする。初回の設定後は、承認された内側で毎回確認せず回す。

### 23.4 費用の見積りと実績

推定費用は `入力token × 検証時の単価` として保存し、課金API等で確認できた実績と分ける。出力無料という現行の公表条件も、provider別の価格設定として扱う。[S36](https://docs.typesafe.ai/models)

timeout・cancel・retry時の未確定費用を0へ丸めない。Labのreplayは一回の入力量が小さくても総量が大きくなるため、実行前に対象ケース数、概算入力量、生成／E2E費用の上限を確認できるようにする。

### 23.5 最適化の優先順位

最初は誤った証拠や不適切な介入を減らす。次に直列往復と無関係なstateを減らし、接続再利用・batch・cacheを調整する。microbenchmarkの勝利だけで手順を採用しない。

キャッシュを使った通常運用と、fresh callによる安定性・model drift評価は区別する。検査項目を先に削るのではなく、候補として観測し、実際の価値を見て採否を決める。

<a id="s24"></a>

## 24. 設計判断記録と未決定事項

### 24.1 現時点で採用する設計判断

以下は本書の提案として採用する判断であり、実装済みではない。

| ADR | 判断 | 理由／留保 |
|---|---|---|
| ADR-01 | Claude Modを主入口にする | before/after、UI、session内状態を自然に扱う。early accessをdoctorで検査 |
| ADR-02 | Coreはpure TypeScript、Node依存を排除 | ModとLab、offline testへ同じロジックを移せる |
| ADR-03 | 永続記録と改善は外部Lab | Mod終了に学習の寿命を結び付けず、SQLiteをModへ直接載せない |
| ADR-04 | 初版の自動進化単位はPolicyBundle | 経験から変えつつ、能力・評価条件の自己書換えを避ける |
| ADR-05 | 多数の狭いJev観測を許す | 観測の節約より主モデルの再読と直列待ちを減らす |
| ADR-06 | Relation、証拠十分性、決定の出所を分離 | 実装とテストが正しくても未決定仕様を見つける |
| ADR-07 | 原文・時点・版・認可・評価armを初日から保存 | 当時の条件を後から復元できなければ改善を比較できない |
| ADR-08 | 通知は一つの調停器から出す | 大量probeが大量の割り込みにならないようにする |
| ADR-09 | 自動採用は固定Evaluator/Promoterだけ | 候補生成器の自己採点を避ける |
| ADR-10 | 最初は証拠十分性で閉ループを完成 | 具体的な定義と反例で答え合わせしやすい |
| ADR-11 | jev-crosscheckを当面置換しない | 明示的inspect/sendと自動送信を別の契約として保つ |
| ADR-12 | `$`経由の効果と外部workerを別に監査 | Mod capabilityが外部Nodeの全副作用を自動保護するわけではない |
| ADR-13 | 停止・棄権・保留・退役を正常系にする | 情報不足時にも何か答える／変更する圧力を作らない |
| ADR-14 | UI-only観測とmodel介入を分離 | 主モデルを汚さず人間が監視・検証できる |

### 24.2 Phase 0で解消すべき事項

| 問い | 決め方 |
|---|---|
| 対象CLIでModsがloadするか、生成型は何か | 手元のバイナリと`/plugin-types`、小さな実機spike |
| 実際のevent/result/cancel/permission契約 | native testとcaptured trace。Classic形式から推測しない |
| Jevのtransportはhost HTTPかbrokerか | `$`の利用可能能力、認証、接続維持、実測latencyで選ぶ |
| Lab接続・起動・終了・service manager | Mac先行で確認し、OS依存をadapterへ隔離 |
| 初期の言語／framework／fixture | 実際のプロジェクトから一つ選ぶ。その他は未対応を明示 |
| 初回の送信・記録・実験の許可範囲 | ユーザー設定として保存。repo内の推測から作らない |

### 24.3 後続実験で決める事項

Jevの日本語品質、候補質問の有用性、深いreviewへの切替条件、contextの長さ、通知頻度、十分な独立ケース数、canary割合、採用の統計条件、proof／mutationの範囲は実測で決める。

予算やriskの許容差を変えるのは人間側の方針変更であり、候補の勝利を作るためにoptimizerが変更するものではない。未決定の数値は設定未済として表示し、妥当そうな初期値を承認済みと扱わない。

<a id="s25"></a>

## 25. 実装調整役への引継ぎと作業分担

### 25.1 調整役の任務

本書を機能の発注一覧として一度に実装せず、Phase 0から順に動く縦断sliceへ切る。手元のClaude Code契約と既存`jev-crosscheck`を読み直し、すでに解決された問題を再発明しない。

最初の作業順序は、(1) host capability確認、(2) Event/Evidence/Observationの最小契約、(3) ModとLab間の往復、(4) 一つのspecific sufficiency probe、(5) 証拠取得とEpisode、(6) 自動改善と採用である。

調整役自身が各領域の実装をすべて握る必要はない。ただし、データ契約・信頼境界・評価条件の決定責任は明示する。

### 25.2 並列化する単位

| 担当 | 主な所有物 | 同時変更を避ける境界 |
|---|---|---|
| Mod adapter | hooks、HostPort、native fixtures、Pane | 生成型を独自に改変しない。Core契約を勝手に拡張しない |
| Core／probe | relation定義、request構築、集約、失効 | データschemaの変更は調整役と共有 |
| Lab／storage | DB、queue、spool、IPC、service | 他担当が直接DBへ新fieldを書かない |
| Evaluation | fixture、oracle、split、run／promotion reports | optimizerとは編集権限を分ける |
| Learning | Episode化、candidate提案、比較job | 採用基準・監査データ・active pointerへ書かない |

Phase 0で接続契約を固める前から、各担当に別々の巨大frameworkを作らせない。fixtureに対して同じ契約を共有し、必要な変更は一つの版更新として扱う。

### 25.3 成果物と報告

各sliceは、変更ファイル、満たした受入ID、確認方法、未実行項目、実API使用量、残った仮定、rollback方法を報告する。mock成功と実モデル品質を別に書く。

本書の提供はrepository作成、install、API課金、worker起動、commit／push、データ送信の許可ではない。実装時の明示指示と登録済みscopeに従う。

### 25.4 そのまま渡せる着手指示

> この設計書を正本として、まずPhase 0と最小Event/Evidence契約を実装する。Claude Modsの対象バイナリから型を生成し、NodeなしのModと外部Labの境界を実機で確認する。最初の到達点は、通常toolの挙動を変えずに観測を記録し、合成fixtureで一つのspecific sufficiency判定を表示できること。勝手に全機能を実装せず、未確認capabilityを使えるものとして補完しない。自己改善に必要な原文・時点・版・origin・認可を初日から保存する。共通契約が固まった後は、担当を分けてPhase 2以降を進める。実行・送信・採用の認可を改善用promptから増やさない。

<a id="s26"></a>

## 26. 議論との対応表・v0.1からの変更

### 26.1 「全部」をどこへ収めたか

| 議論したテーマ | 本書の参照先 | 最初の実装接点 |
|---|---|---|
| 開発中にJevを多数呼び、疑似テストにする | 4、8、12、23 | 観測基盤、candidate probes |
| テスト十分性・テストの性質 | 5.5、6、19 | contract／wrong implementation fixture |
| 仕様準拠・どこから推測か | 6、7、19 | grounding、決定出所、証拠範囲 |
| Relation Checker | 6、付録B | relation別質問とspecific sufficiency |
| 既存jev-crosscheckとの共存 | 1.4、3、10、16 | 明示入口と自動送信の分離 |
| pi-warden等の公開実践 | 18 | candidate→replay→介入評価 |
| 日本語対応・翻訳による解釈混入 | 6、8、22 | 原文保持と日英対照評価 |
| Claude Code HookとしてのWarden | 10 | Classicを代替adapterとして隔離 |
| Claude Modsの活用 | 1、3、10、20 | host-managed effect middleware |
| Skill Suggestion | 5.7、18、19 | relative rank＋absolute fit |
| jev-ultrafastのdynamic action space | 3、9、18 | operation候補とbranch別head |
| Cookbookの幅広い利用 | 5、18 | 検索、構造、反証、手順、次の観測 |
| 自己進化・自動フィードバック | 4、11〜15 | Episode、候補、独立評価、採用／撤回 |
| 故障しても続くworker | 11、付録C | 永続queue、lease、再帰防止 |
| 大まかな計画・最初の一歩 | 21、25 | Phase 0→証拠十分性の閉ループ |
| 型・設定・実装への引継ぎ | 7、20、付録A〜C | コンパイル可能な内部契約の叩き台 |

### 26.2 v0.1からの主な更新

1. **Classic Hook中心からMod中心へ。** 即時制御とUIはhost管理下のModへ移す。外部Labは耐久記録と改善実験を担当する。Coreはどちらにも属さないpure logicとして保つ。
2. **Node環境という前提を修正。** 公開型はModにNode／DOMがないと明記する。Node用Jev SDK・SQLite driver・file systemはLab側へ置くか、`$`に適合したtransportへ分ける。
3. **effect chainの前後と権限を具体化。** nextの呼出回数、cancel、pinned origin／provider、他Modによる書換え、自身の副作用の再帰を契約に追加する。
4. **今回参照したCookbookパターンの取り込み先を記述。** 成功例の紹介ではなく、Wardenへの適用箇所と評価上の限界を表にする。
5. **自己改善の実装契約を拡張。** ラベル由来、時間境界、候補比較、採用権限、再帰防止、削除と派生policy、task効果の比較まで含める。
6. **実装計画と受入IDを追加。** 機能の羅列ではなく、最小の閉ループを段階的に完成する計画へする。

### 26.3 過去の説明から持ち込まない前提

- Modsが普通のNodeプロセス内で動くという断定、SDKをそのままimportできるという仮定。
- user Modがすべてのmanaged policyより外側にいるという仮定。
- `allow`、`next(e)`、何も返さない、を同じ意味として扱うこと。
- 32問等をJevの永久的なAPI上限と決めつけること。
- confidenceを正答率とみなすこと、複数質問を独立した証人の多数決とみなすこと。
- `assumed`、`ambiguous`、`absent`を互いに排他的な一軸へ押し込むこと。
- 先行実装の自己報告や一つのbenchmarkを、Wardenの有効性として引用すること。
- 良いclassification、ユーザーの無反応、hold後の承認をそのまま介入成功のground truthにすること。
- 任意のtest成功、JevのDONE、agentの完了報告だけで全要件の完了を認めること。

本書はv0.1の機能的な内容を保持しつつ、上記の前提を更新した統合版である。旧版は履歴として保存し、本書によって黙って上書きしない。

<a id="s27"></a>

## 27. 参照資料と確認記録

参照日は2026-09-18。以下は設計の根拠と発想元であり、Jev Wardenの実装・性能・安全性が検証済みであることを示すものではない。動的なURLは更新され得るため、実装時に対象版を固定する。コードは取得時のblob hashを併記した。

**内部資料：** 既存の`jev-warden-design-v0.1.md`を全文読み、設計提案を引き継いだ。v0.1は本書で検証すべき設計の前身であり、外部APIの一次資料ではない。会話中の追加方針は第26章へ対応付けた。

- **[S1](https://code.claude.com/docs/en/hooks) Claude Code — Hooks reference** — 今回確認。Classic Hookの契約は対象CLIで再検査する。
- **[S2](https://code.claude.com/docs/en/plugins-reference) Claude Code — Plugins reference** — 今回確認。Plugin構成・データ領域・削除条件。
- **[S3](https://docs.typesafe.ai/primitives) TypeSafe — Primitives** — 今回確認。Choice／Score／Noul、共有state、質問の独立性。
- **[S4](https://docs.typesafe.ai/confidence) TypeSafe — Confidence** — 今回確認。confidenceの意味と領域別評価。
- **[S5](https://docs.typesafe.ai/cookbooks/autoresearch_feature_discovery) TypeSafe — Autoresearch feature discovery** — 今回確認。質問と数値特徴を改善するループ。Wardenの有効性を実証する資料ではない。
- **[S6](https://code.claude.com/docs/en/plugin-evals) Claude Code — Plugin evals** — 今回確認。Plugin比較・ローカルreport設定。
- **[S7](https://github.com/annenpolka/skills/blob/main/jev-crosscheck/SKILL.md) annenpolka/skills — jev-crosscheck/SKILL.md** — 今回全文確認。blob df31ddde532a5a26f013d7889bbc3c21be56eda9。
- **[S8](https://docs.typesafe.ai/cookbooks/skill_suggestion) TypeSafe — Skill suggestion** — 今回確認。候補ランキングと候補別の適合確認。
- **[S9](https://github.com/anthropics/claude-code/blob/main/mods/README.md) Anthropic — Mods README** — 今回全文確認。blob 34ccd54c7a47c6f868a54890b0c424be4ab55464。
- **[S10](https://github.com/anthropics/claude-code/blob/main/mods/types/claude-code.d.ts) Anthropic — Generated Mods declarations** — 今回冒頭1〜210行を確認。生成元2.1.273。blob d7d4073618a6a82cf2d39427f4c0f11993c3ea17。全宣言を監査した意味ではない。
- **[S11](https://github.com/anthropics/claude-code/blob/main/mods/sec-default/README.md) Anthropic — sec-default README** — 今回全文確認。blob 7152f7e96f749a5bd705ca52cd76cb9b4f5cd3ee。
- **[S12](https://docs.typesafe.ai/patterns/fan-out) TypeSafe — Speculative fan-out** — 今回確認。分岐候補の投機的な質問。
- **[S13](https://github.com/browser-use/jev-ultrafast/blob/main/README.md) Browser Use — Jev Ultrafast README** — 今回全文確認。blob 0a4639dc13b8a1eef4d9beb8de839a7b0c28ffa3。ブラウザ実行と速度を今回再現したわけではない。
- **[S14](https://docs.typesafe.ai/primitives/noul) TypeSafe — Noul** — 今回確認。Yesの確率、criteriaの書き方。
- **[S15](https://docs.typesafe.ai/cookbooks/semantic_find) TypeSafe — Line-by-line search** — 今回確認。実在する行と質問の関係。
- **[S16](https://docs.typesafe.ai/cookbooks/hierarchical_classification) TypeSafe — Hierarchical classification** — 今回確認。階層を辿る候補探索。
- **[S17](https://docs.typesafe.ai/cookbooks/classifying_rag_passages) TypeSafe — Classifying RAG passages** — 今回確認。関連・支持・矛盾・注入指示の分類。
- **[S18](https://docs.typesafe.ai/cookbooks/function_calling) TypeSafe — Function calling** — 今回確認。関数と閉じた引数集合の判定。
- **[S19](https://docs.typesafe.ai/cookbooks/autoformat) TypeSafe — Structure recovery** — 今回確認。原文ブロックに構造を付ける。
- **[S20](https://docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook) TypeSafe — Pre-parsed value extraction** — 今回確認。抽出済み候補から値を選ぶ。
- **[S21](https://docs.typesafe.ai/cookbooks/entity_alignment) TypeSafe — Entity alignment** — 今回確認。別資料の対象・属性を照合する。
- **[S22](https://docs.typesafe.ai/cookbooks/citation_check) TypeSafe — Double-checking citations** — 今回確認。引用の実在と意味的な支持を分ける。
- **[S23](https://docs.typesafe.ai/cookbooks/sde_cascade) TypeSafe — SDE cascade** — 今回確認。フィールド別の検証とescalation。
- **[S24](https://docs.typesafe.ai/cookbooks/classification_using_confidence) TypeSafe — Classification using confidence** — 今回確認。粗い粒度への退避。
- **[S25](https://docs.typesafe.ai/cookbooks/consistency_choice_cookbook) TypeSafe — Self-consistency** — 今回確認。繰返し判定の安定性と正しさを区別する。
- **[S26](https://docs.typesafe.ai/cookbooks/parallel_questions) TypeSafe — Parallel questions** — 今回確認。独立した複数質問の一括評価。
- **[S27](https://docs.typesafe.ai/cookbooks/rerank_typesafe) TypeSafe — Re-ranking** — 今回確認。queryに対する文書の関連性。
- **[S28](https://docs.typesafe.ai/cookbooks/date_extraction_cookbook) TypeSafe — Date extraction** — 今回確認。候補や構造を利用する日付抽出。
- **[S29](https://docs.typesafe.ai/cookbooks/llm_guardrails) TypeSafe — LLM guardrails** — 今回確認。狭い意味的なguard判断。
- **[S30](https://github.com/DevMortimer/pi-warden/blob/main/docs/guards.md) DevMortimer/pi-warden — Guards** — 会話中に取得した一次資料を参照。今回の再計測・全実装監査なし。
- **[S31](https://github.com/MrDesjardins/jevrealtimecodecheck/blob/main/README.md) MrDesjardins/jevrealtimecodecheck — README** — 会話中に取得した一次資料を参照。new violationと二段階の局所化。
- **[S32](https://github.com/TinyFrontier/wince/blob/main/README.md) TinyFrontier/wince — README** — 会話中に取得した一次資料を参照。review注意度と実験結果の扱い。
- **[S33](https://github.com/kunchenguid/firstmate/blob/main/docs/verification/dispatch-resolve.md) kunchenguid/firstmate — Dispatch verification** — 会話中に取得した一次資料を参照。rule matchとコード側のdispatch。
- **[S34](https://github.com/gargpratyush/jev-router/blob/master/README.md) gargpratyush/jev-router — README** — 会話中に取得した一次資料を参照。tier提案とrouting policy。
- **[S35](https://docs.typesafe.ai/agent-skill) TypeSafe — Agent skill** — 今回確認。質問・ワークフロー設計をエージェントへ教える資料。
- **[S36](https://docs.typesafe.ai/models) TypeSafe — Models and pricing** — 今回確認。モデル表記・料金・変動し得る制限。実アカウント請求の検証ではない。
- **[S37](https://docs.typesafe.ai/llms.txt) TypeSafe — Documentation index** — 今回確認。Jev 1.13 jaggednessへの索引は存在するが、その本文の再取得は失敗した。本文固有の知見を確定根拠にしない。

### 27.1 確認の限界

外部仕様は文書・公開コードから確認した。ユーザーのClaude Codeのインストール版・feature gate・利用権限、Jevの実アカウント・請求・応答品質は確認していない。Claude Modを実際にloadしたり、workerを起動したり、Jevや生成モデルを課金実行したりしていない。

先行実装の校正や速度は作者側の資料であり、本システムへの移植効果ではない。本書の受入条件と評価ループが、その効果を別途確認するための計画である。

### 27.2 再確認のルール

実装前にdoctor用のhost capability manifestを作り、バイナリ版、生成型hash、Mod manifest、必要な`$`能力、CoreとPolicyBundleのschemaを保存する。更新時は差分と契約テストを取り直す。動的なモデルaliasを使う場合も返却モデルを記録する。

<a id="appendix-a"></a>

## 付録A. 中核データ型の叩き台

以下は**本システム内部**の契約案であり、Claude Mods APIやTypeSafe SDKの型を模倣した宣言ではない。外部adapterが実際の入力を検証してこの形式へ変換する。実装ではIDのbrandやruntime schemaを追加してよい。

```typescript
export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type Id = string;
export type Hash = string;
export type IsoTime = string;

export interface ContextKey {
  sessionId: Id;
  agentId: Id | null;
  worktreeId: Id;
  snapshotId: Id;
  policyVersion: Id;
}

export interface Origin {
  kind: 'user' | 'model' | 'warden' | 'experiment' | 'audit' | 'other_plugin';
  pluginId?: Id;
  experimentId?: Id;
  parentJobId?: Id;
  // Origin is observation provenance, not an authorization grant.
}

export interface EventEnvelope {
  id: Id;
  context: ContextKey;
  origin: Origin;
  eventName: string;       // Normalized internal event, not guessed host API.
  hostContract: Id;
  sequence: number;        // Local sequence; not a global causal clock.
  occurredAt: IsoTime;
  observedAt: IsoTime;
  parentEventId?: Id;
  toolCallId?: Id;
  requestedInputRef?: Id;
  effectiveInputRef?: Id;  // Absent when it could not be observed.
  outcome: 'requested' | 'returned' | 'denied' | 'failed' | 'cancelled' | 'unknown';
  payloadRef?: Id;
}

export interface EvidenceRef {
  id: Id;
  contentHash: Hash;
  localObject: Id;
  source: {
    kind: 'user_text' | 'source_file' | 'spec' | 'test' | 'execution' | 'model_output';
    identity: string;
    revision?: string;
    locator?: { startLine: number; endLine: number };
    speaker?: 'user' | 'assistant' | 'tool';
  };
  coverage: 'complete_for_scope' | 'truncated' | 'partial' | 'missing' | 'unknown';
  scopeDescription: string;
  acquiredAt: IsoTime;
  snapshotId?: Id;
  consentScopeId: Id;
  // A matching hash proves equality of captured content, not its truth.
}

export interface Claim {
  id: Id;
  text: string;
  sourceRefs: Id[];
  extractedBy: 'parser' | 'human' | 'model';
  status: 'candidate' | 'accepted_as_statement' | 'withdrawn';
  interpretation: string;
  semanticAssumptions: string[];
  requiredFactIds: Id[];
}

export type RelationKind =
  | 'evidence_supports_claim'
  | 'specification_grounds_behavior'
  | 'test_constrains_requirement'
  | 'report_matches_diff'
  | 'docs_match_code'
  | 'plan_aligns_action'
  | 'document_addresses_query';

export interface RelationProbe {
  id: Id;
  revision: Id;
  kind: RelationKind;
  sourceRefs: Id[];
  targetRefs: Id[];
  relevantContextRefs: Id[];
  requiredFactIds: Id[];
  questionRef: Id;
  inputBuilderVersion: Id;
  language: string;
}

export type TypedJudgment =
  | { type: 'noul'; probabilityYes: number }
  | { type: 'choice'; selected: string; probabilities: Record<string, number>; concentration: number }
  | { type: 'score'; value: number; probabilities: Record<string, number>; concentration: number };

export type Observation = {
  id: Id;
  probeId: Id;
  context: ContextKey;
  requestHash: Hash;
  requestRef: Id;
  startedAt: IsoTime;
  finishedAt: IsoTime;
  elapsedMs: number;
  fromCache: boolean;
} & (
  | { status: 'completed'; answer: TypedJudgment; rawResponseRef: Id; returnedModel: string }
  | { status: 'unavailable' | 'invalid' | 'cancelled' | 'superseded' | 'budget_exhausted'; errorCode: string }
);

export interface Finding {
  id: Id;
  observationIds: Id[];
  claimIds: Id[];
  missingFactIds: Id[];
  scope: ContextKey;
  state: 'open' | 'awaiting_evidence' | 'resolved' | 'withdrawn' | 'censored';
  resolution?: {
    kind: 'execution_confirmed' | 'source_confirmed' | 'counterexample' | 'user_decided';
    evidenceIds: Id[];
    explanation: string;
    resolvedAt: IsoTime;
  };
}

export interface VerificationReceipt {
  id: Id;
  checkId: Id;
  snapshotId: Id;
  inputHashes: Record<string, Hash>;
  runnerVersion: string;
  environmentHash: Hash;
  argv: string[];
  cwdRef: Id;
  outputRef: Id;
  startedAt: IsoTime;
  finishedAt: IsoTime;
  execution: 'passed' | 'failed' | 'cancelled' | 'unknown';
  exitCode: number | null;
  applicability: 'current' | 'stale' | 'unknown';
  observedTestIds: Id[];
  scopeDescription: string;
  concurrentMutation: 'absent_by_isolation' | 'observed' | 'not_excluded';
}

export type Intervention = {
  id: Id;
  findingIds: Id[];
  context: ContextKey;
  dedupeKey: string;
  arm: 'active' | 'candidate' | 'no_intervention';
  delivery: 'ui_only' | 'queued_for_model' | 'delivered_to_model' | 'not_delivered';
} & (
  | { kind: 'abstain' }
  | { kind: 'nudge' | 'request_review'; templateId: Id; evidenceIds: Id[]; actionCandidateIds: Id[] }
  | { kind: 'ask_permission' | 'deny_by_rule'; authorizationRuleId: Id }
);

export interface OutcomeLabel {
  id: Id;
  dimension: 'judgment' | 'artifact_quality' | 'intervention_utility' | 'user_intent';
  value: Json;
  provenance: 'execution' | 'source' | 'explicit_user' | 'independent_review' | 'weak_model';
  evidenceIds: Id[];
  obtainedAt: IsoTime;
  uncertainty: 'resolved' | 'disputed' | 'unknown';
  replacesLabelId?: Id;
}

export interface Episode {
  id: Id;
  groupId: Id;             // Keeps related tasks and derived fixtures in one split.
  decisionContext: ContextKey;
  decisionEvidenceIds: Id[];
  decisionCutoff: IsoTime;
  observationIds: Id[];
  interventionIds: Id[];
  outcomeLabels: OutcomeLabel[];
  outcomeState: 'pending' | 'observed' | 'censored';
  origin: Origin;
}

export type PolicyState =
  | 'candidate' | 'contract_checked' | 'replay_passed' | 'shadow'
  | 'experiment_passed' | 'canary' | 'active' | 'paused' | 'rejected' | 'retired';

export interface PolicyBundle {
  id: Id;
  parentId: Id | null;
  contentHash: Hash;
  schemaVersion: number;
  scopeId: Id;
  supportedHostContracts: Id[];
  supportedModelProfiles: Id[];
  probeRefs: Id[];
  selectorPlanRefs: Id[];  // Only pre-registered selector operations.
  advisoryRuleRefs: Id[];
  procedureRefs: Id[];
  causalHypothesis: string;
  trainingGroupIds: Id[];
  evaluationReportIds: Id[];
  state: PolicyState;
  // No permission grants, arbitrary command text, or promotion criteria.
}

export interface DurableJob {
  id: Id;
  kind: 'resolve_evidence' | 'build_episode' | 'propose_candidate' | 'replay' | 'task_experiment' | 'audit';
  inputRefs: Id[];
  inputHash: Hash;
  idempotencyKey: string;
  context: ContextKey;
  origin: Origin;
  grantRef: Id;
  budgetReservationId: Id;
  state: 'queued' | 'leased' | 'running' | 'retry_wait' | 'succeeded' | 'failed' | 'cancelled' | 'result_unknown';
  attempts: number;
  lease?: { ownerId: Id; expiresAt: IsoTime };
  outputRefs: Id[];
}
```

### A.1 検証で補うこと

TypeScript型だけでは、probabilityの範囲、分布の和、時刻の整合、IDの実在、権限、budget、重複、schemaの未知fieldを検査できない。永続化・API境界ではruntime validationを必須にする。

`accepted_as_statement`は「誰かがその主張をしたという抽出を採用した」意味であり、その主張が真という意味ではない。`complete_for_scope`も、明示した範囲に対する完全性であり、repository全体の完全性ではない。

<a id="appendix-b"></a>

## 付録B. 設定・request・policy例

すべて未実装の設定例または評価用入力例である。数値を埋めて有効化する前に、対象環境で契約を固定する。

### B.1 安全な初期設定

```json
{
  "schemaVersion": 1,
  "activation": "disabled",
  "projects": [],
  "automaticExternalTransfer": false,
  "consentScopeRef": null,
  "budgetsRef": null,
  "hostContractRef": null,
  "jevModelProfileRef": null,
  "learning": {
    "enabled": false,
    "automaticPromotion": false,
    "promotionPolicyRef": null
  },
  "retentionPolicyRef": null,
  "telemetry": "local_only"
}
```

鍵の値をこの設定へ書かない。実験workerへ秘密情報を引き継がせず、認証済みbrokerまたはhost側の許可された機構から取得する。

### B.2 特定の証拠不足を問うrequest

この例は、主張とコードの対応、および依存定義の存在を同じ材料で別々に問う。Jevの返り値の例は捏造して付けない。

```json
{
  "model": "jev-latest",
  "state": {
    "claim": "このテストは合計2回の呼び出しを検証している。",
    "test_code": "expect(client.mock.calls.length).toBe(EXPECTED_CALLS);",
    "source_scope": "test_codeは対象テストのassertionだけで、import先の定義は未収集。"
  },
  "questions": {
    "checks_two_calls": {
      "type": "noul",
      "instructions": "提示されたtest_codeは、claimにある合計2回の呼び出しを検証していると根拠づけられるか。",
      "criteria": {
        "true": "提示されたコードと定義から、期待される合計呼び出し回数が2回であると読み取れる。",
        "false": "提示されたコードと定義からは合計2回だと根拠づけられない、または別の回数を検証している。"
      }
    },
    "expected_calls_value_visible": {
      "type": "noul",
      "instructions": "test_code内で参照されるEXPECTED_CALLSの具体的な値は、未提示の定義や定数名からの推測に頼らず、提示資料から読み取れるか。",
      "criteria": {
        "true": "具体的な値、または値を決定する明示的な定義が資料内にある。",
        "false": "具体的な値を読むには、提示されていない定義や根拠を必要とする。"
      }
    }
  }
}
```

このrequestは関係の成立を問うもので、一般的なstatementの真偽と根拠の不足を区別して記録する。低い`checks_two_calls`だけで「実際の回数は2ではない」と言い換えない。実行回数の厳密な確認に移ったら、Jevではなく実際の定義と実行証拠を使う。

### B.3 仕様groundingの候補

以下は一つの原子的behaviorについてのChoice候補。仕様の状態と決定の出所は、このChoiceの外で別に持つ。

```json
{
  "type": "choice",
  "instructions": "提示されたspecificationがbehavior_claimをどのように根拠づけるかを分類する。implementation_reportの自己評価は根拠にしない。",
  "criteria": {
    "explicitly_required": "関連する明示規定が、この振る舞いを直接要求している。",
    "entailed": "直接の規定はないが、提示された明示条件を同時に満たすにはこの振る舞いが必要で、追加の設計前提を要しない。",
    "compatible_not_required": "この振る舞いと異なる選択肢の双方が、提示された規定と両立し得る。",
    "contradicted": "提示された整合的な規定がこの振る舞いを禁止する、または反対の振る舞いを要求している。",
    "indeterminate": "資料の不足、規定の衝突、解釈未確定等により、上記のいずれとも根拠づけられない。"
  }
}
```

`indeterminate`という逃げ道を作っても、必要な参照定義があるかをspecific sufficiencyで確認する原則はなくならない。規定間の衝突を発見した時は、任意のbehaviorを`entailed`と扱わない。

### B.4 CandidateBundleのmanifest例

```json
{
  "id": "candidate-example-001",
  "parentId": "policy-example-000",
  "schemaVersion": 1,
  "scopeId": "project-scope-example",
  "state": "candidate",
  "causalHypothesis": "値に依存する主張の評価前に、承認済みのdefinition selectorで定数定義を取得すると、根拠不足の見逃しを減らせる。",
  "changes": [
    {
      "component": "evidence_selector_plan",
      "operation": "use_registered_selector",
      "selectorId": "resolve-referenced-constant-v1"
    },
    {
      "component": "probe",
      "operation": "add_reference",
      "probeId": "specific-constant-sufficiency-v2"
    }
  ],
  "evaluationReportIds": [],
  "permissionChanges": []
}
```

これは完全な実行可能schemaではなく、候補の意味を示す例である。`permissionChanges`は常に空を要求し、未知の実行操作・未知field・未登録selectorをvalidatorが拒否する。候補自身に`active=true`を書くだけで採用される形式にはしない。

### B.5 自動採用profileの構成

採用profileはoptimizerから書換え不可とし、必須契約、品質の非劣性条件、効率上の改善条件、適用範囲、独立task数の評価方法、監査方法、canary、撤回条件、ownerを持つ。

サンプルとして固定の0.7や100件を正解値のように置かない。対象分布・risk・変動から人間が設定し、候補はその範囲内で比較する。

<a id="appendix-c"></a>

## 付録C. 故障時の扱いと運用runbook

### C.1 故障時の期待動作

| 状態 | Runtime／Labの扱い | やってはいけないこと |
|---|---|---|
| Jev timeout／429 | unavailableを記録し、advisoryは縮退、予算と限定retryを適用 | 問題なしとして通す、無制限retry、endpointを勝手に変更 |
| 不正な回答 | responseを安全に記録し、answerとして採用しない | 正規化して正常値に見せる、推測で埋める |
| Lab停止 | 許可されたspoolまたは記録欠損の表示、再起動後に再送 | 成功保存したと表示する |
| Mod reload／session終了 | scopeを閉じ、timerを解除し、未処理jobはLabに残す | 古いcallbackから新sessionに介入 |
| tool中断で副作用不明 | outcome_unknown、必要な観測へ | 同じmutationを自動再実行 |
| source更新 | observationをsuperseded、receipt適用性をstaleへ | 古い評価を現コードへ適用 |
| grant撤回 | 新しい実行・送信を止め、queueを再認可 | 過去の許可のまま遅延jobを実行 |
| budget上限 | 新しいjobを保留し、未確定課金を記録 | candidateが上限を拡大 |
| 評価結果不足 | shadow継続またはpaused | 無反応を成功labelにする |
| canary悪化 | 版を退役、次sessionのpointerを戻し、影響対象を列挙 | policy復帰を成果物復元と同一視 |
| 削除要求 | 実行停止、対象証拠と派生物の削除・失効、残存範囲の説明 | 共有hashの他scopeまで無断削除、外部送信済みデータを回収済みと表示 |

### C.2 初回導入の順序

1. 対象CLIで生成型と最小Modを確認する。必要機能と外部環境をdoctorで表示する。
2. 記録・外部送信・自動実験・自動採用を個別に設定する。APIキーの取得とデータ送信の承認は別にする。
3. offline fixtureでM01〜M07、D01〜D03を確認する。
4. 公開／合成データだけで実Jevの入力・返却モデル・失敗・費用を確認する。
5. 実プロジェクトではobserve-onlyから始める。内容・保存先・削除をユーザーが確認できるようにする。
6. 初期ラベルと評価基準が揃った範囲でadvisoryとlearningを有効化する。

この手順は毎回の呼出確認を要求しない。一度設定された内側ではworkerが自動で回る。

### C.3 継続運用

statusでactive policy、host契約、Jevモデルprofile、未解決件数、recording gap、queue、予算を確認する。採用・退役の説明は比較レポートと該当Episodeへリンクする。

学習停止、介入停止、記録停止は別の操作にする。緊急停止は全新規ジョブと副作用を止める。通常停止では処理中ジョブを安全に閉じ、結果不明のものを明示する。

host更新時は型を再生成して差分を調べ、native test、IPC統合、既存policyの回帰を行う。API契約が変わった時の自動fallbackは機能縮退として表示する。

### C.4 診断に必要な最小bundle

問い合わせ時にexportするのは、scopeを確認した匿名化fixture、host/Core/bundle版、request schema、safe error code、jobの状態遷移、必要な検証結果に限定する。全会話、全環境変数、認証ヘッダ、私的repository一式をデフォルトでexportしない。

### C.5 終了と削除

PluginのuninstallとLab service停止、ローカルデータ削除、OS資格情報削除は別々に確認する。保持設定に従って自動化できるが、残るプロセスやデータを隠さない。バックアップとWAL、採用済みbundleの由来、既に外部へ送信されたデータの扱いまで説明する。

<a id="appendix-d"></a>

## 付録D. 用語と一文での定義

| 用語 | この設計での意味 |
|---|---|
| Mod | Claude Codeのfunction hooksを利用するPlugin。Nodeアプリそのものではない |
| Core | host非依存の状態・関係・集約・policy判断のロジック |
| Lab | 永続記録、経験化、候補生成、実験を動かす外部worker群 |
| Kernel | 認可・予算・固定評価・採用の最小信頼基盤 |
| Probe | 特定の証拠集合へ投げる狭い意味的な問い |
| Observation | モデルまたは決定的処理が返した一回の観測と由来 |
| Finding | 追加調査・解決を管理する論点。複数Observationを束ね得る |
| Evidence | 原文や実行結果への版付き参照。内容hashだけで真実にはならない |
| Claim | 評価したい原子的主張。抽出の採用と真偽の確定は別 |
| Receipt | どの版・環境・範囲で何を実行し、何が確認できたかの記録 |
| Episode | 当時の判断条件と、後続の証拠・ラベルを分けて保持する学習ケース |
| PolicyBundle | 自動比較・採用できる質問・入力構築・advisory方針の版付きデータ |
| Grounding | 挙動や主張が、仕様のどの根拠に支えられるか |
| Sufficiency | 必要な特定事実が、示された材料から取得可能か |
| Shadow | candidateを走らせるが主作業へ介入しない観測 |
| Canary | 許可された限定範囲でcandidateを実際に使う段階 |
| Promotion | 固定基準を満たしたcandidateをactiveにすること |
| Rollback | 使用するpolicy版を戻すこと。過去操作の取り消しではない |
| Weak label | モデル等が付けた補助的な結果。独立した実証labelとは分ける |
| Censored | 観測期限まで結果が確定しなかったケース |
| As-of replay | 当時見えていた情報と許可に限定した再評価 |

**Jevを惜しまず意味観測へ使い、必要な根拠と次の観測を主モデルへ届け、結果から問い方・探し方・助け方を自動で磨き続ける、Claude Mods起点の自己改善型開発制御層。**

[S1]: https://code.claude.com/docs/en/hooks "Claude Code — Hooks reference"
[S2]: https://code.claude.com/docs/en/plugins-reference "Claude Code — Plugins reference"
[S3]: https://docs.typesafe.ai/primitives "TypeSafe — Primitives"
[S4]: https://docs.typesafe.ai/confidence "TypeSafe — Confidence"
[S5]: https://docs.typesafe.ai/cookbooks/autoresearch_feature_discovery "TypeSafe — Autoresearch feature discovery"
[S6]: https://code.claude.com/docs/en/plugin-evals "Claude Code — Plugin evals"
[S7]: https://github.com/annenpolka/skills/blob/main/jev-crosscheck/SKILL.md "annenpolka/skills — jev-crosscheck/SKILL.md"
[S8]: https://docs.typesafe.ai/cookbooks/skill_suggestion "TypeSafe — Skill suggestion"
[S9]: https://github.com/anthropics/claude-code/blob/main/mods/README.md "Anthropic — Mods README"
[S10]: https://github.com/anthropics/claude-code/blob/main/mods/types/claude-code.d.ts "Anthropic — Generated Mods declarations"
[S11]: https://github.com/anthropics/claude-code/blob/main/mods/sec-default/README.md "Anthropic — sec-default README"
[S12]: https://docs.typesafe.ai/patterns/fan-out "TypeSafe — Speculative fan-out"
[S13]: https://github.com/browser-use/jev-ultrafast/blob/main/README.md "Browser Use — Jev Ultrafast README"
[S14]: https://docs.typesafe.ai/primitives/noul "TypeSafe — Noul"
[S15]: https://docs.typesafe.ai/cookbooks/semantic_find "TypeSafe — Line-by-line search"
[S16]: https://docs.typesafe.ai/cookbooks/hierarchical_classification "TypeSafe — Hierarchical classification"
[S17]: https://docs.typesafe.ai/cookbooks/classifying_rag_passages "TypeSafe — Classifying RAG passages"
[S18]: https://docs.typesafe.ai/cookbooks/function_calling "TypeSafe — Function calling"
[S19]: https://docs.typesafe.ai/cookbooks/autoformat "TypeSafe — Structure recovery"
[S20]: https://docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook "TypeSafe — Pre-parsed value extraction"
[S21]: https://docs.typesafe.ai/cookbooks/entity_alignment "TypeSafe — Entity alignment"
[S22]: https://docs.typesafe.ai/cookbooks/citation_check "TypeSafe — Double-checking citations"
[S23]: https://docs.typesafe.ai/cookbooks/sde_cascade "TypeSafe — SDE cascade"
[S24]: https://docs.typesafe.ai/cookbooks/classification_using_confidence "TypeSafe — Classification using confidence"
[S25]: https://docs.typesafe.ai/cookbooks/consistency_choice_cookbook "TypeSafe — Self-consistency"
[S26]: https://docs.typesafe.ai/cookbooks/parallel_questions "TypeSafe — Parallel questions"
[S27]: https://docs.typesafe.ai/cookbooks/rerank_typesafe "TypeSafe — Re-ranking"
[S28]: https://docs.typesafe.ai/cookbooks/date_extraction_cookbook "TypeSafe — Date extraction"
[S29]: https://docs.typesafe.ai/cookbooks/llm_guardrails "TypeSafe — LLM guardrails"
[S30]: https://github.com/DevMortimer/pi-warden/blob/main/docs/guards.md "DevMortimer/pi-warden — Guards"
[S31]: https://github.com/MrDesjardins/jevrealtimecodecheck/blob/main/README.md "MrDesjardins/jevrealtimecodecheck — README"
[S32]: https://github.com/TinyFrontier/wince/blob/main/README.md "TinyFrontier/wince — README"
[S33]: https://github.com/kunchenguid/firstmate/blob/main/docs/verification/dispatch-resolve.md "kunchenguid/firstmate — Dispatch verification"
[S34]: https://github.com/gargpratyush/jev-router/blob/master/README.md "gargpratyush/jev-router — README"
[S35]: https://docs.typesafe.ai/agent-skill "TypeSafe — Agent skill"
[S36]: https://docs.typesafe.ai/models "TypeSafe — Models and pricing"
[S37]: https://docs.typesafe.ai/llms.txt "TypeSafe — Documentation index"
