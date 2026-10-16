import { IconCreditCard } from "@spy4x/preact-icons"
import type { AdminModule } from "../types.ts"
import { comingSoonPage } from "../coming-soon.tsx"

/** Plans, subscriptions and payments. Registered, not built yet (#424). */
export const billingModule: AdminModule = {
  id: `billing`,
  nav: { name: `Billing`, href: `/billing`, Icon: IconCreditCard },
  routes: [
    comingSoonPage({
      path: `/billing`,
      title: `Billing`,
      description: `Plans, subscriptions and payments across every group.`,
      Icon: IconCreditCard,
    }),
  ],
}
