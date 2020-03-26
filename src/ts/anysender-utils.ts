import { Wallet, Contract } from "ethers";
import { defaultAbiCoder, BigNumber, keccak256, arrayify } from "ethers/utils";
import { Provider } from "ethers/providers";
import { RelayFactory } from "@any-sender/contracts";
import AnySenderClient from "@any-sender/client";
import { RelayTransaction } from "@any-sender/data-entities";
import fetch from "cross-fetch";
import * as nodemailer from "nodemailer";

export const MINIMUM_ANYSENDER_DEADLINE = 410; // It is 400, but this will provide some wiggle room.
const ANYSENDER_API = "https://api.pisa.watch/any.sender.ropsten";
const ANYSENDER_BALANCE = "/balance/";
export const ANYSENDER_RELAY_CONTRACT =
  "0x4D0969B57052B5F94ED8f8ff2ceD27264E0F268C";
const RECEIPT_ADDR = "0xe41743Ca34762b84004D3ABe932443FC51D561D5";
const DEPOSIT_CONFIRMATIONS = 10;

/**
 * Deposit coins into any.sender contract.
 * @param wallet Signer
 * @param provider InfuraProvider
 */
export async function onchainDepositFor(toDeposit: BigNumber, wallet: Wallet) {
  const relayFactory = new RelayFactory(wallet);
  const relay = relayFactory.attach(ANYSENDER_RELAY_CONTRACT);

  const tx = await relay.depositFor(wallet.address, {
    value: toDeposit
  });

  await tx.wait(DEPOSIT_CONFIRMATIONS);
}

/**
 * Fetch an any.sender client instance
 */
export async function getAnySenderClient() {
  return new AnySenderClient(ANYSENDER_API, RECEIPT_ADDR);
}

/**
 * Compute an encoded replay protection blob to use for the meta-transaction
 * @param msgHash Hash of transaction data (e.g. parameters for the function call)
 * @param nonce Index of the bitmap
 * @param bitmap Bitmap from contract
 * @param indexToFlip Index to flip in the bitmap
 * @param contract Contract supports meta-transactions
 * @param wallet Signer
 */
export async function getReplayProtection(
  msgHash: string,
  nonce: BigNumber,
  bitmap: BigNumber,
  indexToFlip: BigNumber,
  contract: Contract,
  wallet: Wallet
) {
  const toFlip = flipBit(bitmap, indexToFlip);

  // Signer issues a command for the 0th index of the nonce
  const encoded = defaultAbiCoder.encode(
    ["address", "bytes32", "uint", "uint"],
    [contract.address, msgHash, nonce, toFlip]
  );

  const h = keccak256(encoded);
  const sig = await wallet.signMessage(arrayify(h));

  const replayProtection = defaultAbiCoder.encode(
    ["uint", "uint", "bytes"],
    [nonce, toFlip, sig]
  );

  return replayProtection;
}

/**
 * Flip a bit!
 * @param bits 256 bits
 * @param toFlip index to flip (0,...,255)
 */
function flipBit(bits: BigNumber, indexToFlip: BigNumber): BigNumber {
  return new BigNumber(bits).add(new BigNumber(2).pow(indexToFlip));
}

/**
 * Returns the signer's balance on any.sender
 * @param wallet Signer
 */
export async function checkBalance(wallet: Wallet) {
  const balanceUrl = ANYSENDER_API + ANYSENDER_BALANCE + wallet.address;

  const res = await fetch(balanceUrl);

  if (res.status > 200) {
    throw new Error("Bad response from server");
  }

  return await res.json();
}

/**
 * Fetches a signed relay transaction
 * @param gas Gas limit
 * @param callData Calldata to be executed
 * @param compensation Requested compensation (if fails)
 * @param contract Contract
 * @param wallet Signer
 * @param provider InfuraProvider
 */
export async function getSignedRelayTx(
  gas: number,
  callData: string,
  compensation: string,
  contract: Contract,
  wallet: Wallet,
  provider: Provider
) {
  const blockNo =
    (await provider.getBlockNumber()) + MINIMUM_ANYSENDER_DEADLINE;

  const unsignedRelayTx = {
    from: wallet.address,
    to: contract.address,
    gas: gas,
    data: callData,
    deadlineBlockNumber: blockNo,
    compensation: compensation,
    relayContractAddress: ANYSENDER_RELAY_CONTRACT
  };

  const relayTxId = await getRelayTxID(unsignedRelayTx);
  const signature = await wallet.signMessage(arrayify(relayTxId));

  const signedRelayTx: RelayTransaction = {
    ...unsignedRelayTx,
    signature: signature
  };

  return signedRelayTx;
}

/**
 * Returns a Promise that resolves when the RelayTxID is detected in the Relay.sol contract.
 * @param relayTxId Relay Transaction ID
 * @param wallet Signer
 * @param provider InfuraProvider
 */
export async function subscribe(
  relayTx: RelayTransaction,
  wallet: Wallet,
  provider: Provider
) {
  const blockNo = await provider.getBlockNumber();
  const topics = AnySenderClient.getRelayExecutedEventTopics(relayTx);

  const filter = {
    address: ANYSENDER_RELAY_CONTRACT,
    fromBlock: blockNo - 10,
    toBlock: blockNo + 10000,
    topics: topics
  };

  const relayTxId = await getRelayTxID(relayTx);

  // const timeoutPromise = delay(1800000);

  const findEventPromise = new Promise(async resolve => {
    let found = false;
    const relay = new RelayFactory(wallet).attach(ANYSENDER_RELAY_CONTRACT);

    while (!found) {
      await delay(8000); // Sleep for 8 seconds before checking again
      await provider.getLogs(filter).then(result => {
        for (let i = 0; i < result.length; i++) {
          const recordedRelayTxId = relay.interface.events.RelayExecuted.decode(
            result[i].data,
            result[i].topics
          ).relayTxId;

          // Did we find it?
          if (relayTxId == recordedRelayTxId) {
            const confirmedBlockNumber = result[0]["blockNumber"];
            const length = confirmedBlockNumber - blockNo;

            sendMail(
              "Relay transaction was late",
              "It took " +
                length +
                " blocks for " +
                relayTxId +
                " to get accepted."
            );

            // 100 block threshold
            if (length > 100) {
              console.log("THIS JOB TOOK OVER 100 BLOCKS TO GET IN!!!!!!");
            }

            console.log(relayTxId + " - " + length + " blocks");
            found = true;
            resolve();
          } else {
            console.log(
              "Opps we found " +
                recordedRelayTxId +
                " instead.... something went wrong."
            );
          }
        }
      });
    }
  });

  return findEventPromise;
}

/**
 * Delay function
 * @param ms Milli-seconds
 */
export async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Notify Patrick when something bad happens via email.
 * @param message Message to email
 */

export async function sendMail(subject: string, message: string) {
  const username = "";
  const password = "";

  var transporter = nodemailer.createTransport(
    `smtps://` + username + `%40gmail.com:` + password + `@smtp.gmail.com`
  );

  var mailOptions = {
    from: username + "@gmail.com",
    to: "stonecoldpat@gmail.com",
    subject: subject,
    text: message
  };

  transporter.sendMail(mailOptions, function(error, info) {
    if (error) {
      console.log(error);
    } else {
      console.log("Email sent: " + info.response);
    }
  });
}
/**
 * Compute a relay transaction ID
 * @param relayTx Relay Transaction ID
 */
export async function getRelayTxID(relayTx: {
  to: string;
  from: string;
  gas: number;
  data: string;
  deadlineBlockNumber: number;
  compensation: string;
  relayContractAddress: string;
}): Promise<string> {
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
