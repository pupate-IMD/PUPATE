# Mainnet launch runner

`launch.mjs` is `docs/deployment.md` as a program: the same steps, in the same order, each one
reading the chain first and refusing to repeat what is already done, so an interrupted launch is
continued by running the step again. The two steps that spend IMD say so in their names below and
are run on an explicit go.

    node script/mainnet/launch.mjs status     balances, base fee, which steps are done
    node script/mainnet/launch.mjs pre        DeployPreLaunch: timelock, FloorFeed, Cocoon          gas only
    node script/mainnet/launch.mjs redeploy   a corrected Cocoon beside the same FloorFeed and
                                              timelock, at the address launch.json names; only
                                              before the launch                                   gas only
    node script/mainnet/launch.mjs question   Permit2 approval if needed, the oracle request, the
                                              attestation, questionHash                           0.5 IMD
    node script/mainnet/launch.mjs manifest   fill launch.json, commit, push, free launch check    nothing
    node script/mainnet/launch.mjs open       launch.open, wait until live, verify token and hook  0.5 IMD
    node script/mainnet/launch.mjs post       PostLaunch: wire, vest 5%, pin the question, hand
                                              FloorFeed and Cocoon to the timelock                 gas only
    node script/mainnet/launch.mjs report     the first floor report, from the kept attestation    gas only
    node script/mainnet/launch.mjs finish     keeper/addresses.mainnet.json, the site snippet, links

Needs Foundry (found where `foundryup` installs it when the shell's PATH does not have it), Node 22+,
the keeper's dependencies (`cd keeper && npm install`), and in `.env`:
`MAINNET_RPC_URL`, `KEEPER_PRIVATE_KEY` (the deployer, who is `DEVELOPER`, `OPERATOR` and the wallet
that pays IMD), optionally `ETHERSCAN_API_KEY` for source verification and `MAX_BASE_FEE_GWEI`
(default 1: no transaction is sent while the base fee is above it). No secret is printed; errors are
scrubbed of the RPC URL and the keys.

## What it keeps

Progress (addresses, the oracle request id, the question hash, the launch id and, after a parked
launch, the orders that were paid before) in `keeper/.launch/progress.json` (ignored by git); the first
attestation in `keeper/.launch/first-attestation.json`; the launch request as sent in
`keeper/.launch/launch.request.json`; the paid-action request token in `keeper/.imd/token` (ignored by
git; it is what reads the orders later). Before a step acts on the progress file, the addresses in it
are checked against forge's broadcast records and the chain. `finish` writes
`keeper/addresses.mainnet.json`, which is committed.

## When IMD parks the launch

`open` stops with the judge's finding and the 0.5 IMD is spent (IMD returned half of it within
minutes, both times so far). The order cannot be opened again: answer the finding, commit, and run
`manifest` again, which puts the parked order aside and refuses to prepare a new request for the very
commit that was parked; `open` then pays for a new order. If the finding is in Cocoon, `redeploy`
first: the hook takes the vault's address in its constructor and is deployed by the launch, so a
corrected vault can take the old one's place until then. `launch.json`, the launch request and the fork
test name the new vault's address before it exists (the deployer's next contract address), and
`redeploy` sends nothing if the deployer's nonce has moved since.

## Built from the Sepolia rehearsal

Gas limits are forge's simulation times 1.3 (mainnet's `eth_estimateGas` agrees with forge, unlike
Sepolia's); transactions go out one at a time with retries, and each step waits for three agreeing
polls before reading what the previous one did, because the RPC provider's nodes lag each other.
`PostLaunch` itself is idempotent. `open` follows the paid order's job to its launch record and stops
with the reason if IMD parks it; while it waits for the swarm (about an hour) it waits out network
errors as well, so a laptop that slept in between picks the same job up when it wakes, and a rerun
never pays twice.

## Metamorph MD

Two scripts, the art first, each run once the review is clean. Neither deployment can be corrected: the
three art contracts have no owner and no setter, and the token keeps the art's address as an immutable.

The wrapper. `script/mainnet/metamorph.mjs` runs this section from any shell, as `launch.mjs` runs the
launch: `.env` read by the script, forge found where `foundryup` put it, nothing secret printed.

    node script/mainnet/metamorph.mjs status      chain, deployer, base fee, what is recorded, the live checks
    node script/mainnet/metamorph.mjs art         step 1: the two figures and the router                  gas only
    node script/mainnet/metamorph.mjs rehearsal   between 1 and 2: the throwaway ERC-721 wearing the router gas only
    node script/mainnet/metamorph.mjs token       step 2: MetamorphMD at 20 bits                          gas only
    node script/mainnet/metamorph.mjs record      steps 3 and 4: site/lib/addresses.ts, then the git, keeper
                                                  and site lines to run by hand

