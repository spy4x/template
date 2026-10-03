import { PLANS } from "@domain/billing"
import { BillingInterval, type PricingPlan, PricingTable } from "@spy4x/preact-ui/billing"
import { Notice } from "@spy4x/preact-ui/notice"
import { Section } from "@spy4x/preact-ui/layout"
import { REPOSITORY_URL, SiteFrame, spaLinks } from "../site.tsx"
import { define } from "../utils.ts"

/**
 * The demo app's plans, read from its catalog: a product that changes `PLANS` changes this page.
 * A plan with a trial says so first.
 */
const PRICING_PLANS: PricingPlan[] = PLANS.map((plan) => ({
  id: plan.id,
  name: plan.name,
  amount: plan.amount,
  currency: plan.currency,
  interval: BillingInterval.Month,
  description: plan.description,
  features: plan.trialDays > 0
    ? [`The first ${plan.trialDays} days free`, ...plan.features]
    : [...plan.features],
  highlighted: plan.amount > 0,
  unit: plan.perSeat ? "member" : undefined,
}))

/**
 * `GET` shows the demo app's plans. `POST` is where a plan's "Try in the demo" form goes without
 * JavaScript: plans are chosen inside the app, so it sends the visitor to the app's sign-up.
 */
export const handler = define.handlers({
  POST(ctx) {
    return ctx.redirect(spaLinks(ctx.state.spaOrigin).signUp, 303)
  },
})

export default define.page(function Pricing({ state }) {
  return (
    <SiteFrame
      state={state}
      path="/pricing"
      head={{
        title: "Pricing of the demo app",
        description: "The Free and Pro plans of the demo app Template ships with, priced per " +
          "member. Template itself is free and MIT-licensed.",
      }}
    >
      <Section>
        <h1 class="text-3xl font-bold">Pricing of the demo app</h1>
        <Notice title="These are example prices">
          They are the plans of the demo app that ships with Template, read from its plan catalog.
          Template itself is free and open source under the MIT licence; your product sets its own
          plans in <code>libs/domain/billing</code>.
        </Notice>
      </Section>
      <PricingTable
        plans={PRICING_PLANS}
        action="/pricing"
        headingLevel={2}
        labels={{
          choose: "Try in the demo",
          chooseName: (name) => `Try ${name} in the demo`,
          highlighted: "Recommended",
        }}
      />
      <p class="text-sm text-muted">
        In the demo you start on Free and change the plan on your group's billing page. Questions
        about the code?{" "}
        <a href={`${REPOSITORY_URL}/issues`} class="underline">Open an issue on GitHub</a>.
      </p>
    </SiteFrame>
  )
})
