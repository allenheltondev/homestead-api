import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

// One shared client per Lambda execution environment. The Document
// client wraps the low-level DynamoDBClient and handles marshall /
// unmarshall automatically, so route + domain code can pass plain JS
// objects.
const baseClient = new DynamoDBClient();

export const ddb = DynamoDBDocumentClient.from(baseClient, {
  marshallOptions: {
    // Drop undefined attributes so optional fields round-trip cleanly
    // through update operations instead of erroring.
    removeUndefinedValues: true,
  },
});

export const TABLE_NAME = process.env.TABLE_NAME;
