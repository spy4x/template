export enum GithubWebhookStatus {
  RECEIVED = 1,
  PROCESSING = 2,
  PROCESSED = 3,
  FAILED = 4,
}

export enum GithubActionStatus {
  QUEUED = 1,
  RUNNING = 2,
  SUCCESS = 3,
  FAILED = 4,
}

export enum GithubActionKind {
  GH_CLI = 1,
  OPENCODE = 2,
}

export type GithubWebhookEvent = {
  id: number
  deliveryId: string
  event: string
  action: string | null
  repoFullName: string | null
  payload: unknown
  status: GithubWebhookStatus
  error: string | null
  receivedAt: Date
}

export type GithubActionRun = {
  id: number
  webhookEventId: number | null
  actionKind: GithubActionKind
  command: string | null
  args: unknown | null
  status: GithubActionStatus
  stdout: string | null
  stderr: string | null
  createdAt: Date
  updatedAt: Date
}
