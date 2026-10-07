export function Notes() {
  return (
    <section className="wrap section" id="notes" aria-label="How it holds together">
      <header>
        <span className="n">VI</span>
        <h2>How it holds together</h2>
      </header>
      <div className="notes">
        <p>
          <b>A plain token.</b> 1,000,000,000 PUPATE. 85% opened the pool, 10% went to the IMD swarm that built this, 5% vests
          to the developer over 12 months.
        </p>
        <p>
          <b>One pool, closed.</b> Nobody can add liquidity after the block the pool opened in, so there is no way to trade
          around the tax by resting liquidity.
        </p>
        <p>
          <b>The tax only falls.</b> A 48-hour timelock can lower it. Nothing can raise it. Every other knob moves only within
          bounds written into the contracts.
        </p>
        <p>
          <b>One price, from the swarm.</b> The reference price comes from the IMD oracle, which reads the collection&apos;s sales
          on-chain. It may rise at most 25% per 6 hours; falls are not limited. Without a fresh report the vault stops buying.
        </p>
        <p>
          <b>Three exits.</b> Vault ETH leaves for exactly three reasons: buying a seat on Seaport, buying PUPATE to burn, or a
          caller reward of at most 1%.
        </p>
        <p>
          <b>No promises.</b> This page describes a mechanism. It makes no statement about returns. The tax that applies to your
          trade is always shown beside the button.
        </p>
      </div>
    </section>
  );
}
