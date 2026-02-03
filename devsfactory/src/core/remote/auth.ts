import { createHmac, randomBytes } from "node:crypto";

/**
 * Default authentication timeout in milliseconds
 */
export const AUTH_TIMEOUT_MS = 30_000;

/**
 * Challenge expiration time in milliseconds
 */
export const CHALLENGE_EXPIRY_MS = 60_000;

/**
 * Generate a random challenge string
 */
export const generateChallenge = (): string => {
  return randomBytes(32).toString("hex");
};

/**
 * Generate HMAC signature for a challenge
 * Uses HMAC-SHA256 with the shared secret
 */
export const signChallenge = (
  challenge: string,
  timestamp: number,
  secret: string
): string => {
  const message = `${challenge}:${timestamp}`;
  const hmac = createHmac("sha256", secret);
  hmac.update(message);
  return hmac.digest("hex");
};

/**
 * Verify a signature against a challenge
 */
export const verifySignature = (
  challenge: string,
  timestamp: number,
  signature: string,
  secret: string
): { valid: boolean; reason?: string } => {
  // Check timestamp freshness (within expiry window)
  const now = Date.now();
  const age = now - timestamp;

  if (age < 0) {
    return { valid: false, reason: "Timestamp is in the future" };
  }

  if (age > CHALLENGE_EXPIRY_MS) {
    return { valid: false, reason: "Challenge has expired" };
  }

  // Generate expected signature
  const expected = signChallenge(challenge, timestamp, secret);

  // Constant-time comparison to prevent timing attacks
  if (!timingSafeEqual(signature, expected)) {
    return { valid: false, reason: "Invalid signature" };
  }

  return { valid: true };
};

/**
 * Constant-time string comparison to prevent timing attacks
 */
const timingSafeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) {
    return false;
  }

  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");

  return require("node:crypto").timingSafeEqual(bufA, bufB);
};

/**
 * Generate a new shared secret
 * Can be used for initial setup or key rotation
 */
export const generateSecret = (): string => {
  return randomBytes(32).toString("base64");
};

/**
 * Validate a secret meets minimum security requirements
 */
export const validateSecret = (
  secret: string
): { valid: boolean; reason?: string } => {
  if (!secret) {
    return { valid: false, reason: "Secret cannot be empty" };
  }

  if (secret.length < 16) {
    return { valid: false, reason: "Secret must be at least 16 characters" };
  }

  return { valid: true };
};

/**
 * Authentication state for a pending connection
 */
export interface PendingAuth {
  challenge: string;
  timestamp: number;
  expiresAt: number;
}

/**
 * Create a pending authentication state
 */
export const createPendingAuth = (): PendingAuth => {
  const timestamp = Date.now();
  return {
    challenge: generateChallenge(),
    timestamp,
    expiresAt: timestamp + CHALLENGE_EXPIRY_MS
  };
};

/**
 * Check if a pending auth has expired
 */
export const isPendingAuthExpired = (pending: PendingAuth): boolean => {
  return Date.now() > pending.expiresAt;
};
