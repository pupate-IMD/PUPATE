# Pupate Plan 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Pupate repository, build and test the FloorFeed contract against a real IMD oracle attestation, and record answers to the Phase 0 questions that can be answered without spending money.

**Architecture:** A Foundry project whose toolchain settings match what IMD's launch factory rebuilds with. FloorFeed verifies IMD oracle attestations (EIP-712, domain bound to the consuming contract) and exposes the latest floor price. Phase 0 findings are written to a document that later plans argue from.

**Tech Stack:** Solidity 0.8.26, Foundry (forge 1.7.1), EVM `cancun`, forge-std. No other dependencies in this plan.

**Spec:** `docs/superpowers/specs/2026-10-06-pupate-design.md`

> FloorFeed as written in Task 2 was revised in Plan 2 after review: the question is set by the owner, the evidence chain is a constructor argument, and the move cap became a rise limit that always applies. `src/FloorFeed.sol` is current; this plan is the historical record.

This is plan 1 of 4. Later plans, each written after this one's findings are in:

- Plan 2: PupateHook (tax and mode split), patterned on IMD launch 168 (TollgateHook).
- Plan 3: Cocoon (Seaport buy and list, burn, auctions, seat pairing).
- Plan 4: launch manifest, Sepolia rehearsal, keeper bot, website.

## Global Constraints

- Everything in the repository is English: code, identifiers, comments, docs, commit messages.
- Solidity `0.8.26` exactly; `evm_version = "cancun"`; optimizer on, 200 runs; `via_ir = false`; `bytecode_hash = "none"`; `cbor_metadata = false`. These match IMD reference launches and must not drift.
- No proxies, no `delegatecall`, no `selfdestruct`.
- No push to any remote. Local commits only.
- Oracle domain: name `IdentityMD Oracle`, version `2`, `chainId`, `verifyingContract` = the consuming contract.
- A floor report is fresh for 6 hours. A new report may move the stored floor by at most 25% from the previous fresh one.

## Review Focus

1. An attestation issued for a different consumer contract is submitted to FloorFeed: it must be rejected (domain binding).
2. The same attestation is submitted twice, or an older one after a newer one: the second must be rejected.
3. The `answer` bytes are not exactly 32 bytes, or decode to zero: rejected, stored floor unchanged.
4. A signature with a high `s` value or a length other than 65 bytes: rejected.
5. The previous report has gone stale and the new one differs by more than 25%: accepted, because the cap only applies against a fresh previous report.

Each of these has a test in Task 2.

---

### Task 1: Repository scaffold

**Files:**
- Create: `foundry.toml`, `.gitignore`, `README.md`, `lib/forge-std/` (vendored)
- Test: `test/Scaffold.t.sol`

**Interfaces:**
- Produces: a repository where `forge build` and `forge test` run offline.

- [ ] **Step 1: Initialise git and vendor forge-std**

```bash
cd "/c/dev/imd project"
git init -b main
git clone --depth 1 --branch v1.9.7 https://github.com/foundry-rs/forge-std lib/forge-std
rm -rf lib/forge-std/.git
```

- [ ] **Step 2: Write `foundry.toml`**

```toml
[profile.default]
src = "src"
test = "test"
out = "out"
libs = ["lib"]
solc_version = "0.8.26"
evm_version = "cancun"
optimizer = true
optimizer_runs = 200
via_ir = false
bytecode_hash = "none"
cbor_metadata = false
ffi = false
fs_permissions = []
remappings = ["forge-std/=lib/forge-std/src/"]

[profile.default.fuzz]
runs = 256

[profile.default.invariant]
runs = 48
depth = 48
fail_on_revert = true

[fmt]
line_length = 110
ignore = ["lib/**"]
```

- [ ] **Step 3: Write `.gitignore`**

```
out/
cache/
broadcast/
.env
node_modules/
```

