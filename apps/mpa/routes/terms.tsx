import { LegalPage, REPOSITORY_URL } from "../site.tsx"
import { define } from "../utils.ts"

/** The few rules of the live demo. A product built on Template writes its own. */
export default define.page(function Terms({ state }) {
  return (
    <LegalPage
      state={state}
      path="/terms"
      title="Terms"
      description={"The rules of the free Template demo: what it is, what it is not, and what is " +
        "not allowed in it."}
    >
      <h2>What the demo is</h2>
      <p>
        The demo shows the app that ships with Template, an open-source project. It is free, run by
        me, Anton Shubin, and offered as it is: there is no promise that it is always up, and no
        warranty of any kind.
      </p>
      <h2>Your data</h2>
      <p>
        What you put in the demo stays yours. Its data may be reset, so keep nothing important in
        it. The <a href="/privacy">privacy page</a> says what is stored.
      </p>
      <h2>What is not allowed</h2>
      <ul>
        <li>Breaking the law, or storing content that does.</li>
        <li>Sending spam, for example through invitations.</li>
        <li>Attacking the service or other people's accounts.</li>
      </ul>
      <p>I may remove accounts and data that break these rules.</p>
      <h2>The code</h2>
      <p>
        The source is on <a href={REPOSITORY_URL}>GitHub</a>{" "}
        under the MIT licence, and that licence, not this page, governs what you may do with the
        code.
      </p>
      <h2>Changes</h2>
      <p>
        When these terms change, the new text appears on this page. Questions go to{" "}
        <a href="https://antonshubin.com">antonshubin.com</a>.
      </p>
    </LegalPage>
  )
})
