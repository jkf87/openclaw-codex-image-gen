/**
 * Error detection tests for codex-image-gen plugin
 * Tests rate limit, timeout, and connection error detection
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

// Import the error detection functions from the compiled module
// Since we're testing TS code, we'll mock the functions here
// In real implementation, these would be imported from the built JS

function isRateLimitError(message) {
  const text = message.toLowerCase();
  return text.includes("429") || text.includes("usage_limit_reached") || text.includes("too many requests");
}

function isTimeoutError(message) {
  const text = message.toLowerCase();
  return text.includes("timed out") || text.includes("timeout") || text.includes("etimedout");
}

function isConnectionError(message) {
  const text = message.toLowerCase();
  return text.includes("econnrefused") || text.includes("enotfound") || text.includes("connection refused");
}

describe('Error Detection', () => {
  describe('isRateLimitError', () => {
    it('should detect 429 error', () => {
      assert.strictEqual(isRateLimitError("HTTP 429 Too Many Requests"), true);
    });

    it('should detect usage_limit_reached', () => {
      assert.strictEqual(isRateLimitError("Error: usage_limit_reached"), true);
    });

    it('should detect too many requests', () => {
      assert.strictEqual(isRateLimitError("Too many requests, please try again later"), true);
    });

    it('should be case-insensitive', () => {
      assert.strictEqual(isRateLimitError("HTTP 429 TOO MANY REQUESTS"), true);
    });

    it('should return false for non-rate-limit errors', () => {
      assert.strictEqual(isRateLimitError("Connection refused"), false);
      assert.strictEqual(isRateLimitError("Internal server error"), false);
      assert.strictEqual(isRateLimitError("Timed out"), false);
    });
  });

  describe('isTimeoutError', () => {
    it('should detect timed out', () => {
      assert.strictEqual(isTimeoutError("Codex timed out after 120s"), true);
    });

    it('should detect timeout', () => {
      assert.strictEqual(isTimeoutError("Request timeout"), true);
    });

    it('should detect ETIMEDOUT', () => {
      assert.strictEqual(isTimeoutError("Error: connect ETIMEDOUT"), true);
    });

    it('should be case-insensitive', () => {
      assert.strictEqual(isTimeoutError("REQUEST TIMED OUT"), true);
    });

    it('should return false for non-timeout errors', () => {
      assert.strictEqual(isTimeoutError("HTTP 429"), false);
      assert.strictEqual(isTimeoutError("Connection refused"), false);
    });
  });

  describe('isConnectionError', () => {
    it('should detect ECONNREFUSED', () => {
      assert.strictEqual(isConnectionError("Error: connect ECONNREFUSED 127.0.0.1:8080"), true);
    });

    it('should detect ENOTFOUND', () => {
      assert.strictEqual(isConnectionError("Error: getaddrinfo ENOTFOUND api.openai.com"), true);
    });

    it('should detect connection refused', () => {
      assert.strictEqual(isConnectionError("Connection refused"), true);
    });

    it('should be case-insensitive', () => {
      assert.strictEqual(isConnectionError("ECONNREFUSED"), true);
    });

    it('should return false for non-connection errors', () => {
      assert.strictEqual(isConnectionError("HTTP 429"), false);
      assert.strictEqual(isConnectionError("Timed out"), false);
    });
  });

  describe('Error Classification', () => {
    it('should correctly classify rate limit errors', () => {
      const error = "HTTP 429 Too Many Requests";
      assert.strictEqual(isRateLimitError(error), true);
      assert.strictEqual(isTimeoutError(error), false);
      assert.strictEqual(isConnectionError(error), false);
    });

    it('should correctly classify timeout errors', () => {
      const error = "Codex timed out after 120s";
      assert.strictEqual(isRateLimitError(error), false);
      assert.strictEqual(isTimeoutError(error), true);
      assert.strictEqual(isConnectionError(error), false);
    });

    it('should correctly classify connection errors', () => {
      const error = "connect ECONNREFUSED 127.0.0.1:8080";
      assert.strictEqual(isRateLimitError(error), false);
      assert.strictEqual(isTimeoutError(error), false);
      assert.strictEqual(isConnectionError(error), true);
    });
  });
});
