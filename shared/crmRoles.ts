export const CRM_EMPLOYEE_ROLE = "crm_employee";

export function isCrmEmployeeRole(role: unknown): boolean {
  return role === "sub_agent" || role === CRM_EMPLOYEE_ROLE;
}

export function canAccessCrmLead(
  isAdmin: boolean,
  userId: number | null | undefined,
  assignedTo: number | null | undefined,
): boolean {
  return isAdmin || (userId != null && assignedTo === userId);
}
