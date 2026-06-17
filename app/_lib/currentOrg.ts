export type CurrentOrgTeam = {
  team: string;
  leader?: string;
  members: string[];
};

export type OrgMemberInfo = {
  team: string;
  leader: boolean;
};

export const CURRENT_ORG: CurrentOrgTeam[] = [
  {
    team: "재무/인사",
    leader: "김혜정",
    members: ["최인혜"],
  },
  {
    team: "구매/총무",
    members: ["신훈식", "최하영"],
  },
  {
    team: "국내영업부",
    members: ["김선일"],
  },
  {
    team: "해외영업부",
    leader: "이양로",
    members: ["반준영"],
  },
  {
    team: "신사업부",
    leader: "권현진",
    members: ["박봉근", "최하영"],
  },
  {
    team: "R&D/품질보증본부",
    leader: "서중석",
    members: [],
  },
  {
    team: "R&D/QA부",
    members: ["윤지환"],
  },
  {
    team: "생산본부",
    leader: "장동철",
    members: [],
  },
  {
    team: "기술 1팀",
    leader: "한차현",
    members: ["한재영", "권영일", "김학", "박상현"],
  },
  {
    team: "기술 2팀",
    leader: "이승준",
    members: ["김종혁"],
  },
  {
    team: "기술 3팀",
    members: ["양희원", "김성종"],
  },
];

export const TEAM_ORDER = CURRENT_ORG.map(
  (team) => team.team
);

export const EXECUTIVE_NAMES = ["신상민", "신영호", "정대용"];

export function isExecutiveAccount(
  name?: string | null,
  team?: string | null,
  role?: string | null
) {
  const currentName = name || "";
  const currentTeam = team || "";
  const currentRole = role || "";

  return (
    currentRole === "executive" ||
    EXECUTIVE_NAMES.includes(currentName) ||
    currentTeam.includes("경영진") ||
    currentTeam.includes("회장") ||
    currentTeam.includes("대표이사") ||
    currentTeam.includes("고문")
  );
}

export const ORG_MEMBER_MAP = new Map<
  string,
  OrgMemberInfo
>(
  CURRENT_ORG.flatMap((team) => {
    const entries = team.members.map(
      (name) =>
        [
          name,
          { team: team.team, leader: false },
        ] as [string, OrgMemberInfo]
    );

    if (team.leader) {
      entries.unshift([
        team.leader,
        { team: team.team, leader: true },
      ]);
    }

    return entries;
  }).map(([name, info]) =>
    name === "최하영" ? [name, { ...info, team: "구매/총무" }] : [name, info]
  ) as [string, OrgMemberInfo][]
);

export const WORKLOG_ORG: CurrentOrgTeam[] = [
  {
    team: "재무/인사",
    leader: "김혜정",
    members: ["최인혜"],
  },
  {
    team: "구매/총무",
    members: ["신훈식", "최하영"],
  },
  {
    team: "국내영업",
    members: ["김선일"],
  },
  {
    team: "해외영업",
    leader: "이양로",
    members: ["반준영"],
  },
  {
    team: "전략기획",
    members: [],
  },
  {
    team: "신사업",
    leader: "권현진",
    members: ["박봉근"],
  },
  {
    team: "R&D/QA",
    members: ["윤지환"],
  },
  {
    team: "기술 1팀",
    leader: "한차현",
    members: ["한재영", "권영일", "김학", "박상현"],
  },
  {
    team: "기술 2팀",
    leader: "이승준",
    members: ["김종혁"],
  },
  {
    team: "기술 3팀",
    members: ["양희원", "김성종"],
  },
];

export const WORKLOG_TEAM_ORDER = WORKLOG_ORG.map(
  (team) => team.team
);

export const WORKLOG_MEMBER_MAP = new Map<
  string,
  OrgMemberInfo
>(
  WORKLOG_ORG.flatMap((team) => {
    const entries = team.members.map(
      (name) =>
        [
          name,
          { team: team.team, leader: false },
        ] as [string, OrgMemberInfo]
    );

    if (team.leader) {
      entries.unshift([
        team.leader,
        { team: team.team, leader: true },
      ]);
    }

    return entries;
  })
);

export function getCurrentOrgTeam(
  name: string,
  fallbackTeam = ""
) {
  return ORG_MEMBER_MAP.get(name)?.team || fallbackTeam;
}

export function canAccessSales(
  name: string,
  team: string
) {
  const orgTeam = getCurrentOrgTeam(name, team);

  return (
    EXECUTIVE_NAMES.includes(name) ||
    orgTeam === "국내영업부" ||
    orgTeam === "해외영업부"
  );
}

export function canViewAllWorklogs(
  name: string,
  role: string
) {
  return Boolean(name || role);
}

export function canManageProductionOrders(
  name: string,
  role: string
) {
  return (
    role === "admin" ||
    role === "lead" ||
    role === "executive" ||
    EXECUTIVE_NAMES.includes(name) ||
    ORG_MEMBER_MAP.get(name)?.leader === true
  );
}
