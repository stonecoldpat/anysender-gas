import { ethers, Wallet } from "ethers";
import { PerformanceTestFactory } from "../../out/PerformanceTestFactory";
import { RelayTransaction } from "@any-sender/data-entities";
import { Provider } from "ethers/providers";
import { parseEther, arrayify } from "ethers/utils";
import {
  onchainDepositFor,
  checkBalance,
  getAnySenderClient,
  subscribe,
  sendMail,
  updateTimestamp
} from "./anysender-utils";
import AnySenderClient from "@any-sender/client";
import { UnsignedRelayTransaction } from "@any-sender/client/lib/client";
import {
  ANYSENDER_RELAY_CONTRACT,
  MINIMUM_ANYSENDER_DEADLINE,
  TO_BURST
} from "./config";
import {
  deployPerformanceContract,
  waitForNextRound,
  wait,
  setup,
  prepareSummaryTable
} from "./spam-utils";

/**
 * Deposit coins into any.sender contract
 * @param wallet Signer
 * @param provider InfuraProvider
 */
async function deposit(toDeposit: string, wallet: Wallet, provider: Provider) {
  await onchainDepositFor(parseEther(toDeposit), wallet);
  const response = await checkBalance(wallet);
  return response;
}

/**
 * Sends a relay transaction to any.sender and waits on its response.
 * @param i Round number
 * @param anysender AnySenderClient
 * @param unsignedRelayTx Unsigned Relay Transaction
 * @param wallet Wallet
 */
async function sendRelayJob(
  i: number,
  anysender: AnySenderClient,
  unsignedRelayTx: UnsignedRelayTransaction,
  wallet: Wallet
) {
  // Any promises arise? Just ignore it.
  try {
    const relayTxId = AnySenderClient.relayTxId(unsignedRelayTx);
    const signature = await wallet.signMessage(arrayify(relayTxId));

    const signedRelayTx: RelayTransaction = {
      ...unsignedRelayTx,
      signature: signature
    };
    await anysender.relay(signedRelayTx);
    return unsignedRelayTx;
  } catch (e) {
    if (e.name === "HTTPResponseError") {
      const date = new Date();
      console.log(date.toLocaleTimeString() + " ----> " + e.message);
    }
  }
}

/**
 *
 * Sends up 32 jobs, various gas requirements, to the any.sender service.
 * @param performanceTestAddr Performance Test Contract address
 * @param wallet Wallet
 * @param provider InfuraProvider
 */
async function relayJob(
  totalJobs: number,
  gasLimit: number,
  performanceTestAddr: string,
  wallet: Wallet,
  provider: Provider
) {
  const anysender = await getAnySenderClient();

  const performanceTestFactory = new PerformanceTestFactory(wallet);
  let performTestContract = new ethers.Contract(
    performanceTestAddr,
    performanceTestFactory.interface.abi,
    provider
  );

  let listOfRelayPromises = [];
  let listOfConfirmationPromises = [];

  const recordTime = Date.now();
  const blockNo = await provider.getBlockNumber();
  const deadline = blockNo + MINIMUM_ANYSENDER_DEADLINE;

  for (let i = 0; i < totalJobs; i++) {
    const callData = performTestContract.interface.functions.test.encode([]);
    try {
      const unsignedRelayTx = {
        from: wallet.address,
        to: performanceTestAddr,
        gas: gasLimit - i,
        data: callData,
        deadlineBlockNumber: deadline,
        compensation: parseEther("0.00000001").toString(),
        relayContractAddress: ANYSENDER_RELAY_CONTRACT
      };

      // Send receipt!
      listOfRelayPromises.push(
        sendRelayJob(i, anysender, unsignedRelayTx, wallet)
      );

      if (i % TO_BURST == 0) {
        const results = await Promise.all(listOfRelayPromises);
        listOfRelayPromises = [];

        let totalRelayed = 0;

        for (let j = 0; j < results.length; j++) {
          if (results[j] !== undefined) {
            totalRelayed = totalRelayed + 1;
            listOfConfirmationPromises.push(
              subscribe(results[j], blockNo, wallet, provider)
            );
          } else {
            console.log("Found a missed relay job");
          }
        }
        console.log("Successfully relayed " + totalRelayed);

        await wait(2000);
      }
    } catch (e) {
      console.log(e);
      await wait(5000); // Sanity wait, to stop rapid spam.
    }
  }

  const finishTime = Date.now();
  console.log("Time required to send all jobs: " + (finishTime - recordTime));
  const data = await Promise.all(listOfConfirmationPromises);
  const sorted = data.sort((a, b) => a - b);

  const relayData = [];
  relayData.push(sorted[0]); // slowest
  relayData.push(sorted[sorted.length - 1]); // fastest
  relayData.push(sorted[Math.round(sorted.length / 2)]); // Median
  let average = 0;

  for (let i = 0; i < sorted.length; i++) {
    average = average + sorted[i];
  }

  relayData.push(Math.round(average / sorted.length)); // Average
  relayData.push(sorted.length); // Total

  console.log(JSON.stringify(relayData));
  console.log(JSON.stringify(sorted));
  console.log(JSON.stringify(data));

  return relayData;
}

