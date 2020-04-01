import { Wallet, ethers } from "ethers";
import { PerformanceTestFactory } from "../../out/PerformanceTestFactory";
import { INFURA_PROJECT_ID, MNEMONIC } from "./config";

/**
 * Set up the provider and wallet
 */
export async function setup() {
  const infuraProvider = new ethers.providers.InfuraProvider(
    "ropsten",
    INFURA_PROJECT_ID
  );

  const mnemonicWallet = ethers.Wallet.fromMnemonic(MNEMONIC);
  const connectedWallet = mnemonicWallet.connect(infuraProvider);

  return { wallet: connectedWallet, provider: infuraProvider };
}

/**
 * Deploy performance test contract to the network
 * @param wallet Signer
 * @param provider InfuraProvider
 */
export async function deployPerformanceContract(
  wallet: Wallet
): Promise<string> {
  const performanceTestFactory = new PerformanceTestFactory(wallet);
  const performanceTestTransaction = performanceTestFactory.getDeployTransaction();
  const response = await wallet.sendTransaction(performanceTestTransaction);
  const receipt = await response.wait(6);

  return receipt.contractAddress;
}

/**
 * An easy function to help us wait until the next round
 */
export async function waitForNextRound() {
  // Wake up every
  let wakeup = false;

  while (!wakeup) {
    const mins = 600000;
    var eta_ms =
      (Date.now() - new Date(2020, 0, 21, 20, 29).getTime()) % 86400000;

    if (eta_ms > mins) {
      await wait(mins);
    } else {
      wakeup = true;
    }
  }
}

/**
 * Prepares a HTML Table for the email
 * @param tableData Data for the summary table
 */
export function prepareSummaryTable(tableData: any[]) {
  // Now that we have finished, lets put together a table.
  let tableStart = `<table style="width:100%">`;
  let tableHeaders =
    "<tr><th>Round</th><th>Quickest</th><th>Slowest</th><th>Median</th><th>Average</th><th>Total Jobs</th></tr>";
  let tableRows = "";

  for (let i = 0; i < tableData.length; i++) {
    tableRows =
      tableRows +
      `<tr style="text-align:center">` +
      "<td>" +
      tableData[i][5] +
      "</td>" +
      "<td>" +
      tableData[i][0] +
      "</td>" +
      "<td>" +
      tableData[i][1] +
      "</td>" +
      "<td>" +
      tableData[i][2] +
      "</td>" +
      "<td>" +
      tableData[i][3] +
      "</td>" +
      "<td>" +
      tableData[i][4] +
      "</td>" +
      "</tr>";
  }

  let tableEnd = "</table>";

  return tableStart + tableHeaders + tableRows + tableEnd;
}

/**
 * Wait function
 * @param ms Milli-seconds
 */
export async function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Random number within a range
 * @param min Smallest int
 * @param max Largest int
 */
export function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
