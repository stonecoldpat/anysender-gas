## Spam scripts

### Setup:

We need to update the config.ts with:

``` MNEMONIC ```: 12 word seed

``` INFURA_PROJECT_ID ```: Ropsten Infura ID 

```TO_BURST```: Control frequency of bursts to any-sender (e.g. attempt 5 relays, 6 relays, etc)

The schedule for spam.ts and sendToAnySender.ts can be modified in their respective files. Both rely on waitForNextRound() for their daily restart (in spam-utils.ts) which can be modified to decide if it starts once-a-day and at what time. 


### Execute 
To build the contracts for deployment: 

``` npm run build ```

To run the scripts:

``` npm run spam ```

``` npm run sendToAnySender ```
