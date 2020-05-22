import { PerformanceTestFactory } from "../../out/PerformanceTestFactory";
import { wait, setup } from "../spam/spam-utils";
import { any, SignerWithAnySender } from "@any-sender/client";
import { parseEther } from "ethers/utils";
import { Signer, ethers, Wallet } from "ethers";
import { WaitableRelayTransactionReceipt } from "@any-sender/client/lib/publicInterfaces";
import { StatsPrinter } from "./statsPrinter";
import { JsonRpcProvider } from "ethers/providers";

// send transactions with a wait in between each one
const checkBalanceAndTopUp = async (
  signer: SignerWithAnySender<Signer>,
  minimumBalance: number,
  topupAmount: number,
  confirmations: number
) => {
  try {
    const currentBalance = await signer.any.getBalance();
    if (currentBalance.lt(parseEther(minimumBalance.toString()))) {
      const depositResponse = await signer.any.deposit(
        parseEther(topupAmount.toString())
      );

      if (confirmations !== 0) await depositResponse.wait(confirmations);
    }
  } catch (err) {
    console.error(err);
    try {
      const currentBalance = await signer.any.getBalance();
      if (currentBalance < parseEther("0.1")) throw err;
    } catch (doh) {
      throw doh;
    }
  }
};

let cachedBlockNumber;
let timeSinceLastCache = Date.now();
const getCachedBlockNumber = async (
  provider: ethers.providers.Provider,
  pollingInterval: number
) => {
  const timeNow = Date.now();
  if (timeNow - timeSinceLastCache > pollingInterval || !cachedBlockNumber) {
    // set the time now straight away to avoid race conditions during the async phase
    timeSinceLastCache = timeNow;

    cachedBlockNumber = await provider.getBlockNumber();
  }

  return cachedBlockNumber;
};

class ApplicationError extends Error {
  constructor(msg: string) {
    super(msg);
  }
}

const blockGreaterThan = async (
  block: number,
  pollingInterval: number,
  provider: ethers.providers.Provider,
  cancellor: { cancelled: boolean },
  txId: string
) => {
  while (block > (await getCachedBlockNumber(provider, pollingInterval))) {
    if (cancellor.cancelled) throw Error("Cancelled");
    await wait(pollingInterval);
  }
  throw new ApplicationError(`Transaction not mined in time: ${txId}.`);
};

const sendAndRecordTransaction = async (
  sendTransaction: () => Promise<WaitableRelayTransactionReceipt>,
  provider: ethers.providers.Provider,
  blockPollingInterval: number,
  statsPrinter: StatsPrinter
) => {
  try {
    const startTime = Date.now();
    const startBlockNumber = await getCachedBlockNumber(
      provider,
      blockPollingInterval
    );
    // send the transaction
    const relayReceipt = await sendTransaction();
    const afterSend = Date.now();

    const cancellor = { cancelled: false };
    const greaterThanPromise = blockGreaterThan(
      startBlockNumber + 40,
      blockPollingInterval,
      provider,
      cancellor,
      relayReceipt.id
    );
    const txReceiptPromise = relayReceipt.wait();
    const txReceipt = await Promise.race([
      greaterThanPromise,
      txReceiptPromise,
    ]).then((tx) => {
      cancellor.cancelled = true;
      return tx;
    });

    const endBlock = txReceipt.blockNumber;
    const endTime = Date.now();

    statsPrinter.addTransactionStats({
      afterSendTime: afterSend,
      endBlock: endBlock,
      endTime: endTime,
      startBlock: startBlockNumber,
      startTime: startTime,
      txId: relayReceipt.id,
    });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message.includes("Transaction not mined in")) throw err;
      statsPrinter.addTransactionStats({
        error: err.message,
      });
    } else {
      statsPrinter.addTransactionStats({
        error: err,
      });
    }
  }
};

const run = async (
  signer: Wallet,
  sendingInterval: number,
  perfContractAddress: string,
  blockPollingInterval: number,
  statsPrinter: StatsPrinter
) => {
  let runs = 0;
  (signer.provider as JsonRpcProvider).pollingInterval = 10000;
  const signerWithSender = any.sender(signer);
  const perfContract = any.senderAccount(
    new PerformanceTestFactory(signer).attach(perfContractAddress),
    0
  );
  // topup and wait confirmation
  await checkBalanceAndTopUp(signerWithSender, 1, 10, 15);
  let errors = false;
  while (!errors) {
    // do a quick check that
    if (runs % 100 === 0) {
      await checkBalanceAndTopUp(signerWithSender, 1, 10, 0);
    }

    // we dont await this since we want to send at a constant rate
    sendAndRecordTransaction(
      perfContract.tryme.bind(this),
      signer.provider,
      blockPollingInterval,
      statsPrinter
    ).catch((err) => {
      console.error(err);
      errors = true;
    });

    // now wait until the result?
    await wait(sendingInterval);

    runs++;
  }
};

setup().then((config) =>
  run(
    config.wallet,
    500,
    "0xc53af3030879ff5750ba56c17e656043c3a26987",
    15000,
    // 5 min window size, print every 30 secs
    new StatsPrinter(300, 20)
  ).catch((err) => {
    console.log(err);
  })
);
