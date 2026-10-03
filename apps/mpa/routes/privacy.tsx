import { LegalPage, REPOSITORY_URL } from "../site.tsx"
import { define } from "../utils.ts"

/** What the live demo stores and why, in plain words. A product built on Template adapts it. */
export default define.page(function Privacy({ state }) {
  return (
    <LegalPage
      state={state}
      path="/privacy"
      title="Privacy"
      description={"What the Template demo stores about you, which cookies it sets, and how to have " +
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
        <li>
          A record of each sign-in, with the time, your IP address and your browser's user agent,
          and a record of changes with the time, so problems and break-ins can be traced.
        </li>
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
      <p>The demo sets two cookies when you sign in, and only for the session:</p>
      <ul>
        <li>
          A signed session cookie that scripts cannot read. It keeps you signed in.
        </li>
        <li>
          <code>user_id</code>, which holds your account number and which the app's scripts can
          read, so the app knows who is signed in before it asks the server.
        </li>
      </ul>
      <p>
        There are no advertising cookies, no analytics and no tracking. So that the app opens
        without a network, it also keeps in your browser's own storage: who is signed in, a copy of
        your notes and groups, the group you last selected, and the position the realtime connection
        reached, so it picks up where it left off.
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
