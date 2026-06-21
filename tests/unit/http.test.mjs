import { jsonResponse, emptyResponse, parseBody, parseLimit } from "../../api/services/http.mjs";
import { BadRequestError } from "../../api/services/errors.mjs";

describe("services/http", () => {
  describe("jsonResponse", () => {
    test("serializes an object body with JSON + CORS headers", () => {
      const res = jsonResponse(200, { ok: true });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("application/json");
      expect(res.headers["access-control-allow-origin"]).toBeDefined();
      expect(JSON.parse(res.body)).toEqual({ ok: true });
    });

    test("wraps a string body as { message }", () => {
      const res = jsonResponse(400, "nope");
      expect(JSON.parse(res.body)).toEqual({ message: "nope" });
    });
  });

  describe("emptyResponse", () => {
    test.each([204, 205, 304])("uses a null body for null-body status %i", (status) => {
      expect(emptyResponse(status).body).toBeNull();
    });

    test("keeps an empty-string body for statuses that allow one", () => {
      expect(emptyResponse(200).body).toBe("");
    });
  });

  describe("parseBody", () => {
    test("parses a JSON object body", () => {
      expect(parseBody({ body: '{"name":"Bessie"}' })).toEqual({ name: "Bessie" });
    });

    test("returns {} for an empty body", () => {
      expect(parseBody({ body: "" })).toEqual({});
      expect(parseBody({})).toEqual({});
    });

    test("decodes a base64-encoded body", () => {
      const encoded = Buffer.from('{"a":1}').toString("base64");
      expect(parseBody({ body: encoded, isBase64Encoded: true })).toEqual({ a: 1 });
    });

    test("throws BadRequestError on malformed JSON", () => {
      expect(() => parseBody({ body: "{not json" })).toThrow(BadRequestError);
    });

    test("throws BadRequestError when body is not an object", () => {
      expect(() => parseBody({ body: "[1,2,3]" })).toThrow(BadRequestError);
    });
  });

  describe("parseLimit", () => {
    test("returns the default when absent", () => {
      expect(parseLimit(undefined)).toBe(100);
      expect(parseLimit("", { defaultValue: 25 })).toBe(25);
    });

    test("parses a valid integer", () => {
      expect(parseLimit("10")).toBe(10);
    });

    test("rejects non-integer / out-of-range values", () => {
      expect(() => parseLimit("0")).toThrow(BadRequestError);
      expect(() => parseLimit("abc")).toThrow(BadRequestError);
      expect(() => parseLimit("9999", { max: 500 })).toThrow(BadRequestError);
    });
  });
});
