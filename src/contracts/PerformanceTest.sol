pragma solidity ^0.6.0;

contract PerformanceTest {
    uint public noHashes = 0;
    uint public noCalls = 0;
    event Hash(bytes32 h, uint noHashes, uint noCalls);

    address owner;

    constructor() public {
      owner = msg.sender;
    }
    function test() public {
       assert(5 == 2);
    }

    function kill() public {
      require(msg.sender == owner, "Only owner can kill");
      selfdestruct(msg.sender);
    }
}