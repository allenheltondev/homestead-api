import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { composeWeeklyDigest } from "./domain/digest.mjs";
import { publishEvent } from "./services/events.mjs";
import { logger } from "./services/logger.mjs";

// Scheduled weekly digest function (own esbuild entry point; see
// template.yaml DigestFunction). On its EventBridge schedule it composes the
// weekly digest, ALWAYS publishes a HomesteadDigest domain event (so any
// downstream consumer can react), and -- when both DIGEST_SENDER and
// DIGEST_RECIPIENT are configured -- emails the digest via SES. The email is
// wrapped in try/catch so an SES failure never fails the scheduled run (the
// event has already been published).

// One shared SES client per execution environment.
const ses = new SESClient();

// Renders the digest `lines` into a minimal HTML + text email body.
function renderEmail(digest) {
  const text = digest.lines.join("\n");
  const html = `<html><body><h2>Homestead Weekly Digest</h2><ul>${
    digest.lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")
  }</ul></body></html>`;
  return { text, html };
}

// Minimal HTML escaping for the digest lines (they are server-composed, but
// cheap defense against any stored value leaking markup).
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function sendDigestEmail(digest, sender, recipient) {
  const { text, html } = renderEmail(digest);
  await ses.send(new SendEmailCommand({
    Source: sender,
    Destination: { ToAddresses: [recipient] },
    Message: {
      Subject: { Data: "Homestead Weekly Digest" },
      Body: {
        Text: { Data: text },
        Html: { Data: html },
      },
    },
  }));
}

export const handler = async () => {
  const digest = await composeWeeklyDigest();

  // Always publish the domain event first so downstream consumers see the
  // digest regardless of whether email delivery is configured / succeeds.
  await publishEvent("HomesteadDigest", digest);

  const sender = process.env.DIGEST_SENDER;
  const recipient = process.env.DIGEST_RECIPIENT;

  if (sender && recipient) {
    try {
      await sendDigestEmail(digest, sender, recipient);
      logger.info("digest email sent", { recipient });
    } catch (err) {
      // Never fail the schedule on an email error -- the event is already out.
      logger.error("digest email failed", { error: err?.message });
    }
  } else {
    logger.info("digest email skipped (DIGEST_SENDER/DIGEST_RECIPIENT not set)", {
      lines: digest.lines,
    });
  }

  return digest;
};
