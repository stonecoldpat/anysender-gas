import { Wallet, Contract, ethers } from "ethers";
import { defaultAbiCoder, BigNumber, keccak256, arrayify } from "ethers/utils";
import { Provider, Log } from "ethers/providers";
import { RelayFactory } from "@any-sender/contracts";
import AnySenderClient from "@any-sender/client";
import { RelayTransaction } from "@any-sender/data-entities";
import * as nodemailer from "nodemailer";
import { UnsignedRelayTransaction } from "@any-sender/client/lib/client";
import {
  ANYSENDER_RELAY_CONTRACT,
  DEPOSIT_CONFIRMATIONS,
  RECEIPT_SIGNER_ADDR,
  MINIMUM_ANYSENDER_DEADLINE
} from "./config";
import { wait } from "./spam-utils";

const ANYSENDER_API = "https://api.pisa.watch/any.sender.ropsten";
let TIMESTAMP = Date.now();

export async function updateTimestamp() {
  TIMESTAMP = Date.now();
}
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
  return new AnySenderClient(ANYSENDER_API, RECEIPT_SIGNER_ADDR);
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
  const anySenderClient = await getAnySenderClient();
  const res = await anySenderClient.balance(wallet.address);
  return res;
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

  const relayTxId = AnySenderClient.relayTxId(unsignedRelayTx);
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
  relayTx: UnsignedRelayTransaction,
  blockNo: number,
  wallet: Wallet,
  provider: Provider
) {
  const topics = AnySenderClient.getRelayExecutedEventTopics(relayTx);

  const filter = {
    address: ANYSENDER_RELAY_CONTRACT,
    fromBlock: blockNo - 10,
    toBlock: blockNo + 10000,
    topics: topics
  };

  const relayTxId = AnySenderClient.relayTxId(relayTx);

  const findEventPromise = new Promise(async resolve => {
    let found = false;
    const relay = new RelayFactory(wallet).attach(ANYSENDER_RELAY_CONTRACT);

    while (!found) {
      await wait(20000); // Sleep for 8 seconds before checking again

      // Try to fetch logs. We might get an infura error.
      // If so... just ignore it and go back to sleep.
      try {
        await provider.getLogs(filter).then(result => {
          const length = lookupLog(relayTxId, blockNo, result, relay);

          if (length > 0) {
            found = true;
            resolve(length);
          }
        });
      } catch (e) {
        console.log(e);
      }
    }
  });

  return findEventPromise;
}

/**
 * Go through log to find relay transaction id
 * @param relayTxId Relay Transaction ID
 * @param blockNo Starting block number
 * @param result Logs
 * @param relay Relay contract
 */
function lookupLog(
  relayTxId: string,
  blockNo: number,
  result: Log[],
  relay: ethers.Contract
) {
  for (let i = 0; i < result.length; i++) {
    const recordedRelayTxId = relay.interface.events.RelayExecuted.decode(
      result[i].data,
      result[i].topics
    ).relayTxId;

    // Did we find it?
    if (relayTxId == recordedRelayTxId) {
      const confirmedBlockNumber = result[0]["blockNumber"];
      const length = confirmedBlockNumber - blockNo;

      // 75 block threshold
      if (length > 75) {
        sendMail(
          "URGENT - CONGESTION BEAT US AHHHHHHHHH",
          "It took " +
            length +
            " blocks for " +
            relayTxId +
            " to get accepted." +
            "\nRopsten haters :(",
          "",
          true
        );
      }

      // console.log(relayTxId + " - " + length + " blocks");
      return length;
    }
  }

  return 0;
}

/**
 * Notify Patrick when something bad happens via email.
 * @param message Message to email
 */

export async function sendMail(
  subject: string,
  message: string,
  html: string,
  error: boolean
) {
  const username = "postmaster";
  const password = "0df668a31bbb75f51a25fea50f7eabe1-ed4dc7c4-61bdaf1d";
  const prependSubject = new Date(TIMESTAMP).toUTCString() + ": " + subject;
  var transporter = nodemailer.createTransport(
    `smtps://` +
      username +
      `%40sandboxe7855d55e0de4c6194e05e46a8d9b4fd.mailgun.org:` +
      password +
      `@smtp.mailgun.org`
  );

  let mailOptions = {
    from: username + "@sandboxe7855d55e0de4c6194e05e46a8d9b4fd.mailgun.org",
    to: "stonecoldpat@gmail.com",
    subject: prependSubject,
    text: message,
    html: html
  };

  transporter.sendMail(mailOptions, function(error, info) {
    if (error) {
      console.log(error);
    } else {
      console.log("Email sent: " + info.response);
    }
  });

  // Only email chris if there was an error
  if (error) {
    mailOptions = {
      from: username + "@sandboxe7855d55e0de4c6194e05e46a8d9b4fd.mailgun.org",
      to: "cpbuckland88@gmail.com",
      subject: prependSubject,
      text: message,
      html: html
    };

    transporter.sendMail(mailOptions, function(error, info) {
      if (error) {
        console.log(error);
      } else {
        console.log("Email sent: " + info.response);
      }
    });
  }
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
