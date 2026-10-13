// src/metamorph/ERC721Lite.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IERC721TokenReceiver {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data)
        external
        returns (bytes4);
}

/// @notice The part of ERC-721 that Metamorph MD needs, with a hook before every transfer so a staked
/// card can refuse to move. Hand-rolled like the rest of this repository (no OpenZeppelin vendored).
abstract contract ERC721Lite {
    error NotOwner();
    error NotAuthorized();
    error ZeroAddress();
    error AlreadyMinted();
    error NotMinted();
    error UnsafeRecipient();

    event Transfer(address indexed from, address indexed to, uint256 indexed id);
    event Approval(address indexed owner, address indexed spender, uint256 indexed id);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    string public name;
    string public symbol;

    mapping(uint256 id => address) internal _owner;
    mapping(address owner => uint256) public balanceOf;
    mapping(uint256 id => address) public getApproved;
    mapping(address owner => mapping(address operator => bool)) public isApprovedForAll;

    constructor(string memory name_, string memory symbol_) {
        name = name_;
        symbol = symbol_;
    }

    function ownerOf(uint256 id) public view returns (address owner) {
        owner = _owner[id];
        if (owner == address(0)) revert NotMinted();
    }

    function tokenURI(uint256 id) public view virtual returns (string memory);

    function approve(address spender, uint256 id) external {
        address owner = ownerOf(id);
        if (msg.sender != owner && !isApprovedForAll[owner][msg.sender]) revert NotAuthorized();
        getApproved[id] = spender;
        emit Approval(owner, spender, id);
    }

    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function transferFrom(address from, address to, uint256 id) public {
        if (from != _owner[id]) revert NotOwner();
        if (to == address(0)) revert ZeroAddress();
        if (msg.sender != from && !isApprovedForAll[from][msg.sender] && msg.sender != getApproved[id]) {
            revert NotAuthorized();
        }
        _beforeTransfer(id);
        unchecked {
            balanceOf[from]--;
            balanceOf[to]++;
        }
        _owner[id] = to;
        delete getApproved[id];
        emit Transfer(from, to, id);
    }

    function safeTransferFrom(address from, address to, uint256 id) external {
        transferFrom(from, to, id);
        _checkReceiver(from, to, id, "");
    }

    function safeTransferFrom(address from, address to, uint256 id, bytes calldata data) external {
        transferFrom(from, to, id);
        _checkReceiver(from, to, id, data);
    }

    function supportsInterface(bytes4 interfaceId) public view virtual returns (bool) {
        return interfaceId == 0x01ffc9a7 || interfaceId == 0x80ac58cd || interfaceId == 0x5b5e139f;
    }

    /// @dev Mints and, when `to` is a contract, requires it to accept, so a card never lands where it
    /// cannot move again.
    function _mint(address to, uint256 id) internal {
        if (to == address(0)) revert ZeroAddress();
        if (_owner[id] != address(0)) revert AlreadyMinted();
        unchecked {
            balanceOf[to]++;
        }
        _owner[id] = to;
        emit Transfer(address(0), to, id);
        _checkReceiver(address(0), to, id, "");
    }

    /// @dev Runs before a transfer moves anything; a revert here stops the transfer.
    function _beforeTransfer(uint256 id) internal virtual {}

    function _checkReceiver(address from, address to, uint256 id, bytes memory data) private {
        if (to.code.length == 0) return;
        try IERC721TokenReceiver(to).onERC721Received(msg.sender, from, id, data) returns (bytes4 answer) {
            if (answer != IERC721TokenReceiver.onERC721Received.selector) revert UnsafeRecipient();
        } catch {
            revert UnsafeRecipient();
        }
    }
}
