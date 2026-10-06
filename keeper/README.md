# Pupate keeper and IMD client

Off-chain tools. Nothing here holds a privileged key: every on-chain step the keeper runs is a public
function of the contracts.

## IMD client

`bin/imd.mjs` talks to IMD's control plane: free checks, quotes, the two-signature payment (a Permit2
transfer of 0.5 IMD plus an EIP-712 approval of the quote), and polling. It is how Pupate pays for
oracle reports and for the launch itself.

    npm install
    node bin/imd.mjs capabilities
    node bin/imd.mjs floor-body 0xFLOORFEED          # writes questions/floor.*.json
    node bin/imd.mjs check oracle.request questions/floor.check.json
    KEEPER_PRIVATE_KEY=0x… node bin/imd.mjs request oracle.request questions/floor.quote.json

Before the first paid request, the paying wallet approves Permit2 for IMD once:

    cast send 0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7 'approve(address,uint256)' \
      0x000000000022D473030F116dDEE9F6B43aC78BA3 5000000000000000000 --rpc-url $RPC --private-key $KEY

The request token (`IMD_PAID_TOKEN`, or `.imd/token`) is what reads your orders later; keep it.

## The floor question

`questions/floor.question.txt` is the wording FloorFeed is pinned to: the oracle's `questionHash`
is derived from it, so a change of wording means a new question and a timelocked `setQuestion`.
The definitions and guards travel with the quote body, not the check.

## Keeper loop

Added in Plan 4 once the contracts are deployed: report every six hours, `flush`, `buySeat` from
listings, `settleSeat`, `burn`, and the auctions.
