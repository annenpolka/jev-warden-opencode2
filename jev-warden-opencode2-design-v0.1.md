# Jev Warden
## OpenCode 2 実装設計書

**OC2-0.1 · 2026-09-18 · 設計提案 / 未実装**

大量の意味観測を、原文・探索・検証・自動改善へつなぐ。

> **実装担当へ：** この資料の内部型とpolicy例は提案であり、OpenCode Pluginの動作済み実装ではない。公開APIの形状は固定ソースで確認した範囲だけを使い、未確認の寿命・順序・認可をdoctorと適合試験で確定する。

## 目次

- [0. 要旨・文書の位置付け](#s00)
- [1. 事実：確認したAPIと、断定しない境界](#s01)
- [2. 推測（示唆）：目的・非目標・固定境界](#s02)
- [3. 全体構成と、local／remote配置](#s03)
- [4. 共通CoreとPlatform Adapterの契約](#s04)
- [5. Plugin lifecycle・Effect・起動と停止](#s05)
- [6. Hook・eventの対応表と呼出順序](#s06)
- [7. User prompt・Skill推薦・原文保持](#s07)
- [8. モデル直前context・圧縮・補助request](#s08)
- [9. 権限・操作・完了の扱い](#s09)
- [10. 証拠・Receipt・Eventのデータモデル](#s10)
- [11. Relation Checkerとテスト設計の観測](#s11)
- [12. Jev transport・fan-out・先読み・予算](#s12)
- [13. 意味検索・検証計画・次の観測](#s13)
- [14. RPC：TUI・Labとの接続と認可](#s14)
- [15. Storage・outbox・複数sessionの整合性](#s15)
- [16. PolicyBundle・registry・reloadの安全な接続](#s16)
- [17. TUI・remote client・人間への説明](#s17)
- [18. Generation・worktree・隔離実験](#s18)
- [19. 経験化・自己改善・能動的フィードバック](#s19)
- [20. 評価・採用・監査と固定Kernel](#s20)
- [21. 技術構成・設定・配布・互換性](#s21)
- [22. 性能・費用・有用性の指標](#s22)
- [23. 受入試験・障害注入・検証マトリクス](#s23)
- [24. 実装ロードマップ：まず「育つ一本」を通す](#s24)
- [25. 実装調整役への引継ぎ](#s25)
- [26. 設計判断・未決事項・Claude Mods版との差分](#s26)
- [27. 参照資料・確認記録](#s27)
- [付録A. 内部契約例と検査方法](#appendix-a)
- [付録B. 設定・policy・doctorの例](#appendix-b)
- [付録C. 障害時runbook](#appendix-c)
- [付録D. 最初の一本の時系列](#appendix-d)


---

<a id="s00"></a>

## 0. 要旨・文書の位置付け

**OpenCode 2を第一級の実装先とするJev Wardenの設計書である。** 主モデルの作業を大量の意味観測で支え、その支え方を実際の成果と失敗から自動改善する。Claude Mods版の単なるAPI名置換ではなく、server/client分離、domain hooks、registry、Effect scope、RPCを前提に実装境界を引き直す。

本書は「Jev Warden 統合設計書 v0.2」[W0](reference/jev-warden-complete-design-v0.2.md)を継承する。共通の目的・証拠モデル・三つのループ・固定境界は維持し、OpenCode 2固有の契約は本書を優先する。Claude Mods版の入口と実行環境を上書きする文書ではない。

| 項目 | 状態 |
|---|---|
| 文書版 | OC2-0.1 / 2026-09-18 |
| 継承元 | 統合設計書v0.2。原本を変更せず、参照用コピーを同梱 |
| 調査baseline | anomalyco/opencode v2のcommit `a2594ddefb6557ecf7e7edb3e30ea50c71df8519` |
| ソース内package | `@opencode/plugin` / `2.0.7`。npm公開・手元のCLIとは別 |
| 実施済み | 公開docs・固定ソースの調査、本書作成、付録の純粋内部契約例のoffline検査 |
| 未実施 | OpenCodeのinstall／起動、Plugin load、実Jev・生成API、remote接続、worker稼働、policy採用 |

### 読み方

第1章は確認した外部事実と限界、第2章以降は**推測（示唆）・設計提案**である。後半の「必須」「禁止」はWardenの提案契約であり、OpenCodeに既に実装された保証ではない。コードを「公式API形状の説明」「擬似コード」「offline検査済みの独自契約例」に区別する。

最短の読書経路は、第1〜6章で接続を把握し、第10〜16章で実行・通信・policy境界を確認し、第19〜25章で自己改善と実装を進める。APIの詳細と質問設計を読む場合は第7〜13章へ進む。

### 守る中心命題

> Jevを惜しまず使う。節約するのは、主モデルの再読、依存するネットワーク往復、人間への割り込みである。
>
> 改善候補を作る主体と、その候補の成功条件・権限を決める主体を分離する。

Jevは番人だけではない。関連資料、反証、不足する定義、検証義務、仮説、Skill、次の観測を整える。自己改善は反省文の追加ではなく、次の処理を変える差分と、その差分の評価である。

<a id="s01"></a>

## 1. 事実：確認したAPIと、断定しない境界

### 1.1 固定したソース

本調査はv2 branchの特定commitを固定した。[OC01](https://github.com/anomalyco/opencode/commit/a2594ddefb6557ecf7e7edb3e30ea50c71df8519) package manifestには`@opencode/plugin`、`2.0.7`とあり、Promise入口、`/effect`、`/tui`のexportsがある。[OC02](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/package.json) これは**そのcommit内の宣言**であり、配布済みpackageやインストール済みOpenCodeの動作を検証した値ではない。

Promise APIは`Plugin.define({ id, setup })`、Effect APIは`Plugin.define({ id, effect })`である。Promise setupはcleanupを返せ、Effect側の登録はplugin scopeへ結び付く。transformのeditor callbackは同期処理であり、非同期データの取得はその外で行う。[OC03](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/README.md)[OC04](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/effect/README.md)[OC05](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/effect/plugin.ts)

### 1.2 Hookとregistryの重要な性質

固定READMEではhookは登録順に逐次実行され、後段は前段の変更を観測する。registryは変更後のread時に各transformを新しい値へ適用し、既に読まれた値は変更されない。通知や外部resourceの調整は、その値の再構築とは別である。[OC04](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/effect/README.md)

従って、`reload()`は全利用者のpolicyを一括・原子的に更新するAPIではない。どこまでが同じregistry instanceか、sessionとの対応、実行中callへの反映時点は、型と実機による適合試験を必要とする。

### 1.3 直接確認した接点

| 接点 | 固定ソースで確認したこと | それだけでは分からないこと |
|---|---|---|
| `session.hook("prompt")` | sessionID/messageID、mutable prompt、metadata、delivery | 元の入力の取得点、再実行、skill解決との正確な順序 |
| `session.hook("context")` | model dispatch前のsystem/messages/options/tools | 他plugin後の最終入力、永続履歴に副作用がないことの実機確認 |
| `session.hook("compaction")` | contextに加えてresultを指定できる型 | 資料保持・tool call整合性・取消時の全動作 |
| `tool.hook("execute.before")` | tool/inputの変更、session/agent/message/id | permission前後の最終順序、すべての実行経路の網羅 |
| `tool.hook("execute.after")` | `completed`＋result / `error`＋error | cancel・host crash時に必ず来ること |
| `permission.hook("evaluate")` | action/resources/source、effect/message | config denyの短絡、後段plugin、direct APIを含む最終強制 |
| `ctx.rpc.register` | typed registration、events.emit、Scope | 認証済み呼出主体、永続配送、停止後のendpoint存続 |
| `ctx.worktree` | 公開WorktreeApiとtransform/reload | OS sandbox、未commit変更の自動複製 |
| TUI plugin | 別入口、setup/cleanup、data/slot/panel/storage | 全surfaceの表示と現在の導入設定 |

参照：[OC06](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/effect/session.ts)[OC07](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/effect/tool.ts)[OC08](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/effect/permission.ts)[OC09](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/effect/rpc.ts)[OC10](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/effect/worktree.ts)[OC11](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/tui/index.ts)[OC12](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/tui/plugin.ts)[OC13](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/tui/context.ts)。

Toolの相関IDはこのソースでは`id: Tool.CallID`である。beforeのみ`Tool.Error`の型付き失敗を宣言し、afterの失敗型は`never`。afterのresult/errorをWardenが書き換えないという方針は、本書独自の制約である。[OC07](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/effect/tool.ts)

### 1.4 docsとソースの不一致を持ち込まない

同じV2 Plugins URLの取得結果に、`@opencode/plugin`を使う新しいdomain構成と、`@opencode-ai/plugin`／`ctx.catalog`を使う古い構成が混在した。[D01](https://opencode.ai/v2/docs/build/plugins) さらに古い例の`tools.add(name, value)`と、固定ソースの完全なtool値を渡す`tools.add(value)`は異なる。[OC03](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/README.md)

このため、以下を設計の実装手順とする。

1. インストール済みCLIとそれに対応するpackage・公開型を採取する。
2. 本書の固定baselineとの差分を作り、adapterの適合試験を実施する。
3. 不一致は明示的に更新・縮退する。都合のよい例を新旧混在で貼らない。

`permission.rules`等、オンライン説明にあって固定domain型で確認できないメソッドを前提にしない。`SessionContext`にexecutionIDやmessageIDを勝手に追加してホストが返す値と見なさない。

### 1.5 再取得できなかった資料

RPC docsは調査途中に取得でき、live-only通知、location、外部clientの説明を確認したが、後続の再取得ではcache missとなった。[D03](https://opencode.ai/v2/docs/build/plugins/rpc) TUI専用docsの本文取得も失敗し、公開ソースの必要範囲で補った。[D04](https://opencode.ai/v2/docs/build/plugins/cli)[OC13](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/tui/context.ts) Jev Cookbookの一部は既存v0.2から参照を継承しており、今回再実行・性能再現をしていない。[W0](reference/jev-warden-complete-design-v0.2.md)[J03](https://docs.typesafe.ai/cookbooks/skill_suggestion)[J04](https://docs.typesafe.ai/cookbooks/autoresearch_feature_discovery)

**取得失敗を機能不存在の証拠にしない。同時に、未取得の詳細をAPI仕様として補完しない。** sourceに存在すること、docsに説明があること、実際の環境で働くことは別の確認状態である。

<a id="s02"></a>

## 2. 推測（示唆）：目的・非目標・固定境界

### 2.1 成功の定義

同等の依頼、初期snapshot、主モデル、host条件で、成果の正しさを損なわず、根拠のない仕様補完、古い検証結果の流用、無効な再試行、手戻り、人間の訂正負担を減らす。読むべき資料と反証へ早く到達し、その助け方が手動の振り返り指示なしで改善されることを目標とする。

アラート数、Jev request数、テスト数、主モデルの自己評価を成功指標にしない。正しい指摘でも、既に予定された調査を繰り返すだけなら介入価値は低い。

### 2.2 非目標

OpenCodeをforkして独自agent本体に置き換えること、全作業をJevで代行すること、モデル重みの自己学習、すべての終了を同期的に阻止することは初版の目的ではない。汎用グラフDB、巨大DSL、全面的なprovider routingも先に作らない。

OpenCode PluginをOS sandboxと呼ばない。公開hook以外のprivate DB・内部サービスへ直接依存しない。利用できないhost能力を他の副作用でこっそり再現しない。

### 2.3 自動変更しない境界

固定Kernelが、ユーザーの目的・仕様・明示禁止、送信先と資料範囲、実行能力、認可条件、予算上限、採用基準、監査アクセス、停止操作を所有する。ユーザーは別の明示操作で変更できるが、最適化器が自分の成績向上のために変更してはならない。

```text
依頼 ≠ agentの計画
agentの報告 ≠ 観測された実行
Jevの確率 ≠ 確定事実
executionの成功 ≠ 要求の充足
正しい判断 ≠ 有益な介入
registry reload ≠ session policyの安全な切替
worktree ≠ sandbox
```

### 2.4 自動化する範囲

承認済みのproject・宛先・予算の内側では、意味観測、資料探索、対照fixture生成、隔離実験、比較、advisory policyの採用・撤回を毎回の確認なしで行う。scope外の資料取得、公開、credential変更、実行能力の追加は別の承認経路に戻す。

初版はpolicyをデータとして自動更新する。任意のJSやshellを生成してOpenCode server内へloadする自己改変にはしない。

<a id="s03"></a>

## 3. 全体構成と、local／remote配置

```text
ユーザー
   │
   ▼
OpenCode TUI ─── Warden TUI plugin（表示・ユーザー操作）
   │                    │ typed RPC + 再同期
   │ OpenCode protocol   │
   ▼                    ▼
OpenCode server / location
   ├─ 主モデルのsession
   └─ Warden server plugin（Effect adapter）
        ├─ event対応・session pin・online cache
        ├─ Warden Core（純粋TypeScript）
        ├─ Jev transportまたは同意済みbroker
        └─ 認証されたLab接続
                     │
                     ▼
Warden Lab（server側または承認済み別ホスト）
   ├─ SQLite / evidence files / outbox / durable jobs
   ├─ episode化 / candidate生成 / replay
   └─ 隔離executor
                     │
                     ▼
固定Kernel / Evaluator / Promoter
   └─ 検証済みPolicyBundle → 新しいsessionへ
```

| 部分 | 所有する責務 | 所有しない責務 |
|---|---|---|
| Server plugin | 公開hookの変換、即時調停、認可済みの資料取得、session内状態 | 唯一の永続job queue、任意の自動昇格 |
| Core | relation、入力選別、batch、状態遷移、介入・policyの純粋計算 | OpenCode/Effect/Nodeの直接import |
| TUI plugin | 表示、選択、状態照会、明示的操作の送信 | Jev鍵、独自学習worker、権限の最終判定 |
| Lab | 長期記録、ジョブ、候補生成、実験、履歴再評価 | ユーザー意思の創作、固定評価の改変 |
| Kernel/Promoter | grant・予算・固定基準・採用・失効 | 自分で作った候補の無検証採用 |

### 3.1 一つのrepoで始める

独立可能な責務であって、すべてを別serviceへ分割する指示ではない。Coreはserver pluginにもLabにも組み込める。最初はOpenCode serverと一つのLab、必要な時だけ実験workerを基本にする。

### 3.2 Remoteでは「どのマシンのパスか」を明示する

MacのTUIからWindows/LinuxのOpenCode serverへ接続する構成では、コード・tool・Jevへの送信判断はserver側のlocationに属する。TUIのcwdやkeychainを、serverの作業環境と同一視しない。

Labをserver側に置けば原資料をTUIへ送らずに処理できる。Labを別ホストに置く場合は、その転送もdata policyの対象。OpenCode接続が許可されたことは、Jev・Labへの追加送信の許可ではない。

### 3.3 障害時の独立性

TUIが落ちてもserverの主作業を止めない。Labが落ちた時はオンラインの助言を限定的に継続し、永続性の低下を表示する。OpenCode serverが落ちてもLabの比較・記録は残るが、hostを必要とするjobは待機へ戻す。固定の認可は各経路で維持する。

<a id="s04"></a>

## 4. 共通CoreとPlatform Adapterの契約

CoreへOpenCodeの生eventを渡さず、最小のdomain eventへ正規化する。Claude Mods adapterと同じ概念を共有するが、能力を最小公倍数に潰さず、使えない能力は明示的に表現する。[W0](reference/jev-warden-complete-design-v0.2.md)

### 4.1 識別子を分ける

```text
server_id             Wardenが識別する接続先server
server_epoch          再起動・世代変更の識別
plugin_instance_id    登録されたplugin instance
location_id           実際に実行するlocation
project_id / worktree_id
session_id / agent_id
execution_id?         hostで観測できる時だけ
message_id? / tool_call_id?
policy_id / policy_digest
snapshot_id
```

`ctx.location`は起動instanceの場所として扱い、それだけで受信する全sessionの実行場所を決めない。公開session情報とeventのlocation情報を照合し、解決できなければ`scope_unresolved`として原資料送信や実行を保留する。パス文字列やrepository名だけで同一性を判定しない。

同じsession IDが別serverにもあり得る前提でnamespace化する。parent sessionのgrantは子sessionへ無条件継承せず、委譲範囲との積を取る。

### 4.2 Capability Profile

adapterは起動時に能力を`verified / declared_only / unavailable / unknown`として報告する。

| 能力 | 縮退例 |
|---|---|
| dispatch前context補助 | TUIと明示ツールだけで提供 |
| tool before/afterの対応 | result eventとsnapshot照合、capture gap表示 |
| session原文の取得 | 自分のhook層で観測したdraftと出所を記録 |
| Skill選択の安全な追加 | 追加せず候補を推薦 |
| RPC streaming | polling＋snapshot/delta |
| isolated worktree | 実験を提案だけに留めるか外部executor |
| generation | 明示的に許可された外部reviewer adapter |
| 完了前の介入 | 次回contextへの所見かbounded follow-up |

能力不足を「正常に実行済み」と報告しない。`host unavailable`と`Jev unavailable`も別の障害として残す。

### 4.3 最小port

設計上のportは、`SourceReader`、`EventRecorder`、`JevEvaluator`、`GuidanceSink`、`SkillCatalog`、`CheckExecutor`、`GenerationPort`、`LabClient`、`Clock`、`GrantChecker`とする。存在するtool IDやsource IDから解決し、任意のshell文字列をCoreの判断値にしない。

これらはWarden内部名であり、OpenCodeの実在API名ではない。付録の型はこの内部境界だけを検査する。

<a id="s05"></a>

## 5. Plugin lifecycle・Effect・起動と停止

### 5.1 Effect版を第一候補にする

多数の独立した評価、event stream、取消、cleanupを扱うため、server adapterは`@opencode/plugin/effect`を第一候補とする。CoreはEffectへ依存させない。Promise版でも同じport契約を実装できる。[OC03](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/README.md)[OC04](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/effect/README.md)[OC05](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/effect/plugin.ts)

次は固定ソースに沿った**入口の形状説明**であり、本書でhostへloadしたコードではない。

```ts
import { Plugin } from "@opencode/plugin/effect"
import { Effect } from "effect"

export default Plugin.define({
  id: "jev-warden",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.session.hook("context", () => Effect.void)
  }),
})
```

実装時は対象releaseのEffect／plugin型で再確認する。疑似module宣言を作って「本物のpluginが型検査に通った」と扱わない。

### 5.2 起動順序

optionsのruntime validation、target APIのcapability確認、grant照合、Labとのhandshake、固定policyの取得、永続cursorの復旧を行う。最小の読み取りRPCと縮退statusはLab障害時にも説明可能にする。

hookを登録し、stream consumerと先読み処理をplugin scopeにぶら下げる。setupで無限streamをawaitして起動を終わらなくしない。Scope管理は永続ジョブの代わりではない。

### 5.3 責務別の停止

| 処理 | plugin unload時 | server終了後 |
|---|---|---|
| 即時Jev・prefetch | abort/interruptしてsupersededを記録 | 継続しない |
| hook登録・TUI subscription | dispose/cleanup | 継続しない |
| 未送信の観測 | 上限付きflush、未送信ならspool | 再起動後に回収 |
| 候補比較・長期学習 | durable jobとしてLabへ渡す | 承認済みLabが継続 |
| 副作用が不明な実験 | `result_unknown`、再照合 | 無条件再実行しない |

取消がproviderへのrequestや課金を取り消すとは限らない。`Promise.race`で待ちだけ終了して裏の通信を残す方式を、取消完了と呼ばない。transportの実際のabortとbudget accountingを別々に扱う。

### 5.4 Hot reload

old generationの処理結果がnew generationへ届く場合を想定する。epoch、policy digest、snapshotを比較して古い結果の適用を防ぐ。UI memoryの共有があっても、controller leaseとhandler重複登録を防ぐ。scope cleanupをfixtureで確認する。

<a id="s06"></a>

## 6. Hook・eventの対応表と呼出順序

### 6.1 Mapping

| OpenCode接点 | Warden内部event／役割 | 基準 |
|---|---|---|
| `session.hook("prompt")` | request draftの観測、Skill候補、先読み | [OC06](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/effect/session.ts) |
| `session.hook("context")` | dispatch前の証拠・反証・不足の調停 | [OC06](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/effect/session.ts)[OC04](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/effect/README.md) |
| `session.hook("compaction")` | 未解決事項と原文参照の保持 | [OC06](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/effect/session.ts) |
| `session.hook("generate")` / `"title"` | 補助requestとして区別 | [OC06](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/effect/session.ts) |
| `tool.hook("execute.before")` | 操作要求の記録、固定境界の確認 | [OC07](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/effect/tool.ts) |
| `tool.hook("execute.after")` | completed/error、証拠更新 | [OC07](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/effect/tool.ts) |
| `permission.hook("evaluate")` | 元のeffectを弱めない再判定 | [OC08](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/effect/permission.ts) |
| `ctx.event` | 公開eventからsession状態を補足 | [OC05](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/effect/plugin.ts)。event unionは対象版で固定 |
| `ctx.shell` | shell domainの観測・補助 | [OC05](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/effect/plugin.ts)。具体hook形状はdoctor待ち |
| registry `transform` / `reload` | 安定tool wrapper等の登録 | [OC03](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/README.md)[OC04](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/effect/README.md) |
| `ctx.rpc.register` | TUIと外部clientへの状態API | [OC09](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/effect/rpc.ts) |

`session.execution.started/succeeded/failed/interrupted`は、前段の調査で候補となったevent名である。**本書で読み切った固定型にそのpayloadは含まれないため、公開event unionとの照合項目として扱う。** 名前を文字列で握り潰して「subscription成功」としない。

### 6.2 一つの理想順序をホストの保証と混同しない

Wardenの論理順序は、依頼観測→context準備→操作の認可→実行→結果記録である。しかしOpenCode内部のpermissionとexecute.beforeの最終順序は実機で確認する。後段pluginがinputを変更できるので、Wardenが見たrequested inputと実行されたeffective inputを同じにしない。

最終inputの出所が取れない場合は`effective_input_unknown`を残す。before段階で観測した引数だけから強いVerificationReceiptを発行しない。

### 6.3 before / after / interruption

beforeは`id`、session、agent、messageで対応付ける。afterが成功でも、実行した要求・対象snapshotと一致することを別に確認する。エラー時は元のエラーを保ち、Wardenの記録エラーを代わりに投げない。

```text
requested → dispatched → completed
                       ├→ error
                       ├→ interrupted_outcome_unknown
                       └→ capture_gap
requested → denied_before_dispatch
```

cancelの専用after形状を捏造しない。afterが来ない場合は一定の期限とhost状態の照合でunknownへ閉じる。「eventがない」ことを「実行がない」に読み替えない。

### 6.4 CodeMode・MCP・shellの網羅性

通常toolだけでなく、MCP、CodeMode、shell内部の複数操作、外部terminal、subagentを適合試験に含める。outer tool一件の観測しか得られない経路は、その粒度を明示する。

shell文字列のregexを完全な副作用解析としない。CodeModeにtoolが登録されたことと、その中の実行がすべて同じhookを通ることは別の契約である。未観測経路はsnapshot比較とcollectorで補い、網羅性を誇張しない。

<a id="s07"></a>

## 7. User prompt・Skill推薦・原文保持

### 7.1 promptを権限の創作に使わない

`SessionPrompt`にはmutableなpromptとmetadataがある。[OC06](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/effect/session.ts) しかし変更できることを、元のユーザー依頼をWardenの説明へ置き換えてよい理由にしない。初版では本文は変更しない。

可能なら公開履歴APIで元の入力を取得する。自分のhookまでに他pluginが変更している可能性を排除できなければ、`observed_prompt_draft`として層と時点を記録する。原文が取得できない時に`original_user_request`と名付けない。

日常の補助はcontext hookへ送る。promptへのSkill ID追加も、永続入力に残るか、skill resolutionの前か、後段が変更するかを確認してから有効化する。

### 7.2 Skill選択の二段階

```text
現在の依頼 + 同意済みSkill catalog
   ↓
相対的な候補順位 / Skillを使う必要性
   ↓
候補の原文・適用条件
   ↓
要求を本当に実行できるか / 対象サービスは一致するか
   ↓
推薦またはnone
```

このパターンは既存設計で参照したSkill suggestionの考え方を継承する。[W0](reference/jev-warden-complete-design-v0.2.md)[J03](https://docs.typesafe.ai/cookbooks/skill_suggestion) winnerがあるだけで適合と見なさない。userが選択したSkillを削除しない。同じIDを重複追加せず、catalogの版と選択理由を保存する。

Skill本文には手順や実行要求が含まれるので、未知のSkillを勝手に導入・有効化しない。既に許可されたcatalog内の推薦と、外部packageのinstallは別操作。

### 7.3 初期実装の二つのモード

`recommend_only`を既定とし、contextまたはTUIへ候補と理由を示す。`attach_validated`は安全なSkill追加経路が実機検証でき、ユーザーが有効化した場合に限る。追加したSkillは普通のhost validation経路を通す。

導入デモとしてSkill推薦は小さく作れるが、それだけで自己改善のfirst sliceが完成したとはしない。本命の学習対象は証拠十分性である。

### 7.4 再実行と重複

prompt hookがexactly-onceであるとは仮定しない。session/message/deliveryの識別情報とpayload hashを使い、同じものを二度課金評価・二度追加しない。metadataは認可の根拠ではなく、出所が検証できた範囲の相関情報に使う。

<a id="s08"></a>

## 8. モデル直前context・圧縮・補助request

### 8.1 一時的な補助と永続記憶を分ける

context hookはsystem/messages/options/toolsを変更でき、固定READMEはdispatch直前の変更として説明する。[OC06](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/effect/session.ts)[OC04](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/effect/README.md) Wardenの設計では永続履歴を書き換えず、一回のdispatchへ必要な根拠だけを添える。最終的に永続履歴を変更しないことは適合試験でも確認する。

```text
既存のsystem / messages / tool contracts
          ＋
[Warden observations / not user instructions]
  現在有効な根拠
  関連する反証
  不足する定義
  許可済みの次の調査候補
  source / finding / snapshot / policy IDs
```

原資料内の命令を高優先度のsystem命令へ昇格しない。制御用封筒のtemplateは固定し、取得本文は引用されたデータとして扱う。userの明示指示、role、tool call/resultの組を消さない。

### 8.2 Injectionの一貫性

同じfindingを同じsnapshotへ繰り返し注入しない。request fingerprint、agent、policy、証拠digestを含むキーで記録し、retryや再dispatchで二重追加しない。

SessionContextに存在しないexecutionIDを仮定しない。公開eventから確定できるIDがなければ、Warden内部のdispatch sequenceを作り、`host_execution_id_unknown`と併記する。

助言が「供給された」ことと主モデルが実際にそれを採用したことは別。後続行動との対応を観測し、単なる配信を有効性labelにしない。

### 8.3 toolの見せ方

contextからtoolを隠すことは、主モデルの行動候補の制御であり認可ではない。主モデルに登録されていないtoolでも、他plugin・MCP・direct API等の別経路は存在し得る。固定Kernelは必要な実行経路に別途適用する。

初版はWardenが所有するwrapperの見せ方だけを変え、第三者のtool説明やschemaを勝手に変更しない。特にschema変更とexecutorの不一致を起こさない。

### 8.4 compaction

永続的な未解決事項と原文参照の正本はLabに残す。compactionに渡すのは小さなprojectionであり、圧縮結果だけを学習の唯一の証拠にしない。

`SessionCompaction.result`を与えるとモデルによる処理を置き換え得る型であるが、初版はresultを自作せず補助資料だけを追加する。[OC06](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/effect/session.ts) 圧縮中の取消、provider state、token会計、tool履歴との整合を確認するまで全面置換しない。

### 8.5 primaryとauxiliary

固定型ではmodel/http requestが`primary / compaction / title / generate`を区別する。[OC06](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/effect/session.ts) タイトル生成や補助評価に通常の「作業完了」probeをかけない。補助生成がまたWarden生成を起動する再帰を防ぎ、予算を別勘定にする。

HTTP/WSのbodyは原則触らない。streamを書き換える高度な機能は初版外とし、モデル設定やprovider endpointを自己学習bundleから変更できないようにする。

<a id="s09"></a>

## 9. 権限・操作・完了の扱い

### 9.1 非弱化の原則

permission hookでは入ってきたeffectをまず記録する。Warden自身はそれを弱めない。

| 入力effect | Wardenが採用してよい出力 |
|---|---|
| deny | denyのみ |
| ask | ask、または固定禁止に基づくdeny |
| allow | allow、固定承認条件に基づくask、固定禁止に基づくdeny |
| 未知の値／契約不一致 | 許可へ変換せずadapterを縮退し、固定方針に従う |

これはWardenの局所契約である。ホスト全体で最終denyが維持されるか、別pluginが後から書き換えられるかは別に検証する。[OC08](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/effect/permission.ts)[OC04](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/effect/README.md) 以前の調査で述べた「config denyではhookが呼ばれない」は今回の型だけでは確定できないため、受入試験へ移す。

`abstain`はevent.effectを変更しないこと。積極的にallowを返すことではない。Jevの高確率はask解除の理由にしない。`ctx.permission.reply`が型上存在することを、自動承認してよい根拠にしない。

### 9.2 Kernelとadvisoryの分離

scope外の操作や明示禁止は決定的に扱う。off-task、plan mismatch、stub、仕様推測等のJev所見はまず助言へ回す。正しい指摘でも、実装途中・探索中の行動を自動停止しない。

副作用のない資料参照を推すことと、DB reset・publish・mergeの実行は同じ扱いにしない。agentの「実行する予定」はユーザーの許可ではない。

### 9.3 直接実行経路

pluginがshell/processやモデルAPIへ直接アクセスする場合、native tool permissionが全経路を覆うとは仮定しない。Wardenのbrokerは自身のsource read、Jev送信、check実行にもgrant・path・予算を適用する。入力で渡されたsessionIDだけでauthorityを決めない。

他pluginから隔離されない同一server process内で、絶対的なtamper-proof境界を主張しない。強い隔離が必要な評価器・実験はOS境界へ置く。

### 9.4 完了は二つに分ける

host executionの終端と、要求を満たしたという主張の確認は別のeventとする。成功したexecution、正常なmodel response、テストコマンドのexit 0だけでは、要求全体を満たしたとしない。

初版には汎用の同期completion blockerを前提にしない。未検証事項はTUI・明示status・次回contextへ出す。自動follow-upを行う場合は別のopt-in能力とし、同じfinding/snapshotに新証拠なしで再起動しない。

### 9.5 Follow-upの競合制御

userの新しい入力が優先される。終了照合と新promptの競合では、execution tokenの比較、単一controller lease、送信直前のidle確認で調整する。follow-upにWarden起源を付け、ユーザーが言っていない文をuserの意思として保存しない。

公開`session.synthetic`等が存在しても、自動起動・delivery・取消の動作は実機確認する。[OC06](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/effect/session.ts) 対応しなければ、TUIのボタンまたは次回contextへ縮退する。

<a id="s10"></a>

## 10. 証拠・Receipt・Eventのデータモデル

### 10.1 正本は一つ、投影は複数

長期のevent、証拠、episode、policyと採用記録はLabが所有する。server pluginはhot cacheと処理中の相関、TUIは表示projectionを持つ。host storageとLab DBを二重の正本にしない。

| レコード | 主要fieldと責務 |
|---|---|
| EventEnvelope | server/epoch/location/session/agent、host IDまたは内部sequence、origin、policy、snapshot、時刻 |
| EvidenceRef | 原文・結果の内容hash、scope、資料版、行/節、話者、取得時点、送信許可 |
| Claim | 原子的主張、抽出元、前提、必要な定義、採用決定か仮説か |
| Observation | 実際のrequest/response参照、probe/input builderの版、返却モデル、raw確率、error、usage |
| Finding | 調査項目、依存証拠、複数Observation、解決状態、更新履歴 |
| VerificationReceipt | 固定対象、実行コマンド/runner、環境、結果、検証範囲、出所 |
| Intervention | 対象session/snapshot/policy、助言、根拠、配信経路、重複排除、後続反応 |
| Episode | 当時の情報と後続ラベルを分離、dataset group、評価arm |
| PolicyBundle | 親版、scope、schema、質問/収集/調停の設定、評価記録、互換性 |
| Job | 冪等性キー、lease、予算予約、親実験、grant、入力参照、処理状態 |

すべての自由文をeventに無制限コピーしない。原資料はscope別のcontent-addressed storeへ置き、必要な参照を持つ。同じbytesでもprojectや同意範囲が異なるなら、公開権限を共有しない。[W0](reference/jev-warden-complete-design-v0.2.md)

### 10.2 Requestedとeffective

beforeで観測したtool input、afterに載るinput、runnerが実際に使ったargvを別fieldに持てるようにする。異なる層の値を一つに上書きしない。最終argvが観測できない場合、推定した値を実行証明としない。

trusted runner receiptと、tool出力の文字列「all tests passed」は別の由来である。信頼した署名/プロセス境界がないローカル構成では、その限界を記録する。

### 10.3 検証の鮮度

source、test、fixture、config、lockfile、依存・runnerの版、実行環境をsnapshotへ結び付ける。HEADだけではdirty/untracked変更を表せない。

receiptの成功/失敗と、現在への適用性`current / stale / applicability_unknown`を分ける。実行中に対象が変わり得た場合、開始・終了hash一致だけで途中の変更を否定しない。強い証拠は固定snapshotで実行する。

未観測の外部変更がある場合は`capture_gap`を残し、再snapshotする。Jevの「この変更は関係なさそう」だけで失効を免除しない。依存を限定できない初版では保守的に広いsnapshot単位で失効させる。

### 10.4 時間とscope

`occurred_at`、`observed_at`、`resolved_at`を分ける。古いepisodeを評価する際、現在の最新版を当時の定義として補わない。server clockとclient clockの順序を直接比較せず、server sequenceと受信時刻の役割を分ける。

messageやexecution IDが分からない場合は`unknown`を許す。存在しないIDを生成してhost由来と見せない。Warden内部IDはprefix・名前空間で区別する。

<a id="s11"></a>

## 11. Relation Checkerとテスト設計の観測

### 11.1 最小単位

```text
R(source, target | question, assumptions, source_coverage)
    → typed observation + missing facts + source references
```

support、grounding、test coverageを初期の三族とする。docs/config整合、plan/action整合、query/document適合へ拡張できるが、全関係をgood/bad/unknownへ潰さない。

### 11.2 仕様と推測の境界

仕様上の根拠、仕様の記述状態、追加判断の出所、提示証拠の充足を別軸にする。曖昧な仕様に対する仮決定は正常に存在する。`assumed`を自動的なエラーにしない。

| 軸 | 観測例 |
|---|---|
| 根拠 | explicitly_required / entailed / compatible_not_required / contradicted / indeterminate |
| 仕様 | addressed / unaddressed_in_scope / ambiguous / internally_conflicting / scope_unknown |
| 決定 | adopted / provisional / unresolved / not_needed |
| 証拠 | sufficient / missing_definition / missing_source / truncated / stale / unknown |

「自然だからそうだろう」はentailedではない。明示前提を示せる必要がある。矛盾する規定から任意の挙動を正当化せず、適用範囲・優先順位・改訂を確認する。

### 11.3 具体的なsufficiency

一般的な「資料は十分か」より、主張が依存する事実を名指しする。

```text
対象のtest_codeには、EXPECTED_CALLSの定義が含まれ、
期待する合計呼出回数を名前から推測せずに読み取れるか。
```

必要な定義の存在を構文的に分かる場合はコードで確認する。どの定義が該当するか、同名別スコープではないかを意味判断で補う。資料が全くない場合は未評価とし、低い確率を事実否定として返さない。

### 11.4 テストの性質

守る契約、検出したい具体的な誤実装、許容する実装変更を先に特定する。観測点、assertionの識別力、mockの境界、期待値の出所、異常系・境界値を、その契約との関係で問う。

呼出回数や内部値への依存は、それ自体が悪ではない。例えば通知重複を防ぐ契約では回数の検証が必要になり得る。問題は、契約に不要な実装詳細を固定しているかである。

mutation後にテストが落ちても、型エラーやsetup障害であれば目的のassertionが回帰を検出した証拠ではない。実行の理由を区別する。

### 11.5 原文とstoryを分ける

agentの「仕様通りです」という報告は、spec→behaviorの判定には必要がなければ送らない。report→diffを別に検査する。原文、仮定、自分の結論を同じ入力fieldへ混ぜない。

仕様は日本語原文を保つ。翻訳を自動的な正本にせず、日英の質問差を調べる場合は同じ原資料への別probe版として記録する。日本語性能は評価対象であって保証ではない。

### 11.6 相対選択・絶対適合・二段階

最も関連する節を選べても、その節が主張を裏付けるとは限らない。candidateにnoneを含め、重要なら候補ごとの絶対適合も問う。複数節が必要なら小さな証拠集合を作る。[W0](reference/jev-warden-complete-design-v0.2.md)[J03](https://docs.typesafe.ai/cookbooks/skill_suggestion)

既にある証拠に対する独立質問は同時に投げる。答えによって新しい資料を取得する場合だけ二段目に進む。localizationは実在する節・diff block・test IDから選び、行番号や引用はコードで原文から解決する。

多くのedgeが支持されても、claim抽出の取りこぼしや未検査の変更は残り得る。全体の正しさへ推移的に拡張しない。

<a id="s12"></a>

## 12. Jev transport・fan-out・先読み・予算

### 12.1 接続の所有者

Jev keyはserver側transportまたは認証済みLab brokerに置く。TUI・agentの会話・PolicyBundleへ渡さない。接続先、モデル、送信許可、retry上限は固定設定で選び、認証失敗の回避としてendpointを勝手に変更しない。

OpenCodeの主モデルproviderをJev providerへ偽装しない。Jevは独立した判断APIであり、通常の文章生成APIとは分けて扱う。

### 12.2 多数の質問、小さいstate

同じsnapshotと許可範囲の必要証拠を共有できる質問をbatchにする。全会話と全diffを毎回渡すのではなく、複数の狭いstateへ質問を多く当てる。質問数を固定で32に制限する等の未確認の上限は設けず、対象API・SDK・アカウントの実際の上限をdoctorで確認する。[W0](reference/jev-warden-complete-design-v0.2.md)[J01](https://docs.typesafe.ai/primitives)[J02](https://docs.typesafe.ai/patterns/fan-out)

質問IDには意味を隠さず、instructionsだけで対象・関係・基準が分かるようにする。分岐先の質問を既に準備できる場合は投機的に評価し、選択した分岐の結果だけを使用する。

### 12.3 即時経路と先読み経路

即時経路はdispatchまでの期限を持ち、先読み経路は短命のscoped taskと耐久jobを使い分ける。deadlineを過ぎた結果は古いrequestへ押し込まず、対象snapshotがまだ有効な次の境界だけに使う。

bounded queueとconcurrencyを設け、古いsnapshotのpending batchはcoalesce/cancelする。捨てた事実は数える。callbackの数だけ無制限にrequestを作らない。

### 12.4 Cache

scope、snapshot、evidence hashes、probe定義、input builder、criteria、言語、仮定、model/request options、data policy版をキーに含める。同じ内容でも別scopeの結果を無許可で共有しない。

mutable model aliasのcacheは寿命と返却モデルを管理する。cache hitとfresh inferenceは別に記録し、安定性や校正の評価ではfreshな再実行を使う。policyを変更したのに旧結果を新policyの測定として数えない。

### 12.5 回答検証

Choice候補、質問ID、Scoreの尺度、Noulの範囲、finiteな値、分布、必要fieldを検証する。丸め許容は対象APIの契約に基づき固定する。無効な分布を黙って正規化せず、無効な値をsafe/passへ変換しない。

Noulには別のconfidenceを捏造しない。Choice/Scoreのconfidenceを正答率にせず、複数questionの回答を独立証人として多数決しない。[W0](reference/jev-warden-complete-design-v0.2.md)[J05](https://docs.typesafe.ai/confidence)

### 12.6 予算

Jev観測、生成review、候補生成、E2E主モデル、隔離実行、context tokens、保存容量を分ける。Jevへは広い観測枠を与え、重い評価をその外側で絞る。料金や固定の200ms等を保証しない。

全体上限はKernelが予約・清算する。複数sessionが別々に上限まで使って総額を超えないよう集約する。timeout時のusage不明はゼロ請求とせずunknown reservationを照合する。

<a id="s13"></a>

## 13. 意味検索・検証計画・次の観測

### 13.1 Semantic retrieval

文字列検索、シンボル索引、差分解析で候補を作り、Jevで意味を絞る。名前の類似だけで一つに決めず、仕様・実装・caller・testの探索経路を並行して残す。細部を特定できなければ粗いmodule範囲まで返し、未探索領域を記録する。

候補選択後に該当性を再確認する。検索失敗は仕様全体のabsenceではない。読み取り権限、path実体、symlink、remote locationを取得直前にもチェックする。

### 13.2 反証を届ける

現在の仮説を支持する資料だけでなく、矛盾する資料を別枠で主モデルへ出す。反証を無関係として消さない。検索した候補と除外理由を記録し、原文へ戻れるようにする。

### 13.3 型付きの補助操作

```text
find_definition(symbol_ref, snapshot)
read_source(source_ref, range)
inspect_callers(symbol_ref, snapshot)
compare_artifacts(source_ref, target_ref, relation)
suggest_checks(claim_refs, snapshot)
run_registered_check(check_ref, isolated_snapshot)
request_scoped_review(finding_ref, evidence_refs)
```

これらは独自portの設計名である。OpenCode APIをそのまま示すコードではない。Jevが実行候補を選んでも、brokerがgrant、実体path、版、前提条件、予算を再確認する。

### 13.4 Verification planner

要求の各behaviorに対し、仕様上の根拠、実装の観測点、testのassertion、現在のreceiptを結ぶ。不足するcellを可視化し、追加テストの量ではなく、具体的な誤実装を弾ける検証を選ぶ。

### 13.5 仮説と観測

実装不良、古い期待値、不正fixture、環境差等の仮説を併存させる。次に読む定義や実行するcheckが、どの仮説を区別するかを問う。失敗回数が増えても新情報を得ていれば停滞ではない。

Jevの値を厳密なベイズ事後確率や情報利得と呼ばない。探索を支えるheuristicとして扱い、実際に何が判明したかを保存する。

### 13.6 手順の再利用

有効な調査手順は開始条件、必要証拠、許可能力、停止条件、反例を持つ。成功traceの単純なmacroではない。新しい方法が必要なら生成モデルへ戻し、その方法の実行許可と評価は別に行う。

<a id="s14"></a>

## 14. RPC：TUI・Labとの接続と認可

### 14.1 Transportと権限を混同しない

OpenCodeのtyped RPCへWardenの読み取りcontractを載せる。fixed Effect型にはregister、events.emit、handlerのerror factoryがあるが、認証済みcaller identityやraw requestの取得はこの型から保証されない。[OC09](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/effect/rpc.ts)

従って、RPCが使えるだけで任意clientからのpromote/grant/executeを許さない。OpenCode serverの認証、transportの認可、Wardenのscope grantを別層にする。sessionIDをinputに含めただけでは、そのsessionへアクセスする権限の証明にならない。

### 14.2 読み取り契約

以下は独自contractの設計案。

| Method | 用途 | 注意 |
|---|---|---|
| `status` | service/adapter/policy/queueの状態 | credentialは返さない |
| `findings.list` | scope別の一覧 | page/cursorとserver scopeを検証 |
| `finding.get` | 観測・証拠参照 | 原文の閲覧grantを再確認 |
| `changes.since` | Labの確定sequenceから差分回収 | native event replayを仮定しない |
| `snapshot.get` | scopeの一貫した表示snapshot | cut sequenceを返す |
| `policy.describe` | active/pinned/candidateの説明 | 最適化器へ監査fixtureは返さない |
| `review.request` | 許可された有限review job登録 | idempotencyと予算reservation |

管理操作は別contract・別principal・別endpoint等の認可境界に置く。host RPCから認証主体を確実に取得できないなら、read-onlyに限定し、管理はLabの認証済みローカル経路へ分離する。

### 14.3 Eventは通知、正本ではない

```json
{"type":"findings_changed","serverId":"server-A","locationId":"loc-A",
 "sessionId":"session-A","sequence":84,"projectionVersion":3}
```

これは独自payload例である。通知は「変わったので取得せよ」とする。原文、token、full transcriptをbroadcastしない。RPC docsはlive-onlyで切断中のeventを失う説明だったため、Wardenは通知の欠落・重複・順序逆転を前提にする。[D03](https://opencode.ai/v2/docs/build/plugins/rpc)

### 14.4 再接続protocol

1. subscriptionを確立し、通知を一時bufferする。
2. `snapshot.get`で確定状態とcut sequenceを得る。
3. cutより新しいbufferと`changes.since`を適用する。
4. 重複はsequence/IDで除外し、cursorが古すぎればsnapshotからやり直す。

subscribeとsnapshotの間のrace、server epoch変更、location切替、permission撤回を試験する。Labのsequenceはscope内の確定順序であり、OpenCode native eventに同じcursorがあるとは仮定しない。

### 14.5 取消・errors・JSON

入出力はruntime schemaで検証し、型推論だけを信用しない。Effect RPC handler contextにPromise版と同じsignalがあると仮定せず、実際のScope/取消契約へ接続する。[OC09](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/effect/rpc.ts) cancelが副作用を取消したか不明ならjob IDで後から照合する。

公開errorはconfiguration / incompatible_host / scope_denied / unavailable / budget_exhausted / invalid_response / cancelled等に分類し、provider error body・鍵・送信資料をそのまま返さない。event payloadはobjectにする設計を採る。[D03](https://opencode.ai/v2/docs/build/plugins/rpc)

### 14.6 RPCとMCP

RPCはTUI・外部client・plugin間の制御通信、主モデルに見せる操作は登録済みtoolまたは必要時のMCPとする。モデルが任意の管理RPCを呼べる構成にしない。既存jev-crosscheckの明示手順は別入口として残す。

<a id="s15"></a>

## 15. Storage・outbox・複数sessionの整合性

### 15.1 保存先の責務

| 保存先 | 用途 |
|---|---|
| Server memory | 進行中call、短いcache、prefetch、controller状態 |
| Plugin-scoped storage | 接続設定参照、bounded spool、ack cursor。採用の正本ではない |
| Lab SQLite | jobs、episodes、interventions、bundle評価、active pointer、outbox |
| Lab evidence store | scope別の原文・snapshot・実行出力 |
| TUI storage | 選択panelや表示設定。model key・grant・全証拠は置かない |

plugin-scoped storageのdurabilityやtransaction特性は対象版で確認する。TUIではdurable storeとhot-reload用memoryが別に宣言されている。[OC13](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/tui/context.ts) どちらもLabの学習正本を二重化するためには使わない。

### 15.2 Outboxとingestion

server pluginが観測をLabへ送る際、scope、event ID、sequence、hashを持つ。Labは重複eventをidempotently保存し、確定後にackする。ack前にserverが落ちても再送できる。at-least-onceであってexactly-onceではない。

eventに個人情報が含まれ保存許可がない場合は、許可されたsummary/metadataだけを残す。記録欠落を`durability_degraded`または`redacted_capture`として可視化する。

### 15.3 Controller lease

同じsessionを複数TUIが開いても、推論・介入・学習jobは一回だけ作る。authoritative controllerをserver/session単位のleaseで管理する。UIが増えた数だけJev requestが増えない。

controllerが入れ替わったら世代IDを更新する。古いownerからの介入やjob completionは対象世代を確認する。leaseを持つこと自体はユーザーのgrantを代替しない。

### 15.4 キュー

```text
queued → leased → running → succeeded
                       ├→ retry_wait
                       ├→ failed
                       ├→ cancelled
                       └→ result_unknown
```

jobはscope、snapshot、policy、入力digest、grant版、親実験、budget reservation、lease期限を持つ。worker再起動後も期限とgrantを再確認する。定義探索は安全に再試行できても、外部作用を持つjobはまず実行状況を照合する。

### 15.5 削除・撤回・export

原資料が削除・送信不可になったら、cache、episode、生成fixture、policyの依存を追跡する。依存を持つcandidateの停止、active bundleの再評価や退役を行う。モデルproviderへ既に送信した情報をローカル削除だけで取り消せるとは言わない。

exportはscopeと保存許可を再検証する。secretや非許可資料が含まれるraw traceを一括ZIPへ混入しない。

<a id="s16"></a>

## 16. PolicyBundle・registry・reloadの安全な接続

### 16.1 一つのsessionに一つのpolicy

採用済みbundleをLabから取得し、schema・digest・scope・host/model互換性を検証する。session開始時にpolicyをpinし、通常の更新は新しいsessionへ適用する。既存sessionの評価中にcandidateへすり替えない。

```text
Lab active pointer: v12 → v13
既存session A: v12のまま
新規session B: v13
緊急失効: Aのadvisoryを停止し、理由を明示
```

roll backは次のpolicy適用を戻すことであり、過去のコード変更や外部操作を戻すことではない。問題版が関わった成果物には再確認を付ける。

server再起動は新しいsession開始とは限らない。既存sessionをresumeする時は、Labに保存した元のpolicy pinを復元する。新server epochへの対応を検証してから再bindし、復元できない場合はactive最新版へ自動置換せず保留する。旧epochの処理中結果は破棄するが、pinの履歴自体は失わない。

### 16.2 なぜreloadを採用ボタンにしないか

registry transformは順に再適用され、既読の値は変更されず、resource調整も別である。[OC04](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/effect/README.md) `tool.reload()`や`skill.reload()`が、全sessionのengine・tool契約・policyを一括で原子的に切り替える保証はない。

従って、学習bundleが採用されるたびに全registryをreloadしない。初版は安定したtool wrapperを登録し、そのexecutorがsession pinに対応する内部policyを参照する。context上の推薦・表示もsession別にする。

### 16.3 共存するtool schema

schemaを変更する必要がある場合は新しいversioned tool IDを使うか、安全な区切りでsessionを再開する。同じ名前のschemaだけを変えて、古いmodel callから新executorへ渡さない。

catalogのepoch、tool schema digest、active registrationsを記録し、外部pluginやhost更新によって前提が変わったら互換性確認を行う。session pinは外部registryの全変更を凍結する魔法ではない。

### 16.4 自動変更できるもの

質問・必要証拠の指定・許可済みselectorの設定・検索順序・batch・trigger・助言template・頻度・既存手順参照を対象とする。tool/moduleの任意import、新しいprovider、任意shell、権限上限の変更は対象外。

複雑な変種は一つの仮説ごとに分ける。質問と入力構築を一体変更するなら両方を版付けし、可能なら寄与を比較する。動作条件が変わった質問のraw確率を同じ意味の尺度として比較しない。

### 16.5 Transform実装

非同期に検証済み設定を取得し、immutable snapshotへ確定した後、同期transformで適用する。[OC03](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/README.md)[OC04](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/effect/README.md) transform内部でJevやLabを呼ばない。Wardenが所有しない登録を無断で削除せず、他pluginとの順序・同名衝突をdoctorで検出する。

<a id="s17"></a>

## 17. TUI・remote client・人間への説明

TUIは別entrypointのpluginであり、serverの判断処理を再実行する場所ではない。[OC11](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/tui/index.ts)[OC12](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/tui/plugin.ts) 原文・key・全traceをUIへ流す必要はなく、権限に応じたprojectionを表示する。

### 17.1 初版UI

```text
prompt footer:
  Warden / policy v12 / probes 31 / unresolved 2 / evidence stale 1

session panel:
  Findings | Evidence | Decisions | Experiments

detail:
  finding → claim → 原文参照 → Jev観測 → 後続の確認
```

固定型では`prompt.footer.status`、`session.panel`、`sidebar.content`等のslotがある。[OC13](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/tui/context.ts) 初期UIは既存slotへの追加を使い、appやprompt全体のreplaceを避ける。競合や使えないsurfaceでは独自pageまたはCLI/RPC照会へ縮退する。

### 17.2 操作案

`/warden`、`/warden-status`、`/warden-review`、`/warden-pause`、`/warden-lab`は設計上のcommand名。実際のkeymap/registration形式は対象版で確認する。pauseは観測・助言・学習のどれを止めるかを区別し、固定のnative権限を解除しない。

クリックで原文を取得する際もscopeを再検査する。TUIのconfirm dialogがtrueだったというpayloadだけで、新しいgrantやpolicy採用を認めない。認証されたユーザー操作としてserverの別経路で記録する。

### 17.3 二台のclient

同じserver/sessionへ二台接続してもcontrollerは一つ。panelや選択行はclient-local、findingとjobはserver/Labの正本。切断中の変化はsnapshot/deltaで回収する。session切替時は別scopeの内容を残さず、遅れたレスポンスも破棄する。

remote file pathはclientのローカルファイルとして開かない。server側source IDを介して取得・表示する。原文が非公開なら説明とlocatorだけを出す。

### 17.4 観測と通知を分離する

正常な多数の観測はpanelに集計し、主モデルへ全件注入しない。重要な反証・不足だけcontextへ渡す。UI表示成功は「主モデルが読んだ」証拠ではなく、context供給も「役立った」証拠ではない。

<a id="s18"></a>

## 18. Generation・worktree・隔離実験

### 18.1 小さな生成と自律作業を分ける

固定Plugin Contextは`generate` domainを持ち、session側にもgenerateがある。[OC05](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/effect/plugin.ts)[OC06](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/effect/session.ts) ただし署名と戻り型の詳細は、対象版のGenerateApiまで実装時に確認する。

セッション外の短い生成は、質問候補、原因診断、限定した説明に用いる。会話履歴やtoolsを自動的に持つレビューagentと同一視しない。非セッション生成が無課金・非記録・秘密であるとも扱わない。

資料を読んでコードを変更する実験は、別の有限session/jobとして扱い、開始状態、許可tools、停止条件、model、予算、originを指定する。主sessionのkey・履歴・全権限を丸ごと継承しない。

### 18.2 Worktreeは作業領域

公開worktree APIを使える場合は生成・一覧・削除をadapter化する。[OC10](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/effect/worktree.ts) Warden専用のためにhost全体のworktree providerを上書きしない。

worktreeを作っただけではmain作業のdirty/untracked変更が再現されたことにならない。固定commit、承認された未commit overlay、対象のuntracked files、fixture/config/lockfileを明示してsnapshotを構成する。コピー前後のmanifestを確認する。

### 18.3 OS境界

worktreeはfilesystem上の作業分離であって、credential、network、process、同一UIDからのアクセスの隔離ではない。依存install、テスト、mutationはcode executionとして扱う。

隔離executorは許可されたmount、制限したenv、network方針、CPU/時間/出力上限を持つ。監査fixtureと採用器の書込み権限を学習用agentに与えない。実験repo内のAGENTS.md等を読んでも、その内容で実験のgrantを拡大しない。

### 18.4 後片付け

jobごとの所有manifestとworktree IDを記録し、自分が作った対象だけを削除する。名前やpath prefixだけで破棄しない。使用中、未知の変更、ownership不明、結果不明ならcleanupを保留し、ユーザー領域を巻き込まない。

### 18.5 代表的mutation検証

```text
固定snapshot S1
  ├─ baseline test実行
  ├─ 具体的誤実装M1を隔離環境へ適用
  ├─ 対象test実行
  ├─ 失敗理由をrunnerとassertionで照合
  └─ receipt + finding resolution → episode
```

baselineから失敗している環境を、mutationが検知された成功例にしない。生成したmutationが契約上の誤実装であることも確認対象とする。

<a id="s19"></a>

## 19. 経験化・自己改善・能動的フィードバック

### 19.1 三つのループを最初から閉じる

```text
即時：event → 狭い証拠 → Jev fan-out → 根拠取得/助言
経験：観測 + 後続結果 → 確認/反証/保留 → Episode
改善：Episode → 変種生成 → 比較 → 採用/撤回 → 次session
```

人間が毎回「振り返れ」「質問を調整しろ」と言う運用にしない。所見が解決した時、同じ誤検知・見逃しが蓄積した時、強い反例が出た時、モデル/hostが変わった時に自動jobを起こす。何も警告しなかった作業からも少量の無作為監査を行う。

### 19.2 自分で確かめる

必要な定義の追加取得、仕様原文との照合、固定snapshotのcheck、具体的mutationを使って、不確実な所見を確かめる。ユーザーの意思や未決定仕様は実験では確定しないため、仮決定/未解決として残す。

Jevの同意を正解labelにせず、判断の由来を`direct_source / observed_execution / explicit_user_decision / weak_model_label / unknown`として残す。会話終了や苦情のなさは原則unknown。

### 19.3 当時の情報と、後から知ったこと

Episodeはdecision時点の入力と、後続のoutcomeを分ける。後から取得したEXPECTED_CALLS=3を、当時見えていたstateへ遡って入れない。

追加資料を読む候補policyを評価するなら、当時のsnapshot・grant・検索可能範囲から取得させ、その時間・費用も計上する。現在の最新定義を無料の情報として与えない。

### 19.4 改善対象

| 対象 | 候補の例 |
|---|---|
| question | 一問を分割、条件を明示、誤誘導を除く |
| input builder | 定数定義を含める、無関係なreportを外す |
| retrieval | 関連節・caller・fixtureの探索順を変更 |
| timing | 毎editではなくdispatch境界で集約 |
| guidance | 警告だけでなく次の具体的参照を添える |
| procedure | 成功した調査を条件付きの短い手順へまとめる |
| retirement | 効果のないprobeや重複通知を消す |

質問を直しても材料が足りなければ改善しない。入力構築も第一級の学習対象にする。通常コードで確実にできることを見つけたら、決定的な実装への移管を提案する。

### 19.5 Candidate生成

生成用モデルへ、開発用の失敗族、当時の入力、得られた証拠、悪化例を渡す。原因仮説、変更本体、適用scope、期待する改善、悪化し得るケース、必要な比較を出力させる。[W0](reference/jev-warden-complete-design-v0.2.md)[J04](https://docs.typesafe.ai/cookbooks/autoresearch_feature_discovery)

最初は小さな変種生成と固定比較を使う。GEPAや追加の学習モデルは差し替え点として残すが必須依存にしない。

### 19.6 メタモルフィックな検査

定義あり/なし、正しい/誤った値、識別子だけの変更、reportだけの追加、同名別スコープ等を比較する。どの入力変化に判断が反応すべきかを検査し、単なる同じ質問の多数決にしない。

自動変換が意味を保つとは限らない。対照ケースの期待関係を検証し、同じ原事例からの派生は同じdataset groupに束ねる。

<a id="s20"></a>

## 20. 評価・採用・監査と固定Kernel

### 20.1 Candidate lifecycle

```text
candidate → contract_checked → replay_passed → shadow
         → experiment_passed → canary → active
各段階 → paused / rejected
active → retired / rollback
```

この遷移は承認済み範囲内で自動実行する。候補が生まれるたび人間に承認を求めない。一方、証拠が足りなければ自動で保留する。

### 20.2 三層の評価

**契約評価**はschema、grant、出所、scope、取消、予算、通知量、snapshot、ID、policy非弱化等をofflineで確認する。

**判断評価**は固定ケースで情報不足の検出、relation分類、反証の取り逃し等を比較する。

**作業評価**は同じ初期環境から主モデルを動かし、候補版・現行版・Wardenなしで成果、時間、手戻り、介入負担を比較する。OpenCodeでClaude固有の`plugin eval`が使えるとは仮定せず、公開client/APIと隔離executorを使う独自harnessを設計する。

### 20.3 Dataset境界

Discovery、Development、Promotion、Auditを分ける。session、PR、task、元fixtureの派生が別集合へ漏れないようgroupを持たせる。大量のtool eventは大量の独立した作業成果ではない。

改善器が繰り返し見た評価ケースは開発データへ格下げする。hidden auditの詳細を候補生成へ戻したら、それ以降hiddenとは数えない。モデル差・host差・project差を分けて集計する。

### 20.4 採用条件

固定境界への違反がないこと、事前に決めた正しさの非劣性を満たすこと、その上で事前選択した有用性指標に改善があることを要求する。低い遅延だけで正しさを犠牲にしない。少数の成功例だけで閾値を普遍化しない。

候補数と評価回数を記録し、たまたま勝った候補の昇格を抑える。必要件数や効果幅は実測の変動・risk・task群から決め、本書に未検証の万能値を置かない。

### 20.5 評価器を実際に分離する

candidate generatorは監査fixture、grant、予算上限、active pointer、採用基準へ書き込めない。promptで「書き換えるな」と指示するだけでは分離ではない。別プロセス・権限・volume・限定APIを使う。

Warden Coreのschema checkを通ったことは、candidateの意味が正しい証拠ではない。モデルによるgraderを使う場合もweak labelとして別に監査する。

### 20.6 ロールバック

promoterが評価参照とactive pointerをtransactionで切り替える。事故で半分だけ公開しない。実行中sessionは通常pinを維持する。緊急のdata/grant違反ではそのbundleを失効し、advisory停止と対象成果物の再確認を行う。

文脈注入の影響は巻き戻しで消えない。旧版へ戻した事実と、既に影響したsessionの扱いを別に記録する。

<a id="s21"></a>

## 21. 技術構成・設定・配布・互換性

### 21.1 Repository案

```text
packages/
  core/                 純粋TS、状態・relation・batch・調停
  contracts/            内部event/JSON、RPC定義
  opencode-server/      Effect plugin adapter
  opencode-tui/         Solid/OpenTUI表示adapter
  claude-mod/           既存設計の別adapter。OpenCode型を漏らさない
  lab/                  durable jobs、候補生成、学習記録
  evaluator/            固定評価・採用
  executor/             隔離snapshotの実験
fixtures/
  host-contracts/
  semantic/
  tasks/
```

最初から全部を公開packageにしない。pure Coreとhost adapterの依存をbuildで検査する。CoreへEffect、OpenCode、Node、TUIをimportしない。server adapterの依存は対象OpenCode runtimeと照合し、LabのNode runtimeと同一視しない。[OC02](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/package.json)

### 21.2 設定

本資料にはserver pluginを明示的なlocal pathでloadする設定の**参考例**を付ける。`plugins`配列・optionsの形式はdocsにあるが、旧新docsの混在があるため、対象バイナリで適用を確認する。[D01](https://opencode.ai/v2/docs/build/plugins)

存在しないpublished packageをinstall手順として案内しない。`@opencode/plugin`のソース版2.0.7はregistry公開確認ではない。releaseのlockfile・exports・依存を検証してからセットアップコマンドを確定する。

TUI pluginの発見・install設定は別の適合項目。server設定と同じentryを入れれば両方loadされると仮定しない。サンプルJSONに架空のTUI設定keyを混ぜない。

### 21.3 初回有効化

初回にproject、server、location、送信可能資料、Jev/生成provider、予算、実験能力、自動採用範囲を確認する。設定にkeyを書かずsecret referenceを使う。停止・export・削除・失効の経路を先に提供する。

以後、その承認範囲の内側でループを回す。scope外へ広げる変更だけを再確認する。学習policyの更新でgrantを増やさない。

### 21.4 Doctor

| 記録項目 | 内容 |
|---|---|
| Host | CLI版/channel、server版、runtime、platform |
| Plugin | 実package版、型/lockfile digest、adapter版、登録順 |
| Capabilities | prompt/context/tool/RPC等の宣言と実測 |
| Identity | server epoch、location解決、session親子 |
| Execution | before/permission/after順序、cancel、CodeMode/MCP |
| Persistence | spool、Lab handshake、reconnect、storage寿命 |
| UI | remote接続、slot、二台client、headless |

`doctor.example.json`はテンプレートであり、runtime項目はすべて`NOT_RUN`。記載したsource情報だけが既知である。

### 21.5 更新

host API、plugin package、Effect、main/Jev model、Warden policyを別々に版付けする。自動dependency updateの直後に過去policyが同じ意味で動くと仮定しない。代表回帰とcompatibility testを通し、必要なら観測のみへ戻す。

<a id="s22"></a>

## 22. 性能・費用・有用性の指標

### 22.1 測定対象

| 層 | 指標 |
|---|---|
| Probe | 入力取得、queue待ち、Jev RTT、token数、batch幅、直列段数、schema error |
| Host | hookの追加遅延、cancelまでの時間、setup/cleanup、tool結果保存の影響 |
| Guidance | 注入tokens、通知件数、重複率、古い結果の破棄、採用された参照 |
| Evidence | capture gap、stale receipt、unknown outcome、source取得成功 |
| Task | 成果の正しさ、完了時間、再試行、手戻り、ユーザー訂正 |
| Lab | 候補数、評価待ち、E2E費用、昇格/退役、auditでの悪化 |
| UI/RPC | reconnect、delta追従、表示欠落、client数に対する重複処理 |

### 22.2 予算は別々に見る

Jevが安いから主モデルへ大量contextを注入してよい、とはしない。Jevの観測数とmain model cost、長いE2Eの費用は別に管理する。

複数の独立した候補を一気に評価する余地を残し、最初から少数questionへ絞りすぎない。冷接続/温接続、少数/多数質問、日本語/英語、単一/複数session、remote/localで実測する。

### 22.3 正しさと介入効果

Noul等の校正は正解が定義できる領域で測る。Brier/ECEや順位指標を採用する場合も、taskへの有用性とは別に報告する。質問の意味やlabelが変わった値を同じ曲線として結ばない。

同じsession内の多数callを独立標本として水増しせず、task/session/project単位で比較する。注入の有無は対照armで記録し、観測後に都合よく主指標を選び直さない。

### 22.4 目標値の確定

deadline、batch上限、queue枠、通知上限、監査率、minimum evaluation volumeは初期実測で確定する。本書は未実測の数値をSLAにしない。付録JSONの数値は説明用設定であり、性能・安全性を保証する推奨値ではない。

<a id="s23"></a>

## 23. 受入試験・障害注入・検証マトリクス

### 23.1 四つのテスト層

**Pure Core**ではpermission非弱化、scope/版照合、policy pin、通知dedup、queue状態を決定的に検査する。

**Host conformance**では実OpenCodeへpluginをloadし、型だけでは分からない順序・寿命・取消・権限・registry挙動を検査する。

**Semantic evaluation**では実Jevで情報不足、spec grounding、test拘束、反証、言語差を測る。

**Controlled E2E**では主モデルが固定作業を解く成果を旧版・候補版・無介入で比べる。

一つの層の成功を別の層の検証と称さない。本書に同梱するtestは第一層の小さな参照例のみ。

### 23.2 必須ケース

| 群 | 主なケース | 合格条件 |
|---|---|---|
| Prompt | 再送、複数plugin、元入力、Skill解決順序 | 元の意思を偽造せず追加は冪等 |
| Context | retry、auxiliary、compaction、tool pair | role/履歴整合を保ち一回分の補助だけ |
| Tool | completed/error、before失敗、cancel、after欠落 | 元結果を保持しunknownを正常に表す |
| Permission | deny/ask、前後順序、input変更、別plugin | Wardenが非弱化、全体未保証を検知 |
| Scope | 同名session別server、location移動、子agent | 違うscopeの資料と介入を混ぜない |
| Jev | 429、timeout、無効JSON、異常分布、遅延結果 | 未評価をpassにせずstaleを適用しない |
| RPC | 切断、重複、逆順、snapshot race、epoch変化 | durable stateから一貫して復旧 |
| Policy | v12/v13共存、global reload、緊急失効 | pinを保ち互換性を確認 |
| Storage | crash前後、ack喪失、disk full、削除 | 耐久性低下とgapを明示 |
| Experiment | dirty overlay、key混入、unknown mutation | 隔離し無条件再実行しない |
| Learning | hindsight leakage、同族fixture、無介入監査 | 独立性と原時点を保持 |
| TUI | 二台接続、client切替、headless、slot競合 | 二重推論せずscopeを保持 |

### 23.3 初版の最重要シナリオ

EXPECTED_CALLS未提示の例について、誤った確信→定義取得→反証→episode→候補生成→旧版比較→shadow→有限の作業比較→採用/保留までを、一度人間が有効化した範囲で通す。

**「テストで必要な定義を読み取れるようになった」だけでは、介入が有益になった証明ではない。** 定義取得が元々予定されていたケースや、追加取得が無駄になるケースも含める。

### 23.4 検証結果の表示

passed、failed、not_run、blockedを区別する。記録には何の型を何の環境で検査したかを残す。偽のhost宣言に対してtscが通った状態を、実plugin互換として表示しない。

全caseの機械可読一覧は`appendix/acceptance-matrix.json`に置く。実機試験のstatusは初期値`NOT_RUN`である。

<a id="s24"></a>

## 24. 実装ロードマップ：まず「育つ一本」を通す

### 24.1 Phase 0 — 契約を測るspike

空のserver plugin、最小TUI、単一sessionのevent観測とcontext補助を作る。対象releaseをpinし、doctorで登録順、scope、permission、取消、RPC、storageを確認する。必要ならPromise版で接続を確かめてからEffectへ寄せてもよい。

合格：元のOpenCode処理を壊さず、event→一件の判断→適切な補助/表示が一往復する。未確認機能を明記できる。

### 24.2 Phase 1 — 証拠基盤と普段使いの観測

EventEnvelope、EvidenceRef、VerificationReceipt、policy pin、Lab outbox、単一controller、TUI集計を実装する。Jevはsupport/grounding/coverageを観測だけする。ユーザーのファイルを書き換えず、context注入は限定する。

合格：再起動・複数session・切断を越えて、後から再評価できる材料が溜まる。

### 24.3 Phase 2 — 不足する根拠を取得する

specific sufficiency、definition/caller/spec検索、許可済みsource read、再判定を結ぶ。結果を支持・反証・保留へ分け、次の観測候補を返す。

合格：主張をただ警告するのでなく、一つの不確実性を解消し、由来付きの結果を保存できる。

### 24.4 Phase 3 — Labの改善候補を自動生成する

resolved findingからEpisode、対照fixture、失敗族、CandidateBundleを自動作成する。固定契約とreplay比較を行い、shadow評価まで回す。

合格：手動でpromptを修正しなくても、質問・入力構築・助言の候補と比較結果が生まれる。

### 24.5 Phase 4 — 自動採用と撤回

独立した作業評価、canary、固定promoter、active pointer、session別適用、rollback、悪化影響の追跡を実装する。

合格：良い候補を次sessionへ反映し、悪い候補を退役させ、停止後もjobを再開できる。評価不足なら保留できる。

### 24.6 Phase 5 — 領域を広げる

Skill推薦、反証検索、仕様の仮決定記録、verification planner、仮説比較、手順再利用を同じ経験・評価経路へ乗せる。個別機能ごとの独立した自己採点loopを作らない。

### 24.7 優先順位

Skill Suggestionは短い統合demoとして優秀だが、最初の自己改善対象をそれだけに変えない。中核の価値は「根拠不足を発見・補完し、その経験が次回の助け方を変える」ことである。

全候補の常時最適化、任意コード自己改変、global tool topology変更、凝ったUI、他host完全互換は後回し。原文・版・認可・当時の入力だけは最初から保存する。

<a id="s25"></a>

## 25. 実装調整役への引継ぎ

### 25.1 着手時の指示

この文書とv0.2を読み、現在のrepository・CLI・依存を正本としてdoctorから始める。宣言済み、docs記載、実機確認済みの三つを区別する。新旧OpenCode APIの例を混ぜず、使えないAPIを私有実装へ潜って代替しない。

実装は設計を全部一度に作るのではなく、Phase 0→1→2を優先する。ただしEvidence/Episodeの原時点とpolicy版を省略して、後から学習を付ける計画にしない。

### 25.2 作業分担

| 担当 | 出力 | 依存 |
|---|---|---|
| API/adapter | 固定型、適合fixture、server/TUI入口 | 対象release |
| Core/evidence | 純粋契約、scope/pin/receipt、unit tests | 最小EventEnvelope |
| Jev/retrieval | 入力構築、fan-out、specific sufficiency、probe fixtures | 証拠port |
| Lab/eval | outbox/jobs/Episode、比較、candidate | 契約と固定評価方針 |
| TUI | projection、再接続、説明、停止操作 | 読み取りRPC |

共有型の所有者を一つにし、並行作業で各自が別のscope/policy schemaを発明しない。最初のschema変更はレビューとmigrationを伴う。

### 25.3 完了報告に必要なもの

変更ファイル、固定したhost/package/schema版、実行したテスト、未実施のhost/Jev/E2E、実際に送った資料範囲、未解決の契約、縮退時の動作を報告する。実施していないAPI呼出、worker稼働、精度評価を補完しない。

ユーザーの指示なしにrepository作成、commit、push、公開、API課金、実ユーザーデータの送信をしない。本書作成はそれらの実施を意味しない。実際の実装タスクで別途与えられた明示的な権限は、その範囲で使用する。

### 25.4 最初のPR相当の範囲

実装環境が与えられた時の最初の変更単位は、plugin skeleton、doctor、純粋Coreのpermission/scope/pin、dummy transport、最小statusだけにする。次に実Jevの一件を接続し、最後に証拠取得を加える。巨大なrefactorと一緒に入れない。

コピー用の独立した引継ぎ文は`appendix/implementation-brief.md`に同梱する。

<a id="s26"></a>

## 26. 設計判断・未決事項・Claude Mods版との差分

### 26.1 ADR

| ID | 判断 | 根拠・帰結 |
|---|---|---|
| ADR-01 | OpenCode 2は第一級adapter | Core/Labを共有し、最小互換へ機能を潰さない |
| ADR-02 | Effect server + 別TUI | online処理のscopeと表示client寿命を分ける |
| ADR-03 | 固定commitをbaseline | docsの新旧混在を避ける。実releaseはdoctorで決める |
| ADR-04 | 原prompt不変、contextで補助 | 意思の出所を保ち、scope内の一時助言に限定 |
| ADR-05 | 安定wrapper + session pin | registry reloadをpolicy deployと同一視しない |
| ADR-06 | 通知ではなくLabが正本 | RPC切断でも再構成できる |
| ADR-07 | permissionは非弱化 | 学習による権限拡大をしない |
| ADR-08 | worktreeとsandboxを分離 | dirty snapshot再現とOS隔離を別契約にする |
| ADR-09 | 初版から閉ループ | 後付けの自己改善で原時点を失わない |
| ADR-10 | 評価器をoptimizerから分離 | 自己採点・権限改変・評価漏洩を防ぐ |

### 26.2 実機で決めること

| 未決定事項 | 必要な確認 | 未確認時の動作 |
|---|---|---|
| release/package整合 | 実CLIと型・lockfile・exports | install手順を確定しない |
| promptとskill resolution | 順序、canonical保存、再試行 | recommend_only |
| permission最終順序 | deny短絡、before mutation、他plugin | 非弱化を守り全体保証を主張しない |
| execution events | 公開unionとpayload、親子・interrupt | 内部sequence＋capture gap |
| contextの永続性 | 履歴readback、retry、compaction | 最小追記、履歴編集なし |
| RPC identity | caller認証、location filter、取消 | read-only、管理はLab別経路 |
| registry scope | location/session共有とread時点 | stable wrapper、reload最小化 |
| TUI load設定 | 現バイナリの設定とexport | server/CLIだけで動作 |
| worktree入力 | dirty overlay、remote path、ownership | 実験を保留または外部executor |
| generationの契約 | schema、tools、history、usage、cancel | 独立adapterに限定 |
| OS/runtime | Node/Bun/Windows互換、SQLite | Coreは維持しadapterを縮退 |

### 26.3 Claude Modsとの差分

| 論点 | Claude Mods版 | OpenCode 2版 |
|---|---|---|
| 拡張の形 | `($, e, next)`でchainを包む | domainごとのruntime hook/transform |
| Coreの配置 | host管理下、Node/DOMなしの前提 | server plugin内、runtime依存はadapterへ |
| before/after | 一つのcontinuationで対応 | `id`等で別hookを相関 |
| 模型入力への補助 | 使用可能なeventを型で確認 | context/compactionを主接点 |
| UI | Modのpane/render | 別TUI pluginとRPC projection |
| 共有状態 | storeと外部Lab | plugin storageと外部Lab、二重正本にしない |
| registry | host/noun等の能力 | domain transform/reload、global影響に注意 |
| テスト | native mod testの利用候補 | 固定OpenCodeの適合harnessを用意 |
| 長期学習 | 外部Lab | 外部Labを共通利用 |

比較は全体の優劣ではなく、adapterが守る境界の違いである。自己改善の成果を他hostへ移す場合は、host別評価を行ってから適用する。

<a id="s27"></a>

## 27. 参照資料・確認記録

本文の[OCxx]は固定commitの一次ソース、[Dxx]は可変docs、[Jxx]はJev共通設計の参考、[W0](reference/jev-warden-complete-design-v0.2.md)は会話で作成した設計上の正本である。ソースの型を読んだことと、対象のruntimeで契約を検証したことは分けている。

設計時点のsource catalogを`reference/sources.json`にも保存する。commit/source package版は再現可能な調査基準であり、最新版や公開packageのinstall可能性を保証するための値ではない。

付録の検査記録は、この資料生成時に実際に行ったoffline検査のみを含む。OpenCode/Jev/remote/学習運用をpassとして記録しない。

<a id="appendix-a"></a>
## 付録A. 内部契約例と検査方法

`appendix/core-contracts.ts`は純粋なWarden内部契約の参照例である。permission非弱化、scope・snapshot・policyの適用確認、session pin、tool終端のunknown扱い、観測再帰の抑止を含む。OpenCodeの型を模した偽のmodule宣言は使っていない。

```ts
// 独自Coreの形状例。実OpenCode APIではない。
type NativeEffect = "allow" | "ask" | "deny";
type WardenDecision = "abstain" | "ask_permission" | "deny_by_rule";

// 元effectと固定方針から合成する。モデルのconfidenceは引数にしない。
```

検査手順（TypeScript compilerとNodeが利用可能な環境）：

```bash
tsc -p appendix/tsconfig.json
node --test appendix/core-contracts.test.mjs
```

これは例の局所的性質を確かめるもので、全プログラムの安全性・host互換性・Jev品質の証明ではない。検査ログは`checks/`にある。実機の試験項目は`appendix/acceptance-matrix.json`を使って別に実施する。

<a id="appendix-b"></a>
## 付録B. 設定・policy・doctorの例

`appendix/opencode.config.example.json`はserver pluginのlocal entryを指定する参考例。パスに対応するPluginはこの資料に実装されていない。実際の設定場所・merge・entrypointは対象版で検証する。既存設定を丸ごと上書きせず、明示的にmergeする。

`appendix/warden.policy.example.json`はadvisoryな質問・証拠selector・通知設定の例。grant、固定採用基準、API keyは含めない。candidateはデータとして検証され、任意のJS・shell・importを持てない。

`appendix/doctor.example.json`はsource baselineと`NOT_RUN`なruntime試験を示す。確認していないCLI versionやfeature availabilityはnull/unknownのままにする。記入済みのsource package2.0.7を、インストール済みバイナリ版にコピーしない。

`appendix/implementation-brief.md`は調整役へ単独で渡せる着手指示。共通Core、server/TUI、Lab、固定Kernelの境界を維持し、Phase 0の実測から始める。

<a id="appendix-c"></a>
## 付録C. 障害時runbook

| 症状 | 即時動作 | 復旧と記録 |
|---|---|---|
| Jevがtimeout/429 | 助言を遅延または未評価にする。native処理を保つ | 期限内retry、budget unknownを照合 |
| 回答がschema不正 | 当該結果を使わない | rawは許可範囲で保存、provider/adapterを切り分け |
| Labが停止 | bounded spool、学習停止、durability低下表示 | 再接続後IDで再送、ack回収 |
| RPC通知が欠落 | 最終状態を正しいと断定しない | snapshot/deltaで同期 |
| scopeが解決しない | 原資料の送信・自動実行を保留 | session/location公開情報を再取得 |
| host更新でhook不整合 | 該当機能だけ無効化 | 型digest・適合試験を更新 |
| policy不適合 | 旧pinまたは観測のみ | 無検証の新bundleへfallbackしない |
| tool取消後に結果不明 | unknownで記録 | 実行状況を照合してから再試行 |
| 実験worktreeが残った | 他の領域を削除しない | 所有manifestとjob状態を検査してcleanup |
| semantic警告が多すぎる | 観測を残し通知を絞る | 誤検知・介入価値を別評価 |
| 悪化版の採用 | bundle失効、pointerを戻す | 影響sessionと成果物へ再確認 |
| データ許可の撤回 | 新規送信停止、pending取消 | cache/episode/candidate依存を追跡 |

主作業のtoolエラーとWardenのadvisoryエラーを混ぜない。どの機能が使えず、どこまで観測できているかをstatusから確認できるようにする。

<a id="appendix-d"></a>
## 付録D. 最初の一本の時系列

以下は架空のシナリオであり、実施済みの計測結果ではない。

1. session Sがpolicy P12とsnapshot X1で開始する。
2. 主モデルが「テストは合計2回を検証」と報告する。Wardenはtestが定数を参照し、定義がstateにないことを観測する。
3. finding Fを作り、許可されたdefinition検索でsource Dを取得する。
4. Dの実値は3。主張の訂正または意味の再確認を促し、原文を根拠としてFへ紐付ける。
5. Labは当時の入力と後続のDを別々に持つEpisodeを作る。
6. 定義収集とspecific questionを改善するP13候補を生成する。独立したfixture群でも誤誘導・欠落を調べる。
7. replayとshadowだけで勝者とせず、固定作業をP12/P13/無介入で比較する。
8. 固定基準を満たせばP13をactiveにする。SはP12のまま、新sessionへP13をpinする。
9. TUIが切断していても、再接続後にLab sequenceからこの経過を回収する。
10. P13が別のtask族で悪化したらscopeを狭めるか退役させる。改善しない結論も正常な学習結果である。

この一本が閉じれば、仕様grounding・test justification・反証探索等を、同じ証拠・経験・採用の仕組みに追加できる。


### 出典一覧

- **W0 — Jev Warden 統合設計書 v0.2**  
  [Jev Warden 統合設計書 v0.2](reference/jev-warden-complete-design-v0.2.md)  
  会話添付の既存設計。外部製品の仕様ではなく設計上の正本。

- **OC01 — OpenCode v2 branch の調査時点**  
  [OpenCode v2 branch の調査時点](https://github.com/anomalyco/opencode/commit/a2594ddefb6557ecf7e7edb3e30ea50c71df8519)  
  2026-09-17T19:54:34Z のcommitを調査baselineとして固定。latestや安定版とは主張しない。

- **OC02 — Plugin package manifest**  
  [Plugin package manifest](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/package.json)  
  ソース内のnameは @opencode/plugin、versionは2.0.7。配布済みCLI／npm版の確認ではない。

- **OC03 — Promise Plugin API README**  
  [Promise Plugin API README](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/README.md)  
  setup/cleanup、同期transform、context hook、reload、完全なtool値の登録を確認。

- **OC04 — Effect Plugin API README**  
  [Effect Plugin API README](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/effect/README.md)  
  scopeによる登録解除、hookの順序、registry再構築、既存snapshotの非変更を確認。

- **OC05 — Effect Plugin Context / Definition**  
  [Effect Plugin Context / Definition](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/effect/plugin.ts)  
  effect入口、公開domain型、Scope型を確認。

- **OC06 — Session hook 型**  
  [Session hook 型](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/effect/session.ts)  
  prompt/context/compaction等の入力と変更可能項目、request kind、session methodsを確認。

- **OC07 — Tool hook / registry 型**  
  [Tool hook / registry 型](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/effect/tool.ts)  
  before/after、id=Tool.CallID、completed/errorのunion、beforeのみ型付き失敗を確認。

- **OC08 — Permission hook 型**  
  [Permission hook 型](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/effect/permission.ts)  
  effect/messageとreadonlyな評価情報を確認。最終権限順序はこの型だけでは確定しない。

- **OC09 — RPC Effect domain 型**  
  [RPC Effect domain 型](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/effect/rpc.ts)  
  register/emitとScope、handler contextのerrorを確認。caller identityの保証ではない。

- **OC10 — Worktree domain 型**  
  [Worktree domain 型](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/effect/worktree.ts)  
  WorktreeApi継承、provider transform/reloadを確認。OS隔離の保証ではない。

- **OC11 — TUI plugin 入口**  
  [TUI plugin 入口](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/tui/index.ts)  
  @opencode/plugin/tui側の公開入口を確認。

- **OC12 — TUI plugin 定義**  
  [TUI plugin 定義](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/tui/plugin.ts)  
  setupとcleanupを確認。

- **OC13 — TUI Context 型**  
  [TUI Context 型](https://github.com/anomalyco/opencode/blob/a2594ddefb6557ecf7e7edb3e30ea50c71df8519/packages/plugin/src/tui/context.ts)  
  storage、data、location、slot、panel、router、dialog等の必要範囲を確認。全文を実機検証した意味ではない。

- **D01 — OpenCode V2 Plugins（可変docs）**  
  [OpenCode V2 Plugins（可変docs）](https://opencode.ai/v2/docs/build/plugins)  
  調査中に新旧表記の異なる取得結果があった。最終取得は旧 @opencode-ai/plugin / catalog 表記。固定ソースを優先。

- **D02 — OpenCode V2 Effect plugins（可変docs）**  
  [OpenCode V2 Effect plugins（可変docs）](https://opencode.ai/v2/docs/build/plugins/effect)  
  補助的な説明を確認。公開ソースのOC04/OC05を契約baselineとする。

- **D03 — OpenCode V2 Plugin RPC（可変docs）**  
  [OpenCode V2 Plugin RPC（可変docs）](https://opencode.ai/v2/docs/build/plugins/rpc)  
  調査中にlive-only通知・location・外部clientの説明を確認。後続再取得はcache miss。耐久性・認証は実機試験。

- **D04 — OpenCode V2 CLI/TUI plugin docs**  
  [OpenCode V2 CLI/TUI plugin docs](https://opencode.ai/v2/docs/build/plugins/cli)  
  今回の本文取得は失敗。TUIは固定ソースOC11〜OC13を参照し、導入設定を未確認とする。

- **J01 — TypeSafe primitives**  
  [TypeSafe primitives](https://docs.typesafe.ai/primitives)  
  Jev共通設計の参考。今回の実API評価はなし。

- **J02 — TypeSafe speculative fan-out**  
  [TypeSafe speculative fan-out](https://docs.typesafe.ai/patterns/fan-out)  
  独立質問の投機的な同時評価。性能数値の保証には用いない。

- **J03 — TypeSafe Skill suggestion cookbook**  
  [TypeSafe Skill suggestion cookbook](https://docs.typesafe.ai/cookbooks/skill_suggestion)  
  既存設計から継承する参考。今回の再取得は失敗。bench数値は転載しない。

- **J04 — TypeSafe Autoresearch feature discovery**  
  [TypeSafe Autoresearch feature discovery](https://docs.typesafe.ai/cookbooks/autoresearch_feature_discovery)  
  既存設計から継承する参考。今回の再取得は失敗。Wardenの有効性を証明するものではない。

- **J05 — TypeSafe Confidence**  
  [TypeSafe Confidence](https://docs.typesafe.ai/confidence)  
  確率とconfidenceの区別の参考。今回の言語性能・校正は未評価。

