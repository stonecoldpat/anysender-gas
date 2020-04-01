import { ethers, Wallet } from "ethers";
import { PerformanceTestFactory } from "../../out/PerformanceTestFactory";
import { Provider } from "ethers/providers";
import { parseEther, BigNumber } from "ethers/utils";
import { sendMail, updateTimestamp } from "./anysender-utils";
import { MNEMONIC } from "./config";
import {
  wait,
  getRandomInt,
  setup,
  deployPerformanceContract,
  waitForNextRound
} from "./spam-utils";

let KEY_PATH = "m/44'/50'/1'/1/"; // A key path
const NO_KEYS = 70; // Number of keys to fund up front
const KEYS_PER_PROCESS = 40; // Number of signing keys per process

/**
 * Top up spam accounts.
 * @param wallet Wallet
 * @param provider InfuraProvider
 */
async function prepareSpamWallets(
  toDeposit: BigNumber,
  noKeys: number,
  keyPath: string,
  wallet: Wallet,
  provider: Provider
) {
  let response: ethers.providers.TransactionResponse;

  // Top up each signing key
  for (let i = 0; i < noKeys; i++) {
    let path = keyPath + i;
    let secondMnemonicWallet = ethers.Wallet.fromMnemonic(MNEMONIC, path);
    let connectedWallet = secondMnemonicWallet.connect(provider);

    try {
      response = await wallet.sendTransaction({
        to: connectedWallet.address,
        value: toDeposit
      });
    } catch (e) {
      console.log(e);
    }

    await wait(750);
  }

  // We just care about the final transaction confirmation
  await response.wait(1);

  for (let i = 0; i < noKeys; i++) {
    let path = keyPath + i;
    let secondMnemonicWallet = ethers.Wallet.fromMnemonic(MNEMONIC, path);
    let bal = await provider.getBalance(secondMnemonicWallet.address);
    console.log(
      "address: " + secondMnemonicWallet.address + " balance: " + bal.toString()
    );
  }
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
  gasPrice: BigNumber,
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

  sendMail(
    "Process for spam started",
    "It considers range [" + startKey + "," + noKeys + "]",
    "",
    false
  );

  // Let's send lots of big transactions.
  for (let i = startKey; i < noKeys; i++) {
    let path = keyPath + i;
    let secondMnemonicWallet = ethers.Wallet.fromMnemonic(MNEMONIC, path);
    let connectedWallet = secondMnemonicWallet.connect(provider);

    try {
      sendMail("New key started", "Key: " + startKey, "", false);
      for (let j = 0; j < noJobs; j++) {
        await performTestContract.connect(connectedWallet).test({
          gasLimit: getRandomInt(50000, 500000),
          gasPrice: gasPrice
        });
        console.log("Transaction " + i + ":" + j + " sent");
        await wait(750);
      }
    } catch (e) {
      console.log(e);
    }
  }
}

/**
 * Sets up several processes to kick-start the spam and
 * returns promises.
 *
 * @param spamContract Spam contract address
 * @param gasPrice Gas price for spam transactions
 * @param wallet Signing wallet
 * @param provider Infura Provider
 */
async function performSpam(
  spamContract: string,
  gasPrice: BigNumber,
  noJobs: number,
  wallet: Wallet,
  provider: Provider
) {
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
      noJobs,
      gasPrice,
      KEY_PATH,
      wallet,
      provider
    );

    waitSpam.push(needToWait);
  }

  return waitSpam;
}

/**
 * Runs Ropsten spam
 * - Set up spam wallets (e.g. deposit ether)
 * - Send spam to network
 */

(async () => {
  const { wallet, provider } = await setup();

  while (true) {
    // All emails are pre-pended with round timestamp
    updateTimestamp();

    let gasPrice: BigNumber; // Spam gas price
    let keyDeposit: BigNumber; // Deposit per key
    let keyJobs: number; // Maximum number of jobs we will try per signing key

    // A different gas price every day
    switch (new Date().getDay()) {
      case 0: // sun
        gasPrice = parseEther("0.0000001"); // 100 gwei
        keyDeposit = parseEther("1");
        keyJobs = 20;

        break;
      case 1: // mon
        gasPrice = parseEther("0.00000006"); // 60 gwei
        keyDeposit = parseEther("1");
        keyJobs = 20;

        break;
      case 2: // tue
        gasPrice = parseEther("0.00000009"); // 90 gwei
        keyDeposit = parseEther("1");
        keyJobs = 4;

        break;
      case 3: // wed
        gasPrice = parseEther("0.00000008"); // 80 gwei
        keyDeposit = parseEther("1");
        keyJobs = 1;

        break;
      case 4: // thur
        gasPrice = parseEther("0.000000015"); // 15 gwei
        keyDeposit = parseEther("1");
        keyJobs = 50;

        break;
      case 5: // fri
        gasPrice = parseEther("0.00000015"); // 150 gwei
        keyDeposit = parseEther("1");
        keyJobs = 4;

        break;
      case 6: // sat
        gasPrice = parseEther("0.0000002"); // 200 gwei
        keyDeposit = parseEther("2");
        keyJobs = 40;
        break;
    }

    sendMail(
      "Spam: New Round",
      "Lets do it! Take down ropsten! Rawrrrrr!!",
      "",
      false
    );

    // Spam ropsten with lots of transactions
    await prepareSpamWallets(keyDeposit, NO_KEYS, KEY_PATH, wallet, provider);
    const spamContract = await deployPerformanceContract(wallet);
    console.log("Spam contract for ropsten: " + spamContract);

    const spamPromises = await performSpam(
      spamContract,
      gasPrice,
      keyJobs,
      wallet,
      provider
    );

    await Promise.all(spamPromises);

    console.log("One small step for satoshi, one giant leap for mankind");
    await waitForNextRound();
  }
})().catch(e => {
  console.log(e);
  // Deal with the fact the chain failed
});