- [ ] **Step 4: Write `test/Scaffold.t.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

contract ScaffoldTest is Test {
    function test_toolchainIsCancun() public {
        // TSTORE/TLOAD only exist from cancun onwards.
        bytes32 slot = bytes32(uint256(1));
        uint256 out;
        assembly {
            tstore(slot, 42)
            out := tload(slot)
        }
        assertEq(out, 42);
    }
}
```

- [ ] **Step 5: Run the test**

Run: `forge test --match-contract ScaffoldTest -vv`
Expected: 1 passed.

- [ ] **Step 6: Write `README.md`**

```markdown
# Pupate

Pupate is a strategy token on Ethereum. A tax on every trade funds a vault that buys Identity MD
seats, puts them to work in the IMD swarm, and lists them for resale. An IMD oracle report of the
collection floor decides how much of the tax buys seats and how much buys back and burns the token.

Design: `docs/superpowers/specs/2026-10-06-pupate-design.md`

## Build

    forge build
    forge test

Toolchain is pinned in `foundry.toml`. Dependencies are vendored under `lib/`; the build needs no network.
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold Foundry project"
```

---

### Task 2: FloorFeed

**Files:**
- Create: `src/oracle/OracleAttestation.sol`, `src/FloorFeed.sol`
- Test: `test/OracleAttestation.t.sol`, `test/FloorFeed.t.sol`

**Interfaces:**
- Produces:
  - `library OracleAttestation` with `struct Attestation`, `function domainSeparator(uint256 chainId, address verifyingContract) internal pure returns (bytes32)`, `function digest(bytes32 domainSep, Attestation memory a) internal pure returns (bytes32)`, `function recover(bytes32 digest_, bytes memory sig) internal pure returns (address)`, `uint8 internal constant ANSWER_TYPE_UINT256`.
  - `contract FloorFeed` with `function report(OracleAttestation.Attestation calldata a, bytes calldata sig) external`, `function latest() external view returns (uint256 floorWei, bool fresh)`, `function setAttester(address) external`, `function setMaxAge(uint64) external`, `function transferOwnership(address) external`.

The real attestation used as a fixture (fetched 2026-10-06 from `GET https://api.imd.fun/oracle/requests/09432604-8c1a-4407-8d8d-6c66d7756679/attestation`):

| Field | Value |
|---|---|
| domain.chainId | `1` |
| domain.verifyingContract | `0x37bfb8ac7c960e558657871d41ca70e07e7dbfff` |
| requestId | `0x094326048c1a44078d8d6c66d775667900000000000000000000000000000000` |
| chainId | `1` |
| questionHash | `0x39eecf277118e4219d50e4352a2fcf943cf802239c546d54dd4baba53c72d787` |
| answerType | JSON says `"uint256"`; the EIP-712 type is `uint8`. The numeric value is discovered in Step 3. |
| answer | `0x00000000000000000000000000000000000000000000000000000000d588b5a0` |
| figure | `0` |
| fromBlock / toBlock | `26122900` / `26122901` |
| blockHash | `0x22cd78830715d67d27849123a084fe3b854a1af74b40cd7f73c727399eef3059` |
| panelJobId | `0x4d78f9ab3839475ab2993602d0501de500000000000000000000000000000000` |
| panelSize / quorum / agreed | `5` / `4` / `4` |
| issuedAt / expiresAt | `1791254782` / `1791276382` |
| signature | `0xbfd589bb67b89a4f2a44bfcd689d7eb10309c1cf1e84fa42c417c162a7baf2a91fdd5e18ef891b9ae9f63882fdb3dc1e14e2bd13305b984afcf0ceb0059acfe01c` |
| signer | `0x5598aa9146215bc13eb26f2c692ad1461fd32982` |

