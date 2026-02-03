import { describe, expect, it } from "bun:test";
import {
  CHALLENGE_EXPIRY_MS,
  createPendingAuth,
  generateChallenge,
  generateSecret,
  isPendingAuthExpired,
  signChallenge,
  validateSecret,
  verifySignature
} from "./auth";

describe("auth", () => {
  describe("generateChallenge", () => {
    it("should generate a 64-character hex string", () => {
      const challenge = generateChallenge();
      expect(challenge).toHaveLength(64);
      expect(challenge).toMatch(/^[0-9a-f]+$/);
    });

    it("should generate unique challenges", () => {
      const challenge1 = generateChallenge();
      const challenge2 = generateChallenge();
      expect(challenge1).not.toBe(challenge2);
    });
  });

  describe("generateSecret", () => {
    it("should generate a base64 string", () => {
      const secret = generateSecret();
      expect(secret).toMatch(/^[A-Za-z0-9+/=]+$/);
    });

    it("should generate secrets of sufficient length", () => {
      const secret = generateSecret();
      // 32 bytes in base64 is 44 characters
      expect(secret.length).toBeGreaterThanOrEqual(40);
    });

    it("should generate unique secrets", () => {
      const secret1 = generateSecret();
      const secret2 = generateSecret();
      expect(secret1).not.toBe(secret2);
    });
  });

  describe("validateSecret", () => {
    it("should reject empty secret", () => {
      const result = validateSecret("");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("empty");
    });

    it("should reject short secrets", () => {
      const result = validateSecret("short");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("16 characters");
    });

    it("should accept valid secrets", () => {
      const result = validateSecret("this-is-a-valid-secret-key");
      expect(result.valid).toBe(true);
    });
  });

  describe("signChallenge", () => {
    it("should produce a 64-character hex signature", () => {
      const challenge = "test-challenge";
      const timestamp = Date.now();
      const secret = "test-secret-key-12345";

      const signature = signChallenge(challenge, timestamp, secret);
      expect(signature).toHaveLength(64);
      expect(signature).toMatch(/^[0-9a-f]+$/);
    });

    it("should produce consistent signatures for same inputs", () => {
      const challenge = "test-challenge";
      const timestamp = 1234567890;
      const secret = "test-secret-key-12345";

      const sig1 = signChallenge(challenge, timestamp, secret);
      const sig2 = signChallenge(challenge, timestamp, secret);
      expect(sig1).toBe(sig2);
    });

    it("should produce different signatures for different challenges", () => {
      const timestamp = Date.now();
      const secret = "test-secret-key-12345";

      const sig1 = signChallenge("challenge1", timestamp, secret);
      const sig2 = signChallenge("challenge2", timestamp, secret);
      expect(sig1).not.toBe(sig2);
    });

    it("should produce different signatures for different timestamps", () => {
      const challenge = "test-challenge";
      const secret = "test-secret-key-12345";

      const sig1 = signChallenge(challenge, 1000, secret);
      const sig2 = signChallenge(challenge, 2000, secret);
      expect(sig1).not.toBe(sig2);
    });

    it("should produce different signatures for different secrets", () => {
      const challenge = "test-challenge";
      const timestamp = Date.now();

      const sig1 = signChallenge(
        challenge,
        timestamp,
        "secret1-is-long-enough"
      );
      const sig2 = signChallenge(
        challenge,
        timestamp,
        "secret2-is-long-enough"
      );
      expect(sig1).not.toBe(sig2);
    });
  });

  describe("verifySignature", () => {
    it("should verify valid signature", () => {
      const challenge = "test-challenge";
      const timestamp = Date.now();
      const secret = "test-secret-key-12345";

      const signature = signChallenge(challenge, timestamp, secret);
      const result = verifySignature(challenge, timestamp, signature, secret);

      expect(result.valid).toBe(true);
    });

    it("should reject invalid signature", () => {
      const challenge = "test-challenge";
      const timestamp = Date.now();
      const secret = "test-secret-key-12345";

      const result = verifySignature(
        challenge,
        timestamp,
        "invalid-signature",
        secret
      );

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("Invalid signature");
    });

    it("should reject signature with wrong secret", () => {
      const challenge = "test-challenge";
      const timestamp = Date.now();
      const secret = "test-secret-key-12345";
      const wrongSecret = "wrong-secret-key-12345";

      const signature = signChallenge(challenge, timestamp, secret);
      const result = verifySignature(
        challenge,
        timestamp,
        signature,
        wrongSecret
      );

      expect(result.valid).toBe(false);
    });

    it("should reject future timestamps", () => {
      const challenge = "test-challenge";
      const futureTimestamp = Date.now() + 60000; // 1 minute in future
      const secret = "test-secret-key-12345";

      const signature = signChallenge(challenge, futureTimestamp, secret);
      const result = verifySignature(
        challenge,
        futureTimestamp,
        signature,
        secret
      );

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("future");
    });

    it("should reject expired timestamps", () => {
      const challenge = "test-challenge";
      const expiredTimestamp = Date.now() - CHALLENGE_EXPIRY_MS - 1000;
      const secret = "test-secret-key-12345";

      const signature = signChallenge(challenge, expiredTimestamp, secret);
      const result = verifySignature(
        challenge,
        expiredTimestamp,
        signature,
        secret
      );

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("expired");
    });
  });

  describe("createPendingAuth", () => {
    it("should create pending auth with challenge", () => {
      const pending = createPendingAuth();

      expect(pending.challenge).toHaveLength(64);
      expect(pending.timestamp).toBeGreaterThan(0);
      expect(pending.expiresAt).toBeGreaterThan(pending.timestamp);
    });

    it("should set expiry correctly", () => {
      const pending = createPendingAuth();
      const expectedExpiry = pending.timestamp + CHALLENGE_EXPIRY_MS;

      expect(pending.expiresAt).toBe(expectedExpiry);
    });
  });

  describe("isPendingAuthExpired", () => {
    it("should return false for fresh pending auth", () => {
      const pending = createPendingAuth();
      expect(isPendingAuthExpired(pending)).toBe(false);
    });

    it("should return true for expired pending auth", () => {
      const pending = {
        challenge: "test",
        timestamp: Date.now() - CHALLENGE_EXPIRY_MS - 1000,
        expiresAt: Date.now() - 1000
      };

      expect(isPendingAuthExpired(pending)).toBe(true);
    });
  });
});
