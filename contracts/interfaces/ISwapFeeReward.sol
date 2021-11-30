pragma solidity >=0.6.12;

interface ISwapFeeReward {
    function swap(address account, address input, address output, uint256 amount, address pair) external returns (bool);

    function pairsListLength() external view returns (uint256);
    function pairsList(uint256 index) external view returns (address, uint256, bool);
}
