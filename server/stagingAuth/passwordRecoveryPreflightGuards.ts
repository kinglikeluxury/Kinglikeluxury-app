export const MIN_RECOVERY_RUNTIME_PASSWORD_LENGTH = 12;

export function acceptsRecoveryRuntimePassword(password: string | undefined): boolean {
  // This is a Neon database runtime credential, not an end-user password.
  // Length is a compatibility floor for the generated credential; it does not
  // prove entropy or source, so the configured value must remain secret.
  return typeof password === "string" &&
    password.length >= MIN_RECOVERY_RUNTIME_PASSWORD_LENGTH;
}

export interface RecoveryRoleMembership {
  member_role: string;
  granted_role: string;
  grantor_role: string;
  admin_option: boolean;
  inherit_option: boolean;
  set_option: boolean;
}

export function hasOnlyExpectedNeonOwnerMembership(
  roleName: string,
  memberships: readonly RecoveryRoleMembership[],
): boolean {
  const relevant = memberships.filter(
    (membership) =>
      membership.granted_role === roleName || membership.member_role === roleName,
  );
  return relevant.length === 1 &&
    relevant[0].granted_role === roleName &&
    relevant[0].member_role === "neondb_owner" &&
    relevant[0].grantor_role === "cloud_admin" &&
    relevant[0].admin_option === true &&
    relevant[0].inherit_option === false &&
    relevant[0].set_option === false;
}
