import { PerformanceTestFactory } from "../../out/PerformanceTestFactory";
import { wait, setup } from "../spam/spam-utils";
import { any, SignerWithAnySender, AnyDotSenderCoreClient } from "@any-sender/client";
import { parseEther } from "ethers/utils";
import { Signer, ethers, Wallet } from "ethers";
import { WaitableRelayTransactionReceipt } from "@any-sender/client/lib/publicInterfaces";
import { StatsPrinter } from "./statsPrinter";
import { JsonRpcProvider } from "ethers/providers";
import { N_CLIENTS } from "../config";

// We refer to the client at the official address for checking balances
// const coreClient = new AnyDotSenderCoreClient({
//   apiUrl: "https://api.pisa.watch/any.sender.ropsten",
//   receiptSignerAddress: "0xe41743Ca34762b84004D3ABe932443FC51D561D5"
// });

// send transactions with a wait in between each one
const topUp = async (
  signer: SignerWithAnySender<Signer>,
  topupAmount: number,
  confirmations: number
) => {
  try {
    const depositResponse = await signer.any.deposit(
      parseEther(topupAmount.toString())
    );

    if (confirmations !== 0) await depositResponse.wait(confirmations);
  } catch (err) {
    console.error(err);
    throw err;
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
  } finally {
    statsPrinter.printStats();
  }
};

const run = async (
  apiUrl: string,
  receiptSignerAddress: string,
  wallets: Wallet[],
  sendingInterval: number,
  perfContractAddress: string,
  blockPollingInterval: number,
  maxPendingGas: number,
  statsPrinter: StatsPrinter
) => {
  (wallets[0].provider as JsonRpcProvider).pollingInterval = 10000;
  const clientConfig = {
    apiUrl,
    receiptSignerAddress
  };

  console.log("Signer addresses:", wallets.map(w => w.address).join(", "));

  const signersWithSender = wallets.map(signer => any.sender(signer, clientConfig));
  const perfContracts = wallets.map(signer => any.sender(
    new PerformanceTestFactory(signer).attach(perfContractAddress),
    clientConfig
  ));

  //* <--- switch to decide if topping up or not
  console.log("Checking balances and topping up");
  await Promise.all(signersWithSender.map(signerWithSender => topUp(signerWithSender, 10, 15)));
  //*/

  let errors = false;

  // the gas limit we use for each transaction
  const gasLimit = 30000;
  // the actual number varies because of theactualGasLimit; this is an upper bound, but pretty close
  const reservedGasPerTx = 140000;

  let currentPendingGas = 0; // sum of gas limits of transactions in flight
  let runs = 1;
  console.log("Starting");
  while (!errors) {
    const i = runs % N_CLIENTS;
    const perfContract = perfContracts[i];
    const signer = wallets[i];

    const actualGasLimit = gasLimit + (runs % 5000); // salt to avoid replay rejections

    // We wait an interval if we don't have available pending gas
    while (currentPendingGas + reservedGasPerTx > maxPendingGas) {
      await wait(sendingInterval);
    }

    // We wait an interval if we don'ŧ have available pending gas
    currentPendingGas += reservedGasPerTx;
    statsPrinter.pendingGas = currentPendingGas;

    // we dont await this since we want to send at a constant 
    sendAndRecordTransaction(
      () => perfContract.tryme({
        gasLimit: actualGasLimit
      }),
      signer.provider,
      blockPollingInterval,
      statsPrinter
    ).catch((err) => {
      console.log(err);
      errors = true;
    }).finally(() => {
      currentPendingGas -= reservedGasPerTx;
      statsPrinter.pendingGas = currentPendingGas;
    });

    statsPrinter.printStats();

    // now wait until the result?
    await wait(sendingInterval);

    runs++;
  }
};

setup().then(({ wallets, config }) =>
  run(
    config.ANYSENDER_API,
    config.RECEIPT_SIGNER_ADDR,
    wallets,
    50,
    "0xc53af3030879ff5750ba56c17e656043c3a26987",
    15000,
    config.MAX_PENDING_GAS,
    // 10 min window size, print every 3 minutes print interval
    new StatsPrinter(600, 180)
  ).catch((err) => {
    console.log(err);
  })
);
