/**
 * Jev Warden TUI plugin (display client).
 *
 * The TUI is a projection. It calls the read-only Warden RPC, keeps client-local
 * state, and never runs inference, learning jobs or permission decisions.
 *
 * Host note (verified on OpenCode 2.0.7): a local server package's `./tui`
 * entry is discovered by the CLI-side loader, where the interactive Keymap
 * provider is absent, so `keymap.layer` throws. Registration is therefore
 * attempted behind a try/catch: the plugin stays loadable, and the command
 * surface is simply unavailable on hosts that load it outside the TUI tree.
 */
import { Plugin } from "@opencode/plugin/tui"
import { WardenRpc } from "@jev-warden/contracts"

export default Plugin.define({
  id: "jev-warden.tui",
  setup(context) {
    const [state, updateState] = context.storage.memory("warden-status", {
      initial: { text: "Warden: not queried", sequence: 0, updatedAt: 0 },
    })
    void state
    const warden = context.client.rpc(WardenRpc)
    let disposed = false

    const refresh = async (): Promise<void> => {
      try {
        const result = (await warden.status({})) as { text: string; status: Record<string, unknown> }
        if (disposed) return
        const sequence =
          typeof result.status.updatedAt === "number" ? result.status.updatedAt : Date.now()
        updateState((draft) => {
          draft.text = result.text
          draft.sequence = sequence
          draft.updatedAt = Date.now()
        })
        context.ui.toast.show({ message: result.text, variant: "info" })
      } catch (error) {
        if (disposed) return
        const message = error instanceof Error ? error.message : "unknown error"
        context.ui.toast.show({ message: `Warden status unavailable: ${message}`, variant: "warning" })
      }
    }

    try {
      context.keymap.layer(() => ({
        mode: "global",
        priority: 5,
        commands: [
          {
            id: "warden.status",
            title: "Warden status",
            description: "Show the Jev Warden policy and observation status",
            group: "Warden",
            slash: { name: "warden-status", aliases: ["warden"] },
            run: () => refresh(),
          },
        ],
      }))
    } catch {
      // Keymap provider absent (for example a CLI-side load on 2.0.7).
    }

    return () => {
      disposed = true
    }
  },
})
