/**
 * Registered review probes.
 *
 * A probe is a fixed question or question set over named state keys. The
 * caller cannot define arbitrary instructions: only registered probe ids are
 * accepted, so a learned policy cannot introduce new questions at runtime.
 */
import type { JevQuestion } from "./jev-live.ts"

export interface ProbeDefinition {
  readonly id: string
  readonly role: string
  readonly requiredStateKeys: readonly string[]
  readonly questions: Readonly<Record<string, JevQuestion>>
}

export const SPECIFIC_SUFFICIENCY_PROBE_ID = "specific-sufficiency.expected-calls-definition"

export const PROBES: Readonly<Record<string, ProbeDefinition>> = Object.freeze({
  [SPECIFIC_SUFFICIENCY_PROBE_ID]: {
    id: SPECIFIC_SUFFICIENCY_PROBE_ID,
    role: "specific-evidence-sufficiency",
    requiredStateKeys: ["test_code", "definitions"],
    questions: {
      expected_calls_value_visible: {
        type: "noul",
        instructions:
          "Do `test_code` and `definitions` state the actual value that EXPECTED_CALLS has, directly rather than only by the constant name?",
        criteria: {
          true: "The material contains the definition of EXPECTED_CALLS together with its value",
          false: "The definition or its value is absent, or only the name is shown",
        },
      },
      expected_total_is_three: {
        type: "noul",
        instructions:
          "Do `test_code` and `definitions` support the statement that the expected total number of recorded calls asserted by the test is 3?",
        criteria: {
          true: "The value 3 can be read from the shown material as the expected total",
          false: "The expected total cannot be determined as 3 from the shown material",
        },
      },
    },
  },
})

export function getProbe(id: string): ProbeDefinition | undefined {
  return PROBES[id]
}
