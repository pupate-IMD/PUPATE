// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IMetamorphArt} from "../../src/interfaces/IMetamorphArt.sol";
import {ERC721Lite} from "../../src/metamorph/ERC721Lite.sol";

/// @notice TESTNET ONLY. A throwaway ERC-721 that wears the Metamorph MD art, so a card can be looked at where
/// collectors will see it (a testnet marketplace's item page, a wallet) before the mainnet deployment, which
/// cannot be corrected. Each token is one fixed `View`, given at construction and minted to the deployer, and
/// `tokenURI(id)` is the router's answer for it, the view's `id` being the token id. No owner, no setter,
/// nothing payable: the contract is used once and forgotten, and nothing of it goes in the address book.
contract MetamorphRehearsal is ERC721Lite {
    /// @notice The art router every token asks (`MetamorphArt`).
    IMetamorphArt public immutable ART;

    /// The card behind each token id, its `id` the token's own.
    mapping(uint256 id => IMetamorphArt.View) private _views;

    /// @param art The router, deployed beside this contract.
    /// @param views One card per token: token 1 is `views[0]`, and so on; whatever `id` a view carries is
    /// replaced by its token id.
    constructor(IMetamorphArt art, IMetamorphArt.View[] memory views)
        ERC721Lite("Metamorph MD rehearsal", "MMDR")
    {
        if (address(art) == address(0)) revert ZeroAddress();
        ART = art;
        for (uint256 k; k < views.length; k++) {
            uint256 id = k + 1;
            views[k].id = id;
            _views[id] = views[k];
            _mint(msg.sender, id);
        }
    }

    /// @notice The token's card as the router draws it; reverts (`NotMinted`) for an id that does not exist.
    function tokenURI(uint256 id) public view override returns (string memory) {
        if (_owner[id] == address(0)) revert NotMinted();
        return ART.tokenURI(_views[id]);
    }
}
