import { UserMFAStatus } from "@domain/identity"

/** The one two-factor control the profile page shows at a time. */
export enum TwoFactorStep {
  /** No authenticator app yet: offer "Turn on". */
  Enable = 1,
  /** A QR code is on screen: ask for the first code to finish enabling. */
  Confirm = 2,
  /** An authenticator app is connected: offer "Turn off". */
  Disable = 3,
}

/** Picks the two-factor control from the user's MFA status and whether enrolment is under way. */
export function twoFactorStep(
  mfa: UserMFAStatus | undefined,
  isEnrolling: boolean,
): TwoFactorStep {
  if (isEnrolling) return TwoFactorStep.Confirm
  return mfa === UserMFAStatus.CONFIGURED ? TwoFactorStep.Disable : TwoFactorStep.Enable
}
