export const NEXUS_APPROVAL_AUTHOR_ROLE = "작성";

export const NEXUS_APPROVAL_COLUMN_ROLES = [
  NEXUS_APPROVAL_AUTHOR_ROLE,
  "1차결재",
  "2차결재",
  "3차결재",
  "최종결재",
];

export function nexusApprovalStepRole(index: number, total: number) {
  if (total <= 1) return "최종결재";
  if (index === total - 1) return "최종결재";
  return `${index + 1}차결재`;
}
