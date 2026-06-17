export type NexusDocumentKey =
  | "manufacturing"
  | "work_order"
  | "purchase"
  | "purchase_resolution"
  | "outsourcing"
  | "inspection";

export type NexusDocumentConfig = {
  key: NexusDocumentKey;
  templateKey:
    | "manufacturing_request"
    | "work_order"
    | "purchase_request"
    | "purchase_resolution"
    | "outsourcing_request"
    | "inspection_request";
  title: string;
  icon: string;
  description: string;
  submissionReady: boolean;
};

export const NEXUS_DOCUMENTS: NexusDocumentConfig[] = [
  {
    key: "manufacturing",
    templateKey: "manufacturing_request",
    title: "제조요구서",
    icon: "PI",
    description: "제품 제조 요청과 생산 조건을 상신합니다.",
    submissionReady: true,
  },
  {
    key: "work_order",
    templateKey: "work_order",
    title: "작업지시서",
    icon: "WO",
    description: "승인된 제조요구서를 기준으로 생산 작업 내용을 지시합니다.",
    submissionReady: true,
  },
  {
    key: "purchase",
    templateKey: "purchase_request",
    title: "구매요청서 / 외주의뢰서",
    icon: "PO",
    description: "기술1팀의 구매요청과 외주의뢰를 작성합니다.",
    submissionReady: true,
  },
  {
    key: "purchase_resolution",
    templateKey: "purchase_resolution",
    title: "구매결의서",
    icon: "PR",
    description: "구매처와 금액을 확정하여 구매 승인을 요청합니다.",
    submissionReady: true,
  },
  {
    key: "inspection",
    templateKey: "inspection_request",
    title: "제품검사요청서",
    icon: "QA",
    description: "생산 완료 제품의 검사와 검수를 요청합니다.",
    submissionReady: false,
  },
];

export const NEXUS_DOCUMENT_MAP = Object.fromEntries(
  NEXUS_DOCUMENTS.map((document) => [document.key, document])
) as Record<NexusDocumentKey, NexusDocumentConfig>;

export function isNexusDocumentKey(value: string | null): value is NexusDocumentKey {
  return NEXUS_DOCUMENTS.some((document) => document.key === value);
}
