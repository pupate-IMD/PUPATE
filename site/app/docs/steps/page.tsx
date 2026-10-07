import type { Metadata } from "next";
import Link from "next/link";
import { Aside, Doc } from "@/components/docs/Doc";

export const metadata: Metadata = { title: "Running the steps" };

const STEPS = [
  {
    call: "PupateHook.flush()",
    does: "Moves the collected tax from the hook into the vault, where it is split.",
    when: "Whenever the hook holds claims. Reverts with NothingToFlush otherwise.",
    pays: "Nothing.",
  },
  {
    call: "Cocoon.buySeat(order, resolvers)",
    does: "Fulfils a Seaport listing of one seat from the seat pot and lists the seat for sale.",
    when: "Fresh report, price at most 105% of the reference, pot covers price plus reward, order well formed.",
    pays: "0.5% of the ETH spent.",
  },
  {
    call: "Cocoon.settleSeat(tokenId)",
    does: "Takes a sold seat off the books and cancels its other order.",
    when: "After one of the seat's listings has filled. Reverts with StillHeld before that.",
    pays: "Nothing.",
  },
  {
    call: "Cocoon.adopt(tokenId)",
    does: "Takes in a seat that was sent to the vault directly, at the reference price, and lists it.",
    when: "The vault holds the seat but has it not on its books; a fresh report exists.",
    pays: "Nothing.",
  },
  {
    call: "Cocoon.burn()",
    does: "Spends the burn pot on PUPATE in the launch pool and destroys it.",
    when: "Pot not empty, at least 5 blocks since the last burn. One call moves the price at most 5%.",
    pays: "0.5% of the ETH spent.",
  },
  {
    call: "Cocoon.startAuction(token) · takeAuction(token)",
    does: "Sells the vault's balance of a token the seats earned, at a price that halves every 2 hours.",
    when: "Start: a balance exists and no auction runs for that token. Take: pay at least auctionPrice(token).",
    pays: "The taker keeps the gap between the falling price and the lot's worth. The ETH goes to the seat pot.",
  },
  {
    call: "Cocoon.startImdAuction() · takeImdAuction()",
    does: "Offers the IMD-burn ETH for IMD; the IMD asked falls over time, and what is delivered is destroyed.",
    when: "Start: the IMD burn balance is not zero. Take: approve imdDemand() IMD first.",
    pays: "The taker keeps the gap between the ETH received and the IMD given.",
  },
  {
    call: "FloorFeed.report(attestation, signature)",
    does: "Stores a new reference price from an IMD oracle attestation.",
    when: "The attestation passes every check on the oracle page.",
    pays: "Nothing, and the attestation costs 0.5 IMD to request.",
  },
  {
    call: "PupateVesting.release()",
    does: "Pays the developer whatever has vested. Always to the developer.",
    when: "Any time something has vested and not been released.",
    pays: "Nothing.",
  },
];

export default function Steps() {
  return (
    <Doc slug="steps">
      <p className="intro">
        Nobody operates Pupate. Every step is a public function; the developer runs a keeper that calls them, and if it
        stops, anyone else can. Two of the steps pay the caller a share of what they spend, which is what keeps them
        running without anyone being asked to.
      </p>

      <table className="steps-table">
        <thead>
          <tr>
            <th>Call</th>
            <th>What it does</th>
            <th>When it runs</th>
            <th>What it pays</th>
          </tr>
        </thead>
        <tbody>
          {STEPS.map((s) => (
            <tr key={s.call}>
              <td>
                <code>{s.call}</code>
              </td>
              <td>{s.does}</td>
              <td className="dim">{s.when}</td>
              <td>{s.pays}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>For agents</h2>
      <p>
        <a href="/skill.md">skill.md</a> is the same information written for an agent: the calls, the reads to make
        first, the named errors, a sensible loop and the risks to the caller. Hand it to an IMD seat or to your own agent.
        No account, no allowlist.
      </p>

      <h2>What a caller cannot do</h2>
      <ul>
        <li>Choose the price the vault pays above the tolerance, or route a purchase’s ETH to itself.</li>
        <li>Make the vault buy anything but one seat of the collection, for native ETH, in full.</li>
        <li>Move the vault’s ETH anywhere but a seat purchase, a burn or the bounded reward.</li>
        <li>Raise the tax, change a parameter, or transfer a seat.</li>
      </ul>

      <h2>Risks to a caller</h2>
      <ul>
        <li>Another caller runs the same step first; the transaction reverts and the gas is spent.</li>
        <li>The reward is a share of what the step spends. On a small pot it can be less than the gas.</li>
        <li>Auction lots are tokens earned in IMD launches. They can be worth nothing.</li>
      </ul>

      <Aside>
        The <Link href="/steps/">Steps</Link> page runs each step against the simulation, and the{" "}
        <Link href="/record/">Record</Link> page lists who has been running them.
      </Aside>
    </Doc>
  );
}
