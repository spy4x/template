# Billing

Each group has one subscription, paid by its owner through Stripe. A group without a paid
subscription is on the Free plan. Stripe owns the money and the subscription; this app keeps only
what Stripe's webhooks report, and never decides a plan on its own.

The provider code comes from `jsr:@spy4x/billing` (`createStripeBilling`); the pricing page and the
plan card are built on `@spy4x/preact-ui/billing` (`PricingTable`, `PlanCard`, `UpgradePrompt`).

## Plans

The catalog is `PLANS` in `libs/domain/billing/+lib.ts`:

| Plan id | Name | Price         | Stripe price                     |
| ------- | ---- | ------------- | -------------------------------- |
| `free`  | Free | 0             | none                             |
| `pro`   | Pro  | €9.00 a month | `STRIPE_PRICE_PRO` (environment) |

Pro starts with a 14-day trial (`trialDays` on the plan).

A group is on a paid plan while its subscription is trialing or active, and for a grace period
while it is past due (below). A canceled, incomplete or paused subscription, or one billing a price
that is not in the catalog, puts the group back on Free. To add a plan, add it to `PLANS`, add its
price variable to `readBillingSetup` (`apps/api/features/billing/config.ts`), to
`infra/envs/.env.example` and to the api service's `environment` in
`infra/compose/compose.shared.yml`.

## Failed payments

When a renewal charge fails, Stripe marks the subscription `past_due` and retries the card on its
own schedule. The group keeps its plan for a grace period, `BILLING_GRACE_DAYS` days (default 7)
counted from the first past-due event, and gets the Free plan's entitlements after it. Nothing is
deleted: the subscription stays stored as past due, and everything over a Free cap stays as in
"Downgrade" below.

- The start is `subscriptions.past_due_since`, the `created` time of the first past-due event.
  Later past-due events keep it; Stripe's `unpaid` arrives as past due too
  (`@spy4x/billing` maps both to `PastDue`), so giving up on retries does not restart the clock.
- A past-due event that arrives after a newer event is stale and ignored, as every event is (the
  delivery rules under "Flow"). If Stripe delivers the first failure late, after a newer past-due
  event, the grace period starts at that newer event instead. This only lengthens the grace in the
  customer's favour, and only by as long as Stripe's delivery was delayed.
- Any other status clears it. A payment that makes the subscription active again brings the plan
  back at once; a later failure starts a new grace period.
- `effectivePlanId(subscription, now, graceDays)` in `libs/domain/billing/+lib.ts` decides. The
  command bus's plan check and the billing read both take the current time and the grace period
  from `planClockOf` (`apps/api/features/billing/config.ts`), so the cut-off is exact to the
  request, with no job.

**How it meets Stripe's retries.** Stripe's retry window ("Manage failed payments", up to about two
months) and this grace period are separate clocks. While Stripe retries, the subscription stays
`past_due` even with "cancel the subscription" chosen, so the grace period is what bounds free use:
a group gets at most `BILLING_GRACE_DAYS` of its plan after the first failure, however long Stripe
retries. A payment that succeeds during the retries restores the plan. When the retries end,
"cancel the subscription" (step 6 below) ends the subscription for good, so the group needs a new
checkout; the other two settings leave it past due or unpaid, which this app treats the same way,
Free after the grace period. Keep step 6: a cancelled subscription also lets the owner check out
again, which a past-due one blocks (409 `ALREADY_SUBSCRIBED`).

## Trials

A group's first checkout of a plan with `trialDays` asks Stripe for a trial of that length. A
group that already has a Stripe customer, because it paid or trialed before, checks out without
one, so a trial is given once per group (see "Known limits").

`BILLING_TRIAL_REQUIRES_CARD` decides whether the trial's checkout asks for a card. It is `true`
by default: a trial with a card converts on its own, and a person who cannot pay does not get one.
With `false`, Stripe starts the trial without a card (`trialWithoutPaymentMethod` in
`@spy4x/billing`); if none is added by the trial's end, Stripe cancels the subscription and the
group goes back to Free.

The webhook stores the trial's end (`subscriptions.trial_end`). The group has the plan while the
subscription is trialing and the stored end is still ahead, and gets Free from that instant on,
even before Stripe's next event arrives. When the trial converts, Stripe reports the subscription
active and the plan stays.

## Cancelling and undoing

