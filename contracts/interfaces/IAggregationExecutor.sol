pragma solidity >=0.6.12;

interface IAggregationExecutor {
    function callBytes(bytes calldata data, address srcSpender) external payable;  // 0xd9c45357
}
