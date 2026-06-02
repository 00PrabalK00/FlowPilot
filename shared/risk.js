// Risk levels (section 13) + role model (section 12).

export const Risk = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical'
};

export const Role = {
  VIEWER: 'viewer',
  BUILDER: 'builder',
  OPERATOR: 'operator',
  MAINTAINER: 'maintainer',
  ADMIN: 'admin',
  OWNER: 'owner'
};

// role -> rank, higher can do everything lower can.
export const RoleRank = {
  viewer: 0,
  builder: 1,
  operator: 2,
  maintainer: 3,
  admin: 4,
  owner: 5
};

// Minimum role needed for a given risk action to even be proposable.
export const RiskMinRole = {
  low: Role.BUILDER,
  medium: Role.MAINTAINER,
  high: Role.ADMIN,
  critical: Role.OWNER
};

export function roleAtLeast(have, need) {
  return (RoleRank[have] ?? -1) >= (RoleRank[need] ?? 99);
}
