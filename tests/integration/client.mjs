import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from "@aws-sdk/client-cognito-identity-provider";

// Integration test HTTP client. Talks to a DEPLOYED staging stack:
//   - STAGE_API_URL    base URL of the API (stack output ApiBaseUrl)
//   - USER_POOL_CLIENT_ID / TEST_USERNAME / TEST_PASSWORD
//                      drive a Cognito USER_PASSWORD_AUTH flow to mint a
//                      real id token, attached as the Authorization header
//
// Never imported by unit tests -- jest.config.mjs roots at tests/unit, so
// this file only loads under `npm run test:integration`.

const BASE_URL = (process.env.STAGE_API_URL || "").replace(/\/$/, "");
const REGION = process.env.AWS_REGION || "us-east-1";
const USER_POOL_CLIENT_ID = process.env.USER_POOL_CLIENT_ID;
const TEST_USERNAME = process.env.TEST_USERNAME;
const TEST_PASSWORD = process.env.TEST_PASSWORD;

const cognito = new CognitoIdentityProviderClient({ region: REGION });

let cachedToken;

// Exchanges the test user's credentials for a Cognito id token. Cached
// for the lifetime of the test process so we authenticate once per run.
export async function getIdToken() {
  if (cachedToken) return cachedToken;

  if (!USER_POOL_CLIENT_ID || !TEST_USERNAME || !TEST_PASSWORD) {
    throw new Error(
      "Integration auth requires USER_POOL_CLIENT_ID, TEST_USERNAME and TEST_PASSWORD env vars.",
    );
  }

  const result = await cognito.send(
    new InitiateAuthCommand({
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: USER_POOL_CLIENT_ID,
      AuthParameters: {
        USERNAME: TEST_USERNAME,
        PASSWORD: TEST_PASSWORD,
      },
    }),
  );

  const idToken = result?.AuthenticationResult?.IdToken;
  if (!idToken) {
    throw new Error("Cognito InitiateAuth did not return an IdToken.");
  }
  cachedToken = idToken;
  return cachedToken;
}

// Issues an authenticated request against the staging API and returns
// { status, body } where body is parsed JSON when possible.
export async function request(method, path, body) {
  if (!BASE_URL) {
    throw new Error("STAGE_API_URL env var is not set.");
  }

  const token = await getIdToken();
  const url = `${BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }

  return { status: response.status, body: parsed };
}
