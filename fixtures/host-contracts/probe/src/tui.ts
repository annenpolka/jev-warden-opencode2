/**
 * Host-conformance TUI probe (fixture).
 *
 * Writes JSONL evidence for TUI plugin setup/cleanup and for a slash command,
 * so the runner can prove that the TUI actually loaded the plugin. The log
 * path comes from JW_PROBE_TUI_LOG; without it the plugin stays silent.
 */
import { appendFileSync } from "node:fs"
import { Plugin } from "@opencode/plugin/tui"

const rawLog = (value: Record<string, unknown>): void => {
  const path = process.env.JW_PROBE_TUI_LOG
  if (path === undefined || path.length === 0) return
  try {
    appendFileSync(path, JSON.stringify({ at: Date.now(), pid: process.pid, ...value }) + "\n")
  } catch {
    // evidence loss is visible to the runner because the file stops growing
  }
}

rawLog({ event: "tui.module-imported" })

const log = (value: Record<string, unknown>): void => rawLog(value)

export default Plugin.define({
  id: "jw-probe-tui",
  setup(context) {
    log({
      event: "tui.setup",
      version: context.app?.version ?? null,
      channel: context.app?.channel ?? null,
      location: context.location?.directory ?? null,
    })
    try {
      context.keymap.layer(() => ({
        mode: "global",
        commands: [
          {
            id: "jw-probe.marker",
            title: "Probe marker",
            group: "Probe",
            slash: { name: "jw-probe-marker" },
            run: () => log({ event: "tui.command", command: "jw-probe.marker" }),
          },
        ],
      }))
      log({ event: "tui.keymap.registered" })
    } catch (error) {
      log({
        event: "tui.keymap.failed",
        message: error instanceof Error ? error.message : String(error),
      })
    }
    return () => log({ event: "tui.cleanup" })
  },
})
