import { jest } from "@jest/globals";

process.env.USER_POOL_ID = "us-east-1_TestPool";
process.env.USER_POOL_CLIENT_ID = "test-client-id";

// Mock aws-jwt-verify so no network/JWKS call happens. The factory
// returns a verifier whose verify() resolves or rejects based on what
// each test sets up.
const verify = jest.fn();
jest.unstable_mockModule("aws-jwt-verify", () => ({
  CognitoJwtVerifier: {
    create: jest.fn(() => ({ verify })),
  },
}));

const { handler } = await import("../../api/authorizer.mjs");

const METHOD_ARN =
  "arn:aws:execute-api:us-east-1:123456789012:abc123/v1/GET/health";

describe("authorizer", () => {
  beforeEach(() => {
    verify.mockReset();
  });

  test("allows a valid Cognito id token", async () => {
    verify.mockResolvedValueOnce({ sub: "user-123", email: "a@b.com" });

    const result = await handler({
      authorizationToken: "Bearer good.jwt.token",
      methodArn: METHOD_ARN,
    });

    expect(result.principalId).toBe("user-123");
    expect(result.policyDocument.Statement[0].Effect).toBe("Allow");
    expect(result.context).toMatchObject({ sub: "user-123", authSource: "cognito" });
    // Resource is wildcarded for caching across method/path.
    expect(result.policyDocument.Statement[0].Resource).toContain("/*/*/*");
  });

  test("strips the Bearer prefix before verifying", async () => {
    verify.mockResolvedValueOnce({ sub: "user-123" });

    await handler({ authorizationToken: "Bearer abc.def.ghi", methodArn: METHOD_ARN });

    expect(verify).toHaveBeenCalledWith("abc.def.ghi");
  });

  test("denies an invalid token by throwing Unauthorized", async () => {
    verify.mockRejectedValueOnce(new Error("Invalid signature"));

    await expect(
      handler({ authorizationToken: "Bearer bad.token", methodArn: METHOD_ARN }),
    ).rejects.toThrow("Unauthorized");
  });

  test("denies a token minted for the wrong audience", async () => {
    verify.mockRejectedValueOnce(new Error("Token not for this client"));

    await expect(
      handler({ authorizationToken: "Bearer wrong.aud.token", methodArn: METHOD_ARN }),
    ).rejects.toThrow("Unauthorized");
  });

  test("rejects a missing token", async () => {
    await expect(
      handler({ authorizationToken: "", methodArn: METHOD_ARN }),
    ).rejects.toThrow("Unauthorized");
    expect(verify).not.toHaveBeenCalled();
  });
});