- [ ] **Step 1: Write `src/oracle/OracleAttestation.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice EIP-712 encoding of an IMD oracle attestation.
library OracleAttestation {
    struct Attestation {
        bytes32 requestId;
        uint256 chainId;
        bytes32 questionHash;
        uint8 answerType;
        bytes answer;
        uint256 figure;
        uint64 fromBlock;
        uint64 toBlock;
        bytes32 blockHash;
        bytes32 panelJobId;
        uint16 panelSize;
        uint16 quorum;
        uint16 agreed;
        uint64 issuedAt;
        uint64 expiresAt;
    }

    error BadSignatureLength();
    error BadSignatureS();

    uint8 internal constant ANSWER_TYPE_UINT256 = 0;

    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant NAME_HASH = keccak256("IdentityMD Oracle");
    bytes32 internal constant VERSION_HASH = keccak256("2");
    bytes32 internal constant TYPEHASH = keccak256(
        "OracleAttestation(bytes32 requestId,uint256 chainId,bytes32 questionHash,uint8 answerType,bytes answer,uint256 figure,uint64 fromBlock,uint64 toBlock,bytes32 blockHash,bytes32 panelJobId,uint16 panelSize,uint16 quorum,uint16 agreed,uint64 issuedAt,uint64 expiresAt)"
    );
    // secp256k1n / 2; signatures with a larger s are malleable and rejected.
    uint256 private constant HALF_N = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    function domainSeparator(uint256 chainId, address verifyingContract) internal pure returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, chainId, verifyingContract));
    }

    function digest(bytes32 domainSep, Attestation memory a) internal pure returns (bytes32) {
        // Encoded in two halves to stay within the stack limit without via_ir.
        bytes memory head = abi.encode(
            TYPEHASH, a.requestId, a.chainId, a.questionHash, a.answerType, keccak256(a.answer), a.figure, a.fromBlock
        );
        bytes memory tail = abi.encode(
            a.toBlock, a.blockHash, a.panelJobId, a.panelSize, a.quorum, a.agreed, a.issuedAt, a.expiresAt
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSep, keccak256(bytes.concat(head, tail))));
    }

    function recover(bytes32 digest_, bytes memory sig) internal pure returns (address) {
        if (sig.length != 65) revert BadSignatureLength();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 0x20))
            s := mload(add(sig, 0x40))
            v := byte(0, mload(add(sig, 0x60)))
        }
        if (uint256(s) > HALF_N) revert BadSignatureS();
        return ecrecover(digest_, v, r, s);
    }
}
```

- [ ] **Step 2: Write `test/OracleAttestation.t.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {OracleAttestation} from "../src/oracle/OracleAttestation.sol";

contract OracleAttestationTest is Test {
    address constant REAL_SIGNER = 0x5598Aa9146215Bc13eb26f2c692Ad1461Fd32982;
    address constant REAL_CONSUMER = 0x37Bfb8AC7C960E558657871D41Ca70E07e7DbfFf;
    bytes constant REAL_SIG =
        hex"bfd589bb67b89a4f2a44bfcd689d7eb10309c1cf1e84fa42c417c162a7baf2a91fdd5e18ef891b9ae9f63882fdb3dc1e14e2bd13305b984afcf0ceb0059acfe01c";

    function _real(uint8 answerType) internal pure returns (OracleAttestation.Attestation memory a) {
        a.requestId = 0x094326048c1a44078d8d6c66d775667900000000000000000000000000000000;
        a.chainId = 1;
        a.questionHash = 0x39eecf277118e4219d50e4352a2fcf943cf802239c546d54dd4baba53c72d787;
        a.answerType = answerType;
        a.answer = hex"00000000000000000000000000000000000000000000000000000000d588b5a0";
        a.figure = 0;
        a.fromBlock = 26122900;
        a.toBlock = 26122901;
        a.blockHash = 0x22cd78830715d67d27849123a084fe3b854a1af74b40cd7f73c727399eef3059;
        a.panelJobId = 0x4d78f9ab3839475ab2993602d0501de500000000000000000000000000000000;
        a.panelSize = 5;
        a.quorum = 4;
        a.agreed = 4;
        a.issuedAt = 1791254782;
        a.expiresAt = 1791276382;
    }

    /// Finds which uint8 the oracle signs for the "uint256" answer type.
    function test_discoverAnswerType() public pure {
        bytes32 sep = OracleAttestation.domainSeparator(1, REAL_CONSUMER);
        for (uint8 t = 0; t < 32; t++) {
            if (OracleAttestation.recover(OracleAttestation.digest(sep, _real(t)), REAL_SIG) == REAL_SIGNER) {
                console2.log("answerType for uint256 =", t);
                return;
            }
        }
        revert("no answerType in 0..31 recovers the real signer");
    }

    function test_realAttestationRecoversRealSigner() public pure {
        bytes32 sep = OracleAttestation.domainSeparator(1, REAL_CONSUMER);
        bytes32 d = OracleAttestation.digest(sep, _real(OracleAttestation.ANSWER_TYPE_UINT256));
        assertEq(OracleAttestation.recover(d, REAL_SIG), REAL_SIGNER);
    }

    function test_differentConsumerDoesNotRecoverRealSigner() public pure {
        bytes32 sep = OracleAttestation.domainSeparator(1, address(0xBEEF));
        bytes32 d = OracleAttestation.digest(sep, _real(OracleAttestation.ANSWER_TYPE_UINT256));
        assertTrue(OracleAttestation.recover(d, REAL_SIG) != REAL_SIGNER);
    }
}
```

