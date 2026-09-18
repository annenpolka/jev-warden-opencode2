# Jev Warden / OpenCode 2 design package

**OC2-0.1 · 2026-09-18 · 設計提案、Warden本体は未実装**

## 読むもの

- `jev-warden-opencode2-design-v0.1.md`：編集用正本。28章と付録4編。
- `jev-warden-opencode2-design-v0.1.html`：同じ本文の目次付き閲覧版。
- `reference/jev-warden-complete-design-v0.2.md`：継承した既存設計の無変更コピー。
- `reference/sources.json`：固定ソースと可変docsの確認状態。
- `appendix/implementation-brief.md`：実装調整役に渡す独立した指示。

## 付録

`core-contracts.ts`はWarden独自の純粋な内部契約例。OpenCode Pluginではない。
JSON例は設定の叩き台で、server pluginの実装ファイルやpublished packageは含まない。
`doctor.example.json`と`acceptance-matrix.json`の実機項目はNOT_RUN。

## 参照コードの再検査

TypeScript compilerとNodeが利用可能な環境で、ディレクトリ直下から実行する。

```bash
tsc -p appendix/tsconfig.json
node --test appendix/core-contracts.test.mjs
```

`checks/`は資料生成時の型検査・offline test・文書検査の記録。
実OpenCode起動、Plugin load、実Jev／生成API、remote運用、自己改善の稼働は行っていない。
API参照のbaselineは固定commitであり、実装時に対象releaseとの適合を確認する。
