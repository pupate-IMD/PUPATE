// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IERC721ReceiverLike {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data)
        external
        returns (bytes4);
}

/// @dev Test-only ERC-721 standing in for the identity.md collection.
contract MockERC721 {
    string public constant name = "identity.md";
    string public constant symbol = "IDMD";

    mapping(uint256 => address) private _owner;
    mapping(address => uint256) public balanceOf;
    mapping(uint256 => address) public getApproved;
    mapping(address => mapping(address => bool)) public isApprovedForAll;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    function mint(address to, uint256 tokenId) external {
        require(_owner[tokenId] == address(0), "minted");
        _owner[tokenId] = to;
        balanceOf[to] += 1;
        emit Transfer(address(0), to, tokenId);
    }

    function burn(uint256 tokenId) external {
        address owner = ownerOf(tokenId);
        require(msg.sender == owner, "not owner");
        delete _owner[tokenId];
        delete getApproved[tokenId];
        balanceOf[owner] -= 1;
        emit Transfer(owner, address(0), tokenId);
    }

    function ownerOf(uint256 tokenId) public view returns (address owner) {
        owner = _owner[tokenId];
        require(owner != address(0), "no token");
    }

    function approve(address to, uint256 tokenId) external {
        address owner = ownerOf(tokenId);
        require(msg.sender == owner || isApprovedForAll[owner][msg.sender], "not allowed");
        getApproved[tokenId] = to;
        emit Approval(owner, to, tokenId);
    }

    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        address owner = ownerOf(tokenId);
        require(owner == from, "wrong from");
        require(to != address(0), "zero to");
        require(
            msg.sender == owner || msg.sender == getApproved[tokenId] || isApprovedForAll[owner][msg.sender],
            "not allowed"
        );
        delete getApproved[tokenId];
        _owner[tokenId] = to;
        balanceOf[from] -= 1;
        balanceOf[to] += 1;
        emit Transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        transferFrom(from, to, tokenId);
        if (to.code.length != 0) {
            require(
                IERC721ReceiverLike(to).onERC721Received(msg.sender, from, tokenId, "")
                    == IERC721ReceiverLike.onERC721Received.selector,
                "unsafe recipient"
            );
        }
    }
}
