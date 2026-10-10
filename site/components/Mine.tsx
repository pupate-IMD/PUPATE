import Link from "next/link";

/// The proof-of-work layer, announced before it exists: what Chrysalis Cards are, how mining and
/// minting will work, how the price climbs, and where the fees go. Nothing here is live; the page
/// says so in its first and last lines.
export function Mine() {
  return (
    <section className="wrap mine-page" aria-label="Mine">
      <div className="mine-grid">
        <div>
          <div className="label gold">Mine · after the first cocoon</div>
          <h1 className="serif">Mine a card of a seat that works.</h1>
          <p className="lede">
            Chrysalis Cards are Pupate&apos;s proof-of-work layer. Your browser mines a solution; the solution lets you mint one
            card of a seat the vault holds, paid in PUPATE that is burned. When that seat sells, your card turns into its
            butterfly. <b>Not live yet:</b> it opens after the token launch, once the vault holds its first seat.
          </p>

          <h2 className="serif sub-h">How it will work</h2>
          <ol className="buy-steps">
            <li>
              <b>Pick a seat the vault holds.</b> Each seat has a limited run of cards, 33 per round. Sold seats close their run.
            </li>
            <li>
              <b>Mine.</b> Your browser searches for a hash under the epoch&apos;s target, on a CPU or, if you run it hard, a GPU.
              A solution is bound to your wallet; nobody else can use it.
            </li>
            <li>
              <b>Mint, in PUPATE.</b> The fee is burned, every card makes the token scarcer. To pay it you buy PUPATE in the pool,
              and that trade pays the 6% tax that buys more seats.
            </li>
            <li>
              <b>Watch it change.</b> A card is a chrysalis while the vault holds the seat, and becomes its butterfly, on-chain, the
              moment the seat sells.
            </li>
          </ol>

          <h2 className="serif sub-h">Harder and dearer as it goes</h2>
          <p className="dim mine-p">
            Difficulty and the mint price both rise by epoch, one epoch every fixed number of cards. Early miners work less and
            pay less; late miners work more and burn more. The schedule is public and written into the contract.
          </p>
          <table className="mine-table">
            <thead>
              <tr>
                <th>Epoch</th>
                <th>Difficulty</th>
                <th>Mint price</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>1</td>
                <td>base</td>
                <td>base, in PUPATE</td>
              </tr>
              <tr>
                <td>2</td>
                <td>higher</td>
                <td>× 1.25</td>
              </tr>
              <tr>
                <td>3 …</td>
                <td>higher again</td>
                <td>× 1.25 each epoch</td>
              </tr>
            </tbody>
          </table>
          <p className="dim mine-p">The exact numbers are set when the contracts are built and reviewed, and published here before mining opens.</p>

          <h2 className="serif sub-h">Fees, plainly</h2>
          <ul className="buy-notes">
            <li>
              <b>Mint:</b> paid in PUPATE, burned in full. No treasury takes a cut of a mint.
            </li>
            <li>
              <b>Resale:</b> 5% to the developer, enforced on-chain rather than left to the marketplace&apos;s goodwill. It pays for
              the oracle reports, the servers and the work around the project.
            </li>
            <li>
              The token&apos;s vault is untouched by any of this. It still has no keys, and cards only read it.
            </li>
          </ul>

          <h2 className="serif sub-h">Rarity from real work</h2>
          <p className="dim mine-p">
            A card&apos;s traits follow what its seat actually did in the swarm, read from IMD&apos;s records: a seat that took and
            passed more jobs makes a rarer card. The proof of work in the hash is spent on a proof of work by a seat. That is
            the part no hash-only project can copy.
          </p>

          <div className="empty" style={{ marginTop: 24 }}>
            Not live. Mining opens after the token launch and the first cocoon; the date and the schedule will be posted here
            and on{" "}
            <a href="https://x.com/pupateIMD" target="_blank" rel="noreferrer">
              @pupateIMD
            </a>
            . Until then there is nothing to mine and nothing to mint.
          </div>
          <p className="dim" style={{ marginTop: 20 }}>
            The seats these cards will be drawn from: <Link href="/work/">Work →</Link> · the design in full:{" "}
            <a href="https://github.com/pupate-IMD/PUPATE/blob/main/docs/v2-mining-proof-of-work.md" target="_blank" rel="noreferrer">
              v2 design on GitHub ↗
            </a>
          </p>
        </div>

        <figure className="card-preview">
          {/* The prototype render; the live cards are drawn on-chain from the seat's number. */}
          <img src="/cards/prototype-1376.svg" alt="Prototype Chrysalis Card of seat 1376: a chrysalis whose every contour is a line of 0s and 1s, a jade wing inside, a gold band, in a dark card frame" width={1080} height={1080} />
          <figcaption className="dim">
            Prototype of card No. 1376, in the cocoon. Every contour is a line of 0s and 1s seeded by the seat&apos;s number; the
            wing inside is the butterfly it becomes.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
