/** 12-swatch palette shown in the member color picker */
export const MEMBER_COLOR_SWATCHES = [
  '#ef4444', // red
  '#f97316', // orange
  '#f59e0b', // amber
  '#84cc16', // lime
  '#22c55e', // green
  '#14b8a6', // teal
  '#3b82f6', // blue
  '#6d5efc', // violet (app primary)
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#64748b', // slate
  '#78716c', // stone
];

/** Fallback palette used when a member has no stored color */
export const MEMBER_HEX_PALETTE = [
  '#6d5efc', '#ef4444', '#f59e0b', '#22c55e',
  '#3b82f6', '#8b5cf6', '#ec4899', '#f97316',
  '#14b8a6', '#6366f1',
];

export function memberHex(members: { id: string; color?: string }[], memberId: string): string {
  const member = members.find((m) => m.id === memberId);
  if (member?.color) return member.color;
  const idx = members.findIndex((m) => m.id === memberId);
  return MEMBER_HEX_PALETTE[Math.max(0, idx) % MEMBER_HEX_PALETTE.length];
}
