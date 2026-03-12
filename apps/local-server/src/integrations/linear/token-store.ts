import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { LinearTokenSet, LinearTokenStore, LinearTokenStoreStatus } from "./types.ts";

interface EncryptedTokenPayload {
  ciphertext: string;
  iv: string;
  salt: string;
  tag: string;
  version: 1;
}

export const createLinearTokenStore = (options: { filePath: string }): LinearTokenStore => {
  let unlockedTokens: LinearTokenSet | null = null;

  const save = async (tokens: LinearTokenSet, passphrase: string): Promise<void> => {
    const payload = encryptTokens(tokens, passphrase);
    await mkdir(dirname(options.filePath), { recursive: true });
    await writeFile(options.filePath, JSON.stringify(payload), "utf8");
    unlockedTokens = tokens;
  };

  const getStatus = async (): Promise<LinearTokenStoreStatus> => {
    const connected = await Bun.file(options.filePath).exists();
    return {
      connected,
      locked: connected ? unlockedTokens === null : true,
    };
  };

  const unlock = async (passphrase: string): Promise<void> => {
    const encrypted = await readEncryptedPayload(options.filePath);
    unlockedTokens = decryptTokens(encrypted, passphrase);
  };

  const read = async (): Promise<LinearTokenSet> => {
    if (!unlockedTokens) {
      throw new Error("Linear token store is locked");
    }
    return unlockedTokens;
  };

  const lock = async (): Promise<void> => {
    unlockedTokens = null;
  };

  const disconnect = async (): Promise<void> => {
    unlockedTokens = null;
    await rm(options.filePath, { force: true });
  };

  return {
    save,
    getStatus,
    unlock,
    read,
    lock,
    disconnect,
  };
};

const encryptTokens = (tokens: LinearTokenSet, passphrase: string): EncryptedTokenPayload => {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(passphrase, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(tokens), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    version: 1,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
};

const decryptTokens = (payload: EncryptedTokenPayload, passphrase: string): LinearTokenSet => {
  const key = deriveKey(passphrase, Buffer.from(payload.salt, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");

  return JSON.parse(plaintext) as LinearTokenSet;
};

const deriveKey = (passphrase: string, salt: Buffer): Buffer =>
  scryptSync(passphrase, salt, 32) as Buffer;

const readEncryptedPayload = async (filePath: string): Promise<EncryptedTokenPayload> => {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as EncryptedTokenPayload;
};
