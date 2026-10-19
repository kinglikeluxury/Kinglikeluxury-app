import bcrypt from "bcrypt";

export interface MetaReviewerAccount {
  id: number;
  email: string;
  username: string;
  passwordHash: string;
  isAdmin: boolean;
  isActive: boolean;
  role: "meta_reviewer";
}

export type SafeMetaReviewerAccount = Omit<MetaReviewerAccount, "passwordHash">;

const accounts = new Map<number, MetaReviewerAccount>();
const pendingEmails = new Set<string>();
let nextId = -1;

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
      isAdmin: true,
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
  return Array.from(accounts.values()).find(account => account.email === normalizedEmail);
}

export function getMetaReviewerAccount(id: number): MetaReviewerAccount | undefined {
  return accounts.get(id);
}

export function listMetaReviewerAccounts(): SafeMetaReviewerAccount[] {
  return Array.from(accounts.values()).map(toSafeAccount);
}

export function disableMetaReviewerAccount(id: number): SafeMetaReviewerAccount | undefined {
  const account = accounts.get(id);
  if (!account) return undefined;
  account.isActive = false;
  account.isAdmin = false;
  return toSafeAccount(account);
}

export function deleteMetaReviewerAccount(id: number): boolean {
  return accounts.delete(id);
}

export function clearMetaReviewerAccountsForTests(): void {
  accounts.clear();
  pendingEmails.clear();
  nextId = -1;
}

function toSafeAccount(account: MetaReviewerAccount): SafeMetaReviewerAccount {
  const { passwordHash: _passwordHash, ...safe } = account;
  return safe;
}
