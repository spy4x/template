import {
  BodyReadTimeoutError,
  parseBoundedFormData,
  PayloadTooLargeError,
} from "@spy4x/net/bounded-body"

/**
 * The largest form any page accepts. The largest real one is a note at its longest: 10 000
 * characters of four-byte text, percent-encoded to 12 bytes each, is about 120 KiB.
 */
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
 * A number field as a number. A value that is not a whole number stays a string, so the API's
 * schema refuses it with its own message instead of the MPA guessing a number.
 */
function numberField(form: FormData, name: string): number | string {
  const value = field(form, name)
  return /^\d+$/.test(value) ? Number(value) : value
}

/**
 * Each form translated into the JSON body of its API call. The MPA only picks and converts: every
 * form already posts the API's field names, and the API's schemas validate every value, so no rule
 * lives here.
 */
export const API_BODIES = {
  signIn: (form: FormData) => ({
    login: field(form, "login"),
    password: field(form, "password"),
  }),
  signUp: (form: FormData) => ({
    email: field(form, "email"),
    password: field(form, "password"),
  }),
  forgotPassword: (form: FormData) => ({ email: field(form, "email") }),
  resetPassword: (form: FormData) => ({
    email: field(form, "email"),
    code: field(form, "code"),
    newPassword: field(form, "newPassword"),
  }),
  oneTimeCode: (form: FormData) => ({ otp: field(form, "otp") }),
  profile: (form: FormData) => ({
    firstName: field(form, "firstName"),
    lastName: field(form, "lastName"),
  }),
  password: (form: FormData) => ({
    password: field(form, "password"),
    newPassword: field(form, "newPassword"),
  }),
  totpFinish: (form: FormData) => ({ otp: field(form, "otp") }),
  emailVerify: (form: FormData) => ({ code: field(form, "code") }),
  emailChange: (form: FormData) => ({
    email: field(form, "email"),
    password: field(form, "password"),
  }),
  pushRemove: (form: FormData) => ({ deviceId: field(form, "deviceId") }),
  groupCreate: (form: FormData) => ({
    id: field(form, "id"),
    name: field(form, "name"),
  }),
  groupRename: (form: FormData) => ({ name: field(form, "name") }),
  groupSelect: (form: FormData) => ({ groupId: field(form, "groupId") }),
  groupMemberRole: (form: FormData) => ({ role: numberField(form, "role") }),
  groupTransfer: (form: FormData) => ({
    userId: numberField(form, "userId"),
    name: field(form, "name"),
    password: field(form, "password"),
  }),
  billingCheckout: (form: FormData) => ({ planId: field(form, "planId") }),
  invitationCreate: (form: FormData) => ({
    role: numberField(form, "role"),
    expiresInDays: numberField(form, "expiresInDays"),
    maxUses: numberField(form, "maxUses"),
    email: field(form, "email"),
    // An unticked checkbox sends nothing.
    sendEmail: field(form, "sendEmail") === "true",
    acceptSeatPrice: field(form, "acceptSeatPrice") === "true",
  }),
  /** An answer names a link's token, or the id of an invitation sent to the person's address. */
  invitationAnswer: (form: FormData): { token: string } | { invitationId: string } =>
    form.has("token")
      ? { token: field(form, "token") }
      : { invitationId: field(form, "invitationId") },
  noteCreate: (form: FormData) => ({
    id: field(form, "id"),
    title: field(form, "title"),
    body: field(form, "body"),
  }),
  noteUpdate: (form: FormData) => ({
    title: field(form, "title"),
    body: field(form, "body"),
    version: numberField(form, "version"),
  }),
  noteDelete: (form: FormData) => ({ version: numberField(form, "version") }),
  /** The list's form: the group, and every ticked note. */
  noteMoveMany: (form: FormData) => ({
    toGroupId: field(form, "toGroupId"),
    noteIds: form.getAll("noteIds").filter((id): id is string => typeof id === "string"),
  }),
  /** One note's page names no note in the form: the address does. */
  noteMoveOne: (form: FormData, noteId: string) => ({
    toGroupId: field(form, "toGroupId"),
    noteIds: [noteId],
  }),
  subscribe: (form: FormData) => ({ email: field(form, "email"), list: field(form, "list") }),
  /** The list and token a subscription link carries, for its confirm or its unsubscribe. */
  subscriptionToken: (form: FormData) => ({
    list: field(form, "list"),
    token: field(form, "token"),
  }),
} as const