- [ ] **Step 3: Discover the answer type and pin it**

Run: `forge test --match-test test_discoverAnswerType -vv`
Expected: PASS, with a log line `answerType for uint256 = N`.

Set `ANSWER_TYPE_UINT256 = N` in `src/oracle/OracleAttestation.sol`.

If the test reverts with "no answerType in 0..31 recovers the real signer", the type string or field encoding is wrong. Stop and compare `TYPEHASH` against the `types` object in the fixture's source JSON before going further.

- [ ] **Step 4: Run the library tests**

Run: `forge test --match-contract OracleAttestationTest -vv`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: verify IMD oracle attestations"
```

- [ ] **Step 6: Write the failing FloorFeed tests in `test/FloorFeed.t.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {FloorFeed} from "../src/FloorFeed.sol";
import {OracleAttestation} from "../src/oracle/OracleAttestation.sol";

contract FloorFeedTest is Test {
    uint256 constant ATTESTER_KEY = 0xA11CE;
    bytes32 constant QUESTION = keccak256("floor question");
    uint64 constant T0 = 1_800_000_000;

    address attester;
    address owner = address(0x0A);
    FloorFeed feed;

    function setUp() public {
        attester = vm.addr(ATTESTER_KEY);
        vm.warp(T0);
        feed = new FloorFeed(owner, attester, QUESTION);
    }

    function _att(uint256 floorWei, uint64 issuedAt) internal view returns (OracleAttestation.Attestation memory a) {
        a.requestId = bytes32(uint256(issuedAt));
        a.chainId = block.chainid;
        a.questionHash = QUESTION;
        a.answerType = OracleAttestation.ANSWER_TYPE_UINT256;
        a.answer = abi.encode(floorWei);
        a.panelSize = 5;
        a.quorum = 4;
        a.agreed = 4;
        a.issuedAt = issuedAt;
        a.expiresAt = issuedAt + 6 hours;
    }

    function _sign(OracleAttestation.Attestation memory a, uint256 key, address consumer)
        internal
        view
        returns (bytes memory)
    {
        bytes32 sep = OracleAttestation.domainSeparator(block.chainid, consumer);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, OracleAttestation.digest(sep, a));
        return abi.encodePacked(r, s, v);
    }

    function _report(uint256 floorWei, uint64 issuedAt) internal {
        OracleAttestation.Attestation memory a = _att(floorWei, issuedAt);
        feed.report(a, _sign(a, ATTESTER_KEY, address(feed)));
    }

    function test_startsEmptyAndNotFresh() public view {
        (uint256 floorWei, bool fresh) = feed.latest();
        assertEq(floorWei, 0);
        assertFalse(fresh);
    }

    function test_acceptsValidReport() public {
        _report(2.84 ether, T0);
        (uint256 floorWei, bool fresh) = feed.latest();
        assertEq(floorWei, 2.84 ether);
        assertTrue(fresh);
    }

    function test_reportGoesStaleAfterSixHours() public {
        _report(2 ether, T0);
        vm.warp(T0 + 6 hours + 1);
        (uint256 floorWei, bool fresh) = feed.latest();
        assertEq(floorWei, 2 ether);
        assertFalse(fresh);
    }

    function test_rejectsWrongSigner() public {
        OracleAttestation.Attestation memory a = _att(2 ether, T0);
        bytes memory sig = _sign(a, 0xBAD, address(feed));
        vm.expectRevert(FloorFeed.BadSigner.selector);
        feed.report(a, sig);
    }

    function test_rejectsAttestationForAnotherConsumer() public {
        OracleAttestation.Attestation memory a = _att(2 ether, T0);
        bytes memory sig = _sign(a, ATTESTER_KEY, address(0xBEEF));
        vm.expectRevert(FloorFeed.BadSigner.selector);
        feed.report(a, sig);
    }

    function test_rejectsWrongQuestion() public {
        OracleAttestation.Attestation memory a = _att(2 ether, T0);
        a.questionHash = keccak256("another question");
        bytes memory sig = _sign(a, ATTESTER_KEY, address(feed));
        vm.expectRevert(FloorFeed.WrongQuestion.selector);
        feed.report(a, sig);
    }

    function test_rejectsWrongChain() public {
        OracleAttestation.Attestation memory a = _att(2 ether, T0);
        a.chainId = block.chainid + 1;
        bytes memory sig = _sign(a, ATTESTER_KEY, address(feed));
        vm.expectRevert(FloorFeed.WrongChain.selector);
        feed.report(a, sig);
    }

    function test_rejectsWrongAnswerType() public {
        OracleAttestation.Attestation memory a = _att(2 ether, T0);
        a.answerType = OracleAttestation.ANSWER_TYPE_UINT256 + 1;
        bytes memory sig = _sign(a, ATTESTER_KEY, address(feed));
        vm.expectRevert(FloorFeed.BadAnswer.selector);
        feed.report(a, sig);
    }

    function test_rejectsBelowQuorum() public {
        OracleAttestation.Attestation memory a = _att(2 ether, T0);
        a.agreed = 3;
        bytes memory sig = _sign(a, ATTESTER_KEY, address(feed));
        vm.expectRevert(FloorFeed.NoQuorum.selector);
        feed.report(a, sig);
    }

    function test_rejectsExpired() public {
        OracleAttestation.Attestation memory a = _att(2 ether, T0 - 7 hours);
        bytes memory sig = _sign(a, ATTESTER_KEY, address(feed));
        vm.expectRevert(FloorFeed.Expired.selector);
        feed.report(a, sig);
    }

    function test_rejectsIssuedInTheFuture() public {
        OracleAttestation.Attestation memory a = _att(2 ether, T0 + 1);
        bytes memory sig = _sign(a, ATTESTER_KEY, address(feed));
        vm.expectRevert(FloorFeed.Expired.selector);
        feed.report(a, sig);
    }

    function test_rejectsReplayAndOlderReports() public {
        _report(2 ether, T0);
        OracleAttestation.Attestation memory same = _att(2 ether, T0);
        bytes memory sameSig = _sign(same, ATTESTER_KEY, address(feed));
        vm.expectRevert(FloorFeed.NotNewer.selector);
        feed.report(same, sameSig);

        OracleAttestation.Attestation memory older = _att(2 ether, T0 - 1);
        bytes memory olderSig = _sign(older, ATTESTER_KEY, address(feed));
        vm.expectRevert(FloorFeed.NotNewer.selector);
        feed.report(older, olderSig);
    }

    function test_rejectsZeroAnswer() public {
        OracleAttestation.Attestation memory a = _att(0, T0);
        bytes memory sig = _sign(a, ATTESTER_KEY, address(feed));
        vm.expectRevert(FloorFeed.BadAnswer.selector);
        feed.report(a, sig);
    }

    function test_rejectsAnswerOfWrongLength() public {
        OracleAttestation.Attestation memory a = _att(2 ether, T0);
        a.answer = abi.encodePacked(uint128(2 ether));
        bytes memory sig = _sign(a, ATTESTER_KEY, address(feed));
        vm.expectRevert(FloorFeed.BadAnswer.selector);
        feed.report(a, sig);
    }

    function test_rejectsHighS() public {
        OracleAttestation.Attestation memory a = _att(2 ether, T0);
        bytes32 sep = OracleAttestation.domainSeparator(block.chainid, address(feed));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ATTESTER_KEY, OracleAttestation.digest(sep, a));
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes memory sig = abi.encodePacked(r, bytes32(n - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        vm.expectRevert(OracleAttestation.BadSignatureS.selector);
        feed.report(a, sig);
    }

    function test_rejectsShortSignature() public {
        OracleAttestation.Attestation memory a = _att(2 ether, T0);
        vm.expectRevert(OracleAttestation.BadSignatureLength.selector);
        feed.report(a, hex"1234");
    }

    function test_rejectsMoveAboveCapWhilePreviousIsFresh() public {
        _report(2 ether, T0);
        vm.warp(T0 + 1 hours);
        OracleAttestation.Attestation memory up = _att(2.5 ether + 1, T0 + 1 hours);
        bytes memory upSig = _sign(up, ATTESTER_KEY, address(feed));
        vm.expectRevert(FloorFeed.MoveTooLarge.selector);
        feed.report(up, upSig);

        OracleAttestation.Attestation memory down = _att(1.5 ether - 1, T0 + 1 hours);
        bytes memory downSig = _sign(down, ATTESTER_KEY, address(feed));
        vm.expectRevert(FloorFeed.MoveTooLarge.selector);
        feed.report(down, downSig);

        (uint256 floorWei,) = feed.latest();
        assertEq(floorWei, 2 ether);
    }

    function test_acceptsMoveAtExactlyTheCap() public {
        _report(2 ether, T0);
        vm.warp(T0 + 1 hours);
        _report(2.5 ether, T0 + 1 hours);
        vm.warp(T0 + 2 hours);
        _report(1.875 ether, T0 + 2 hours);
        (uint256 floorWei,) = feed.latest();
        assertEq(floorWei, 1.875 ether);
    }

    function test_acceptsLargeMoveOncePreviousIsStale() public {
        _report(2 ether, T0);
        vm.warp(T0 + 7 hours);
        _report(5 ether, T0 + 7 hours);
        (uint256 floorWei, bool fresh) = feed.latest();
        assertEq(floorWei, 5 ether);
        assertTrue(fresh);
    }

    function test_maxAgeShortensFreshness() public {
        vm.prank(owner);
        feed.setMaxAge(1 hours);
        _report(2 ether, T0);
        vm.warp(T0 + 1 hours + 1);
        (, bool fresh) = feed.latest();
        assertFalse(fresh);
    }

    function test_setMaxAgeIsBounded() public {
        vm.startPrank(owner);
        vm.expectRevert(FloorFeed.OutOfBounds.selector);
        feed.setMaxAge(1 hours - 1);
        vm.expectRevert(FloorFeed.OutOfBounds.selector);
        feed.setMaxAge(24 hours + 1);
        vm.stopPrank();
    }

    function test_onlyOwnerCanAdminister() public {
        vm.expectRevert(FloorFeed.NotOwner.selector);
        feed.setAttester(address(1));
        vm.expectRevert(FloorFeed.NotOwner.selector);
        feed.setMaxAge(2 hours);
        vm.expectRevert(FloorFeed.NotOwner.selector);
        feed.transferOwnership(address(1));
    }

    function test_ownerCanRotateAttester() public {
        vm.prank(owner);
        feed.setAttester(vm.addr(0xB0B));
        OracleAttestation.Attestation memory a = _att(2 ether, T0);
        bytes memory oldSig = _sign(a, ATTESTER_KEY, address(feed));
        vm.expectRevert(FloorFeed.BadSigner.selector);
        feed.report(a, oldSig);
        feed.report(a, _sign(a, 0xB0B, address(feed)));
    }
}
```

- [ ] **Step 7: Run to verify it fails**

Run: `forge test --match-contract FloorFeedTest`
Expected: compilation fails, `src/FloorFeed.sol` not found.

- [ ] **Step 8: Write `src/FloorFeed.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {OracleAttestation} from "./oracle/OracleAttestation.sol";

