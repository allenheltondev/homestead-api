import { jest } from "@jest/globals";

process.env.USER_POOL_ID = "us-east-1_TestPool";
process.env.USER_POOL_CLIENT_ID = "test-client-id";
process.env.ALEXA_CLIENT_ID = "alexa-client-id";

// Mock aws-jwt-verify so no network/JWKS call happens. create() is called
// once per token use; route each verifier to its own mock so id-token and
// access-token paths can be driven independently.
const idVerify = jest.fn();
const accessVerify = jest.fn();
jest.unstable_mockModule("aws-jwt-verify", () => ({
  CognitoJwtVerifier: {
    create: jest.fn((opts) => ({
      verify: opts.tokenUse === "access" ? accessVerify : idVerify,
    })),
  },
}));

const { handler } = await import("../../api/authorizer.mjs");

const METHOD_ARN =
  "arn:aws:execute-api:us-east-1:123456789012:abc123/v1/GET/health";

describe("authorizer", () => {
  beforeEach(() => {
    idVerify.mockReset();
    accessVerify.mockReset();
  });

  test("allows a valid Cognito id token", async () => {
    idVerify.mockResolvedValueOnce({ sub: "user-123", email: "a@b.com" });

    const result = await handler({
      authorizationToken: "Bearer good.jwt.token",
      methodArn: METHOD_ARN,
    });

    expect(result.principalId).toBe("user-123");
    expect(result.policyDocument.Statement[0].Effect).toBe("Allow");
    expect(result.context).toMatchObject({
      sub: "user-123",
      email: "a@b.com",
      authSource: "cognito",
    });
    expect(result.policyDocument.Statement[0].Resource).toContain("/*/*/*");
    expect(accessVerify).not.toHaveBeenCalled();
  });

  test("falls back to an access token (Alexa account linking)", async () => {
    idVerify.mockRejectedValueOnce(new Error("not an id token"));
    accessVerify.mockResolvedValueOnce({
      sub: "alexa-user",
      client_id: "alexa-client-id",
    });

    const result = await handler({
      authorizationToken: "Bearer access.jwt.token",
      methodArn: METHOD_ARN,
    });

    expect(result.principalId).toBe("alexa-user");
    expect(result.context).toMatchObject({
      sub: "alexa-user",
      email: "",
      authSource: "cognito-access",
    });
  });

  test("strips the Bearer prefix before verifying", async () => {
    idVerify.mockResolvedValueOnce({ sub: "user-123" });

    await handler({ authorizationToken: "Bearer abc.def.ghi", methodArn: METHOD_ARN });

    expect(idVerify).toHaveBeenCalledWith("abc.def.ghi");
  });

  test("denies a token rejected as both id and access", async () => {
    idVerify.mockRejectedValueOnce(new Error("Invalid signature"));
    accessVerify.mockRejectedValueOnce(new Error("Invalid signature"));

    await expect(
      handler({ authorizationToken: "Bearer bad.token", methodArn: METHOD_ARN }),
    ).rejects.toThrow("Unauthorized");
  });

  test("denies a token minted for a disallowed client", async () => {
    idVerify.mockRejectedValueOnce(new Error("Token not for this client"));
    accessVerify.mockRejectedValueOnce(new Error("Token not for this client"));

    await expect(
      handler({ authorizationToken: "Bearer wrong.aud.token", methodArn: METHOD_ARN }),
    ).rejects.toThrow("Unauthorized");
  });

  test("rejects a missing token", async () => {
    await expect(
      handler({ authorizationToken: "", methodArn: METHOD_ARN }),
    ).rejects.toThrow("Unauthorized");
    expect(idVerify).not.toHaveBeenCalled();
    expect(accessVerify).not.toHaveBeenCalled();
  });
});
