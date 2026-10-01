import { RealtimeRequestError } from "@spy4x/realtime"
import { validate } from "@spy4x/validation"

type Schema = Parameters<typeof validate>[0]

/** Checks a socket payload with the schema the REST route checks its body with. */
export function parsePayload<T>(schema: Schema, payload: unknown): T {
  const { data, error } = validate(schema, payload)
  if (error) throw new RealtimeRequestError("bad_request", error.description)
  return data as T
}

/** Refuses a payload on a request that takes none, so a client cannot smuggle fields past it. */
export function expectNoPayload(payload: unknown): void {
  if (payload !== undefined && payload !== null) {
    throw new RealtimeRequestError("bad_request", "This request takes no payload")
  }
}
