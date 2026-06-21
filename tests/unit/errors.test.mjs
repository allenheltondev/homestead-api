import {
  ApiError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  UpstreamError,
} from "../../api/services/errors.mjs";

describe("services/errors", () => {
  test("ApiError carries statusCode + code", () => {
    const err = new ApiError(418, "teapot", "Teapot");
    expect(err).toBeInstanceOf(Error);
    expect(err.statusCode).toBe(418);
    expect(err.code).toBe("Teapot");
    expect(err.message).toBe("teapot");
  });

  test("BadRequestError maps to 400", () => {
    const err = new BadRequestError("bad input");
    expect(err).toBeInstanceOf(ApiError);
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe("BadRequest");
    expect(err.message).toBe("bad input");
  });

  test("UnauthorizedError defaults to 401", () => {
    const err = new UnauthorizedError();
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe("Unauthorized");
    expect(err.message).toBe("Unauthorized");
  });

  test("ForbiddenError maps to 403", () => {
    const err = new ForbiddenError();
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe("Forbidden");
  });

  test("NotFoundError builds an entity message and maps to 404", () => {
    const err = new NotFoundError("animal", "abc123");
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe("NotFound");
    expect(err.message).toBe("animal abc123 not found");
  });

  test("ConflictError maps to 409", () => {
    const err = new ConflictError("already exists");
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe("Conflict");
  });

  test("UpstreamError maps to 502 and keeps the upstream status", () => {
    const err = new UpstreamError("downstream blew up", 503);
    expect(err.statusCode).toBe(502);
    expect(err.code).toBe("UpstreamError");
    expect(err.upstreamStatus).toBe(503);
  });
});
