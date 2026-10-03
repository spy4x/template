import { LegalPage, REPOSITORY_URL } from "../site.tsx"
import { define } from "../utils.ts"

/** What the live demo stores and why, in plain words. A product built on Template adapts it. */
export default define.page(function Privacy({ state }) {
  return (
    <LegalPage
      state={state}
      path="/privacy"
      title="Privacy"
      description={"What the Template demo stores about you, which cookie it sets, and how to have " +
        "your data deleted."}
    >
      <p>
        I'm Anton Shubin, and I run the demo of Template at{" "}
        <a href={state.spaOrigin}>{new URL(state.spaOrigin).host}</a>{" "}
        so you can try it. This page says what the demo keeps about you and why.
      </p>
      <h2>What it stores</h2>
      <ul>
        <li>
          Your account: the username, the password as a salted hash only (never the password
          itself), the e-mail address and the name if you add them, and the second-factor secret if
          you turn it on.
        </li>
        <li>What you create: groups, who is in them, invitations and notes.</li>
        <li>A record of sign-ins and changes, with the time, so problems can be traced.</li>
        <li>
          Your browser's push address, only if you allow notifications. Turning them off removes it.
        </li>
        <li>Your e-mail address, if you subscribe to the newsletter.</li>
        <li>
          If billing is on and you choose a paid plan, Stripe takes the payment. The demo keeps only
          Stripe's customer and subscription numbers, never your card.
        </li>
      </ul>
      <p>
        Mail, such as sign-in codes, reset links, invitations and the newsletter, goes out through
        an e-mail provider. The servers keep request logs to run and fix the service.
      </p>
      <h2>Cookies and your browser</h2>
      <p>
        The demo sets one cookie, when you sign in, and uses it only to keep you signed in. There
        are no advertising cookies, no analytics and no tracking. So that the app opens without a
        network, it also keeps a copy of your notes and groups in your browser's own storage.
      </p>
      <h2>What it does not do</h2>
      <p>It does not sell or share your data, and shows no ads.</p>
      <h2>Deleting your data</h2>
      <p>
        You cannot delete an account from inside the app yet. To have yours and everything in it
        deleted, write to me through{" "}
        <a href="https://antonshubin.com">antonshubin.com</a>. Do not keep anything important in the
        demo: it is a demo, and its data may be reset.
      </p>
      <h2>Questions</h2>
      <p>
        Ask through <a href="https://antonshubin.com">antonshubin.com</a> or{" "}
        <a href={`${REPOSITORY_URL}/issues`}>an issue on GitHub</a>.
      </p>
    </LegalPage>
  )
})
