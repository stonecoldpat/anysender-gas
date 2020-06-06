import { PerformanceTestFactory } from "../out/PerformanceTestFactory";
import { TransactionResponse } from "ethers/providers";

import { wait, setup } from "./spam/spam-utils";
import { any } from "@any-sender/client";
import { PerformanceTest } from "../out/PerformanceTest";
import { parseEther } from "ethers/utils";

async function watchFor(result: TransactionResponse) {
  try {
    const receipt = await result.wait();
    return receipt;
  } catch (e) {
    console.log("To double-check an exception was thrown during watchFor");
    console.log(e);
  }
}

async function sendTx(
  userDot: any,
  performanceContract: PerformanceTest,
  callData: string,
  gasLimit: number
) {
  try {
    return await userDot.any.sendTransaction({
      to: performanceContract.address,
      data: callData,
      gasLimit: gasLimit,
    });
  } catch (e) {
    console.log("To double-check an exception was thrown during sendTx");
    console.log(e);
  }
}
/**
 * Runs the entire program.
 * - Checks (and deposit) balance on any.sender for main wallet
 * - Deploy performance contract
 * - Send relay jobs to any.sender
 */
(async () => {
  const { wallets } = await setup();

  console.log("Wallet: " + wallets[0].address);
  const userDot = any.sender(wallets[0]);

  // Deposit into any.sender
  const depositTx = await userDot.any.deposit(parseEther("100"), {
    gasPrice: parseEther("0.0000002"), // 20
  });

  console.log("https://ropsten.etherscan.io/tx/" + depositTx.hash);
  await depositTx.wait(12);

  const performanceContract = new PerformanceTestFactory(wallets[0]).attach(
    "0xc53af3030879ff5750ba56c17e656043c3a26987"
  );

  // const isProxyDeployed = await userDot.any.isProxyAccountDeployed();
  // console.log("Does proxy exist: " + isProxyDeployed);

  let anysenderRounds = 1000; // Number of rounds sending up to any.sender
  let relayJobs = 150; // Number of relay jobs
  let gasLimit = 211000; // Gas per transaction
  const callData = performanceContract.interface.functions.tryme.encode([]);

  // Repeat the batches multiple times
  for (let i = 0; i < anysenderRounds; i++) {
    let listOfRelayPromises = [];

    // Starting sending a list of jobs to anysender (e.g. 40 jobs)
    for (let j = 0; j < relayJobs; j++) {
      // Send receipt!
      listOfRelayPromises.push(
        sendTx(userDot, performanceContract, callData, gasLimit + j)
      );
      await wait(2000);
    }

    // Lets wait for all the treansactions to be registered
    const results: TransactionResponse[] = await Promise.all(
      listOfRelayPromises
    );

    console.log("All sent... waiting for confirmations");

    // Now we wait for the transactions to get confirmed
    let listOfConfirmationPromises = [];
    for (let j = 0; j < results.length; j++) {
      listOfConfirmationPromises.push(watchFor(results[j]));
    }

    const receipts = await Promise.all(listOfConfirmationPromises);

    for (const receipt of receipts) {
      if (receipt !== undefined) {
        console.log(
          "https://ropsten.etherscan.io/tx/" + receipt.transactionHash
        );

        console.log("Sent by: " + receipt.from);
      }
    }
    console.log("Round " + i + " completed.");
    await wait(14000);
  }
})().catch((e) => {
  console.log(e);
  // Deal with the fact the chain failed
});
