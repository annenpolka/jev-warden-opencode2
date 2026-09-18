#!/usr/bin/env node
/**
 * Candidate -> contract check -> replay comparison -> decision (Phase 3 slice).
 *
 * The candidate is generated deterministically from the episode shape, not by
 * a model: it turns "definition not visible" into an advisory guidance policy.
 * The comparison replays the candidate's fixed decision rule over recorded
 * observations. Work-level usefulness is not established by replay, so the
 * expected honest decision is `hold`.
 *
 * Usage:
 *   node fixtures/jev-live/run-loop.mjs
 */
import { createHash } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { validatePolicyBundle, policyDigestInput } from "../../packages/core/src/index.ts"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, "../..")
const fixtureDir = join(repoRoot, "checks/jev-live/2026-09-18-specific-sufficiency")

const SUFFICIENCY_THRESHOLD = 0.5
const PROBE_ID = "specific-sufficiency.expected-calls-definition"

const sha256 = (value) => createHash("sha256").update(value).digest("hex")

function noulOf(output, name) {
  const answer = output?.answers?.[name]
  return answer?.type === "noul" ? answer.noul : null
}

function loadObservations() {
  const hostPath = join(fixtureDir, "host-review-observations.json")
  if (existsSync(hostPath)) {
    const data = JSON.parse(readFileSync(hostPath, "utf8"))
    const byArm = Object.fromEntries(data.reviews.map((entry) => [entry.arm, entry.output]))
    return {
      source: "plugin RPC review.request (live)",
      file: hostPath,
      missing: byArm["definition-missing"],
      present: byArm["definition-present"],
      overBudget: byArm["over-budget-control"],
      credential: byArm["credential-control"],
    }
  }
  const direct = JSON.parse(readFileSync(join(fixtureDir, "episode-live.json"), "utf8"))
  return {
    source: "direct warden transport (live)",
    file: join(fixtureDir, "episode-live.json"),
    missing: direct.decisionTime.observation,
    present: direct.outcome.observation,
    overBudget: null,
    credential: null,
  }
}

function buildCandidate() {
  return {
    schemaVersion: "warden.policy/0.1",
    id: "candidate-specific-definition-guidance-v1",
    parentId: "baseline-observe-only",
    status: "candidate",
    scope: { kind: "project", projectRef: "project-under-test" },
    compatibility: { coreContract: "warden.core/0.1", requiredCapabilities: ["source.read", "context.guidance"] },
    selectors: [
      {
        id: "registered-definition-selector",
        options: { followReferencedConstants: true, maxFiles: 6 },
      },
    ],
    probes: [
      {
        id: PROBE_ID,
        type: "noul",
        instructions:
          "Do `test_code` and `definitions` state the actual value that EXPECTED_CALLS has, directly rather than only by the constant name?",
        criteria: {
          true: "The material contains the definition of EXPECTED_CALLS together with its value",
          false: "The definition or its value is absent, or only the name is shown",
        },
        inputs: ["test_code", "definitions"],
        role: "specific-evidence-sufficiency",
      },
    ],
    guidance: {
      kind: "definition-needed",
      delivery: "advisory",
      maxItems: 2,
      repeatOnlyOnNewEvidence: true,
    },
    promotion: { evaluationPolicyRef: "fixed-evaluation-policy-1", reportRefs: [] },
    notes: "Deterministic template candidate. Data only; no executable content.",
  }
}

/**
 * Fixed decision rule, written before looking at the replay results:
 * deliver guidance when the sufficiency observation is below 0.5.
 */
function candidateDecision(output) {
  const sufficiency = noulOf(output, "expected_calls_value_visible")
  if (sufficiency === null) return { action: "no_data", sufficiency }
  return sufficiency < SUFFICIENCY_THRESHOLD
    ? { action: "deliver_guidance", sufficiency }
    : { action: "stay_silent", sufficiency }
}

function main() {
  const observations = loadObservations()
  const candidate = buildCandidate()
  validatePolicyBundle(candidate)
  const digest = sha256(policyDigestInput(candidate))

  const arms = [
    { arm: "definition-missing", role: "decision-time", output: observations.missing },
    { arm: "definition-present", role: "control", output: observations.present },
  ].map((entry) => {
    const decision = candidateDecision(entry.output)
    return {
      arm: entry.arm,
      role: entry.role,
      status: entry.output?.status ?? "missing",
      sufficiency: decision.sufficiency,
      candidateAction: decision.action,
      baselineAction: "observe_only",
    }
  })

  const contract = {
    bundleValid: true,
    requiredCapabilities: candidate.compatibility.requiredCapabilities,
    hasExecutableContent: false,
  }
  const replay = {
    rule: "sufficiency < 0.5 -> deliver_guidance",
    arms,
    firesOnDecisionTimeArm: arms[0].candidateAction === "deliver_guidance",
    silentOnControlArm: arms[1].candidateAction === "stay_silent",
  }
  const criteria = {
    contractOk: contract.bundleValid,
    replayOk: replay.firesOnDecisionTimeArm && replay.silentOnControlArm,
    correctnessNonInferiorityEstablished: false,
    usefulnessImprovementEstablished: false,
  }
  const decision = {
    schemaVersion: "warden.promotion-decision/0.1",
    candidateId: candidate.id,
    candidateDigest: digest,
    stage: "replay_passed",
    decision: criteria.contractOk && criteria.replayOk && !criteria.usefulnessImprovementEstablished ? "hold" : "reject",
    reason:
      criteria.contractOk && criteria.replayOk
        ? "Replay separates the decision-time arm from the control arm, but work-level usefulness was not measured. " +
          "Adoption requires a bounded work comparison, not a judgment replay."
        : "Contract or replay criteria failed.",
    criteria,
    nextActions: [
      "collect more episodes with the same probe and independent controls",
      "run a bounded work comparison (guidance vs observe-only) before any adoption",
      "keep the candidate advisory-only; it cannot change permissions or prompt text",
    ],
  }

  writeFileSync(join(fixtureDir, "candidate-bundle.json"), JSON.stringify(candidate, null, 2) + "\n")
  writeFileSync(
    join(fixtureDir, "comparison.json"),
    JSON.stringify(
      {
        schemaVersion: "warden.replay-comparison/0.1",
        observationSource: observations.source,
        observationFile: observations.file,
        threshold: SUFFICIENCY_THRESHOLD,
        contract,
        replay,
        criteria,
      },
      null,
      2,
    ) + "\n",
  )
  writeFileSync(join(fixtureDir, "decision.json"), JSON.stringify(decision, null, 2) + "\n")

  console.log(JSON.stringify({ stage: decision.stage, decision: decision.decision, arms, source: observations.source }, null, 2))
}

main()
