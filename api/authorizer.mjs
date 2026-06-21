import { CognitoJwtVerifier } from "aws-jwt-verify";
import { logger } from "./services/logger.mjs";

// Lambda TOKEN authorizer for the API. Verifies a Cognito JWT via the
// user pool's JWKS and returns an IAM policy plus a context object the
// routes read via event.requestContext.authorizer.
//
// Two token shapes are accepted, for any of the allowed app clients:
//   - id tokens     (dashboard sign-in)      -> validated on the `aud` claim
//   - access tokens (Alexa account linking)  -> validated on `client_id`
// Alexa account linking hands the skill an ACCESS token, so the API must
// accept access tokens minted for the Alexa app client, not just id
// tokens from the dashboard client.

const USER_POOL_ID = process.env.USER_POOL_ID;

// Dashboard client + optional dedicated Alexa app client. Empty/undefined
// entries are dropped, so an unset ALEXA_CLIENT_ID is a no-op.
const allowedClientIds = [
  process.env.USER_POOL_CLIENT_ID,
  process.env.ALEXA_CLIENT_ID,
].filter(Boolean);

if (!USER_POOL_ID || allowedClientIds.length === 0) {
  throw new Error("USER_POOL_ID and USER_POOL_CLIENT_ID env vars must be set.");
}

// Module-scope so each verifier's JWKS stays cached across invocations in
// the same execution environment.
const idVerifier = CognitoJwtVerifier.create({
  userPoolId: USER_POOL_ID,
  tokenUse: "id",
  clientId: allowedClientIds,
});
const accessVerifier = CognitoJwtVerifier.create({
  userPoolId: USER_POOL_ID,
  tokenUse: "access",
  clientId: allowedClientIds,
});

export async function handler(event) {
  const raw = event?.authorizationToken ?? "";
  const token = raw.startsWith("Bearer ") ? raw.slice(7).trim() : raw.trim();

  if (!token) {
    logger.info("Authorizer: missing token");
    throw new Error("Unauthorized");
  }

  const methodArn = event.methodArn;

  let payload;
  let authSource;
  try {
    payload = await idVerifier.verify(token);
    authSource = "cognito";
  } catch (idErr) {
    try {
      payload = await accessVerifier.verify(token);
      authSource = "cognito-access";
    } catch (accessErr) {
      // API Gateway only maps a thrown "Unauthorized" Error to a 401;
      // anything else becomes a 500. Log both reasons for ops.
      logger.info("Authorizer: rejecting token", {
        idReason: idErr?.message,
        accessReason: accessErr?.message,
      });
      throw new Error("Unauthorized", { cause: accessErr });
    }
  }

  return allow({
    principalId: payload.sub,
    methodArn,
    context: {
      sub: payload.sub,
      // Access tokens don't carry an email claim; only id tokens do.
      email: payload.email ?? "",
      authSource,
    },
  });
}

function allow({ principalId, methodArn, context }) {
  return {
    principalId,
    // Wildcard so the cached authorizer response works across every
    // method/path the same caller hits within the cache TTL. The cache
    // key is the token itself; the policy resource just needs to permit
    // anything on the API.
    policyDocument: {
      Version: "2012-10-17",
      Statement: [
        {
          Action: "execute-api:Invoke",
          Effect: "Allow",
          Resource: methodArnWildcard(methodArn),
        },
      ],
    },
    context,
  };
}

// methodArn looks like arn:aws:execute-api:us-east-1:123:abc/v1/GET/foo
// Replace the stage + method + path with /*/*/* so one cached policy
// covers every request that reuses the same authorizer cache entry.
function methodArnWildcard(methodArn) {
  if (!methodArn) return "*";
  const parts = methodArn.split(":");
  if (parts.length < 6) return methodArn;
  const apiAndPath = parts[5];
  const apiId = apiAndPath.split("/")[0];
  parts[5] = `${apiId}/*/*/*`;
  return parts.join(":");
}
