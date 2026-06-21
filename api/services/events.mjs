import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { logger } from "./logger.mjs";

// One shared EventBridge client per execution environment. Domain code
// calls publishEvent() to emit a domain event; downstream rules/consumers
// (notifications, projections, audit) subscribe by detail-type. Keeping
// the source stable ("homestead.api") lets rules match on it.
const client = new EventBridgeClient();

const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || "default";
const EVENT_SOURCE = "homestead.api";

export async function publishEvent(detailType, detail) {
  const entry = {
    EventBusName: EVENT_BUS_NAME,
    Source: EVENT_SOURCE,
    DetailType: detailType,
    Detail: JSON.stringify(detail ?? {}),
  };

  const result = await client.send(new PutEventsCommand({ Entries: [entry] }));

  // PutEvents returns 200 even when individual entries fail; FailedEntryCount
  // surfaces partial failures that would otherwise be silently dropped.
  if (result?.FailedEntryCount > 0) {
    const reason = result?.Entries?.find((e) => e.ErrorCode)?.ErrorMessage;
    logger.error("publishEvent failed", { detailType, reason });
    throw new Error(`Failed to publish ${detailType} event: ${reason ?? "unknown"}`);
  }

  return result;
}
