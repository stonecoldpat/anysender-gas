pragma solidity ^0.6.0;

contract PerformanceTest {
    uint public noHashes = 0;
    uint public noCalls = 0;
    event Hash(bytes32 h, uint noHashes, uint noCalls);
    event Broadcast(address caller, uint counter);

    address owner;
    uint c = 0;

    constructor() public {
      owner = msg.sender;
    }

    function tryme() public {
      emit Broadcast(msg.sender, c);
      c = c + 1;
    }
    function test() public {
       assert(5 == 2);
    }

    function kill() public {
      require(msg.sender == owner, "Only owner can kill");
      selfdestruct(msg.sender);
    }
}