/// @notice Latest Identity MD floor price, as attested by the IMD oracle for one fixed question.
contract FloorFeed {
    error NotOwner();
    error ZeroAddress();
    error OutOfBounds();
    error BadSigner();
    error WrongQuestion();
    error WrongChain();
    error NoQuorum();
    error Expired();
    error NotNewer();
    error BadAnswer();
    error MoveTooLarge();

    event Reported(uint256 floorWei, uint64 issuedAt, uint64 freshUntil);
    event AttesterSet(address attester);
    event MaxAgeSet(uint64 maxAge);
    event OwnershipTransferred(address indexed from, address indexed to);

    uint256 public constant MAX_MOVE_BPS = 2500;
    uint64 public constant MIN_MAX_AGE = 1 hours;
    uint64 public constant MAX_MAX_AGE = 24 hours;

    bytes32 public immutable QUESTION_HASH;

    address public owner;
    address public attester;
    uint64 public maxAge = 6 hours;

    uint256 public floorWei;
    uint64 public issuedAt;
    uint64 public expiresAt;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address owner_, address attester_, bytes32 questionHash_) {
        if (owner_ == address(0) || attester_ == address(0)) revert ZeroAddress();
        owner = owner_;
        attester = attester_;
        QUESTION_HASH = questionHash_;
    }

    /// @notice Store a new floor report. Callable by anyone holding a valid attestation.
    function report(OracleAttestation.Attestation calldata a, bytes calldata sig) external {
        bytes32 sep = OracleAttestation.domainSeparator(block.chainid, address(this));
        if (OracleAttestation.recover(OracleAttestation.digest(sep, a), sig) != attester) revert BadSigner();
        if (a.questionHash != QUESTION_HASH) revert WrongQuestion();
        if (a.chainId != block.chainid) revert WrongChain();
        if (a.agreed < a.quorum || a.quorum == 0) revert NoQuorum();
        if (a.issuedAt > block.timestamp || block.timestamp > a.expiresAt) revert Expired();
        if (block.timestamp > uint256(a.issuedAt) + maxAge) revert Expired();
        if (a.issuedAt <= issuedAt) revert NotNewer();
        if (a.answerType != OracleAttestation.ANSWER_TYPE_UINT256 || a.answer.length != 32) revert BadAnswer();
        uint256 next = abi.decode(a.answer, (uint256));
        if (next == 0) revert BadAnswer();

        if (_fresh()) {
            uint256 prev = floorWei;
            uint256 band = (prev * MAX_MOVE_BPS) / 10_000;
            if (next > prev + band || next < prev - band) revert MoveTooLarge();
        }

        floorWei = next;
        issuedAt = a.issuedAt;
        expiresAt = a.expiresAt;
        emit Reported(next, a.issuedAt, _freshUntil());
    }

    /// @return floorWei_ the last reported floor, and whether it is still fresh.
    function latest() external view returns (uint256 floorWei_, bool fresh) {
        return (floorWei, _fresh());
    }

    function setAttester(address attester_) external onlyOwner {
        if (attester_ == address(0)) revert ZeroAddress();
        attester = attester_;
        emit AttesterSet(attester_);
    }

    function setMaxAge(uint64 maxAge_) external onlyOwner {
        if (maxAge_ < MIN_MAX_AGE || maxAge_ > MAX_MAX_AGE) revert OutOfBounds();
        maxAge = maxAge_;
        emit MaxAgeSet(maxAge_);
    }

    function transferOwnership(address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, to);
        owner = to;
    }

    function _freshUntil() private view returns (uint64) {
        uint64 byAge = issuedAt + maxAge;
        return byAge < expiresAt ? byAge : expiresAt;
    }

    function _fresh() private view returns (bool) {
        return issuedAt != 0 && block.timestamp <= _freshUntil();
    }
}
```

- [ ] **Step 9: Run the tests**

Run: `forge test -vv`
Expected: all tests pass (1 scaffold, 3 library, 23 FloorFeed).

- [ ] **Step 10: Format and commit**

```bash
forge fmt
git add -A
git commit -m "feat: add FloorFeed with freshness and move cap"
```

---

### Task 3: Phase 0 desk findings

No contract code. This task answers what can be answered for free and writes it down, so plans 2 to 4 start from facts.

**Files:**
- Create: `docs/phase0-findings.md`

**Interfaces:**
- Produces: `docs/phase0-findings.md`, one section per spec Phase 0 question, each marked `ANSWERED`, `PARTIAL` or `OPEN`, with the evidence (URL or command and the relevant output).

- [ ] **Step 1: Launch policy and manifest format**

```bash
curl -s https://api.imd.fun/launch/policies | jq '[.policies[] | select(.params.chainId==1 and .kind=="univ4_hook")] | sort_by(.version) | last'
curl -s https://raw.githubusercontent.com/identity-md-launches/launch-168-release-tollgate-symbol-toll/HEAD/launch.json
curl -s https://raw.githubusercontent.com/identity-md-launches/launch-697-gotchi/HEAD/launch.json
```

Record: supply split fields (`liquidityBps`, `treasuryBps`, `contributorPoolBps`, `perWalletCapBps`), the `owners` block, allowed fee tiers, initial market cap bounds, and the manifest shape for `univ4_hook` and for extra contracts (`$owner`, `$token`, `$contract:Name` placeholders).

- [ ] **Step 2: Hook tax precedent**

Read `src/TollgateHook.sol` from launch 168 (2% in native ETH) and the description of launch 551 (4% in ETH to a fixed address). Record the highest tax found in a live mainnet launch and how the fee is collected (ERC-6909 claims via `poolManager.mint`, or `take`).

- [ ] **Step 3: Free admission check**

```bash
curl -s https://api.imd.fun/requests/capabilities | jq '.launches'
```

Then send a `launch.open` body for a 6% tax hook to `POST https://api.imd.fun/requests/check`, following the request shape in https://imd.fun/docs/#paid. Record the full response, in particular the pool fee and allocations it states. This call holds no payment.

