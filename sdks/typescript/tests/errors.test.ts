import { describe, it, expect } from "vitest";
import {
  SheetbaseError,
  TokenError,
  DataPathError,
  ValidationError,
  NotFoundError,
  PermissionDeniedError,
  UnauthenticatedError,
  StaleVersionError,
  ConflictError,
  MissingLinkError,
  InvalidTransitionError,
  InvalidPropertiesError,
  TemplateNotInstantiableError,
  RateLimitedError,
  ServiceUnavailableError,
  ServerError,
  dataPathError,
} from "../src/errors.js";

describe("TokenError", () => {
  it("has code and message", () => {
    const err = new TokenError("invalid_credential", "Bad key");
    expect(err.code).toBe("invalid_credential");
    expect(err.message).toContain("[invalid_credential]");
    expect(err.message).toContain("Bad key");
  });

  it("is a SheetbaseError", () => {
    const err = new TokenError("test", "msg");
    expect(err).toBeInstanceOf(SheetbaseError);
    expect(err).toBeInstanceOf(TokenError);
  });
});

describe("DataPathError", () => {
  it("has category, message and requestId", () => {
    const err = new DataPathError("not_found", "Missing", "req-123");
    expect(err.category).toBe("not_found");
    expect(err.requestId).toBe("req-123");
    expect(err.message).toContain("[not_found]");
    expect(err.message).toContain("request_id=req-123");
  });

  it("requestId defaults to null", () => {
    const err = new DataPathError("server_error", "Boom");
    expect(err.requestId).toBeNull();
  });

  it("is a SheetbaseError", () => {
    const err = new DataPathError("test", "msg");
    expect(err).toBeInstanceOf(SheetbaseError);
    expect(err).toBeInstanceOf(DataPathError);
  });

  const categoryCases: [string, typeof DataPathError][] = [
    ["validation_error", ValidationError],
    ["not_found", NotFoundError],
    ["permission_denied", PermissionDeniedError],
    ["unauthenticated", UnauthenticatedError],
    ["stale_version", StaleVersionError],
    ["conflict", ConflictError],
    ["missing_link", MissingLinkError],
    ["invalid_transition", InvalidTransitionError],
    ["invalid_properties", InvalidPropertiesError],
    ["template_not_instantiable", TemplateNotInstantiableError],
    ["rate_limited", RateLimitedError],
    ["service_unavailable", ServiceUnavailableError],
    ["server_error", ServerError],
  ];

  for (const [category, Cls] of categoryCases) {
    it(`maps ${category} to ${Cls.name}`, () => {
      const err = dataPathError(category, "msg");
      expect(err).toBeInstanceOf(Cls);
      expect(err.category).toBe(category);
    });
  }

  it("unmapped category returns base DataPathError", () => {
    const err = dataPathError("unknown_category", "msg");
    expect(err).toBeInstanceOf(DataPathError);
    expect(err).not.toBeInstanceOf(ValidationError);
    expect(err.category).toBe("unknown_category");
  });

  it("all data-path errors are SheetbaseErrors", () => {
    for (const [, Cls] of categoryCases) {
      const err = new Cls("test", "msg");
      expect(err).toBeInstanceOf(SheetbaseError);
    }
  });
});
