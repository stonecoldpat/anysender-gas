import { ethers, Wallet } from "ethers";
import { PerformanceTestFactory } from "../../out/PerformanceTestFactory";
import { RelayTransaction } from "@any-sender/data-entities";
import { Provider } from "ethers/providers";
import { parseEther, defaultAbiCoder, keccak256, arrayify } from "ethers/utils";
import {
  onchainDepositFor,
  checkBalance,
  getAnySenderClient,
  MINIMUM_ANYSENDER_DEADLINE,
  ANYSENDER_RELAY_CONTRACT,
  subscribe,
  delay,
  sendMail
} from "./anysender-utils";

const mnemonic = "";

const INFURA_PROJECT_ID = "a3b26b2802f44d9caec977a00c08c01b";
const NO_KEYS = 200; // Number of keys to fund up front
const NO_JOBS = 1000; // Maximum number of jobs we will try per signing key
const ANYSENDER_ROUNDS = 1; // Number of rounds we'll send transactions to any.sender
const ANYSENDER_RELAY_JOBS = 3; // Number of jobs per round
const KEYS_PER_PROCESS = 20; // Number of signing keys per process
let KEY_PATH = "m/44'/50'/1'/0/"; // A key path

/**
 * Computes a hash of the relay transaction ID.
 * @param relayTx Unsigned Relay Transaction
 */
function getRelayTxID(relayTx: {
  to: string;
  from: string;
  gas: number;
  data: string;
  deadlineBlockNumber: number;
  compensation: string;
  relayContractAddress: string;
}): string {
  const messageEncoded = defaultAbiCoder.encode(
    ["address", "address", "bytes", "uint", "uint", "uint", "address"],
    [
      relayTx.to,
      relayTx.from,
      relayTx.data,
      relayTx.deadlineBlockNumber,
      relayTx.compensation,
      relayTx.gas,
      relayTx.relayContractAddress
    ]
  );
  return keccak256(messageEncoded);
}

/**
 * Set up the provider and wallet
 */
async function setup() {
  const infuraProvider = new ethers.providers.InfuraProvider(
    "ropsten",
    INFURA_PROJECT_ID
  );

  const mnemonicWallet = ethers.Wallet.fromMnemonic(mnemonic);
  const connectedWallet = mnemonicWallet.connect(infuraProvider);

  return { wallet: connectedWallet, provider: infuraProvider };
}

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
 * Deploy performance test contract to the network
 * @param wallet Signer
 * @param provider InfuraProvider
 */
async function deployPerformanceContract(wallet: Wallet): Promise<string> {
  const performanceTestFactory = new PerformanceTestFactory(wallet);
  const performanceTestTransaction = performanceTestFactory.getDeployTransaction();
  const response = await wallet.sendTransaction(performanceTestTransaction);
  const receipt = await response.wait(6);

  return receipt.contractAddress;
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

  let listOfPromises = [];

  for (let i = 0; i < totalJobs; i++) {
    const callData = performTestContract.interface.functions.test.encode([]);

    const deadline =
      (await provider.getBlockNumber()) + MINIMUM_ANYSENDER_DEADLINE;

    const unsignedRelayTx = {
      from: wallet.address,
      to: performanceTestAddr,
      gas: 3000000 - i,
      data: callData,
      deadlineBlockNumber: deadline,
      compensation: parseEther("0.00000001").toString(),
      relayContractAddress: ANYSENDER_RELAY_CONTRACT
    };

    const relayTxId = getRelayTxID(unsignedRelayTx);
    const signature = await wallet.signMessage(arrayify(relayTxId));

    const signedRelayTx: RelayTransaction = {
      ...unsignedRelayTx,
      signature: signature
    };

    // We might hit a global gas-limit in any.sender
    // ... so let's just ignore this job and not create
    // a promise to wait on it.
    try {
      // Send receipt!
      const txReceipt = await anysender.relay(signedRelayTx);
      console.log(i + ": " + txReceipt.id);

      listOfPromises.push(subscribe(signedRelayTx, wallet, provider));
    } catch (e) {
      console.log(e);
      await delay(5000); // Sanity wait, to stop rapid spam.
    }
  }

  await Promise.all(listOfPromises);
}

/**
 * Top up spam accounts.
 * @param wallet Wallet
 * @param provider InfuraProvider
 */
async function prepareSpamWallets(
  toDeposit: string,
  noKeys: number,
  keyPath: string,
  wallet: Wallet,
  provider: Provider
) {
  // Top up each signing key
  for (let i = 0; i < noKeys; i++) {
    let path = keyPath + i;
    let secondMnemonicWallet = ethers.Wallet.fromMnemonic(mnemonic, path);
    let connectedWallet = secondMnemonicWallet.connect(provider);

    let response = await wallet.sendTransaction({
      to: connectedWallet.address,
      value: parseEther(toDeposit)
    });

    await response.wait(1);

    let bal = await provider.getBalance(secondMnemonicWallet.address);
    console.log(
      "address: " + secondMnemonicWallet.address + "balance: " + bal.toString()
    );
  }
}

