pragma solidity 0.6.2;

contract GasCon {

    mapping(uint => uint) public gasStorage;
    uint public lastIndex = 0;
    address owner;

    constructor() public {
      owner = msg.sender;
    }

    function useGas(uint toStore) public  {

      for(uint i=lastIndex; i<lastIndex+toStore; i++) {

         gasStorage[i] = i;
      }

      lastIndex = lastIndex + toStore;
    }



}