Each command reads the chain first and refuses what this section says to refuse: a step already recorded
(`--again` deploys over it), a sample length that is not the code's, a base fee above `MAX_BASE_FEE_GWEI`
(default 2 here). The three that broadcast run the forge script without `--broadcast` first and show its
addresses and sample lines, ask whether the keeper loop is stopped (the art and the token) and
`broadcast? (yes/no)` before anything is sent (`--dry-run` sends nothing and asks nothing), check the result
on chain as the commands below do, and record the addresses in `keeper/.launch/metamorph.json` and
`keeper/addresses.mainnet.json`; the rehearsal is recorded in the progress file only. The raw commands below
remain the reference and the fallback.

1. Deploy the art: `MetamorphChrysalis`, `MetamorphButterfly`, then the router `MetamorphArt` with their
   addresses. Look at a rendered sample before broadcasting. `node script/art/parity.mjs` runs the same
   script on a local anvil (port 8546, anvil's public test key), reads 24 cards through `tokenURI`, checks
   each against the JavaScript mirror byte for byte and as XML, prints the gas and the sizes, and writes the
   SVGs to `out/art/`. Then `node script/art/thumbs.mjs` draws them as PNGs in `out/art/png/` with headless
   Edge (`EDGE_PATH`, or the path as the argument, names an `msedge.exe` other than the Windows default).
   Both must end without an error, and the owner looks at the PNGs.

   Recommended, not required, before the mainnet broadcast: look at a card where collectors will see it.
   Deploy the art on a testnet beside a throwaway ERC-721 whose `tokenURI(id)` returns `art.tokenURI(view)`
   for a fixed `View` per id (cards from `node script/art/mirror.mjs sample`, both stages), mint a few, and
   open them on a testnet marketplace's item page and in a wallet. The reason is `<textPath>`, which draws
   the figure's digit contours and the halo rings: browsers draw it, and so do marketplaces that render in a
   browser (as they do Uniswap v3's textPath NFTs), but rasterisers built on librsvg (sharp) draw no
   `<textPath>`. Wherever a marketplace or a wallet turns the image into a PNG on a server, the contours and
   the halos vanish (a chrysalis loses its whole shell) and what is left is the frame, the labels and the
   plain strokes. The art cannot be changed once the token has it, so this is the last look before that;
   whether it is worth a testnet deployment is the owner's call.

   Rehearsal on Sepolia. `script/RehearseMetamorphArt.s.sol` is that testnet deployment: the two figures and
   the router exactly as the mainnet script deploys them, then `MetamorphRehearsal`
   (`script/rehearsal/MetamorphRehearsal.sol`), a throwaway ERC-721 ("Metamorph MD rehearsal", MMDR) with
   eight cards of the parity sample minted to the deployer, four chrysalises and four butterflies, a gilt one
   in each stage, every form and every halo among them, whose `tokenURI(id)` is the router's card. Any funded
   Sepolia key will do as `SEPOLIA_KEY` (keep it in `.env`, which is gitignored); the four transactions take
   9,595,604 gas together, as the local run measured them, in Sepolia ETH only. Simulate without `--broadcast`
   first, then broadcast; both print the four addresses and a line per token, `token 1 stage 0 gilt false
   tokenURI bytes 21045` and so on, the code alone fixing the numbers. OpenSea retired its testnet site
   (`testnets.opensea.io` redirects to its "Farewell testnets" article, and its API knows no Sepolia), so the
   testnet look is Sepolia Etherscan's token page,
   `https://sepolia.etherscan.io/nft/<MetamorphRehearsal address>/<id>` for ids 1 to 8, and a wallet that
   shows Sepolia NFTs (MetaMask on Sepolia imports one by the rehearsal's address and the id). The marketplace
   look is on mainnet, between step 1 and step 2: once the real router is deployed and checked, run the same
   script with `ART=<metamorphArt>` in the environment and it deploys nothing but the throwaway ERC-721
   (about 1.95M gas), wearing that router; then open
   `https://opensea.io/assets/ethereum/<MetamorphRehearsal address>/<id>` and the cards in a wallet, and
   only then deploy the token. What should be there, as in the browser view of `out/art/`: the digit
   contours that draw the figure and the halo rings around it, a chrysalis in its whole shell. A chrysalis
   without its shell, only the frame, the labels and the plain strokes left, means that marketplace or wallet
   rasterises on a server without `<textPath>`. The rehearsal contracts are throwaway: nothing from them is
   recorded in the address book, nothing depends on them, and the eight cards stay in the deployer's wallet
   (hide the collection on OpenSea afterwards if its name should not show beside the real one).

       set -a; . ./.env; set +a
       forge script script/RehearseMetamorphArt.s.sol --rpc-url "$SEPOLIA_RPC_URL" --private-key "$SEPOLIA_KEY"
       forge script script/RehearseMetamorphArt.s.sol --rpc-url "$SEPOLIA_RPC_URL" --private-key "$SEPOLIA_KEY" --broadcast          --gas-estimate-multiplier 900 --slow --retries 10 --delay 8
       ART=<metamorphArt> forge script script/RehearseMetamorphArt.s.sol --rpc-url "$MAINNET_RPC_URL" --private-key "$KEEPER_PRIVATE_KEY" --broadcast

   The multiplier is the lesson of the first Sepolia rehearsal (`docs/deployment.md`, "What the Sepolia
   rehearsal taught"): forge simulates on the project's `cancun` EVM and Sepolia runs a newer schedule under
   which contract creation costs about seven times the estimate, so with the default margin all four
   transactions run out of gas and burn their whole limit (as happened on 2026-10-15, ~12.5M gas lost). With
   `900` the four took 64.9M gas in all (12.0M, 12.9M, 29.2M and 10.8M), under 0.002 Sepolia ETH at the
   gas price of the day.
   Mainnet needs no multiplier: its `eth_estimateGas` agrees with forge.

   Stop the keeper loop (`node keeper/bin/keeper.mjs --loop`, or the pm2 or systemd unit that runs it)
   before the broadcast, wait until its last transaction is mined, and start it again when step 2 is done.
   The deploy key is the keeper's key, and the three transactions depend on one another: the router takes the
   two figures' addresses, which follow from the deployer's nonce when the script is simulated, so a keeper
   transaction that takes one of those nonces in between leaves a router that points at an address with no
   code, and nothing can correct that. Simulate first, without `--broadcast`:

       forge script script/DeployMetamorphArt.s.sol --rpc-url "$MAINNET_RPC_URL" --private-key "$KEEPER_PRIVATE_KEY"

   The dry run prints the three addresses the broadcast will create, then reads token 1 (seat 1376's holotype)
   through the router in each stage and prints the length of its token URI: `sample chrysalis tokenURI bytes
   21045` and `sample butterfly tokenURI bytes 20285` (the code alone fixes the numbers). Then broadcast:

       forge script script/DeployMetamorphArt.s.sol --rpc-url "$MAINNET_RPC_URL" --broadcast --private-key "$KEEPER_PRIVATE_KEY"

   With `ETHERSCAN_API_KEY` set, add `--verify` to the broadcast and forge verifies the three contracts as it
   sends them, as `docs/deployment.md` does for the earlier scripts. Without it, verify them afterwards, with
   the addresses the script printed:

       forge verify-contract <chrysalis> src/metamorph/art/MetamorphChrysalis.sol:MetamorphChrysalis \
         --chain mainnet --watch
       forge verify-contract <butterfly> src/metamorph/art/MetamorphButterfly.sol:MetamorphButterfly \
         --chain mainnet --watch
       forge verify-contract <router> src/metamorph/art/MetamorphArt.sol:MetamorphArt --chain mainnet --watch \
         --constructor-args "$(cast abi-encode 'constructor(address,address)' <chrysalis> <butterfly>)"

   Record `metamorphArt`, the router (`MetamorphArt`). Before the token takes it as `ART`, check it:

       ART=<metamorphArt>
       cast codesize $(cast call "$ART" "CHRYSALIS()(address)" --rpc-url "$MAINNET_RPC_URL") \
         --rpc-url "$MAINNET_RPC_URL"
       cast codesize $(cast call "$ART" "BUTTERFLY()(address)" --rpc-url "$MAINNET_RPC_URL") \
         --rpc-url "$MAINNET_RPC_URL"
       cast call "$ART" \
         "tokenURI((uint256,uint256,uint16,uint16,uint8,bool,uint16,address,uint40,uint256))(string)" \
         "(1,1376,0,1,0,false,1,<your address>,0,50000000000000000000000)" --rpc-url "$MAINNET_RPC_URL"

   The first prints `7655` and the second `8191`. The third returns a URI, `"data:application/json;base64,…"`;
   piped through `tr -d '"\n' | wc -c` it counts 21045, the dry run's number. Repeat it with `1` in place of the
   fifth field, the stage, for the butterfly: 20285. If any of the four differs, do not run step 2. Nothing has
   taken this art yet, so a wrong deployment is only abandoned, at the gas of three contracts: deploy again
   and check again.

2. Deploy the token, `ART` being the router:

       COCOON=… HOOK=… PUPATE=… IMD=… COLLECTION=… POOL_MANAGER=… ART=<metamorphArt> MIN_BITS=20 \
       forge script script/DeployMetamorph.s.sol --rpc-url "$MAINNET_RPC_URL" --broadcast --private-key "$KEEPER_PRIVATE_KEY" -vv

   The script refuses any `MIN_BITS` but 20, an `ART` without code, and an `ART` that does not draw: its
   simulation reads token 1 through `ART` as a chrysalis and as a butterfly and stops, before anything is
   sent, unless each token URI is at least 100 bytes and begins `data:application/json;base64,`. The
   constructor refuses pool keys that are not the hook's launch pool and an initialised hookless ETH/IMD
   pool charging at least 1% (`BadPoolKey`), and addresses that are not the vault's own: IMD, the
   collection and the PoolManager must be the ones Cocoon names, and the hook must pay Cocoon
   (`BadWiring`). Nothing can be corrected after the deployment. With `ETHERSCAN_API_KEY` set, add
   `--verify` here as well, and start the keeper loop again.

3. Record the two addresses, and the keeper takes the mine's duties. Add `"metamorph"` (the token,
   `MetamorphMD`) and `"metamorphArt"` (the router, `MetamorphArt`) to `keeper/addresses.mainnet.json`, and
   the same two fields to `MAINNET` in `site/lib/addresses.ts`; commit both. The keeper reads `metamorph`
   from its addresses file only (no environment variable names it), so the keeper's `.env` on the VPS must
   name that file: `ADDRESSES=/opt/pupate/app/keeper/addresses.mainnet.json`, an absolute path, since the
   keeper runs in `keeper/`. Any `TOKEN=`, `COCOON=`, … lines may stay; each still overrides the file. Print
   the decisions once without sending anything, then restart the loop the usual way (`deploy/update.sh`, or
   `pm2 restart pupate-keeper --update-env`):

       node keeper/bin/keeper.mjs --once --dry-run

   The start line is the one it always was, with ` metamorph <MetamorphMD>` at the end of the address line,
   where the keeper said `no metamorph in the addresses: the mine duties (noteSeats, forgetSeats, convert,
   poke) are skipped` before. From the next tick on the keeper notes every seat the vault holds
   (`noteSeat`), forgets every seat the vault sold (`forgetSeat`), converts the pot once it holds 20 mint
   prices, and pokes the staked cards that emerged (`keeper/README.md`, "The mine's duties"); its
   `status.json` gains the `mine` block. Seats the vault already holds are noted on that first tick.

   `noteSeat(seat)` and `forgetSeat(seat)` stay permissionless, so anyone can call them while the keeper is
   down. To find the vault's seats by hand, replay Cocoon's `SeatBought` and `SeatAdopted` events from
   `fromBlock` in `keeper/addresses.mainnet.json`, drop every seat whose last event is a `SeatSold`, and
   call `noteSeat` for each one the vault still holds (it reverts `SeatNotHeld` for any other). After a sale,
   `forgetSeat(seat)` stops mints walking a seat the vault no longer holds. A seat the vault buys again can
   be noted again, in its new round.

4. Publish the site. The mine page and Your cards read `metamorph` and `metamorphArt` from `MAINNET` in
   `site/lib/addresses.ts` at build time, so the deployment that carries them is the one that opens the
   mine. From `site/`:

       npm run mine-live
       npm run copy-check && npm run typecheck && npm run build
       vercel --prod --yes

   `npm run mine-live` is the end-to-end run of the same code on the local stack: headless Edge with a dev
   wallet connects through RainbowKit, approves PUPATE, mines and mints at one bit, stakes, claims and
   unstakes on /cards/, and loses one forced race. It uses a running stack (`node script/local/up.mjs`), or
   brings one up and down itself when `MAINNET_RPC_URL` is in the shell (`set -a; . ../.env; set +a`), and it
   ends with `mine-live: 23 of 23 steps passed`. Do not deploy on anything less.

   Then look at `https://pupate.fun/mine/`: no preview chip, the mint price, the epoch and the numbers from
   the chain, Start mining on and the practice run a link away. Until the keeper has noted the first seat
   the mine reads "Ready. The vault holds no seat yet, so cards draw from the whole identity.md
   collection.", and every mint draws its seat from the whole collection (the commons); from the first noted
   seat on, from the vault's seats, with no second deployment. Announce it as "contracts live, the mine is
   open".
