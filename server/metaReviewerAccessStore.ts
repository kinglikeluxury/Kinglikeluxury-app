import bcrypt from "bcrypt";
import { verifyStoredPassword } from "./passwordAuth";

export interface MetaReviewerAccount {
  id: number;
  email: string;
  username: string;
  passwordHash: string;
  isMetaReviewer: true;
  isActive: boolean;
  role: "meta_reviewer";
}

export type SafeMetaReviewerAccount = Omit<MetaReviewerAccount, "passwordHash">;

const accounts = new Map<number, MetaReviewerAccount>();
const pendingEmails = new Set<string>();
let nextId = -2;

const CONFIGURED_REVIEWER_ID = -1;
const REVIEWER_ENABLED_FLAG = "META_REVIEW_WA_REVIEWER_ENABLED";
const REVIEWER_EMAIL_KEY = "META_REVIEW_WA_REVIEWER_EMAIL";
const REVIEWER_HASH_KEY = "META_REVIEW_WA_REVIEWER_PASSWORD_HASH";

function configuredReviewer(): MetaReviewerAccount | undefined {
  const env = process.env;
  const email = env[REVIEWER_EMAIL_KEY]?.trim().toLowerCase() ?? "";
  const passwordHash = env[REVIEWER_HASH_KEY]?.trim() ?? "";
  if (
    env[REVIEWER_ENABLED_FLAG] !== "true" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    !/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(passwordHash)
  ) return undefined;
  return {
    id: CONFIGURED_REVIEWER_ID,
    email,
    username: email,
    passwordHash,
    isMetaReviewer: true,
    isActive: true,
    role: "meta_reviewer",
  };
}

export async function createMetaReviewerAccount(
  email: string,
  password: string,
): Promise<SafeMetaReviewerAccount> {
  const normalizedEmail = email.trim().toLowerCase();
  if (
    pendingEmails.has(normalizedEmail) ||
    Array.from(accounts.values()).some(account => account.email === normalizedEmail)
  ) {
    throw new Error("reviewer_exists");
  }
  pendingEmails.add(normalizedEmail);
  try {
    const account: MetaReviewerAccount = {
      id: nextId--,
      email: normalizedEmail,
      username: normalizedEmail,
      passwordHash: await bcrypt.hash(password, 12),
      isMetaReviewer: true,
      isActive: true,
      role: "meta_reviewer",
    };
    accounts.set(account.id, account);
    return toSafeAccount(account);
  } finally {
    pendingEmails.delete(normalizedEmail);
  }
}

export function findMetaReviewerByEmail(email: string): MetaReviewerAccount | undefined {
  const normalizedEmail = email.trim().toLowerCase();
  const configured = configuredReviewer();
  if (configured?.email === normalizedEmail) return configured;
  return Array.from(accounts.values()).find(account => account.email === normalizedEmail);
}

export async function authenticateMetaReviewer(
  email: string,
  password: string,
): Promise<MetaReviewerAccount | undefined> {
  const account = findMetaReviewerByEmail(email);
  if (
    !account ||
    account.isMetaReviewer !== true ||
    account.isActive !== true ||
    !await verifyStoredPassword(password, account.passwordHash)
  ) {
    return undefined;
  }
  return account;
}

export function getMetaReviewerAccount(id: number): MetaReviewerAccount | undefined {
  if (id === CONFIGURED_REVIEWER_ID) return configuredReviewer();
  return accounts.get(id);
}

export function listMetaReviewerAccounts(): SafeMetaReviewerAccount[] {
  return Array.from(accounts.values()).map(toSafeAccount);
}

export function disableMetaReviewerAccount(id: number): SafeMetaReviewerAccount | undefined {
  const account = accounts.get(id);
  if (!account) return undefined;
  account.isActive = false;
  return toSafeAccount(account);
}

export function deleteMetaReviewerAccount(id: number): boolean {
  return accounts.delete(id);
}

export function clearMetaReviewerAccountsForTests(): void {
  accounts.clear();
  pendingEmails.clear();
  nextId = -2;
}

function toSafeAccount(account: MetaReviewerAccount): SafeMetaReviewerAccount {
  const { passwordHash: _passwordHash, ...safe } = account;
  return safe;
}
