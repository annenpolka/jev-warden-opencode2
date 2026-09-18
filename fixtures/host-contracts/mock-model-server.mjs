// Local OpenAI-compatible chat-completions mock for host conformance.
// No external network, no provider cost. Responses are consumed in order from
// a JSON script file. Control endpoints let the runner reset the cursor.
import { createServer } from "node:http"
import { appendFileSync, readFileSync, existsSync } from "node:fs"

const port = Number(process.argv[2] ?? 45998)
const scriptPath = process.argv[3] ?? new URL("./mock-script.json", import.meta.url).pathname
const logPath = process.argv[4] ?? new URL("./mock-requests.jsonl", import.meta.url).pathname

let cursor = 0
const log = (value) => appendFileSync(logPath, JSON.stringify(value) + "\n")
const readScript = () => {
  if (!existsSync(scriptPath)) return []
  try {
    return JSON.parse(readFileSync(scriptPath, "utf8"))
  } catch {
    return []
  }
}
const nextEntry = () => {
  const script = readScript()
  const entry = script[cursor]
  cursor += 1
  return entry ?? { kind: "text", text: "mock: no scripted response" }
}

const sendJson = (res, status, value) => {
  res.writeHead(status, { "content-type": "application/json" })
  res.end(JSON.stringify(value))
}

const sse = (res, payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`)

const handleCompletion = async (req, res) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  let body = {}
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } catch {}
  const entry = nextEntry()
  log({ at: Date.now(), url: req.url, body, entry })
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  })
  const base = {
    id: `chatcmpl-mock-${cursor}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: body.model ?? "mock-1",
  }
  sse(res, { ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] })
  if (entry.kind === "tool") {
    sse(res, {
      ...base,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: entry.id ?? `call_mock_${cursor}`,
                type: "function",
                function: { name: entry.tool, arguments: JSON.stringify(entry.arguments ?? {}) },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    })
    sse(res, { ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })
  } else {
    const text = String(entry.text ?? "")
    for (const piece of text.match(/[\s\S]{1,24}/g) ?? []) {
      sse(res, { ...base, choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] })
    }
    sse(res, { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })
  }
  if (body.stream_options?.include_usage) {
    sse(res, { ...base, choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })
  }
  res.write("data: [DONE]\n\n")
  res.end()
}

const server = createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/__reset") {
    cursor = 0
    sendJson(res, 200, { ok: true, cursor })
    return
  }
  if (req.method === "GET" && req.url === "/__state") {
    sendJson(res, 200, { cursor, scriptPath, logPath })
    return
  }
  if (req.method === "GET" && (req.url === "/v1/models" || req.url?.startsWith("/v1/models?"))) {
    const model = readScript()[0]?.model ?? "mock-1"
    sendJson(res, 200, { object: "list", data: [{ id: model, object: "model", owned_by: "jw-mock" }] })
    return
  }
  if (req.method === "POST" && req.url?.startsWith("/v1/chat/completions")) {
    await handleCompletion(req, res)
    return
  }
  log({ at: Date.now(), url: req.url, method: req.method, unhandled: true })
  sendJson(res, 404, { error: { message: "not found" } })
})

server.listen(port, "127.0.0.1", () => {
  console.log(JSON.stringify({ event: "mock-model-listening", port, scriptPath, logPath }))
})
