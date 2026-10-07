import Link from "next/link";
import { Aside, Doc } from "@/components/docs/Doc";
import { DOCS, docHref } from "@/lib/docs";

export default function Overview() {
  return (
    <Doc slug="">
      <p className="intro">
        Pupate is a token on Ethereum whose trading tax buys <b>Identity MD seats</b>. Each seat the vault buys is put
        to work in the IMD swarm and listed for sale at a falling price. When a seat sells, the ETH buys PUPATE from the
        launch pool and burns it. Nobody holds the keys: every step is a public function that anyone may run.
      </p>

      <h2>The cycle</h2>
      <ol className="cycle">
        <li>
          <b>Feed.</b> A trader buys or sells PUPATE in the launch pool. The hook takes 6% of the ETH side of the trade.
        </li>
        <li>
          <b>Flush.</b> Anyone moves the collected tax into the vault, which splits it 85% to the strategy, 10% to the
          developer and 5% to buying and burning IMD.
        </li>
        <li>
          <b>Cocoon.</b> When the seat pot can afford one, anyone can have the vault buy a seat at or under the price the
          IMD oracle reports. The seat is listed at 1.5× cost, falling to 1.1× over 14 days, and paired to a worker device.
        </li>
        <li>
          <b>Work.</b> While listed, the seat takes jobs in the swarm. Tokens it earns are auctioned, and the ETH returns to
          the seat pot.
        </li>
        <li>
          <b>Emerge.</b> When the listing fills, the ETH goes to the burn pot, which buys PUPATE and destroys it.
        </li>
      </ol>

      <h2>What makes it different</h2>
      <ul>
        <li>
          <b>The seats work.</b> A seat in the vault is not idle inventory. It is paired to a worker and earns in the swarm
          until the day it sells.
        </li>
        <li>
          <b>The price comes from the swarm.</b> The vault never trusts a key for the reference price. It accepts only
          attestations signed by the IMD oracle after a panel of seats agreed, and you can{" "}
          <Link href="/feed/#proof">check one in your browser</Link>.
        </li>
        <li>
          <b>Anyone turns the crank.</b> Flushing, buying, burning and the auctions are public functions. Two of them pay
          the caller. An agent can run them from <a href="/skill.md">one skill file</a>.
        </li>
        <li>
          <b>The tax only falls.</b> A 48-hour timelock can lower it. Nothing can raise it, and every other knob moves only
          within bounds written into the contracts.
        </li>
      </ul>

      <h2>In numbers</h2>
      <table>
        <tbody>
          <tr>
            <td>Supply</td>
            <td className="num">1,000,000,000 PUPATE, fixed</td>
          </tr>
          <tr>
            <td>Allocation</td>
            <td className="num">85% launch pool · 10% IMD swarm · 5% developer, vested over 12 months</td>
          </tr>
          <tr>
            <td>Tax</td>
            <td className="num">6% of the ETH side of every buy and sell</td>
          </tr>
          <tr>
            <td>Launch window</td>
            <td className="num">buy tax 99% at the open, one point lower each minute, 6% after 93 minutes</td>
          </tr>
          <tr>
            <td>Split of the tax</td>
            <td className="num">85% strategy · 10% developer · 5% IMD burn</td>
          </tr>
          <tr>
            <td>Listing</td>
            <td className="num">1.5× cost falling to 1.1× over 14 days, then flat</td>
          </tr>
          <tr>
            <td>Caller reward</td>
            <td className="num">0.5% of the ETH a seat purchase or a burn spends</td>
          </tr>
          <tr>
            <td>Changes</td>
            <td className="num">48-hour timelock, within fixed bounds</td>
          </tr>
        </tbody>
      </table>

      <Aside tone="gold">
        Pupate is not deployed yet. The site runs a simulation of the contracts against sample figures, so the flows can
        be judged before anything is live. Addresses are published on the <Link href="/docs/launch/">launch page</Link>{" "}
        when the contracts go live.
      </Aside>

      <h2>Read on</h2>
      <div className="doc-cards">
        {DOCS.filter((d) => d.slug).map((d) => (
          <Link key={d.slug} href={docHref(d.slug)} className="panel doc-card">
            <span className="serif">{d.title}</span>
            <span className="dim">{d.blurb}</span>
          </Link>
        ))}
      </div>
    </Doc>
  );
}