The owner cancels in the Stripe customer portal, which cancels at the end of the paid period
(Stripe's `cancel_at_period_end`). The group keeps its plan until `current_period_end`, and gets
Free from that instant on. Until then the owner can renew the plan in the same portal; the next
webhook clears the flag and the plan simply continues. The portal must allow both (step 5 below).

`effectivePlanId` and `accessEndsAt` in `libs/domain/billing/+lib.ts` hold both bounds, the
trial's and the cancellation's, with the same request clock as the grace period.

## Notices

The owner is told three things, by e-mail and by a banner on the group's settings page in both
apps. Other members see neither.

| Notice         | When                                                   | Banner shown                        |
| -------------- | ------------------------------------------------------ | ----------------------------------- |
| Trial ending   | 3 days before the trial ends (`TRIAL_NOTICE_DAYS`)     | from then until the trial ends      |
| Payment failed | on the first past-due event                            | while past due, with the grace end  |
| Plan ending    | when a cancellation at period end arrives              | until the period ends or it is undone |

`billingNoticeOf` (`libs/domain/billing/+lib.ts`) decides the banner from the stored subscription
and the request clock. A failed payment wins over the other two.

The webhook queues each mail as a job in the outbox, in the transaction that stores the event
(`libs/server/billing/billing-notices.ts`): a failed payment and a cancellation at once, a trial's
notice at its end minus three days. A job is keyed by its group, its kind and its time, so a
repeated or reordered event queues nothing twice. When a job runs, the worker reads the
subscription again and sends only a notice that still holds: a payment that went through, an
undone cancellation or a converted trial sends nothing, and a trial whose end moved is told only by
the job for the new end (`libs/server/jobs/billing-notice-mail.ts`). The mail goes to the owner's
first proven address; an owner with none gets no mail, and the worker logs a warning without the
address. A failed send is retried. With mail off, nothing is sent.

## Who may do what

- Every member sees the group's plan in the group's settings.
- Only the owner may open a checkout or the Stripe customer portal. Anyone else gets 403
  (`ROLE_INSUFFICIENT`), and a person outside the group gets 404.
- A group with a subscription that is not cancelled cannot open a second checkout (409
  `ALREADY_SUBSCRIBED`), even when that subscription shows as Free (paused, incomplete, or on a price
  not in the catalog). The owner changes or cancels it in the portal.
- The owner sees the portal button whenever the group has a live subscription or a Stripe customer
  (past invoices, the card on file).
- A group with a live subscription cannot be deleted (409 `GROUP_SUBSCRIBED`); the owner cancels the
  subscription in the portal first. The settings page disables the delete button and says why.

## Entitlements

What a plan allows lives in the plan itself: `entitlements` on each entry of `PLANS`, with feature
flags and numeric limits. No handler names a plan; a command says what it needs, and the plan
answers.

| Key            | Kind    | Free    | Pro     | Enforced                                                     |
| -------------- | ------- | ------- | ------- | ------------------------------------------------------------ |
| `memberRoles`  | feature | no      | yes     | Promoting a member (`GroupMemberRoleCommand`)                |
| `maxNotes`     | limit   | 10      | no cap  | Creating a note (`NoteCreateCommand`)                        |
| `maxMembers`   | limit   | 3       | 50      | Inviting (`GroupInvitationCreateCommand`) and accepting      |
| `storageBytes` | limit   | 50 MiB  | 10 GiB  | Not yet: the key ships for attachments (#157)                |

A limit of `null` means no cap.

**One check, on the command bus.** `apps/api/cqrs/entitlement-gate.ts` runs after the idempotency
middleware, so a retry still gets its stored answer; `apps/api/cqrs/command-middleware.ts` holds
that order, and its test fails if it changes. `ENTITLEMENT_NEEDS`
(`apps/api/cqrs/entitlement-needs.ts`) lists each command that needs something from its group's
plan. The gate reads the group's plan and refuses such a command before its handler runs. Queries
pass untouched, and so does every command that is not listed.

The gate judges a listed command only when the handler would carry it out on a plan that allows
it. Anything the handler refuses on every plan goes on to the handler, which gives the same answer
on Free as on Pro:

- a stranger gets 404, and a viewer who tries to write gets 403;
- an admin who tries to demote the owner gets 409 `LAST_OWNER`;
- a role change for someone who has left the group gets 404 `MEMBER_NOT_FOUND`.

**Only a promotion is a paid feature.** `memberRoles` gates a role change that raises the member's
role. A group on any plan can give a member a lower role or remove them, so a group back on Free
can still demote an admin it made on Pro.

**The refusal.** The API answers **402 Payment Required**, so a client can tell a plan refusal from
a role refusal (403):

```json
{
  "error": {
    "code": "PLAN_LIMIT_REACHED",
    "message": "The group has reached its plan's limit",
    "entitlement": "maxNotes",
    "limit": 10,
    "canUpgrade": true
  }
}
```

`code` is `PLAN_FEATURE_MISSING` or `PLAN_LIMIT_REACHED`. `canUpgrade` is true only for the owner,
the one person who can change the plan. The socket's error codes are a closed set, so over the
socket the refusal is `forbidden`, with the same fields in `details`. `readPlanRefusal` reads either
one back. Both apps then show `UpgradePrompt`: the owner gets a link to the group's pricing page,
and anyone else is told to ask the owner. The MPA draws it from the 402 body, with no script.

**Counted in the write's transaction.** The gate counts before the handler runs, outside any
transaction, so two requests can both pass it for the last free slot. The gate therefore passes
the cap to the handler (`allowance` on the command). The note repository counts again after its
insert, in the same transaction, under the group row lock that every note write already takes. The
second request waits for the first to commit, counts it, and is refused.
`tests/integration/plan-limits.integration.test.ts` races two creates for the last slot to prove
it. A handler that gets no `allowance` throws, so a bus without the gate fails closed.

**Downgrade.** Nothing is deleted when a group drops to a smaller plan. Everything over a cap stays
readable, editable and deletable; only a write that adds to the count is refused, until the group
is back under the cap or upgrades. A feature the new plan lacks is refused from then on: members
promoted on Pro keep their roles and can still be demoted or removed, but nobody new is promoted.

**Billing off.** With `BILLING_PROVIDER=off` nobody can pay to lift a cap, so every group gets
every feature with no cap (`UNLIMITED`). The settings page still shows the group as Free.

**Adding a key.** Add it to `FeatureKey` or `LimitKey`; TypeScript then asks for it in every plan
and in `UNLIMITED`. Add its wording to `REFUSAL_TEXT` in `libs/ui/plan-refusal.tsx`. List the
command in `ENTITLEMENT_NEEDS` with `needsFeature` or `needsRoom`. A limit also needs a usage count
in `apps/api/cqrs/entitlements.ts` (the gate refuses to start without one), and the write must count
again inside its transaction, as the note repository does.

## Configuration

`BILLING_PROVIDER` picks the provider:

| Value      | What runs                                                                       |
| ---------- | ------------------------------------------------------------------------------- |
| unset      | `off` in production, `fake` with `ENV=dev`                                      |
| `off`      | No billing: every group shows as Free with no caps; checkout and the webhook answer 404        |
| `stripe`   | Stripe. Needs `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `STRIPE_PRICE_PRO` |
| `fake`     | The development provider, below. Refused in production                         |

With `stripe` and any of the three keys missing, the API refuses to start and names the missing
ones. Any other value of `BILLING_PROVIDER` also stops the start.

`BILLING_GRACE_DAYS` sets the grace period for failed payments: a whole number of days from 0 to
90, 7 when unset or empty. Any other value stops the start.

`BILLING_TRIAL_REQUIRES_CARD` is `true` or `false`: whether starting a trial asks for a card
("Trials" above). Unset or empty means `true`; any other value stops the start.

## Flow

1. The owner opens **See plans** on the group's settings, then **Choose Pro**. The API asks Stripe
   for a checkout session with the group's id as its reference and sends the browser there.
2. Stripe takes the payment and returns the browser to the group's settings.
3. Stripe posts `customer.subscription.created` to `POST /api/webhooks/billing`. The API checks the
   signature first; then, in one transaction, it stores the event id, writes the group's
   subscription and its customer, and records `group.plan.changed` in the outbox when the plan or
   the status changed (a renewal that only moves the period's end records nothing). The worker
   announces the change, and every open page of the group reads the plan again.
4. Later changes (renewal, a failed payment, a cancellation from the portal) arrive the same way.

Delivery rules the webhook keeps:

- A repeated event id changes nothing, so Stripe's retries are safe.
- An event older than the one stored never rolls the plan back. Events are ordered by Stripe's
  `created` second, then by kind (created, updated, deleted). Within one second a later kind wins
  over an earlier one whatever order they arrive in; two events of the same kind in the same second
  keep the one that arrives last. See "Known limits".
- Another subscription replaces the one held when it pays (trialing or active), whatever the held
  one's status, or when the held one is cancelled. One that does not pay never replaces a live
  one: the end or a late failed payment of an old subscription leaves the newer one, and the
  group's plan, as they are ([#242](https://github.com/spy4x/template/issues/242)).
- A bad or missing signature gets 400; a body that cannot be read after a valid signature, and
  events this app does not handle, get 200 so Stripe stops sending them; a failure while storing
  gets 500 so Stripe retries.

## Test mode and the Stripe CLI

Use Stripe's test mode for everything but production: test keys start with `sk_test_`, and test
cards such as `4242 4242 4242 4242` pay without money.

1. In the Stripe dashboard (test mode), create a product "Pro" with a monthly price of €9.00, and
   copy its price id into `STRIPE_PRICE_PRO`.
2. Copy the test secret key into `STRIPE_SECRET_KEY`.
3. Forward webhooks to the local API with the [Stripe CLI](https://docs.stripe.com/stripe-cli):

   ```bash
   stripe login
   stripe listen --forward-to http://app.localhost/api/webhooks/billing \
     --events customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid,invoice.payment_failed
   ```

   `stripe listen` prints a `whsec_...` signing secret: put it in `STRIPE_WEBHOOK_SECRET`.
4. Set `BILLING_PROVIDER=stripe` and restart the API.
5. Configure the customer portal once in the dashboard (Settings, Billing, Customer portal), or
   Stripe refuses to open it. Allow customers to cancel subscriptions "at the end of the billing
   period", not immediately, so the group keeps what it paid for, and allow them to renew a
   cancelled subscription, which is how an owner undoes a cancellation.
6. Set failed payments to cancel the subscription (Settings, Billing, Subscriptions and emails,
   "Manage failed payments for subscriptions": when all retries fail, cancel the subscription).
   The grace period ("Failed payments" above) already drops a past-due group to Free after
   `BILLING_GRACE_DAYS`, whichever option is chosen; cancelling ends the subscription for good and
   lets the owner check out again, where a subscription left unpaid or overdue blocks a new
   checkout.

In production, add the webhook endpoint `https://<domain>/api/webhooks/billing` in the dashboard
with the same five events, use its signing secret, and set failed payments as in step 6. Keys live
in the environment only; the tracked `.env.example` holds empty placeholders.

## The development provider

With `ENV=dev` and no `BILLING_PROVIDER`, the API runs the development provider
(`createFakeBilling` in `apps/api/features/billing/config.ts`). It calls no network:

- A checkout sends the browser straight back to the success URL, as if paid. Nothing changes until
  a webhook arrives.
- The portal sends the browser back to the group's settings.
- Webhooks are verified exactly as Stripe's are, with the public secret
  `whsec_template_development_only` and the price `price_fake_pro` for Pro. Anyone can sign a
  webhook with it, so a server running with `ENV=dev` and no `BILLING_PROVIDER` accepts webhooks
  from anyone who can reach it. Never expose such a server to the internet.

The e2e test drives an upgrade this way: it posts a recorded `customer.subscription.created`, signed
with that secret (`e2e/fixtures/billing.ts`), to the webhook. Production refuses the development
provider, so its public secret cannot sign a real event.

## Known limits

- `@spy4x/billing` cannot read a subscription back from Stripe yet
  ([spy4x/ts-libs#380](https://github.com/spy4x/ts-libs/issues/380)), so two events of the same
  kind in the same second that arrive out of order leave the older one stored. Stripe usually sends
  them in order; the next event, or a change in the portal, corrects it. Once the library can read
  the subscription back, the webhook will store what Stripe says now instead.
- Two checkout sessions opened before either is paid can both be paid, which starts two
  subscriptions for one group. The 409 above only covers a subscription the webhook has already
  stored. Refund and cancel the extra one in the Stripe dashboard.
- A webhook can store a subscription for a group that was already deleted, if the owner paid and
  deleted the group before the webhook arrived. The purge keeps such a group, and the worker logs
  how many it kept. The group is past its restore window, so the owner cannot reach the portal:
  cancel the subscription in the Stripe dashboard, and the next purge removes the group.
- Payment events are stored (so repeats are skipped) but change nothing yet.
- The end of a grace period, a trial or a cancelled period records no `group.plan.changed` event,
  since no webhook arrives at that instant. Every check reads the plan with the current time, so
  the cut-off holds; an open page shows the old plan until it reads the billing again (a reload, or
  the next change of the group).
- The notice banner is on the group's settings page only, not on every page of the group.
- A trial is given once per group, not once per person: an owner who creates a new group can try
  the paid plan again there.
