/**
 * Shared RPC contract for the Warden server plugin and its clients.
 *
 * The server plugin registers this definition; the TUI plugin imports the same
 * contract and calls `context.client.rpc(Warden)`. The contract is deliberately
 * read-only. Management operations (promote/rollback/grant) do not live here.
 */
import { Rpc } from "@opencode/plugin/rpc"

export const WardenRpc = Rpc.define({
  id: "jev-warden",
  methods: {
    status: {
      input: {
        type: "object",
        properties: {
          sessionID: { type: "string" },
        },
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          text: { type: "string" },
          status: { type: "object", additionalProperties: true },
        },
        required: ["text", "status"],
        additionalProperties: true,
      },
    },
    "snapshot.get": {
      input: {
        type: "object",
        properties: {
          sessionID: { type: "string" },
          cutSequence: { type: "number" },
        },
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          cutSequence: { type: "number" },
          itemCount: { type: "number" },
        },
        required: ["cutSequence", "itemCount"],
        additionalProperties: true,
      },
    },
  },
  events: {
    changed: {
      schema: {
        type: "object",
        properties: {
          sequence: { type: "number" },
          reason: { type: "string" },
        },
        required: ["sequence", "reason"],
        additionalProperties: false,
      },
    },
  },
})

export type WardenRpcDefinition = typeof WardenRpc