/**
 * Random number within a range
 * @param min Smallest int
 * @param max Largest int
 */
function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Spam ropsten with hash junk
 * @param performanceTestAddr Spam contract
 * @param wallet Signer
 * @param provider InfuraProvider
 */
async function spam(
  performanceTestAddr: string,
  startKey: number,
  noKeys: number,
  noJobs: number,
  keyPath: string,
  wallet: Wallet,
  provider: Provider
) {
  const performanceTestFactory = new PerformanceTestFactory(wallet);
  let performTestContract = new ethers.Contract(
    performanceTestAddr,
    performanceTestFactory.interface.abi,
    provider
  );

  // Let's send lots of big transactions.
  for (let i = startKey; i < noKeys; i++) {
    let path = keyPath + i;
    let secondMnemonicWallet = ethers.Wallet.fromMnemonic(mnemonic, path);
    let connectedWallet = secondMnemonicWallet.connect(provider);

    try {
      for (let j = 0; j < noJobs; j++) {
        await performTestContract.connect(connectedWallet).test({
          gasLimit: getRandomInt(50000, 500000),
          gasPrice: parseEther("0.00000006")
        });

        console.log("Transaction " + i + ":" + j + " sent");
        await delay(750);
      }
    } catch (e) {
      console.log(e);
    }
  }
}

/**
 * Send up lots of jobs to any.sender
 * @param relayContract Relay contract
 * @param wallet Wallet
 * @param provider Provider
 */
async function sendToAnySender(
  relayContract: string,
  wallet: Wallet,
  provider: Provider
) {
  // Loop around 25 times.
  for (let i = 0; i < ANYSENDER_ROUNDS; i++) {
    try {
      // Send out the relay jobs (largest to smallest in gas)
      await relayJob(ANYSENDER_RELAY_JOBS, relayContract, wallet, provider);
    } catch (e) {
      console.log(e);
    }
  }
}

/**
 * Runs the entire program.
 * - Deposits from main wallet
 * - Checks balance on any.sender for main wallet
 * - Deploy performance contract
 * - Set up spam wallets (e.g. deposit ether)
 * - Send spam to network
 * - Send relay jobs to any.sender
 */

(async () => {
  const { wallet, provider } = await setup();

  while (true) {
    console.log("Sleeping for one day.");

    // Wake up every
    let wakeup = false;

    while (!wakeup) {
      const ten = 600000;
      var eta_ms =
        (Date.now() - new Date(2020, 0, 21, 16, 40).getTime()) % 86400000;

      if (eta_ms > ten) {
        await delay(ten);
      } else {
        wakeup = true;
      }
    }

    sendMail("Spam: New Round", "Lets do it! Take down ropsten! Rawrrrrr!!");

    // // Deposit into any.sender
    const depositResponse = await deposit("100", wallet, provider);
    console.log(depositResponse);

    // // Spam ropsten with lots of transactions
    await prepareSpamWallets("1", NO_KEYS, KEY_PATH, wallet, provider);
    const spamContract = await deployPerformanceContract(wallet);
    console.log("Spam contract for ropsten: " + spamContract);

    // // Relay new contract
    const relayContract = await deployPerformanceContract(wallet);
    console.log("Relay contract for any.sender: " + relayContract);

    sendMail(
      "Contract address",
      "Spam contract: " +
        spamContract +
        "\n" +
        "Relay contract: " +
        relayContract
    );

    const waitSpam = [];

    // Spam any.sender will lots of transactions
    for (let i = 0; i < NO_KEYS; i = i + KEYS_PER_PROCESS) {
      let limit = i + KEYS_PER_PROCESS - 1;

      if (limit > NO_KEYS) {
        limit = NO_KEYS;
      }

      console.log("Process range of keys [" + i + "," + limit + "]");

      const needToWait = spam(
        spamContract,
        i,
        limit,
        NO_JOBS,
        KEY_PATH,
        wallet,
        provider
      );

      waitSpam.push(needToWait);
    }

    const needToWait = sendToAnySender(relayContract, wallet, provider);

    waitSpam.push(needToWait);

    console.log("We have " + waitSpam.length + " processes");
    await Promise.all(waitSpam);
    console.log("One small step for satoshi, one giant leap for mankind");
  }
})().catch(e => {
  console.log(e);
  // Deal with the fact the chain failed
});
