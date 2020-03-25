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
  subscribe
} from "./anysender-utils";

const mnemonic = "";
const INFURA_PROJECT_ID = "a3b26b2802f44d9caec977a00c08c01b";
const NO_KEYS = 100; // Number of keys to fund up front
// Try to send up to 100 transactions
// It will throw exception when out of balance and move onto next key
const NO_JOBS = 100;

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
  console.log("Topping up " + wallet.address + " balance on any.sender.");
  await onchainDepositFor(parseEther(toDeposit), wallet);
  const response = await checkBalance(wallet);
  console.log(response);
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

  console.log("Performance contract: " + receipt.contractAddress);
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
      gas: 3000000 - i * 10,
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

    // Send receipt!
    const txReceipt = await anysender.relay(signedRelayTx);
    console.log(i + ": " + txReceipt.id);

    listOfPromises.push(subscribe(signedRelayTx, wallet, provider));
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
  wallet: Wallet,
  provider: Provider
) {
  for (let i = 0; i < noKeys; i++) {
    let path = "m/44'/50'/1'/0/" + i;
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
  noKeys: number,
  noJobs: number,
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
  for (let i = 1; i < noKeys; i++) {
    let path = "m/44'/60'/1'/0/" + i;
    let secondMnemonicWallet = ethers.Wallet.fromMnemonic(mnemonic, path);
    let connectedWallet = secondMnemonicWallet.connect(provider);

    // Two jobs per key
    for (let j = 0; j < noJobs; j++) {
      try {
        let receipt = await performTestContract.connect(connectedWallet).test({
          gasLimit: getRandomInt(100000, 5000000),
          gasPrice: parseEther("0.00000006") // 10 to 90 gwei
        });

        console.log(receipt);

        await delay(750);
      } catch (e) {
        console.log(e);
      }
    }
  }
}

/**
 * Delay function
 * @param ms Milli-seconds
 */
function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

  console.log("Balance: " + (await provider.getBalance(wallet.address)));
  // Deposit into any.sender
  //   await deposit("600", wallet, provider);
  await checkBalance(wallet);

  // Spam ropsten with lots of transactions
  await prepareSpamWallets("2", NO_KEYS, wallet, provider);
  const spamContract = await deployPerformanceContract(wallet);

  // Relay new contract
  const relayContract = await deployPerformanceContract(wallet);

  // Spam any.sender will lots of transactions
  await spam(spamContract, NO_KEYS, NO_JOBS, wallet, provider);

  // Send out the relay jobs (largest to smallest in gas)
  await relayJob(37, relayContract, wallet, provider);

  console.log("One small step for satoshi, one giant leap for mankind");
})().catch(e => {
  console.log(e);
  // Deal with the fact the chain failed
});
