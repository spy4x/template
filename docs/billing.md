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

A group is on a paid plan while its subscription is trialing, active or past due. A canceled,
incomplete or paused subscription, or one billing a price that is not in the catalog, puts the group
back on Free. To add a plan, add it to `PLANS`, add its price variable to `readBillingSetup`
(`apps/api/features/billing/config.ts`) and to `infra/envs/.env.example`.

## Who may do what

- Every member sees the group's plan in the group's settings.
- Only the owner may open a checkout or the Stripe customer portal. Anyone else gets 403
  (`ROLE_INSUFFICIENT`), and a person outside the group gets 404.
- A group that already pays cannot open a second checkout (409 `ALREADY_SUBSCRIBED`); the owner
  changes or cancels the plan in the portal.

## Configuration

`BILLING_PROVIDER` picks the provider:

| Value      | What runs                                                                       |
| ---------- | ------------------------------------------------------------------------------- |
| unset      | `off` in production, `fake` with `ENV=dev`                                      |
| `off`      | No billing: every group is on Free, checkout and the webhook answer 404         |
| `stripe`   | Stripe. Needs `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `STRIPE_PRICE_PRO` |
| `fake`     | The development provider, below. Refused in production                         |

With `stripe` and any of the three keys missing, the API refuses to start and names the missing
ones. Any other value of `BILLING_PROVIDER` also stops the start.

## Flow

1. The owner opens **See plans** on the group's settings, then **Choose Pro**. The API asks Stripe
   for a checkout session with the group's id as its reference and sends the browser there.
2. Stripe takes the payment and returns the browser to the group's settings.
3. Stripe posts `customer.subscription.created` to `POST /api/webhooks/billing`. The API checks the
   signature first; then, in one transaction, it stores the event id, writes the group's
   subscription and its customer, and records `group.plan.changed` in the outbox. The worker
   announces the change, and every open page of the group reads the plan again.
4. Later changes (renewal, a failed payment, a cancellation from the portal) arrive the same way.

Delivery rules the webhook keeps:

- A repeated event id changes nothing, so Stripe's retries are safe.
- An event older than the one stored never rolls the plan back. Events are ordered by Stripe's
  `created` second, then by kind (created, updated, deleted). Two updates in the same second keep
  the one that arrived first; see "Known limits".
- The end of an old subscription does not end a newer one that replaced it.
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
   Stripe refuses to open it.

In production, add the webhook endpoint `https://<domain>/api/webhooks/billing` in the dashboard
with the same five events, and use its signing secret. Keys live in the environment only; the
tracked `.env.example` holds empty placeholders.

## The development provider

With `ENV=dev` and no `BILLING_PROVIDER`, the API runs the development provider
(`createFakeBilling` in `apps/api/features/billing/config.ts`). It calls no network:

- A checkout sends the browser straight back to the success URL, as if paid. Nothing changes until
  a webhook arrives.
- The portal sends the browser back to the group's settings.
- Webhooks are verified exactly as Stripe's are, with the public secret
  `whsec_template_development_only` and the price `price_fake_pro` for Pro.

The e2e test drives an upgrade this way: it posts a recorded `customer.subscription.created`, signed
with that secret (`e2e/fixtures/billing.ts`), to the webhook. Production refuses the development
provider, so its public secret cannot sign a real event.

## Known limits

- `@spy4x/billing` cannot read a subscription back from Stripe, so two updates in the same second
  that arrive out of order keep the first. Stripe usually sends them in order; a later event, or a
  change in the portal, corrects it.
- Payment events are stored (so repeats are skipped) but change nothing yet.
