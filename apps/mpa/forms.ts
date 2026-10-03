import {
  BodyReadTimeoutError,
  parseBoundedFormData,
  PayloadTooLargeError,
} from "@spy4x/net/bounded-body"

/** The largest form any page accepts, far above the newsletter forms' address and token. */
export const MAX_FORM_BYTES = 256 * 1024

/** A form post the page cannot read: the status to answer with, and why. */
export class FormRejected extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = "FormRejected"
  }
}

/**
 * Reads a form post, capped at {@link MAX_FORM_BYTES}. Throws {@link FormRejected}: 413 for a body
 * over the cap, 408 for a body that stalls, 400 for a body that is not a form.
 */
export async function readForm(request: Request): Promise<FormData> {
  try {
    return await parseBoundedFormData(request, { maxBytes: MAX_FORM_BYTES })
  } catch (error) {
    if (error instanceof PayloadTooLargeError) throw new FormRejected(413, "The form is too large")
    if (error instanceof BodyReadTimeoutError) {
      throw new FormRejected(408, "The form stopped arriving")
    }
    throw new FormRejected(400, "The request is not a form")
  }
}

/** A text field's value, or `""` when the form has none. */
function field(form: FormData, name: string): string {
  const value = form.get(name)
  return typeof value === "string" ? value : ""
}

/**
 * Each form translated into the JSON body of its API call. The MPA only picks: every form already
 * posts the API's field names, and the API's schemas validate every value, so no rule lives here.
 */
export const API_BODIES = {
  subscribe: (form: FormData) => ({ email: field(form, "email"), list: field(form, "list") }),
  /** The list and token a subscription link carries, for its confirm or its unsubscribe. */
  subscriptionToken: (form: FormData) => ({
    list: field(form, "list"),
    token: field(form, "token"),
  }),
} as const
