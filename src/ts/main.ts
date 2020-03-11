import { ethers, Wallet, Contract } from "ethers";
import { GasConFactory } from "../../out/GasConFactory";
import { Provider } from "ethers/providers";
import { parseEther, BigNumber } from "ethers/utils";

import {
  onchainDepositFor,
  getAnySenderClient,
  subscribe,
  getSignedRelayTx
} from "./anysender-utils";
import AnySenderClient from "@any-sender/client";

// This account has ETHER to top up the any.sender service
// const mnemonic = "";

/**
 * Set up the provider and wallet
 */
async function setup() {
  const infuraProvider = new ethers.providers.InfuraProvider(
    "ropsten",
    "7333c8bcd07b4a179b0b0a958778762b"
  );

  const mnemonicWallet = ethers.Wallet.fromMnemonic(mnemonic);
  const wallet = mnemonicWallet.connect(infuraProvider);

  return {
    wallet: wallet,
    provider: infuraProvider
  };
}

/**
 * Deploy performance test contract to the network
 * @param wallet Signer
 * @param provider InfuraProvider
 */
async function deployGasContract(
  wallet: Wallet,
  provider: Provider
): Promise<Contract> {
  const gasConFactory = new GasConFactory(wallet);
  // const gasConTx = gasConFactory.getDeployTransaction();
  // const response = await wallet.sendTransaction(gasConTx);
  // const receipt = await response.wait(6);

  const gasCon = new ethers.Contract(
    "0xdFE5Dd55C6161A2Fa9B0545aC3b704344Ff2dd97",
    // receipt.contractAddress,
    gasConFactory.interface.abi,
    provider
  );

  return gasCon;
}

async function sendGas(
  gasCon: ethers.Contract,
  wallet: Wallet,
  provider: Provider
) {
  const loops = Math.ceil(Math.random() * 140);

  // What function are we calling? And what are the arguments?
  // Let's encode this nice little packet up.
  const callData = gasCon.interface.functions.useGas.encode([loops]);

  // Creates the unsigned relay transaction
  const signedRelayTx = await getSignedRelayTx(
    3000000, // Gas limit
    callData, // Encoded call data
    parseEther("0.000000001").toString(), // Requested Refund (if fails)
    gasCon, // Ballot contract
    wallet, // Signer
    provider // InfuraProvider
  );

  // Let's confirm the voter is registered
  const oldIndex = await gasCon.lastIndex();
  const oldBlockNo = await provider.getBlockNumber();

  const anysender = await getAnySenderClient();

  // Waits until the RelayTxID is confirmed via Relay.sol
  const subscribePromise = subscribe(signedRelayTx, wallet, provider);

  // Let's sign it and send it off!
  const txReceipt = await anysender.relay(signedRelayTx);

  // Receipt of any.sender
  console.log("RelayTxID: " + AnySenderClient.relayTxId(signedRelayTx));
  console.log("any.sender sig: " + txReceipt.receiptSignature);

  await subscribePromise;

  // Let's confirm the voter is registered
  const newIndex = await gasCon.lastIndex();
  const newBlockNo = await provider.getBlockNumber();

  // Let's confirm the voter is registered
  console.log("Index changed " + oldIndex + " to " + newIndex);
  console.log("Blocks " + oldBlockNo + " to " + newBlockNo);
}

(async () => {
  // Set up wallets & provider
  const { wallet, provider } = await setup();
  console.log("Wallet address: " + wallet.address);

  const bal = await provider.getBalance(wallet.address);

  if (bal.gt(parseEther("180"))) {
    const toDeposit = "180";

    // Deposit to any.sender
    console.log(
      "Admin deposits " + toDeposit + " ether into the any.sender contract"
    );
    await onchainDepositFor(parseEther(toDeposit), wallet);
    console.log("Deposit processed.");
  }

  console.log("Deploy gas contract.");
  const gasCon = await deployGasContract(wallet, provider);
  console.log("Gas contract: " + gasCon.address);

  console.log("Send gas -- using the any.sender service");

  let roundNo = 1;

  // Keep looping to send transactions every 5 minutes
  while (true) {
    console.log(roundNo + ": New round starting now");

    await sendGas(gasCon, wallet, provider);

    roundNo = roundNo + 1;

    // Wait 5 minutes before next round
    await new Promise(function(resolve, reject) {
      setTimeout(resolve, 60000, "No event emitted!");
    });
  }
})().catch(e => {
  console.log(e);
  // Deal with the fact the chain failed
});
