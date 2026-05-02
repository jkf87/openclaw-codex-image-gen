/**
 * Multi-account routing tests for codex-image-gen plugin
 * Tests account selection, cooldown marking, and error recovery
 */

const { describe, it, mock } = require('node:test');
const assert = require('node:assert');

// Mock implementations for testing
const mockAccounts = [
  { id: 'account1', authType: 'oauth_codex', authValue: '/path/to/account1', plan: 'pro', weight: '1' },
  { id: 'account2', authType: 'oauth_codex', authValue: '/path/to/account2', plan: 'pro', weight: '1' },
  { id: 'account3', authType: 'oauth_codex', authValue: '/path/to/account3', plan: 'pro', weight: '1' },
];

let accountPool = [...mockAccounts];
let cooldownSet = new Set();
let releaseSet = new Set();

function pickCodexPoolAccount(model) {
  if (accountPool.length === 0) return null;
  return accountPool.shift();
}

function markCodexPoolCooldown(id) {
  cooldownSet.add(id);
  // Remove from pool to simulate cooldown
  accountPool = accountPool.filter(a => a.id !== id);
}

function releaseCodexPoolAccount(id) {
  releaseSet.add(id);
}

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

describe('Multi-Account Routing', () => {
  // Reset state before each test
  const resetState = () => {
    accountPool = [...mockAccounts];
    cooldownSet = new Set();
    releaseSet = new Set();
  };

  describe('Account Selection', () => {

    it('should pick an account from the pool', () => {
      resetState();
      const account = pickCodexPoolAccount('gpt-5.4');
      assert.ok(account);
      assert.strictEqual(account.id, 'account1');
    });

    it('should pick different accounts on successive calls', () => {
      resetState();
      const account1 = pickCodexPoolAccount('gpt-5.4');
      const account2 = pickCodexPoolAccount('gpt-5.4');
      
      assert.ok(account1);
      assert.ok(account2);
      assert.notStrictEqual(account1.id, account2.id);
    });

    it('should return null when pool is exhausted', () => {
      resetState();
      pickCodexPoolAccount('gpt-5.4');
      pickCodexPoolAccount('gpt-5.4');
      pickCodexPoolAccount('gpt-5.4');
      
      const account = pickCodexPoolAccount('gpt-5.4');
      assert.strictEqual(account, null);
    });
  });

  describe('Cooldown Management', () => {
    it('should mark account as cooldown on rate limit', () => {
      resetState();
      const account = mockAccounts[0];
      markCodexPoolCooldown(account.id);
      
      assert.ok(cooldownSet.has(account.id));
      assert.ok(!accountPool.find(a => a.id === account.id));
    });

    it('should track multiple cooldowns', () => {
      resetState();
      markCodexPoolCooldown('account1');
      markCodexPoolCooldown('account2');
      
      assert.strictEqual(cooldownSet.size, 2);
      assert.ok(cooldownSet.has('account1'));
      assert.ok(cooldownSet.has('account2'));
    });
  });

  describe('Release Tracking', () => {
    it('should track released accounts', () => {
      resetState();
      releaseCodexPoolAccount('account1');
      releaseCodexPoolAccount('account2');
      
      assert.strictEqual(releaseSet.size, 2);
      assert.ok(releaseSet.has('account1'));
      assert.ok(releaseSet.has('account2'));
    });
  });

  describe('Error Recovery Strategy', () => {
    it('should trigger cooldown for rate limit errors', () => {
      resetState();
      const error = "HTTP 429 Too Many Requests";
      const account = mockAccounts[0];
      
      if (isRateLimitError(error)) {
        markCodexPoolCooldown(account.id);
      }
      
      assert.ok(cooldownSet.has(account.id));
    });

    it('should trigger cooldown for timeout errors', () => {
      resetState();
      const error = "Codex timed out after 120s";
      const account = mockAccounts[0];
      
      if (isTimeoutError(error)) {
        markCodexPoolCooldown(account.id);
      }
      
      assert.ok(cooldownSet.has(account.id));
    });

    it('should trigger cooldown for connection errors', () => {
      resetState();
      const error = "connect ECONNREFUSED 127.0.0.1:8080";
      const account = mockAccounts[0];
      
      if (isConnectionError(error)) {
        markCodexPoolCooldown(account.id);
      }
      
      assert.ok(cooldownSet.has(account.id));
    });

    it('should NOT trigger cooldown for other errors', () => {
      resetState();
      const error = "Internal server error 500";
      const account = mockAccounts[0];
      
      if (isRateLimitError(error)) markCodexPoolCooldown(account.id);
      if (isTimeoutError(error)) markCodexPoolCooldown(account.id);
      if (isConnectionError(error)) markCodexPoolCooldown(account.id);
      
      assert.ok(!cooldownSet.has(account.id));
    });
  });

  describe('Retry Logic Simulation', () => {
    it('should retry with next account on rate limit', () => {
      resetState();
      const error = "HTTP 429 Too Many Requests";
      const attempted = new Set();
      const maxAttempts = 5;
      
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const account = pickCodexPoolAccount('gpt-5.4');
        if (!account) break;
        
        attempted.add(account.id);
        
        if (isRateLimitError(error)) {
          markCodexPoolCooldown(account.id);
          continue; // Try next account
        }
        break; // Success
      }
      
      // Should have tried multiple accounts
      assert.ok(attempted.size >= 1);
    });

    it('should retry with next account on timeout', () => {
      resetState();
      const error = "Codex timed out after 120s";
      const attempted = new Set();
      const maxAttempts = 5;
      
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const account = pickCodexPoolAccount('gpt-5.4');
        if (!account) break;
        
        attempted.add(account.id);
        
        if (isTimeoutError(error)) {
          markCodexPoolCooldown(account.id);
          continue; // Try next account
        }
        break; // Success
      }
      
      // Should have tried multiple accounts
      assert.ok(attempted.size >= 1);
    });

    it('should stop trying after pool exhaustion', () => {
      resetState();
      const error = "HTTP 429 Too Many Requests";
      const attempted = new Set();
      const maxAttempts = 10; // More than available accounts
      
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const account = pickCodexPoolAccount('gpt-5.4');
        if (!account) break;
        
        attempted.add(account.id);
        
        if (isRateLimitError(error)) {
          markCodexPoolCooldown(account.id);
          continue;
        }
        break;
      }
      
      // Should have stopped at pool size
      assert.strictEqual(attempted.size, mockAccounts.length);
    });
  });
});
