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
    "review.request": {
      input: {
        type: "object",
        properties: {
          sessionID: { type: "string" },
          probeID: { type: "string" },
          state: { type: "object", additionalProperties: true },
          stateRefs: { type: "array", items: { type: "string" } },
        },
        required: ["probeID", "state"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          status: { type: "string" },
          requestDigest: { type: "string" },
          model: { type: "string" },
          answers: { type: "object", additionalProperties: true },
          error: { type: "string" },
        },
        required: ["status", "requestDigest"],
        additionalProperties: false,
      },
    },
    "review.list": {
      input: {
        type: "object",
        properties: {
          sessionID: { type: "string" },
          limit: { type: "number" },
        },
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          items: { type: "array", items: { type: "object", additionalProperties: true } },
        },
        required: ["items"],
        additionalProperties: false,
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
