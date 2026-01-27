import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { errorHandler } from "./error-handler.js";

vi.mock("./logging.js", () => ({
  logger: {
    error: vi.fn(),
  },
}));

import { logger } from "./logging.js";

describe("errorHandler", () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let statusMock: ReturnType<typeof vi.fn>;
  let jsonMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockReq = {};
    jsonMock = vi.fn();
    statusMock = vi.fn().mockReturnValue({ json: jsonMock });
    mockRes = {
      status: statusMock as unknown as Response["status"],
    };
    mockNext = vi.fn();
  });

  it("logs the error with context", () => {
    const error = new Error("Something went wrong");

    errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

    expect(logger.error).toHaveBeenCalledWith(
      { err: error },
      "Unhandled error"
    );
  });

  it("returns 500 status code", () => {
    const error = new Error("Test error");

    errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

    expect(statusMock).toHaveBeenCalledWith(500);
  });

  it("returns generic error message in JSON response", () => {
    const error = new Error("Sensitive internal details");

    errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

    expect(jsonMock).toHaveBeenCalledWith({ error: "Internal server error" });
  });

  it("does not expose error details to client", () => {
    const error = new Error("Database connection failed: password incorrect");

    errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

    expect(jsonMock).toHaveBeenCalledWith({ error: "Internal server error" });
    expect(jsonMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining("Database") })
    );
  });

  it("does not call next", () => {
    const error = new Error("Test");

    errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

    expect(mockNext).not.toHaveBeenCalled();
  });
});
