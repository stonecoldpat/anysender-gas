### Basic test contract for an any.sender instance
We have a contract GasCon.sol with a single function GasCon.useGas(uint toStore). Its only purpose is to fill up storage slots on the network (e.g. 20k gas per storage).

The code here will send 1 transaction via any.sender to GasCon every minute. So we can see how well any.sender handles a continuous flow of jobs in a production environment.