- [ ] **Step 4: Contract-owned seats**

Read `src/WorkerWallet.sol` from launch 246 and the README of launch 440 (SEATLEASE). Record what each says about ERC-1271 acceptance in `POST /pair/complete`, and whether either was ever paired on mainnet (check `GET https://api.imd.fun/seats/owners` for an owner address with code, using `cast code <owner> --rpc-url https://ethereum-rpc.publicnode.com`).

- [ ] **Step 5: Collection and seat facts**

```bash
cast call 0x0000eC93127BAA929E58E97dd0095A2BFb38ec1D "name()(string)" --rpc-url https://ethereum-rpc.publicnode.com
cast call 0x0000eC93127BAA929E58E97dd0095A2BFb38ec1D "totalSupply()(uint256)" --rpc-url https://ethereum-rpc.publicnode.com
```

Record the confirmed collection address, name, and supply.

- [ ] **Step 6: Floor question draft**

Read the two most recent attested requests from `GET https://api.imd.fun/oracle/requests?limit=20` and their `definitions` and `guards` blocks. Draft the floor-price question in the same style and record it, together with which data source it pins and why that source needs no API key. Record how `questionHash` is derived (compare `cast keccak "<question text>"` with the request's `questionHash`).

- [ ] **Step 7: Write `docs/phase0-findings.md` and commit**

One section per question from the spec's Phase 0 table, plus a final section "Changes the spec needs" listing every place the findings contradict the spec.

```bash
git add -A
git commit -m "docs: record Phase 0 desk findings"
```
