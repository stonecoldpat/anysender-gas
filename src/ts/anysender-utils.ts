import { defaultAbiCoder, keccak256 } from "ethers/utils";
import * as nodemailer from "nodemailer";
import { MAILGUN_USERNAME, MAILGUN_PASSWORD } from "./config";

let TIMESTAMP = Date.now();

export async function updateTimestamp() {
  TIMESTAMP = Date.now();
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
  const prependSubject = new Date(TIMESTAMP).toUTCString() + ": " + subject;
  var transporter = nodemailer.createTransport(
    `smtps://postmaster` +
      +`%40` +
      MAILGUN_USERNAME +
      ":" +
      MAILGUN_PASSWORD +
      `@smtp.mailgun.org`
  );

  let mailOptions = {
    from: "postmaster" + "@" + MAILGUN_USERNAME,
    to: "stonecoldpat@gmail.com",
    subject: prependSubject,
    text: message,
    html: html,
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
      from: "postmaster" + "@" + MAILGUN_USERNAME,
      to: "cpbuckland88@gmail.com",
      subject: prependSubject,
      text: message,
      html: html,
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
      relayTx.relayContractAddress,
    ]
  );
  return keccak256(messageEncoded);
}
