// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice PUPATE: a plain ERC-20 with a fixed supply minted once to its deployer.
/// @dev No owner, mint, pause, fee or transfer limit. `burn` and `burnFrom` only reduce supply.
contract PupateToken {
    error ZeroAddress();
    error InsufficientBalance();
    error InsufficientAllowance();

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);

    string public constant name = "Pupate";
    string public constant symbol = "PUPATE";
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor() {
        totalSupply = 1_000_000_000 ether;
        balanceOf[msg.sender] = totalSupply;
        emit Transfer(address(0), msg.sender, totalSupply);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        _spendAllowance(from, amount);
        _transfer(from, to, amount);
        return true;
    }

    /// @notice Destroy `amount` of the caller's tokens.
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    /// @notice Destroy `amount` of `from`'s tokens, spending the caller's allowance.
    function burnFrom(address from, uint256 amount) external {
        _spendAllowance(from, amount);
        _burn(from, amount);
    }

    function _transfer(address from, address to, uint256 amount) private {
        if (to == address(0)) revert ZeroAddress();
        uint256 balance = balanceOf[from];
        if (balance < amount) revert InsufficientBalance();
        unchecked {
            balanceOf[from] = balance - amount;
            // Cannot overflow: balances never sum to more than totalSupply.
            balanceOf[to] += amount;
        }
        emit Transfer(from, to, amount);
    }

    function _burn(address from, uint256 amount) private {
        uint256 balance = balanceOf[from];
        if (balance < amount) revert InsufficientBalance();
        unchecked {
            balanceOf[from] = balance - amount;
            totalSupply -= amount;
        }
        emit Transfer(from, address(0), amount);
    }

    function _spendAllowance(address from, uint256 amount) private {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed == type(uint256).max) return;
        if (allowed < amount) revert InsufficientAllowance();
        unchecked {
            allowance[from][msg.sender] = allowed - amount;
        }
    }
}