/**
 * Send up lots of jobs to any.sender
 * @param relayContract Relay contract
 * @param wallet Wallet
 * @param provider Provider
 */
async function sendToAnySender(
  relayContract: string,
  anysenderRounds: number,
  relayJobs: number,
  gasLimit: number,
  wallet: Wallet,
  provider: Provider
) {
  const tableData = [];

  for (let i = 0; i < anysenderRounds; i++) {
    try {
      sendMail("New any.sender round", "Sending off round " + i, "", false);

      // Send out the relay jobs (largest to smallest in gas)
      const relayData = await relayJob(
        relayJobs,
        gasLimit,
        relayContract,
        wallet,
        provider
      );

      // Printout to console each round for clarity
      const results =
        "Quickest: " +
        relayData[0] +
        " blocks" +
        "\nSlowest: " +
        relayData[1] +
        " blocks" +
        "\nMedian: " +
        relayData[2] +
        " blocks" +
        "\nAverage: " +
        relayData[3] +
        " blocks" +
        "\nTOTAL JOBS: " +
        relayData[4];

      sendMail(
        "new any.sender round",
        "Results for round " + i + "\n" + results,
        "",
        false
      );

      await wait(60000);
      relayData[5] = i; // Round number. Protect against exceptions being thrown inside it.
      tableData.push(relayData);
    } catch (e) {
      console.log(e);
    }
  }
  sendMail(
    "Summarised any.sender results ",
    "",
    prepareSummaryTable(tableData),
    true
  );
}

/**
 * Runs the entire program.
 * - Checks (and deposit) balance on any.sender for main wallet
 * - Deploy performance contract
 * - Send relay jobs to any.sender
 */
(async () => {
  const { wallet, provider } = await setup();

  sendMail("All fired up.", "Lets do it!", "", false);
  while (true) {
    // All emails are pre-pended with round timestamp
    updateTimestamp();

    // Deposit into any.sender
    // const depositResponse = await deposit("100", wallet, provider);
    // console.log(depositResponse);

    let anysenderRounds: number; // Number of rounds sending up to any.sender
    let relayJobs: number; // Number of relay jobs
    let gasLimit: number; // Gas limit per relay job

    // A different gas price every day
    switch (new Date().getDay()) {
      case 0: // sun
        anysenderRounds = 30;
        relayJobs = 37;
        gasLimit = 3000000;

        break;
      case 1: // mon
        anysenderRounds = 30;
        relayJobs = 37;
        gasLimit = 3000000;

        break;
      case 2: // tue
        anysenderRounds = 30;
        relayJobs = 400;
        gasLimit = 100000;
        break;
      case 3: // wed
        anysenderRounds = 30;
        relayJobs = 400;
        gasLimit = 100000;

        break;
      case 4: // thur
        anysenderRounds = 30;
        relayJobs = 37;
        gasLimit = 3000000;

        break;
      case 5: // fri
        anysenderRounds = 20;
        relayJobs = 400;
        gasLimit = 250000;
        break;
      case 6: // sat
        anysenderRounds = 30;
        relayJobs = 400;
        gasLimit = 250000;
        break;
    }

    const relayContract = await deployPerformanceContract(wallet);
    console.log("Relay contract for any.sender: " + relayContract);

    await sendToAnySender(
      relayContract,
      anysenderRounds,
      relayJobs,
      gasLimit,
      wallet,
      provider
    );

    console.log("One small step for satoshi, one giant leap for mankind");
    await waitForNextRound();
  }
})().catch(e => {
  console.log(e);
  // Deal with the fact the chain failed
});
