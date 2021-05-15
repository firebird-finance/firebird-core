pragma solidity >=0.5.16;

import '../FireBirdERC20.sol';

contract FireBirdERC20Wrapper is FireBirdERC20 {
    constructor(string memory _name, string memory _symbol,uint _totalSupply) public {
        super.initialize(_name,_symbol);
        _mint(msg.sender, _totalSupply);
    }
}
