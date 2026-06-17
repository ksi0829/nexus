"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from "react";
import {
  EXECUTIVE_NAMES,
  ORG_MEMBER_MAP,
  TEAM_ORDER,
  getCurrentOrgTeam,
} from "@/app/_lib/currentOrg";
import {
  type ExcelSheet,
  exportDateStamp,
  exportExcelWorkbook,
} from "@/app/_lib/excelExport";
import {
  createManufacturingPdf,
  downloadPdf,
} from "@/app/_lib/nexusManufacturingPdf";
import { createPurchasePdf } from "@/app/_lib/nexusPurchasePdf";
import { createPurchaseResolutionPdf } from "@/app/_lib/nexusPurchaseResolutionPdf";
import {
  NEXUS_DOCUMENT_MAP,
  isNexusDocumentKey,
  type NexusDocumentKey,
} from "@/app/_lib/nexusDocuments";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import {
  NexusNavigation,
  nexusNavigationStyles,
} from "@/components/nexus/NexusNavigation";

type FieldType = "text" | "date" | "select" | "textarea";
type ApprovalStatus = "pending" | "approved" | "rejected";
type EquipmentStageKey = "manufacturingRequest" | "purchaseRequest" | "outsourcingRequest" | "qa";
type InputMode = "modern" | "legacy";
type DocumentFilter = "mine" | "pending" | "reference" | "history";
type DocumentStatusFilter = "all" | ApprovalStatus;

type FieldDef = {
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  options?: string[];
  span?: 1 | 2;
};

type TableColumn = {
  key: string;
  label: string;
  width?: string;
};

type TableDef = {
  key: string;
  title: string;
  columns: TableColumn[];
  initialRows: number;
};

type TemplateDef = {
  key: string;
  title: string;
  category: string;
  description: string;
  approvalRoles: string[];
  fields: FieldDef[];
  tables: TableDef[];
};

type ProfileRow = {
  id: string;
  name: string | null;
  team: string | null;
  role: string | null;
};

type ApprovalLineRow = {
  id: number;
  document_id: number;
  step_order: number;
  role_label: string;
  approver_id: string;
  approver_name: string;
  approver_team: string | null;
  status: ApprovalStatus;
  acted_at: string | null;
  memo: string | null;
};

type ApprovalReferenceInfo = {
  id: string;
  name: string;
  team: string;
};

type ApprovalDocumentRow = {
  id: number;
  template_key: string;
  template_title: string;
  title: string;
  status: ApprovalStatus;
  requester_id: string;
  requester_name: string;
  requester_team: string | null;
  current_step: number;
  form_data: Record<string, unknown>;
  submitted_at: string;
  completed_at: string | null;
  equipment_order_id?: number | null;
  equipment_stage_key?: EquipmentStageKey | null;
  created_at: string;
  updated_at: string;
  document_no?: string | null;
  worktalk_room_id?: number | null;
  approval_lines?: ApprovalLineRow[];
};

type ApprovalAttachmentRow = {
  id: number;
  document_id: number;
  storage_path: string;
  original_name: string;
  mime_type: string | null;
  size_bytes: number;
  uploaded_by: string;
  created_at: string;
};

type NotificationRow = {
  id: number;
  user_id: string;
  document_id: number;
  message: string;
  read_at: string | null;
  created_at: string;
};

type ApproverSlot = {
  roleLabel: string;
  approverId: string;
};

type EquipmentOrderRow = {
  id: number;
  category: "domestic" | "overseas" | "parts";
  order_date: string;
  country: string | null;
  customer: string;
  model: string;
  owner_name: string;
  serial_no?: string | null;
  delivery_place?: string | null;
  note?: string | null;
  manufacturing_document_id?: number | null;
  outsourcing_document_id?: number | null;
};

type CustomerOption = {
  id: number;
  name: string;
};

const supabase = createSupabaseBrowser();
const today = new Date().toISOString().slice(0, 10);
const DEFAULT_APPROVER_COUNT = 3;
const APPROVAL_ATTACHMENT_BUCKET = "approval-attachments";
const APPROVAL_ATTACHMENT_ACCEPT = ".xlsx,.xls,.pdf,.jpg,.jpeg,.png,.dwg,.dxf,.zip";
const MAX_ATTACHMENT_COUNT = 10;
const MAX_ATTACHMENT_SIZE = 30 * 1024 * 1024;
const NEXUS_MANUFACTURING_APPROVERS = ["장동철", "신영호"];
const NEXUS_MANUFACTURING_REFERENCES = ["신훈식", "신상민"];
const NEXUS_PURCHASE_APPROVERS = ["한차현", "장동철", "신영호"];
const NEXUS_PURCHASE_TEAM_REFERENCES = ["한재영", "권영일", "김학", "박상현"];
const NEXUS_PURCHASE_FIXED_REFERENCES = ["신훈식", "최하영"];
const NEXUS_PURCHASE_RESOLUTION_REFERENCES = ["최하영", "신상민"];
const NEXUS_WORK_ORDER_TECH_MEMBERS = [
  "한차현",
  "한재영",
  "권영일",
  "김학",
  "박상현",
  "이승준",
  "김종혁",
];
const NEXUS_WORK_ORDER_DOMESTIC_SALES = ["김선일"];
const NEXUS_WORK_ORDER_OVERSEAS_SALES = ["이양로", "반준영"];
const ALLOWED_ATTACHMENT_EXTENSIONS = new Set([
  "xlsx",
  "xls",
  "pdf",
  "jpg",
  "jpeg",
  "png",
  "dwg",
  "dxf",
  "zip",
]);

const equipmentStageByTemplate: Partial<Record<string, EquipmentStageKey>> = {
  manufacturing_request: "manufacturingRequest",
  purchase_request: "purchaseRequest",
  outsourcing_request: "outsourcingRequest",
  inspection_request: "qa",
};

const equipmentDateColumnByStage: Record<EquipmentStageKey, string> = {
  manufacturingRequest: "manufacturing_request_approved_on",
  purchaseRequest: "purchase_request_approved_on",
  outsourcingRequest: "outsourcing_request_approved_on",
  qa: "qa_approved_on",
};

const commonItemColumns: TableColumn[] = [
  { key: "name", label: "품명" },
  { key: "spec", label: "규격" },
  { key: "unit", label: "단위", width: "88px" },
  { key: "qty", label: "수량", width: "88px" },
  { key: "memo", label: "비고" },
];

const templates: TemplateDef[] = [
  {
    key: "purchase_request",
    title: "구매의뢰서",
    category: "구매",
    description: "장비, 원자재, 공용품 구매 요청",
    approvalRoles: ["담당", "팀장", "본부장", "부사장", "대표이사"],
    fields: [
      { key: "controlNo", label: "부서 관리 번호", type: "text" },
      {
        key: "requestType",
        label: "의뢰 구분",
        type: "select",
        options: ["구매", "외주"],
      },
      { key: "client", label: "수주처", type: "text" },
      { key: "requester", label: "의뢰인", type: "text" },
      { key: "equipment", label: "장비명", type: "text" },
      { key: "serialNo", label: "S/N", type: "text" },
      { key: "deliveryPlace", label: "입고장소", type: "text" },
      { key: "requestDate", label: "의뢰일", type: "date" },
      { key: "dueDate", label: "입고요청일", type: "date" },
      { key: "comparisonVendor", label: "비교 업체", type: "text" },
      { key: "comparisonEquipment", label: "비교 장비명", type: "text" },
      { key: "comparisonSerialNo", label: "비교 S/N", type: "text" },
      { key: "estimatedHours", label: "제품 소요시간", type: "text" },
      { key: "shippingDate", label: "출고예정일", type: "date" },
      {
        key: "usageType",
        label: "사용구분",
        type: "select",
        options: ["원자재", "재공품", "공용품", "판매", "무상", "사무용품", "기타"],
      },
    ],
    tables: [{ key: "items", title: "구매 품목", columns: commonItemColumns, initialRows: 28 }],
  },
  {
    key: "draft",
    title: "기안서",
    category: "공통",
    description: "사내 의사결정, 보고, 협조 요청",
    approvalRoles: ["담당", "차장", "팀장", "본부장", "부사장", "사장"],
    fields: [
      { key: "documentNo", label: "문서번호", type: "text" },
      { key: "classification", label: "분류기호", type: "text" },
      { key: "processingPeriod", label: "처리기간", type: "text" },
      { key: "effectiveDate", label: "시행일자", type: "date" },
      { key: "draftDate", label: "기안일자", type: "date" },
      { key: "owner", label: "기안책임자", type: "text" },
      { key: "recipient", label: "수신", type: "text" },
      { key: "via", label: "경유", type: "text" },
      { key: "sender", label: "발신", type: "text" },
      { key: "reference", label: "참조", type: "text" },
      { key: "title", label: "제목", type: "text", span: 2 },
      { key: "content", label: "내용", type: "textarea", span: 2 },
    ],
    tables: [],
  },
  {
    key: "outsourcing_request",
    title: "외주의뢰서",
    category: "구매",
    description: "외주 제작, 가공, 협력사 의뢰",
    approvalRoles: ["담당", "팀장", "본부장", "부사장", "대표이사"],
    fields: [
      { key: "controlNo", label: "부서 관리 번호", type: "text" },
      { key: "client", label: "수주처", type: "text" },
      { key: "requester", label: "의뢰인", type: "text" },
      { key: "equipment", label: "장비명", type: "text" },
      { key: "serialNo", label: "S/N", type: "text" },
      { key: "deliveryPlace", label: "입고장소", type: "text" },
      { key: "requestDate", label: "의뢰일", type: "date" },
      { key: "dueDate", label: "입고요청일", type: "date" },
      {
        key: "usageType",
        label: "사용구분",
        type: "select",
        options: ["원자재", "재공품", "공용품", "판매", "무상", "기타"],
      },
      { key: "reference", label: "비교자료", type: "textarea", span: 2 },
    ],
    tables: [
      {
        key: "items",
        title: "외주 품목",
        columns: [
          { key: "name", label: "품명" },
          { key: "drawingNo", label: "도면번호" },
          { key: "unit", label: "단위", width: "88px" },
          { key: "qty", label: "수량", width: "88px" },
          { key: "memo", label: "비고" },
        ],
        initialRows: 8,
      },
    ],
  },
  {
    key: "manufacturing_request",
    title: "제조요구서",
    category: "제조",
    description: "제품 제조 요청과 생산 조건 정리",
    approvalRoles: ["담당", "팀장", "이사", "부사장", "사장"],
    fields: [
      {
        key: "orderCategory",
        label: "현황 구분",
        type: "select",
        options: ["국내 장비", "해외 장비", "부품"],
      },
      { key: "orderDate", label: "수주일", type: "date" },
      { key: "country", label: "국가/구분", type: "text" },
      { key: "productName", label: "제품명", type: "text" },
      { key: "qty", label: "수량", type: "text" },
      { key: "createdDate", label: "작성일", type: "date" },
      { key: "client", label: "발주처", type: "text" },
      { key: "deliveryDate", label: "납기", type: "date" },
      { key: "documentNo", label: "문서 NO", type: "text" },
      { key: "serialNo", label: "Serial No", type: "text" },
      { key: "power", label: "전원", type: "text" },
      { key: "productSpec", label: "제품규격", type: "textarea", span: 2 },
      { key: "additional", label: "추가사항", type: "textarea", span: 2 },
      { key: "reference", label: "참고사항", type: "textarea", span: 2 },
      { key: "attachment", label: "첨부 메모(기존)", type: "text", span: 2 },
    ],
    tables: [{ key: "specs", title: "Specification", columns: [{ key: "content", label: "내용" }], initialRows: 4 }],
  },
  {
    key: "work_order",
    title: "작업지시서",
    category: "생산",
    description: "승인된 제조요구서를 기준으로 생산 작업 내용을 지시",
    approvalRoles: [],
    fields: [
      { key: "issueDate", label: "발행일", type: "date" },
      {
        key: "marketType",
        label: "국내/해외 구분",
        type: "select",
        options: ["국내", "해외"],
      },
      { key: "productName", label: "제품명", type: "text" },
      { key: "qty", label: "수량", type: "text" },
      { key: "client", label: "발주처", type: "text" },
      { key: "deliveryDate", label: "납품일", type: "date" },
      { key: "serialNo", label: "Serial No", type: "text" },
      { key: "inspectionDate", label: "검수예정일", type: "date" },
      { key: "manufacturingDate", label: "제조완료예정일", type: "date" },
      { key: "power", label: "전원", type: "text" },
      { key: "productSpec", label: "제품규격", type: "textarea", span: 2 },
      { key: "additionalSpec", label: "추가규격", type: "textarea", span: 2 },
      { key: "clientRequirements", label: "발주처 요구사항", type: "textarea", span: 2 },
      { key: "manufacturingNotes", label: "제조 시 주의사항", type: "textarea", span: 2 },
      { key: "attachments", label: "첨부서류", type: "textarea", span: 2 },
    ],
    tables: [],
  },
  {
    key: "inspection_request",
    title: "제품검사요청서",
    category: "QA",
    description: "생산 완료 후 제품 검사 요청",
    approvalRoles: ["담당", "팀장"],
    fields: [
      { key: "client", label: "발주처", type: "text" },
      { key: "contact", label: "담당자", type: "text" },
      { key: "manufacturedDate", label: "제조완료일", type: "date" },
      { key: "inspectionDate", label: "검수 요청일", type: "date" },
      { key: "qaMemo", label: "QA 접수 메모", type: "textarea", span: 2 },
    ],
    tables: [
      {
        key: "products",
        title: "검사 대상",
        columns: [
          { key: "productName", label: "제품명" },
          { key: "modelName", label: "모델명" },
          { key: "serialNo", label: "S/N" },
          { key: "spec", label: "제품 규격" },
        ],
        initialRows: 5,
      },
    ],
  },
  {
    key: "purchase_resolution",
    title: "구매결의서",
    category: "구매",
    description: "구매처, 결제조건, 품목과 금액 확정",
    approvalRoles: ["담당", "팀장", "본부장", "대표이사"],
    fields: [
      { key: "resolutionDate", label: "작성일", type: "date" },
      { key: "vendorName", label: "매입처명", type: "text" },
      { key: "supplier", label: "공급처", type: "text" },
      { key: "managerName", label: "담당자", type: "text" },
      { key: "manufacturingCondition", label: "결제조건", type: "text" },
      { key: "contact", label: "연락처", type: "text" },
      { key: "paymentTerms", label: "일시불/분할", type: "text" },
      { key: "expectedArrivalDate", label: "입고예정일", type: "date" },
      { key: "warrantyPeriod", label: "하자 이행보증 기간", type: "text" },
      { key: "amountInWords", label: "합계금액 한글", type: "text" },
      { key: "vatType", label: "VAT 구분", type: "select", options: ["VAT별도", "VAT포함"] },
    ],
    tables: [
      {
        key: "items",
        title: "구매품목",
        columns: [
          { key: "name", label: "품명" },
          { key: "spec", label: "규격" },
          { key: "unit", label: "단위" },
          { key: "qty", label: "수량" },
          { key: "unitPrice", label: "단가" },
          { key: "amount", label: "금액" },
        ],
        initialRows: 20,
      },
    ],
  },
  {
    key: "expense_request",
    title: "지출품의서",
    category: "재무",
    description: "비용 지출 승인 요청",
    approvalRoles: ["담당", "팀장", "재무", "대표이사"],
    fields: [
      { key: "title", label: "제목", type: "text", span: 2 },
      { key: "expenseDate", label: "지출 예정일", type: "date" },
      { key: "vendor", label: "지출처", type: "text" },
      { key: "amount", label: "금액", type: "text" },
      { key: "paymentMethod", label: "지급방법", type: "select", options: ["계좌이체", "카드", "현금", "기타"] },
      { key: "purpose", label: "지출 사유", type: "textarea", span: 2 },
    ],
    tables: [{ key: "items", title: "지출 내역", columns: commonItemColumns, initialRows: 3 }],
  },
  {
    key: "vacation_request",
    title: "휴가신청서",
    category: "인사",
    description: "연차, 반차, 기타 휴가 신청",
    approvalRoles: ["신청자", "팀장", "인사"],
    fields: [
      { key: "applicant", label: "신청자", type: "text" },
      { key: "team", label: "부서", type: "text" },
      { key: "vacationType", label: "휴가구분", type: "select", options: ["연차", "오전반차", "오후반차", "경조", "공가", "기타"] },
      { key: "days", label: "일수", type: "text" },
      { key: "startDate", label: "시작일", type: "date" },
      { key: "endDate", label: "종료일", type: "date" },
      { key: "emergencyContact", label: "비상연락처", type: "text" },
      { key: "delegate", label: "업무 대행자", type: "text" },
      { key: "reason", label: "사유", type: "textarea", span: 2 },
    ],
    tables: [],
  },
  {
    key: "holiday_work_request",
    title: "휴일근무신청서",
    category: "인사",
    description: "휴일 또는 연장 근무 사전 신청",
    approvalRoles: ["신청자", "팀장", "인사"],
    fields: [
      { key: "applicant", label: "신청자", type: "text" },
      { key: "team", label: "부서", type: "text" },
      { key: "workDate", label: "근무일", type: "date" },
      { key: "workTime", label: "근무시간", type: "text", placeholder: "예: 09:00-13:00" },
      { key: "location", label: "근무장소", type: "text" },
      { key: "participants", label: "대상자", type: "text" },
      { key: "workContent", label: "업무내용", type: "textarea", span: 2 },
      { key: "reason", label: "근무사유", type: "textarea", span: 2 },
    ],
    tables: [],
  },
];

const templateMap = Object.fromEntries(templates.map((template) => [template.key, template]));
const legacyTemplateKeys = [
  "manufacturing_request",
  "work_order",
  "purchase_request",
  "purchase_resolution",
  "outsourcing_request",
  "inspection_request",
];
const manufacturingTemplateKeys = [
  "manufacturing_request",
  "work_order",
  "purchase_request",
  "purchase_resolution",
  "outsourcing_request",
  "inspection_request",
];
const generalTemplateKeys = ["draft", "expense_request", "vacation_request", "holiday_work_request"];
const templateRows = [
  [...manufacturingTemplateKeys, ...generalTemplateKeys]
    .map((key) => templateMap[key])
    .filter((template): template is TemplateDef => Boolean(template)),
];

function createDefaultApproverSlots(count = DEFAULT_APPROVER_COUNT): ApproverSlot[] {
  return Array.from({ length: count }, (_, index) => ({
    roleLabel: `${index + 1}차 결재`,
    approverId: "",
  }));
}

function getDisplayTeam(profile: ProfileRow) {
  return getCurrentOrgTeam(profile.name || "", profile.team || "");
}

function getProfileSortValue(profile: ProfileRow) {
  const name = profile.name || "";
  const team = getDisplayTeam(profile);
  const teamIndex = TEAM_ORDER.includes(team) ? TEAM_ORDER.indexOf(team) : 999;
  const orgInfo = ORG_MEMBER_MAP.get(name);
  const leaderWeight = orgInfo?.leader ? 0 : 1;

  return `${String(teamIndex).padStart(3, "0")}-${leaderWeight}-${name}`;
}

function createTableRows(table: TableDef) {
  return Array.from({ length: table.initialRows }, () =>
    Object.fromEntries(table.columns.map((column) => [column.key, ""]))
  );
}

function shouldUseTodayAsDefault(field: FieldDef) {
  return (
    field.label.includes("작성일") ||
    field.label.includes("발행일") ||
    ["createdDate", "resolutionDate", "issueDate"].includes(field.key)
  );
}

function createEmptyFormData(template: TemplateDef) {
  const next: Record<string, unknown> = {};

  template.fields.forEach((field) => {
    if (field.type === "date") {
      next[field.key] = shouldUseTodayAsDefault(field) ? today : "";
      return;
    }

    next[field.key] = "";
  });

  template.tables.forEach((table) => {
    next[table.key] = createTableRows(table);
  });

  return next;
}

function applyCurrentUserFields(
  data: Record<string, unknown>,
  name: string,
  team: string,
  overwrite = false
) {
  const next = { ...data };

  [
    ["applicant", name],
    ["requester", name],
    ["owner", name],
    ["team", team],
  ].forEach(([key, value]) => {
    if (!value) return;
    if (overwrite || !next[key]) {
      next[key] = value;
    }
  });

  return next;
}

function applyEquipmentOrderFields(
  data: Record<string, unknown>,
  order: EquipmentOrderRow
) {
  const next = { ...data };
  const pairs: Array<[string, string | null | undefined]> = [
    ["client", order.customer],
    ["customer", order.customer],
    ["equipment", order.model],
    ["productName", order.model],
    ["modelName", order.model],
    ["serialNo", order.serial_no],
    ["deliveryPlace", order.delivery_place],
  ];

  pairs.forEach(([key, value]) => {
    if (value && key in next) {
      next[key] = value;
    }
  });

  return next;
}

function getErrorMessage(error: unknown) {
  if (!error || typeof error !== "object") return "";
  const maybeError = error as { message?: string; details?: string; hint?: string; code?: string };

  return [maybeError.message, maybeError.details, maybeError.hint, maybeError.code]
    .filter(Boolean)
    .join(" / ");
}

function getRows(value: unknown): Record<string, string>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is Record<string, string> => row && typeof row === "object");
}

function formatFileSize(sizeBytes: number) {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileExtension(fileName: string) {
  const extension = fileName.split(".").pop()?.toLowerCase() || "";
  return extension;
}

function validateAttachmentFiles(files: File[], existingCount = 0) {
  if (existingCount + files.length > MAX_ATTACHMENT_COUNT) {
    return `첨부파일은 문서당 최대 ${MAX_ATTACHMENT_COUNT}개까지 등록할 수 있습니다.`;
  }

  for (const file of files) {
    const extension = getFileExtension(file.name);

    if (!ALLOWED_ATTACHMENT_EXTENSIONS.has(extension)) {
      return `${file.name}: 엑셀, PDF, 이미지, DWG/DXF, ZIP 파일만 첨부할 수 있습니다.`;
    }

    if (file.size <= 0 || file.size > MAX_ATTACHMENT_SIZE) {
      return `${file.name}: 파일 크기는 30MB 이하여야 합니다.`;
    }
  }

  return "";
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  return value.slice(0, 10);
}

function formatMonthKey(value?: string | null) {
  if (!value) return "unknown";
  return value.slice(0, 7);
}

function formatMonthLabel(monthKey: string) {
  if (monthKey === "unknown") return "날짜 미지정";
  const [year, month] = monthKey.split("-");
  return `${year}년 ${Number(month)}월`;
}

function formatShortDate(value?: string | null) {
  if (!value) return "";
  const [, month, day] = value.slice(0, 10).split("-");
  if (!month || !day) return value;
  return `${Number(month)}/${Number(day)}`;
}

function statusText(status: ApprovalStatus) {
  if (status === "approved") return "승인완료";
  if (status === "rejected") return "반려";
  return "진행중";
}

function progressText(document: ApprovalDocumentRow) {
  if (document.status === "approved") return "최종 승인 완료";
  if (document.status === "rejected") return "반려 처리됨";

  const pendingLine = getFirstPendingLine(document);
  return pendingLine ? `${pendingLine.approver_name} (${pendingLine.role_label}) 결재 대기` : "결재 진행 중";
}

function deriveDocumentTitle(template: TemplateDef, data: Record<string, unknown>) {
  const candidates = [
    data.title,
    data.productName,
    data.equipment,
    data.vendorName,
    data.client,
    data.vendor,
    data.applicant,
  ];

  const found = candidates.find((value) => typeof value === "string" && value.trim());
  return found ? `${template.title} - ${String(found).trim()}` : template.title;
}

function getFirstPendingLine(document: ApprovalDocumentRow) {
  const lines = [...(document.approval_lines || [])].sort((a, b) => a.step_order - b.step_order);
  return lines.find((line) => line.status === "pending") || null;
}

function getSortedApprovalLines(document: ApprovalDocumentRow) {
  return [...(document.approval_lines || [])].sort((a, b) => a.step_order - b.step_order);
}

function formatExcelValue(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return JSON.stringify(value);
}

function formatDocumentValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function escapePrintHtml(value: unknown) {
  return formatDocumentValue(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getReferenceInfos(data: Record<string, unknown>): ApprovalReferenceInfo[] {
  const value = data._references;
  if (!Array.isArray(value)) return [];

  return value.filter(
    (item): item is ApprovalReferenceInfo =>
      Boolean(item) &&
      typeof item === "object" &&
      typeof (item as ApprovalReferenceInfo).id === "string"
  );
}

function collectSearchValues(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }
  if (Array.isArray(value)) return value.flatMap(collectSearchValues);
  if (typeof value === "object") return Object.values(value).flatMap(collectSearchValues);
  return [];
}

function documentMatchesSearch(document: ApprovalDocumentRow, query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase("ko");
  if (!normalizedQuery) return true;

  const searchableText = [
    document.template_title,
    document.title,
    document.requester_name,
    document.requester_team || "",
    statusText(document.status),
    formatDate(document.submitted_at),
    formatDate(document.completed_at),
    ...(document.approval_lines || []).flatMap((line) => [
      line.approver_name,
      line.approver_team || "",
      line.role_label,
      statusText(line.status),
    ]),
    ...getReferenceInfos(document.form_data).flatMap((reference) => [
      reference.name,
      reference.team,
    ]),
    ...collectSearchValues(document.form_data),
  ]
    .join(" ")
    .toLocaleLowerCase("ko");

  return searchableText.includes(normalizedQuery);
}

function getLinkedEquipmentInfo(document: ApprovalDocumentRow) {
  const data = document.form_data || {};
  const orderIdValue = document.equipment_order_id || data._equipmentOrderId;
  const stageValue = document.equipment_stage_key || data._equipmentStageKey;
  const orderId =
    typeof orderIdValue === "number"
      ? orderIdValue
      : typeof orderIdValue === "string"
        ? Number(orderIdValue)
        : null;

  if (
    !orderId ||
    typeof stageValue !== "string" ||
    !(stageValue in equipmentDateColumnByStage)
  ) {
    return null;
  }

  return {
    orderId,
    stageKey: stageValue as EquipmentStageKey,
  };
}

function getDocumentSheetName(document: ApprovalDocumentRow) {
  const date = formatDate(document.submitted_at).replaceAll("-", "").slice(2);
  return `${date}_${document.template_title}`.slice(0, 31);
}

function createApprovalListSheet(documents: ApprovalDocumentRow[]): ExcelSheet {
  return {
    name: "결재문서 목록",
    widths: [95, 120, 240, 85, 100, 90, 100, 110, 120],
    rows: [
      ["결재문서 히스토리"],
      [""],
      [
        "작성일",
        "문서종류",
        "제목",
        "작성자",
        "부서",
        "상태",
        "현재결재자",
        "최종승인일",
        "결재라인",
      ],
      ...documents.map((document) => {
        const pendingLine = getFirstPendingLine(document);

        return [
          formatDate(document.submitted_at),
          document.template_title,
          document.title,
          document.requester_name,
          document.requester_team || "",
          statusText(document.status),
          pendingLine ? `${pendingLine.approver_name} (${pendingLine.role_label})` : "",
          formatDate(document.completed_at),
          (document.approval_lines || [])
            .map((line) => `${line.role_label}:${line.approver_name}/${statusText(line.status)}`)
            .join(" → "),
        ];
      }),
    ],
  };
}

function createApprovalDocumentSheet(document: ApprovalDocumentRow): ExcelSheet {
  const template = templateMap[document.template_key] || null;
  const rows = [
    [document.template_title],
    [""],
    ["항목", "내용"],
    ["제목", document.title],
    ["상태", statusText(document.status)],
    ["작성자", document.requester_name],
    ["부서", document.requester_team || ""],
    ["작성일", formatDate(document.submitted_at)],
    ["최종승인일", formatDate(document.completed_at)],
    [""],
    ["결재순서", "결재자", "부서", "상태", "처리일"],
    ...(document.approval_lines || []).map((line) => [
      line.role_label,
      line.approver_name,
      line.approver_team || "",
      statusText(line.status),
      formatDate(line.acted_at),
    ]),
    [""],
    ["참조 인원", getReferenceInfos(document.form_data).map((item) => `${item.name}/${item.team}`).join(", ")],
    [""],
    ["문서 항목", "입력값"],
    ...(template?.fields || []).map((field) => [
      field.label,
      formatExcelValue(document.form_data[field.key]),
    ]),
  ];

  (template?.tables || []).forEach((table) => {
    rows.push([""], [table.title], table.columns.map((column) => column.label));
    getRows(document.form_data[table.key]).forEach((item) => {
      rows.push(table.columns.map((column) => item[column.key] || ""));
    });
  });

  return {
    name: getDocumentSheetName(document),
    widths: [120, 180, 140, 100, 100, 120],
    rows,
  };
}

function getEquipmentOrderLabel(order: EquipmentOrderRow) {
  const categoryText =
    order.category === "domestic"
      ? "국내"
      : order.category === "overseas"
        ? order.country || "해외"
        : order.country || "부품";

  return `${formatShortDate(order.order_date)} · ${categoryText} · ${order.customer} · ${order.model}`;
}

function getStringValue(data: Record<string, unknown>, key: string) {
  const value = data[key];
  return typeof value === "string" ? value.trim() : "";
}

export default function ApprovalPage() {
  const [selectedTemplateKey, setSelectedTemplateKey] = useState(templates[0].key);
  const selectedTemplate = templateMap[selectedTemplateKey] || templates[0];
  const [inputMode, setInputMode] = useState<InputMode>("modern");
  const [formData, setFormData] = useState<Record<string, unknown>>(() =>
    createEmptyFormData(selectedTemplate)
  );
  const [approverSlots, setApproverSlots] = useState<ApproverSlot[]>(() =>
    createDefaultApproverSlots()
  );
  const [referenceIds, setReferenceIds] = useState<string[]>([]);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [customerOptions, setCustomerOptions] = useState<CustomerOption[]>([]);
  const [equipmentOrders, setEquipmentOrders] = useState<EquipmentOrderRow[]>([]);
  const [selectedEquipmentOrderId, setSelectedEquipmentOrderId] = useState("");
  const [documents, setDocuments] = useState<ApprovalDocumentRow[]>([]);
  const [attachments, setAttachments] = useState<ApprovalAttachmentRow[]>([]);
  const [pendingAttachmentFiles, setPendingAttachmentFiles] = useState<File[]>([]);
  const [attachmentFeatureReady, setAttachmentFeatureReady] = useState(false);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [currentName, setCurrentName] = useState("");
  const [currentTeam, setCurrentTeam] = useState("");
  const [currentRole, setCurrentRole] = useState("");
  const [selectedDocumentId, setSelectedDocumentId] = useState<number | null>(null);
  const [detailModalDocumentId, setDetailModalDocumentId] = useState<number | null>(null);
  const [activeFilter, setActiveFilter] = useState<DocumentFilter>("mine");
  const [documentSearchQuery, setDocumentSearchQuery] = useState("");
  const [documentTemplateFilter, setDocumentTemplateFilter] = useState("all");
  const [documentStatusFilter, setDocumentStatusFilter] = useState<DocumentStatusFilter>("all");
  const [documentRequesterFilter, setDocumentRequesterFilter] = useState("all");
  const [documentDateFrom, setDocumentDateFrom] = useState("");
  const [documentDateTo, setDocumentDateTo] = useState("");
  const [documentsWithAttachmentsOnly, setDocumentsWithAttachmentsOnly] = useState(false);
  const [showDocumentFilters, setShowDocumentFilters] = useState(false);
  const [expandedHistoryMonths, setExpandedHistoryMonths] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [setupError, setSetupError] = useState("");
  const [message, setMessage] = useState("");
  const [nexusDocumentKey, setNexusDocumentKey] = useState<NexusDocumentKey | null>(null);
  const nexusDefaultsAppliedRef = useRef(false);
  const nexusDocument = nexusDocumentKey ? NEXUS_DOCUMENT_MAP[nexusDocumentKey] : null;
  const nexusManufacturingMode = nexusDocumentKey === "manufacturing";
  const nexusWorkOrderMode = nexusDocumentKey === "work_order";
  const nexusPurchaseMode = nexusDocumentKey === "purchase";
  const nexusPurchaseResolutionMode = nexusDocumentKey === "purchase_resolution";
  const nexusSubmissionLocked = Boolean(nexusDocument && !nexusDocument.submissionReady);

  const isCurrentUserId = useCallback(
    (value?: string | null) => Boolean(currentUserId && value === currentUserId),
    [currentUserId]
  );
  const isCurrentUserName = useCallback(
    (value?: string | null) => Boolean(currentName && value === currentName),
    [currentName]
  );
  const isCurrentRequester = useCallback(
    (document: ApprovalDocumentRow) => {
      if (currentName) return document.requester_name === currentName;
      return isCurrentUserId(document.requester_id);
    },
    [currentName, isCurrentUserId]
  );
  const isCurrentApprover = useCallback(
    (document: ApprovalDocumentRow) =>
      (document.approval_lines || []).some(
        (line) => isCurrentUserId(line.approver_id) || isCurrentUserName(line.approver_name)
      ),
    [isCurrentUserId, isCurrentUserName]
  );
  const isCurrentReference = useCallback(
    (document: ApprovalDocumentRow) =>
      getReferenceInfos(document.form_data).some(
        (reference) => isCurrentUserId(reference.id) || isCurrentUserName(reference.name)
      ),
    [isCurrentUserId, isCurrentUserName]
  );
  const isCurrentApprovalLine = useCallback(
    (line?: ApprovalLineRow | null) =>
      Boolean(line && (isCurrentUserId(line.approver_id) || isCurrentUserName(line.approver_name))),
    [isCurrentUserId, isCurrentUserName]
  );
  const isAdmin = currentRole === "admin";
  const visibleDocuments = useMemo(
    () =>
      isAdmin
        ? documents
        : documents.filter(
        (document) =>
          isCurrentRequester(document) ||
          isCurrentApprover(document) ||
          isCurrentReference(document)
      ),
    [documents, isAdmin, isCurrentApprover, isCurrentReference, isCurrentRequester]
  );

  const pendingForMe = useMemo(
    () =>
      visibleDocuments.filter((document) => {
        const pendingLine = getFirstPendingLine(document);
        return document.status === "pending" && isCurrentApprovalLine(pendingLine);
      }),
    [isCurrentApprovalLine, visibleDocuments]
  );
  const completedForMe = useMemo(
    () => visibleDocuments.filter((document) => document.status === "approved"),
    [visibleDocuments]
  );

  const referenceForMe = useMemo(
    () => visibleDocuments.filter(isCurrentReference),
    [isCurrentReference, visibleDocuments]
  );
  const myDocuments = useMemo(
    () => (isAdmin ? visibleDocuments : visibleDocuments.filter(isCurrentRequester)),
    [isAdmin, isCurrentRequester, visibleDocuments]
  );
  const requesterFilterOptions = useMemo(
    () =>
      Array.from(new Set(visibleDocuments.map((document) => document.requester_name)))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, "ko")),
    [visibleDocuments]
  );

  const baseFilteredDocuments = useMemo(() => {
    if (activeFilter === "mine") {
      return myDocuments;
    }

    if (activeFilter === "pending") {
      return pendingForMe;
    }

    if (activeFilter === "reference") {
      return referenceForMe;
    }

    if (activeFilter === "history") {
      return completedForMe;
    }

    return [];
  }, [
    activeFilter,
    completedForMe,
    myDocuments,
    pendingForMe,
    referenceForMe,
  ]);

  const filteredDocuments = useMemo(
    () =>
      baseFilteredDocuments.filter((document) => {
        if (!documentMatchesSearch(document, documentSearchQuery)) return false;
        if (documentTemplateFilter !== "all" && document.template_key !== documentTemplateFilter) return false;
        if (documentStatusFilter !== "all" && document.status !== documentStatusFilter) return false;
        if (documentRequesterFilter !== "all" && document.requester_name !== documentRequesterFilter) return false;
        if (documentDateFrom && document.submitted_at.slice(0, 10) < documentDateFrom) return false;
        if (documentDateTo && document.submitted_at.slice(0, 10) > documentDateTo) return false;
        if (documentsWithAttachmentsOnly && !attachments.some((attachment) => attachment.document_id === document.id)) {
          return false;
        }
        return true;
      }),
    [
      attachments,
      baseFilteredDocuments,
      documentDateFrom,
      documentDateTo,
      documentRequesterFilter,
      documentSearchQuery,
      documentStatusFilter,
      documentTemplateFilter,
      documentsWithAttachmentsOnly,
    ]
  );
  const hasDetailedFilters =
    documentTemplateFilter !== "all" ||
    documentStatusFilter !== "all" ||
    documentRequesterFilter !== "all" ||
    Boolean(documentDateFrom) ||
    Boolean(documentDateTo) ||
    documentsWithAttachmentsOnly;

  const historyMonthGroups = useMemo(() => {
    const groupMap = new Map<string, ApprovalDocumentRow[]>();

    filteredDocuments.forEach((document) => {
      const monthKey = formatMonthKey(document.completed_at || document.submitted_at);
      groupMap.set(monthKey, [...(groupMap.get(monthKey) || []), document]);
    });

    return Array.from(groupMap.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([monthKey, rows]) => ({
        monthKey,
        rows: rows.sort((a, b) =>
          (b.completed_at || b.submitted_at).localeCompare(a.completed_at || a.submitted_at)
        ),
      }));
  }, [filteredDocuments]);

  const selectedDocument = useMemo(
    () =>
      filteredDocuments.find((document) => document.id === selectedDocumentId) ||
      filteredDocuments[0] ||
      null,
    [filteredDocuments, selectedDocumentId]
  );
  const detailModalDocument = useMemo(
    () => visibleDocuments.find((document) => document.id === detailModalDocumentId) || null,
    [detailModalDocumentId, visibleDocuments]
  );

  const sortedProfiles = useMemo(
    () =>
      profiles
        .filter(
          (profile) =>
            profile.name &&
            (ORG_MEMBER_MAP.has(profile.name) || EXECUTIVE_NAMES.includes(profile.name))
        )
        .sort((a, b) => getProfileSortValue(a).localeCompare(getProfileSortValue(b), "ko")),
    [profiles]
  );

  const selectedEquipmentStage = equipmentStageByTemplate[selectedTemplate.key] || null;
  const shouldCreateEquipmentOrder = selectedTemplate.key === "manufacturing_request";
  const shouldSelectEquipmentOrder = Boolean(selectedEquipmentStage && !shouldCreateEquipmentOrder);
  const linkableEquipmentOrders = useMemo(() => {
    if (!shouldSelectEquipmentOrder) return [];

    return equipmentOrders.filter(
      (order) => Boolean(order.manufacturing_document_id)
    );
  }, [equipmentOrders, shouldSelectEquipmentOrder]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setSetupError("");

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const storedName = typeof window !== "undefined" ? localStorage.getItem("name") || "" : "";
    const storedTeam = typeof window !== "undefined" ? localStorage.getItem("team") || "" : "";
    const storedRole = typeof window !== "undefined" ? localStorage.getItem("role") || "" : "";
    const currentOrgTeam = getCurrentOrgTeam(storedName, storedTeam);

    setCurrentUserId(user?.id || "");
    setCurrentName(storedName);
    setCurrentTeam(currentOrgTeam);
    setCurrentRole(storedRole);
    setFormData((prev) => applyCurrentUserFields(prev, storedName, currentOrgTeam));

    const { data: profileRows } = await supabase
      .from("profiles")
      .select("id,name,team,role")
      .order("name", { ascending: true });

    setProfiles((profileRows || []) as ProfileRow[]);

    const { data: customerRows } = await supabase
      .from("customers")
      .select("id,name")
      .eq("category", "customer")
      .order("name", { ascending: true });

    setCustomerOptions((customerRows || []) as CustomerOption[]);

    const primaryEquipmentOrders = await supabase
      .from("equipment_orders")
      .select("id,category,order_date,country,customer,model,owner_name,serial_no,delivery_place,note,manufacturing_document_id,outsourcing_document_id")
      .order("order_date", { ascending: false })
      .limit(80);

    let equipmentRows = primaryEquipmentOrders.data;

    if (primaryEquipmentOrders.error?.message?.includes("outsourcing")) {
      const fallbackEquipmentOrders = await supabase
        .from("equipment_orders")
        .select("id,category,order_date,country,customer,model,owner_name,serial_no,delivery_place,note,manufacturing_document_id")
        .order("order_date", { ascending: false })
        .limit(80);

      equipmentRows = (fallbackEquipmentOrders.data || []).map((order) => ({
        ...order,
        outsourcing_document_id: null,
      }));
    }

    setEquipmentOrders((equipmentRows || []) as EquipmentOrderRow[]);

    const { data: documentRows, error: documentError } = await supabase
      .from("approval_documents")
      .select(
        [
          "id",
          "template_key",
          "template_title",
          "title",
          "status",
          "requester_id",
          "requester_name",
          "requester_team",
          "current_step",
          "form_data",
          "submitted_at",
          "completed_at",
          "equipment_order_id",
          "equipment_stage_key",
          "created_at",
          "updated_at",
          "document_no",
          "worktalk_room_id",
          "approval_lines(id,document_id,step_order,role_label,approver_id,approver_name,approver_team,status,acted_at,memo)",
        ].join(",")
      )
      .order("created_at", { ascending: false });

    if (documentError) {
      setSetupError(
        "결재문서 테이블이 아직 준비되지 않았습니다. project-docs/supabase-approval-documents.sql 실행 후 다시 열어주세요."
      );
      setDocuments([]);
      setNotifications([]);
      setLoading(false);
      return;
    }

    const normalizedDocuments = (((documentRows || []) as unknown) as ApprovalDocumentRow[]).map((document) => ({
      ...document,
      approval_lines: [...(document.approval_lines || [])].sort(
        (a, b) => a.step_order - b.step_order
      ),
    }));

    setDocuments(normalizedDocuments);
    setSelectedDocumentId((prev) => prev || normalizedDocuments[0]?.id || null);

    const { data: attachmentRows, error: attachmentError } = await supabase
      .from("approval_attachments")
      .select("id,document_id,storage_path,original_name,mime_type,size_bytes,uploaded_by,created_at")
      .order("created_at", { ascending: true });

    if (attachmentError) {
      setAttachments([]);
      setAttachmentFeatureReady(false);
    } else {
      setAttachments((attachmentRows || []) as ApprovalAttachmentRow[]);
      setAttachmentFeatureReady(true);
    }

    if (user?.id) {
      const { data: notificationRows } = await supabase
        .from("approval_notifications")
        .select("id,user_id,document_id,message,read_at,created_at")
        .eq("user_id", user.id)
        .is("read_at", null)
        .order("created_at", { ascending: false });

      setNotifications((notificationRows || []) as NotificationRow[]);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => loadData());
  }, [loadData]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const nexusKey = params.get("nexus");
    if (!isNexusDocumentKey(nexusKey)) return;
    const nexusConfig = NEXUS_DOCUMENT_MAP[nexusKey];

    const timeoutId = window.setTimeout(() => {
      setNexusDocumentKey(nexusKey);
      setSelectedTemplateKey(nexusConfig.templateKey);
      setInputMode("legacy");
      setFormData(
        applyCurrentUserFields(
          {
            ...createEmptyFormData(templateMap[nexusConfig.templateKey]),
            ...(nexusKey === "purchase"
              ? {
                  requestType: "구매",
                }
              : nexusKey === "work_order"
                ? { issueDate: today, marketType: "국내" }
              : nexusKey === "purchase_resolution"
                ? { resolutionDate: today, vatType: "VAT별도" }
                : {}),
          },
          localStorage.getItem("name") || "",
          getCurrentOrgTeam(
            localStorage.getItem("name") || "",
            localStorage.getItem("team") || ""
          ),
          true
        )
      );
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    if (
      !nexusManufacturingMode ||
      nexusDefaultsAppliedRef.current ||
      profiles.length === 0
    ) {
      return;
    }

    const profileByName = new Map(
      profiles.map((profile) => [profile.name || "", profile])
    );
    const timeoutId = window.setTimeout(() => {
      setApproverSlots(
        NEXUS_MANUFACTURING_APPROVERS.map((name, index) => ({
          roleLabel: index === 0 ? "1차 결재" : "2차 최종 결재",
          approverId: profileByName.get(name)?.id || "",
        }))
      );
      setReferenceIds(
        NEXUS_MANUFACTURING_REFERENCES.map(
          (name) => profileByName.get(name)?.id || ""
        ).filter(Boolean)
      );
      nexusDefaultsAppliedRef.current = true;
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [nexusManufacturingMode, profiles]);

  useEffect(() => {
    if (!nexusPurchaseMode || profiles.length === 0) return;

    const profileByName = new Map(
      profiles.map((profile) => [profile.name || "", profile])
    );
    const timeoutId = window.setTimeout(() => {
      setApproverSlots(
        NEXUS_PURCHASE_APPROVERS.map((name, index) => ({
          roleLabel:
            index === 0 ? "팀장" : index === 1 ? "본부장" : "대표이사",
          approverId: profileByName.get(name)?.id || "",
        }))
      );
      setReferenceIds(
        [
          ...NEXUS_PURCHASE_TEAM_REFERENCES.filter(
            (name) => name !== currentName
          ),
          ...NEXUS_PURCHASE_FIXED_REFERENCES,
        ]
          .map((name) => profileByName.get(name)?.id || "")
          .filter(Boolean)
      );
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [currentName, nexusPurchaseMode, profiles]);

  useEffect(() => {
    if (!nexusPurchaseResolutionMode || profiles.length === 0) return;

    const profileByName = new Map(
      profiles.map((profile) => [profile.name || "", profile])
    );
    const timeoutId = window.setTimeout(() => {
      setApproverSlots(
        NEXUS_PURCHASE_APPROVERS.map((name, index) => ({
          roleLabel:
            index === 0 ? "팀장" : index === 1 ? "본부장" : "대표이사",
          approverId: profileByName.get(name)?.id || "",
        }))
      );
      setReferenceIds(
        NEXUS_PURCHASE_RESOLUTION_REFERENCES.map(
          (name) => profileByName.get(name)?.id || ""
        ).filter(Boolean)
      );
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [nexusPurchaseResolutionMode, profiles]);

  useEffect(() => {
    if (!nexusWorkOrderMode || profiles.length === 0) return;

    const profileByName = new Map(
      profiles.map((profile) => [profile.name || "", profile])
    );
    const marketType = String(formData.marketType || "국내");
    const salesNames =
      marketType === "해외"
        ? NEXUS_WORK_ORDER_OVERSEAS_SALES
        : NEXUS_WORK_ORDER_DOMESTIC_SALES;
    const participantNames = [
      ...NEXUS_WORK_ORDER_TECH_MEMBERS,
      ...salesNames,
    ].filter((name) => name !== currentName);

    const timeoutId = window.setTimeout(() => {
      setApproverSlots([]);
      setReferenceIds(
        participantNames
          .map((name) => profileByName.get(name)?.id || "")
          .filter(Boolean)
      );
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [currentName, formData.marketType, nexusWorkOrderMode, profiles]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 760px)");
    const updateMobile = () => setIsMobile(mediaQuery.matches);

    updateMobile();
    mediaQuery.addEventListener("change", updateMobile);
    return () => mediaQuery.removeEventListener("change", updateMobile);
  }, []);

  useEffect(() => {
    if (!shouldSelectEquipmentOrder || !selectedEquipmentOrderId) return;

    const selectedOrder = linkableEquipmentOrders.find(
      (order) => String(order.id) === selectedEquipmentOrderId
    );

    if (!selectedOrder) {
      void Promise.resolve().then(() => setSelectedEquipmentOrderId(""));
      return;
    }

    const manufacturingDocument = documents.find(
      (document) => document.id === selectedOrder.manufacturing_document_id
    );
    const serialFromDocument = manufacturingDocument
      ? getStringValue(manufacturingDocument.form_data, "serialNo")
      : "";

    void Promise.resolve().then(() =>
      setFormData((prev) =>
        applyEquipmentOrderFields(prev, {
          ...selectedOrder,
          serial_no: selectedOrder.serial_no || serialFromDocument || null,
        })
      )
    );
  }, [documents, linkableEquipmentOrders, selectedEquipmentOrderId, shouldSelectEquipmentOrder]);

  function changeTemplate(templateKey: string, mode: InputMode = "modern") {
    const nextTemplate = templateMap[templateKey] || templates[0];
    setSelectedTemplateKey(templateKey);
    setInputMode(legacyTemplateKeys.includes(templateKey) ? mode : "modern");
    setFormData(applyCurrentUserFields(createEmptyFormData(nextTemplate), currentName, currentTeam, true));
    setApproverSlots(createDefaultApproverSlots());
    setReferenceIds([]);
    setSelectedEquipmentOrderId("");
    setPendingAttachmentFiles([]);
    setMessage("");
  }

  function updateField(key: string, value: string) {
    setFormData((prev) => ({ ...prev, [key]: value }));
  }

  function updateTableCell(table: TableDef, rowIndex: number, columnKey: string, value: string) {
    setFormData((prev) => {
      const rows = getRows(prev[table.key]);
      const nextRows = rows.map((row, index) =>
        index === rowIndex ? { ...row, [columnKey]: value } : row
      );

      return { ...prev, [table.key]: nextRows };
    });
  }

  function addTableRow(table: TableDef) {
    setFormData((prev) => ({
      ...prev,
      [table.key]: [
        ...getRows(prev[table.key]),
        Object.fromEntries(table.columns.map((column) => [column.key, ""])),
      ],
    }));
  }

  function removeTableRow(table: TableDef, rowIndex: number) {
    setFormData((prev) => {
      const rows = getRows(prev[table.key]);
      if (rows.length <= 1) return prev;
      return { ...prev, [table.key]: rows.filter((_, index) => index !== rowIndex) };
    });
  }

  function selectApprover(index: number, approverId: string) {
    setApproverSlots((prev) =>
      prev.map((slot, slotIndex) => (slotIndex === index ? { ...slot, approverId } : slot))
    );
  }

  function addApproverSlot() {
    setApproverSlots((prev) => [
      ...prev,
      { roleLabel: `${prev.length + 1}차 결재`, approverId: "" },
    ]);
  }

  function removeApproverSlot(index: number) {
    setApproverSlots((prev) =>
      prev
        .filter((_, slotIndex) => slotIndex !== index)
        .map((slot, slotIndex) => ({ ...slot, roleLabel: `${slotIndex + 1}차 결재` }))
    );
  }

  function getProfile(id: string) {
    return profiles.find((profile) => profile.id === id) || null;
  }

  function addReference() {
    setReferenceIds((prev) => [...prev, ""]);
  }

  function selectReference(index: number, profileId: string) {
    setReferenceIds((prev) =>
      prev.map((id, currentIndex) => (currentIndex === index ? profileId : id))
    );
  }

  function removeReference(index: number) {
    setReferenceIds((prev) => prev.filter((_, currentIndex) => currentIndex !== index));
  }

  function handleEquipmentOrderChange(orderId: string) {
    setSelectedEquipmentOrderId(orderId);
  }

  function getDocumentAttachments(documentId: number) {
    return attachments.filter((attachment) => attachment.document_id === documentId);
  }

  function handlePendingAttachmentChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (files.length === 0) return;

    const error = validateAttachmentFiles(files, pendingAttachmentFiles.length);
    if (error) {
      setMessage(error);
      return;
    }

    setPendingAttachmentFiles((prev) => [...prev, ...files]);
    setMessage("");
  }

  async function uploadFilesToDocument(documentId: number, files: File[]) {
    const failedFiles: string[] = [];

    if (!currentUserId || !attachmentFeatureReady) {
      return ["파일 첨부 저장소가 아직 준비되지 않았습니다."];
    }

    setAttachmentBusy(true);

    for (const file of files) {
      const extension = getFileExtension(file.name);
      const storagePath = `${currentUserId}/${documentId}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from(APPROVAL_ATTACHMENT_BUCKET)
        .upload(storagePath, file, {
          contentType: file.type || undefined,
          upsert: false,
        });

      if (uploadError) {
        failedFiles.push(file.name);
        continue;
      }

      const { error: metadataError } = await supabase.from("approval_attachments").insert({
        document_id: documentId,
        storage_path: storagePath,
        original_name: file.name,
        mime_type: file.type || null,
        size_bytes: file.size,
        uploaded_by: currentUserId,
      });

      if (metadataError) {
        await supabase.storage.from(APPROVAL_ATTACHMENT_BUCKET).remove([storagePath]);
        failedFiles.push(file.name);
      }
    }

    setAttachmentBusy(false);
    return failedFiles;
  }

  async function addFilesToExistingDocument(
    document: ApprovalDocumentRow,
    event: ChangeEvent<HTMLInputElement>
  ) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (files.length === 0) return;

    const error = validateAttachmentFiles(files, getDocumentAttachments(document.id).length);
    if (error) {
      setMessage(error);
      return;
    }

    const failedFiles = await uploadFilesToDocument(document.id, files);
    setMessage(
      failedFiles.length > 0
        ? `일부 파일을 첨부하지 못했습니다: ${failedFiles.join(", ")}`
        : "첨부파일이 등록되었습니다."
    );
    await loadData();
  }

  async function downloadAttachment(attachment: ApprovalAttachmentRow) {
    setAttachmentBusy(true);
    setMessage("");

    const { data, error } = await supabase.storage
      .from(APPROVAL_ATTACHMENT_BUCKET)
      .download(attachment.storage_path);

    if (error || !data) {
      setMessage(`첨부파일을 내려받지 못했습니다. ${getErrorMessage(error)}`);
      setAttachmentBusy(false);
      return;
    }

    const url = URL.createObjectURL(data);
    const link = window.document.createElement("a");
    link.href = url;
    link.download = attachment.original_name;
    link.click();
    URL.revokeObjectURL(url);
    setAttachmentBusy(false);
  }

  async function deleteAttachment(attachment: ApprovalAttachmentRow) {
    if (!confirm(`${attachment.original_name} 파일을 삭제할까요?`)) return;

    setAttachmentBusy(true);
    setMessage("");

    const { error: storageError } = await supabase.storage
      .from(APPROVAL_ATTACHMENT_BUCKET)
      .remove([attachment.storage_path]);

    if (storageError) {
      setMessage(`첨부파일을 삭제하지 못했습니다. ${getErrorMessage(storageError)}`);
      setAttachmentBusy(false);
      return;
    }

    const { error: metadataError } = await supabase
      .from("approval_attachments")
      .delete()
      .eq("id", attachment.id);

    if (metadataError) {
      setMessage(`첨부 내역을 삭제하지 못했습니다. ${getErrorMessage(metadataError)}`);
      setAttachmentBusy(false);
      return;
    }

    setMessage("첨부파일이 삭제되었습니다.");
    setAttachmentBusy(false);
    await loadData();
  }

  async function ensureWorkTalkDocumentMessageId(
    roomId: number,
    documentId: number,
    fallbackMessageId: number | null | undefined,
    messageBody: string
  ) {
    if (fallbackMessageId) return fallbackMessageId;

    const { data: metadataMessage } = await supabase
      .from("worktalk_messages")
      .select("id")
      .eq("room_id", roomId)
      .eq("message_type", "document")
      .eq("metadata->>approval_document_id", String(documentId))
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (metadataMessage?.id) return Number(metadataMessage.id);

    const { data: latestMessage } = await supabase
      .from("worktalk_messages")
      .select("id")
      .eq("room_id", roomId)
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestMessage?.id) return Number(latestMessage.id);

    const { data: createdMessageId, error } = await supabase.rpc(
      "worktalk_send_message",
      {
        target_room_id: roomId,
        message_body: messageBody,
      }
    );

    if (error || !createdMessageId) {
      throw new Error(
        error?.message || "PDF를 연결할 채팅 메시지를 생성하지 못했습니다."
      );
    }

    return Number(createdMessageId);
  }

  async function submitDocument() {
    setMessage("");

    if (isMobile) {
      setMessage("결재문서 작성은 PC에서만 가능합니다. 모바일에서는 문서 확인과 승인/반려만 사용할 수 있습니다.");
      return;
    }

    if (nexusSubmissionLocked && nexusDocument) {
      setMessage(
        `${nexusDocument.title}는 양식 작성이 가능합니다. 문서번호 접두사, 결재라인, 참조자, 저장 분류 위치가 확정되면 상신 기능이 열립니다.`
      );
      return;
    }

    if (!currentUserId) {
      setMessage("로그인 정보를 확인할 수 없습니다. 다시 로그인해 주세요.");
      return;
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const requesterId = session?.user?.id || currentUserId;

    if (!requesterId) {
      setMessage("로그인 세션이 만료되었습니다. 다시 로그인해 주세요.");
      return;
    }

    const selectedApprovers = approverSlots
      .map((slot, index) => ({ ...slot, stepOrder: index + 1, profile: getProfile(slot.approverId) }))
      .filter((slot) => slot.profile);
    const selectedReferences = Array.from(new Set(referenceIds))
      .map((profileId) => getProfile(profileId))
      .filter((profile): profile is ProfileRow => Boolean(profile));

    if (!nexusWorkOrderMode && selectedApprovers.length === 0) {
      setMessage("결재라인에서 최소 1명 이상 선택해 주세요.");
      return;
    }

    if (nexusWorkOrderMode && !String(formData.marketType || "").trim()) {
      setMessage("작업지시서의 국내/해외 구분을 선택해 주세요.");
      return;
    }

    setSaving(true);

    const title = deriveDocumentTitle(selectedTemplate, formData);
    const linkedEquipmentOrderId =
      shouldSelectEquipmentOrder && selectedEquipmentOrderId
        ? Number(selectedEquipmentOrderId)
        : null;
    const finalEquipmentOrderId = linkedEquipmentOrderId;
    const finalFormData = {
      ...formData,
      _inputMode: inputMode,
      _equipmentOrderId: finalEquipmentOrderId,
      _equipmentStageKey: selectedEquipmentStage,
      _references: selectedReferences.map((profile) => ({
        id: profile.id,
        name: profile.name || "-",
        team: getDisplayTeam(profile) || profile.team || "",
      })),
    };
    const documentPayload: Record<string, unknown> = {
      template_key: selectedTemplate.key,
      template_title: selectedTemplate.title,
      title,
      status: nexusWorkOrderMode ? "approved" : "pending",
      requester_id: requesterId,
      requester_name: currentName || "작성자",
      requester_team: currentTeam || null,
      current_step: nexusWorkOrderMode ? 0 : 1,
      form_data: finalFormData,
    };

    if (finalEquipmentOrderId) {
      documentPayload.equipment_order_id = finalEquipmentOrderId;
    }

    if (selectedEquipmentStage) {
      documentPayload.equipment_stage_key = selectedEquipmentStage;
    }

    const linePayload = selectedApprovers.map((slot, index) => ({
      step_order: index + 1,
      role_label:
        selectedApprovers.length === 1
          ? "1차 최종 결재"
          : index === selectedApprovers.length - 1
            ? `${index + 1}차 최종 결재`
            : `${index + 1}차 결재`,
      approver_id: slot.profile?.id || "",
      approver_name: slot.profile?.name || "결재자",
      approver_team: slot.profile ? getDisplayTeam(slot.profile) || slot.profile.team || null : null,
      status: "pending",
    }));

    const referencePayload = selectedReferences.map((profile) => ({
      user_id: profile.id,
      reference_name: profile.name || "참조자",
      reference_team: getDisplayTeam(profile) || profile.team || null,
    }));
    const notificationPayload = [
      ...selectedApprovers.map((slot) => ({
        user_id: slot.profile?.id || "",
        message: `${currentName || "작성자"}님이 ${selectedTemplate.title} 결재라인에 지정했습니다.`,
      })),
      ...selectedReferences.map((profile) => ({
        user_id: profile.id,
        message: `${currentName || "작성자"}님이 ${selectedTemplate.title} 참조자로 지정했습니다.`,
      })),
    ];

    const { data: documentId, error: submitError } = await supabase.rpc(
      "submit_approval_document",
      {
        document_payload: documentPayload,
        line_payload: linePayload,
        reference_payload: referencePayload,
        notification_payload: notificationPayload,
      }
    );

    if (submitError || !documentId) {
      const detail = getErrorMessage(submitError);
      setMessage(
        `문서를 저장하지 못했습니다. ${detail || "project-docs/supabase-approval-submit-rpc.sql 실행 여부를 확인해 주세요."}`
      );
      setSaving(false);
      return;
    }

    let nexusDocumentNo = "";
    let nexusPdfAttached = false;
    let nexusSubmittedLabel = "";
    let nexusPdfErrorMessage = "";
    if (
      nexusWorkOrderMode &&
      selectedTemplate.key === "work_order"
    ) {
      const { data, error } = await supabase.rpc(
        "nexus_finalize_work_order_submission",
        { target_document_id: Number(documentId) }
      );
      if (error) {
        setMessage(
          `문서는 등록됐지만 NEXUS 작업지시방 생성에 실패했습니다. ${getErrorMessage(error)}`
        );
        setSaving(false);
        await loadData();
        return;
      }
      const nexusResult =
        data && typeof data === "object"
          ? (data as {
              document_no?: string;
              room_id?: number;
              message_id?: number;
            })
          : null;
      nexusDocumentNo = String(nexusResult?.document_no || "");
      nexusSubmittedLabel = "작업지시서";
    } else if (
      nexusManufacturingMode &&
      selectedTemplate.key === "manufacturing_request"
    ) {
      const { data, error } = await supabase.rpc(
        "nexus_finalize_manufacturing_submission",
        { target_document_id: Number(documentId) }
      );
      if (error) {
        setMessage(
          `문서는 등록됐지만 NEXUS 결재방 생성에 실패했습니다. ${getErrorMessage(error)}`
        );
        setSaving(false);
        await loadData();
        return;
      }
      const nexusResult =
        data && typeof data === "object"
          ? (data as {
              document_no?: string;
              room_id?: number;
              message_id?: number;
            })
          : null;
      nexusDocumentNo = String(nexusResult?.document_no || "");
      nexusSubmittedLabel = "제조요구서";

      if (nexusDocumentNo && nexusResult?.room_id) {
        try {
          const targetMessageId = await ensureWorkTalkDocumentMessageId(
            Number(nexusResult.room_id),
            Number(documentId),
            nexusResult.message_id,
            `${currentName || "작성자"}님이 ${selectedTemplate.title} - ${title} 문서를 상신합니다.`
          );
          if (!targetMessageId) {
            throw new Error("PDF를 연결할 결재방 메시지를 찾지 못했습니다.");
          }

          const pdfBlob = await createManufacturingPdf({
            documentNo: nexusDocumentNo,
            title,
            requesterName: currentName || "작성자",
            requesterTeam: currentTeam || "",
            formData: finalFormData,
            inputMode,
          });
          const fileName = `${nexusDocumentNo}_${title}_제출본.pdf`;
          downloadPdf(pdfBlob, fileName);

          const datePart = nexusDocumentNo.slice(3, 11);
          const storagePath = [
            "manufacturing",
            datePart.slice(0, 4),
            datePart.slice(4, 6),
            datePart.slice(6, 8),
            nexusDocumentNo,
            "submitted.pdf",
          ].join("/");
          const { error: uploadError } = await supabase.storage
            .from("nexus-documents")
            .upload(storagePath, pdfBlob, {
              contentType: "application/pdf",
              upsert: true,
            });
          if (uploadError) throw uploadError;

          const { error: attachError } = await supabase.rpc(
            "nexus_attach_manufacturing_pdf",
            {
              target_document_id: Number(documentId),
              target_room_id: Number(nexusResult.room_id),
              target_message_id: targetMessageId,
              target_storage_path: storagePath,
              target_original_name: fileName,
              target_size_bytes: pdfBlob.size,
            }
          );
          if (attachError) throw attachError;
          nexusPdfAttached = true;
        } catch (pdfError) {
          nexusPdfErrorMessage = `${nexusDocumentNo} 문서는 상신됐지만 PDF 저장에 실패했습니다. ${getErrorMessage(pdfError)}`;
        }
      }
    } else if (
      nexusPurchaseMode &&
      selectedTemplate.key === "purchase_request"
    ) {
      const { data, error } = await supabase.rpc(
        "nexus_finalize_purchase_submission",
        { target_document_id: Number(documentId) }
      );
      if (error) {
        setMessage(
          `문서는 등록됐지만 NEXUS 결재방 생성에 실패했습니다. ${getErrorMessage(error)}`
        );
        setSaving(false);
        await loadData();
        return;
      }
      const nexusResult =
        data && typeof data === "object"
          ? (data as {
              document_no?: string;
              room_id?: number;
              message_id?: number;
            })
          : null;
      nexusDocumentNo = String(nexusResult?.document_no || "");
      nexusSubmittedLabel =
        String((finalFormData as Record<string, unknown>)["requestType"] || "") === "외주"
          ? "외주의뢰서"
          : "구매의뢰서";

      if (nexusDocumentNo && nexusResult?.room_id) {
        try {
          const targetMessageId = await ensureWorkTalkDocumentMessageId(
            Number(nexusResult.room_id),
            Number(documentId),
            nexusResult.message_id,
            `${currentName || "작성자"}님이 ${nexusSubmittedLabel} - ${title} 문서를 상신합니다.`
          );
          if (!targetMessageId) {
            throw new Error("PDF를 연결할 결재방 메시지를 찾지 못했습니다.");
          }

          const pdfBlob = await createPurchasePdf({
            documentNo: nexusDocumentNo,
            requesterName: currentName || "작성자",
            formData: finalFormData,
          });
          const fileName = `${nexusDocumentNo}_${nexusSubmittedLabel}_${title}_제출본.pdf`;
          downloadPdf(pdfBlob, fileName);

          const datePart = nexusDocumentNo.slice(1, 9);
          const storagePath = [
            "purchase",
            datePart.slice(0, 4),
            datePart.slice(4, 6),
            datePart.slice(6, 8),
            nexusDocumentNo,
            "submitted.pdf",
          ].join("/");
          const { error: uploadError } = await supabase.storage
            .from("nexus-documents")
            .upload(storagePath, pdfBlob, {
              contentType: "application/pdf",
              upsert: true,
            });
          if (uploadError) throw uploadError;

          const { error: attachError } = await supabase.rpc(
            "nexus_attach_purchase_pdf",
            {
              target_document_id: Number(documentId),
              target_room_id: Number(nexusResult.room_id),
              target_message_id: targetMessageId,
              target_storage_path: storagePath,
              target_original_name: fileName,
              target_size_bytes: pdfBlob.size,
            }
          );
          if (attachError) throw attachError;
          nexusPdfAttached = true;
        } catch (pdfError) {
          nexusPdfErrorMessage = `${nexusDocumentNo} 문서는 상신됐지만 PDF 저장에 실패했습니다. ${getErrorMessage(pdfError)}`;
        }
      }
    } else if (
      nexusPurchaseResolutionMode &&
      selectedTemplate.key === "purchase_resolution"
    ) {
      const { data, error } = await supabase.rpc(
        "nexus_finalize_purchase_resolution_submission",
        { target_document_id: Number(documentId) }
      );
      if (error) {
        setMessage(
          `문서는 등록됐지만 NEXUS 결재방 생성에 실패했습니다. ${getErrorMessage(error)}`
        );
        setSaving(false);
        await loadData();
        return;
      }
      const nexusResult =
        data && typeof data === "object"
          ? (data as {
              document_no?: string;
              room_id?: number;
              message_id?: number;
            })
          : null;
      nexusDocumentNo = String(nexusResult?.document_no || "");
      nexusSubmittedLabel = "구매결의서";

      if (nexusDocumentNo && nexusResult?.room_id) {
        try {
          const targetMessageId = await ensureWorkTalkDocumentMessageId(
            Number(nexusResult.room_id),
            Number(documentId),
            nexusResult.message_id,
            `${currentName || "작성자"}님이 ${nexusSubmittedLabel} - ${title} 문서를 상신합니다.`
          );
          if (!targetMessageId) {
            throw new Error("PDF를 연결할 결재방 메시지를 찾지 못했습니다.");
          }

          const pdfBlob = await createPurchaseResolutionPdf({
            requesterName: currentName || "작성자",
            formData: finalFormData,
          });
          const fileName = `${nexusDocumentNo}_구매결의서_${title}_제출본.pdf`;
          downloadPdf(pdfBlob, fileName);
          const date = new Date();
          const storagePath = [
            "purchase-resolution",
            String(date.getFullYear()),
            String(date.getMonth() + 1).padStart(2, "0"),
            String(date.getDate()).padStart(2, "0"),
            nexusDocumentNo,
            "submitted.pdf",
          ].join("/");
          const { error: uploadError } = await supabase.storage
            .from("nexus-documents")
            .upload(storagePath, pdfBlob, {
              contentType: "application/pdf",
              upsert: true,
            });
          if (uploadError) throw uploadError;

          const { error: attachError } = await supabase.rpc(
            "nexus_attach_purchase_resolution_pdf",
            {
              target_document_id: Number(documentId),
              target_room_id: Number(nexusResult.room_id),
              target_message_id: targetMessageId,
              target_storage_path: storagePath,
              target_original_name: fileName,
              target_size_bytes: pdfBlob.size,
            }
          );
          if (attachError) throw attachError;
          nexusPdfAttached = true;
        } catch (pdfError) {
          nexusPdfErrorMessage = `${nexusDocumentNo} 구매결의서는 상신됐지만 PDF 저장에 실패했습니다. ${getErrorMessage(pdfError)}`;
        }
      }
    }

    const failedAttachments =
      pendingAttachmentFiles.length > 0
        ? await uploadFilesToDocument(Number(documentId), pendingAttachmentFiles)
        : [];

    setMessage(
      nexusDocumentNo
        ? nexusPdfAttached
          ? `${nexusDocumentNo} ${nexusSubmittedLabel}가 상신됐고 PDF가 결재방에 등록되었습니다.`
          : nexusPdfErrorMessage ||
            `${nexusDocumentNo} ${nexusSubmittedLabel}와 결재방은 생성됐지만 PDF 등록을 확인해 주세요.`
        : failedAttachments.length > 0
        ? `결재문서는 등록됐지만 일부 첨부 업로드에 실패했습니다: ${failedAttachments.join(", ")}`
        : pendingAttachmentFiles.length > 0
          ? "결재문서와 첨부파일이 등록되었습니다."
          : "결재문서가 등록되었습니다."
    );
    setFormData(applyCurrentUserFields(createEmptyFormData(selectedTemplate), currentName, currentTeam, true));
    setReferenceIds([]);
    setSelectedEquipmentOrderId("");
    setPendingAttachmentFiles([]);
    setSaving(false);
    await loadData();
    setSelectedDocumentId(documentId);
  }

  async function approveSelectedDocument() {
    if (!selectedDocument || !currentUserId) return;
    const pendingLine = getFirstPendingLine(selectedDocument);

    if (!pendingLine || !isCurrentApprovalLine(pendingLine)) {
      setMessage("현재 결재 순서가 아닙니다.");
      return;
    }

    setSaving(true);
    setMessage("");
    let approvalMessage = "승인 처리되었습니다.";

    await supabase
      .from("approval_lines")
      .update({ status: "approved", acted_at: new Date().toISOString() })
      .eq("id", pendingLine.id);

    const remainingLines = (selectedDocument.approval_lines || [])
      .filter((line) => line.id !== pendingLine.id && line.status === "pending")
      .sort((a, b) => a.step_order - b.step_order);

    if (remainingLines.length === 0) {
      const completedDate = new Date().toISOString();
      await supabase
        .from("approval_documents")
        .update({ status: "approved", completed_at: completedDate })
        .eq("id", selectedDocument.id);

      const linkedEquipment = getLinkedEquipmentInfo(selectedDocument);

      if (linkedEquipment) {
        await supabase
          .from("equipment_orders")
          .update({
            [equipmentDateColumnByStage[linkedEquipment.stageKey]]:
              completedDate.slice(0, 10),
          })
          .eq("id", linkedEquipment.orderId);
      }

      await supabase.from("approval_notifications").insert({
        user_id: selectedDocument.requester_id,
        document_id: selectedDocument.id,
        message: `${selectedDocument.title} 최종 결재가 완료되었습니다.`,
      });

      if (
        selectedDocument.template_key === "manufacturing_request" &&
        selectedDocument.document_no &&
        selectedDocument.worktalk_room_id
      ) {
        try {
          const approvedLines = (selectedDocument.approval_lines || []).map(
            (line) =>
              line.id === pendingLine.id
                ? { ...line, status: "approved" as const, acted_at: completedDate }
                : line
          );
          const approvedPdf = await createManufacturingPdf({
            documentNo: selectedDocument.document_no,
            title: selectedDocument.title,
            requesterName: selectedDocument.requester_name,
            requesterTeam: selectedDocument.requester_team || "",
            formData: selectedDocument.form_data,
            inputMode:
              selectedDocument.form_data._inputMode === "legacy"
                ? "legacy"
                : "modern",
            version: "approved",
            approvals: [
              ...approvedLines.map((line) => ({
                role: line.role_label,
                name: line.approver_name,
                status: line.status === "approved" ? "승인" : "대기",
                actedAt: line.acted_at,
              })),
              { role: "참조", name: "신훈식 부장", status: "참조" },
              { role: "참조", name: "신상민 회장", status: "참조" },
            ],
          });
          const datePart = selectedDocument.document_no.slice(3, 11);
          const approvedPath = [
            "manufacturing",
            datePart.slice(0, 4),
            datePart.slice(4, 6),
            datePart.slice(6, 8),
            selectedDocument.document_no,
            "approved.pdf",
          ].join("/");
          const { error: uploadError } = await supabase.storage
            .from("nexus-documents")
            .upload(approvedPath, approvedPdf, {
              contentType: "application/pdf",
              upsert: true,
            });
          if (uploadError) throw uploadError;

          const { error: attachError } = await supabase.rpc(
            "nexus_attach_approved_manufacturing_pdf",
            {
              target_document_id: selectedDocument.id,
              target_storage_path: approvedPath,
              target_original_name: `${selectedDocument.document_no}_${selectedDocument.title}_승인완료.pdf`,
              target_size_bytes: approvedPdf.size,
            }
          );
          if (attachError) throw attachError;
        } catch (pdfError) {
          approvalMessage = `승인은 완료됐지만 최종 PDF 저장에 실패했습니다. ${getErrorMessage(pdfError)}`;
        }
      }

      if (
        selectedDocument.template_key === "purchase_request" &&
        selectedDocument.document_no &&
        selectedDocument.worktalk_room_id
      ) {
        try {
          const approvedLines = (selectedDocument.approval_lines || []).map(
            (line) =>
              line.id === pendingLine.id
                ? { ...line, status: "approved" as const, acted_at: completedDate }
                : line
          );
          const documentLabel =
            String(selectedDocument.form_data.requestType || "") === "외주"
              ? "외주의뢰서"
              : "구매의뢰서";
          const approvedPdf = await createPurchasePdf({
            documentNo: selectedDocument.document_no,
            requesterName: selectedDocument.requester_name,
            formData: selectedDocument.form_data,
            version: "approved",
            approvals: [
              {
                role: "담당",
                name: selectedDocument.requester_name,
                status: "작성",
              },
              ...approvedLines.map((line) => ({
                role: line.role_label,
                name: line.approver_name,
                status: line.status === "approved" ? "승인" : "대기",
                actedAt: line.acted_at,
              })),
            ],
          });
          const datePart = selectedDocument.document_no.slice(1, 9);
          const approvedPath = [
            "purchase",
            datePart.slice(0, 4),
            datePart.slice(4, 6),
            datePart.slice(6, 8),
            selectedDocument.document_no,
            "approved.pdf",
          ].join("/");
          const { error: uploadError } = await supabase.storage
            .from("nexus-documents")
            .upload(approvedPath, approvedPdf, {
              contentType: "application/pdf",
              upsert: true,
            });
          if (uploadError) throw uploadError;

          const { error: attachError } = await supabase.rpc(
            "nexus_attach_approved_purchase_pdf",
            {
              target_document_id: selectedDocument.id,
              target_storage_path: approvedPath,
              target_original_name: `${selectedDocument.document_no}_${documentLabel}_${selectedDocument.title}_승인완료.pdf`,
              target_size_bytes: approvedPdf.size,
            }
          );
          if (attachError) throw attachError;
        } catch (pdfError) {
          approvalMessage = `승인은 완료됐지만 최종 PDF 저장에 실패했습니다. ${getErrorMessage(pdfError)}`;
        }
      }

      if (
        selectedDocument.template_key === "purchase_resolution" &&
        selectedDocument.document_no &&
        selectedDocument.worktalk_room_id
      ) {
        try {
          const approvedLines = (selectedDocument.approval_lines || []).map(
            (line) =>
              line.id === pendingLine.id
                ? { ...line, status: "approved" as const, acted_at: completedDate }
                : line
          );
          const approvedPdf = await createPurchaseResolutionPdf({
            requesterName: selectedDocument.requester_name,
            formData: selectedDocument.form_data,
            version: "approved",
            approvals: [
              {
                role: "담당",
                name: selectedDocument.requester_name,
                status: "작성",
              },
              ...approvedLines.map((line) => ({
                role:
                  line.role_label === "팀장"
                    ? "이사"
                    : line.role_label === "대표이사"
                      ? "사장"
                      : line.role_label,
                name: line.approver_name,
                status: line.status === "approved" ? "승인" : "대기",
              })),
            ],
          });
          const date = new Date();
          const approvedPath = [
            "purchase-resolution",
            String(date.getFullYear()),
            String(date.getMonth() + 1).padStart(2, "0"),
            String(date.getDate()).padStart(2, "0"),
            selectedDocument.document_no,
            "approved.pdf",
          ].join("/");
          const { error: uploadError } = await supabase.storage
            .from("nexus-documents")
            .upload(approvedPath, approvedPdf, {
              contentType: "application/pdf",
              upsert: true,
            });
          if (uploadError) throw uploadError;

          const { error: attachError } = await supabase.rpc(
            "nexus_attach_approved_purchase_resolution_pdf",
            {
              target_document_id: selectedDocument.id,
              target_storage_path: approvedPath,
              target_original_name: `${selectedDocument.document_no}_구매결의서_${selectedDocument.title}_승인완료.pdf`,
              target_size_bytes: approvedPdf.size,
            }
          );
          if (attachError) throw attachError;
        } catch (pdfError) {
          approvalMessage = `승인은 완료됐지만 구매결의서 최종 PDF 저장에 실패했습니다. ${getErrorMessage(pdfError)}`;
        }
      }

      if (selectedDocument.template_key === "vacation_request") {
        const { error: scheduleError } = await supabase.rpc("add_vacation_schedule_from_document", {
          target_document_id: selectedDocument.id,
        });

        if (scheduleError) {
          approvalMessage =
            "승인은 완료됐지만 휴가 일정 자동 등록은 실패했습니다. project-docs/supabase-approval-vacation-schedule.sql을 다시 실행해 주세요.";
        }
      }
    } else {
      const nextLine = remainingLines[0];
      await supabase
        .from("approval_documents")
        .update({ current_step: nextLine.step_order })
        .eq("id", selectedDocument.id);

      await supabase.from("approval_notifications").insert({
        user_id: nextLine.approver_id,
        document_id: selectedDocument.id,
        message: `${selectedDocument.title} 결재 순서가 도착했습니다.`,
      });
    }

    if (selectedDocument.worktalk_room_id) {
      const nextApprover = remainingLines[0];
      await supabase.rpc("worktalk_send_message", {
        target_room_id: selectedDocument.worktalk_room_id,
        message_body:
          remainingLines.length === 0
            ? `${currentName || "결재자"}님이 승인했습니다. 모든 결재가 완료되었습니다.`
            : `${currentName || "결재자"}님이 승인했습니다. 다음 결재자는 ${nextApprover.approver_name}님입니다.`,
      });
    }

    await supabase
      .from("approval_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", currentUserId)
      .eq("document_id", selectedDocument.id)
      .is("read_at", null);

    setMessage(approvalMessage);
    setSaving(false);
    await loadData();
  }

  async function rejectSelectedDocument() {
    if (!selectedDocument || !currentUserId) return;
    const pendingLine = getFirstPendingLine(selectedDocument);

    if (!pendingLine || !isCurrentApprovalLine(pendingLine)) {
      setMessage("현재 결재 순서가 아닙니다.");
      return;
    }

    const rejectionReason = window.prompt("반려 사유를 입력해 주세요.");
    if (rejectionReason === null) return;
    if (!rejectionReason.trim()) {
      setMessage("반려 사유는 반드시 입력해야 합니다.");
      return;
    }

    setSaving(true);
    setMessage("");

    await supabase
      .from("approval_lines")
      .update({
        status: "rejected",
        acted_at: new Date().toISOString(),
        memo: rejectionReason.trim(),
      })
      .eq("id", pendingLine.id);

    await supabase
      .from("approval_documents")
      .update({ status: "rejected", completed_at: new Date().toISOString() })
      .eq("id", selectedDocument.id);

    await supabase.from("approval_notifications").insert({
      user_id: selectedDocument.requester_id,
      document_id: selectedDocument.id,
      message: `${selectedDocument.title} 문서가 반려되었습니다. 사유: ${rejectionReason.trim()}`,
    });

    if (selectedDocument.worktalk_room_id) {
      await supabase.rpc("worktalk_send_message", {
        target_room_id: selectedDocument.worktalk_room_id,
        message_body: `${currentName || "결재자"}님이 문서를 반려했습니다. 사유: ${rejectionReason.trim()}`,
      });
    }

    setMessage("반려 처리되었습니다.");
    setSaving(false);
    await loadData();
  }

  async function deleteSelectedDocument() {
    if (!selectedDocument || !isAdmin) return;
    if (!confirm("선택한 결재문서를 삭제할까요?")) return;

    setSaving(true);
    setMessage("");

    const storedAttachments = getDocumentAttachments(selectedDocument.id);
    if (storedAttachments.length > 0) {
      const { error: storageError } = await supabase.storage
        .from(APPROVAL_ATTACHMENT_BUCKET)
        .remove(storedAttachments.map((attachment) => attachment.storage_path));

      if (storageError) {
        setMessage(`문서의 첨부파일을 정리하지 못했습니다. ${getErrorMessage(storageError)}`);
        setSaving(false);
        return;
      }
    }

    await supabase
      .from("approval_notifications")
      .delete()
      .eq("document_id", selectedDocument.id);
    await supabase
      .from("approval_references")
      .delete()
      .eq("document_id", selectedDocument.id);
    await supabase
      .from("approval_lines")
      .delete()
      .eq("document_id", selectedDocument.id);
    if (selectedDocument.template_key === "manufacturing_request") {
      await supabase
        .from("equipment_orders")
        .delete()
        .eq("manufacturing_document_id", selectedDocument.id);
    } else {
      await supabase
        .from("equipment_orders")
        .update({ manufacturing_document_id: null, manufacturing_request_approved_on: null })
        .eq("manufacturing_document_id", selectedDocument.id);
    }
    await supabase
      .from("equipment_orders")
      .update({ purchase_document_id: null, purchase_request_approved_on: null })
      .eq("purchase_document_id", selectedDocument.id);
    await supabase
      .from("equipment_orders")
      .update({ outsourcing_document_id: null, outsourcing_request_approved_on: null })
      .eq("outsourcing_document_id", selectedDocument.id);
    await supabase
      .from("equipment_orders")
      .update({ qa_document_id: null, qa_approved_on: null })
      .eq("qa_document_id", selectedDocument.id);

    const { error } = await supabase
      .from("approval_documents")
      .delete()
      .eq("id", selectedDocument.id);

    if (error) {
      setMessage(`문서를 삭제하지 못했습니다. ${getErrorMessage(error)}`);
      setSaving(false);
      return;
    }

    setSelectedDocumentId(null);
    setMessage("결재문서가 삭제되었습니다.");
    setSaving(false);
    await loadData();
  }

  function exportApprovalList() {
    if (filteredDocuments.length === 0) {
      setMessage("다운로드할 문서가 없습니다.");
      return;
    }

    exportExcelWorkbook(`결재문서_목록_${exportDateStamp()}.xls`, [
      createApprovalListSheet(filteredDocuments),
    ]);
  }

  function exportApprovalForms() {
    if (filteredDocuments.length === 0) {
      setMessage("다운로드할 문서가 없습니다.");
      return;
    }

    exportExcelWorkbook(
      `결재문서_양식_${exportDateStamp()}.xls`,
      filteredDocuments.map(createApprovalDocumentSheet)
    );
  }

  function printApprovedDocument(document: ApprovalDocumentRow) {
    if (document.status !== "approved") {
      setMessage("승인 완료된 문서만 인쇄하거나 PDF로 저장할 수 있습니다.");
      return;
    }

    const printWindow = window.open("", "_blank", "width=980,height=900");
    if (!printWindow) {
      setMessage("인쇄 창을 열 수 없습니다. 브라우저의 팝업 차단 설정을 확인해 주세요.");
      return;
    }

    const template = templateMap[document.template_key];
    const documentAttachments = getDocumentAttachments(document.id);
    const references = getReferenceInfos(document.form_data);
    const printDate = new Intl.DateTimeFormat("ko-KR", {
      dateStyle: "long",
      timeStyle: "short",
    }).format(new Date());
    const fieldsMarkup = (template?.fields || [])
      .map(
        (field) => `
          <div class="field ${field.span === 2 ? "wide" : ""}">
            <span>${escapePrintHtml(field.label)}</span>
            <strong>${escapePrintHtml(document.form_data[field.key])}</strong>
          </div>`
      )
      .join("");
    const approvalMarkup = (document.approval_lines || [])
      .map(
        (line) => `
          <div class="approval-cell">
            <span>${escapePrintHtml(line.role_label)}</span>
            <strong>${escapePrintHtml(line.approver_name)}</strong>
            <em>${escapePrintHtml(statusText(line.status))}</em>
            <small>${escapePrintHtml(formatDate(line.acted_at))}</small>
          </div>`
      )
      .join("");
    const referenceMarkup =
      references.length > 0
        ? references
            .map((reference) => `${escapePrintHtml(reference.name)} / ${escapePrintHtml(reference.team || "-")}`)
            .join(", ")
        : "-";
    const attachmentMarkup =
      documentAttachments.length > 0
        ? documentAttachments
            .map(
              (attachment) =>
                `<li><span>${escapePrintHtml(attachment.original_name)}</span><strong>${escapePrintHtml(formatFileSize(attachment.size_bytes))}</strong></li>`
            )
            .join("")
        : "<li class=\"empty\">등록된 첨부파일이 없습니다.</li>";
    const tablesMarkup = (template?.tables || [])
      .map((table) => {
        const rows = getRows(document.form_data[table.key]);
        if (rows.length === 0) return "";

        return `
          <section class="section keep-together">
            <h2>${escapePrintHtml(table.title)}</h2>
            <table>
              <thead>
                <tr>${table.columns.map((column) => `<th>${escapePrintHtml(column.label)}</th>`).join("")}</tr>
              </thead>
              <tbody>
                ${rows
                  .map(
                    (row) =>
                      `<tr>${table.columns.map((column) => `<td>${escapePrintHtml(row[column.key])}</td>`).join("")}</tr>`
                  )
                  .join("")}
              </tbody>
            </table>
          </section>`;
      })
      .join("");

    printWindow.document.open();
    printWindow.document.write(`<!doctype html>
      <html lang="ko">
        <head>
          <meta charset="utf-8" />
          <title>${escapePrintHtml(document.title)} - 인쇄</title>
          <style>
            * { box-sizing: border-box; }
            body { margin: 0; background: #fff; color: #111827; font-family: "Malgun Gothic", "Apple SD Gothic Neo", sans-serif; }
            .page { width: 210mm; min-height: 297mm; margin: 0 auto; padding: 17mm 16mm; }
            header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; padding-bottom: 14px; border-bottom: 2px solid #111827; }
            .brand { font-size: 19px; font-weight: 900; letter-spacing: 0.22em; }
            .heading { flex: 1; text-align: center; }
            .heading p { margin: 0 0 7px; color: #64748b; font-size: 12px; font-weight: 700; }
            .heading h1 { margin: 0; font-size: 25px; line-height: 1.35; }
            .status { border: 1px solid #86efac; border-radius: 999px; background: #ecfdf3; color: #047857; padding: 7px 11px; font-size: 12px; font-weight: 800; white-space: nowrap; }
            .meta { display: grid; grid-template-columns: repeat(4, 1fr); margin-top: 16px; border: 1.5px solid #334155; }
            .meta div { min-height: 54px; padding: 9px 10px; border-right: 1px solid #64748b; }
            .meta div:last-child { border-right: 0; }
            .meta span, .field span, .approval-cell span { display: block; margin-bottom: 5px; color: #64748b; font-size: 11px; font-weight: 700; }
            .meta strong, .field strong { font-size: 13px; font-weight: 700; white-space: pre-wrap; word-break: break-word; }
            .section { margin-top: 18px; }
            .section h2 { margin: 0 0 9px; font-size: 14px; font-weight: 900; }
            .approval { display: grid; grid-template-columns: repeat(${Math.max(document.approval_lines?.length || 1, 1)}, 1fr); border: 1.5px solid #334155; }
            .approval-cell { min-height: 75px; border-right: 1px solid #64748b; padding: 9px; text-align: center; }
            .approval-cell:last-child { border-right: 0; }
            .approval-cell strong { display: block; margin: 8px 0 7px; font-size: 13px; }
            .approval-cell em { display: inline-block; color: #047857; font-size: 11px; font-style: normal; font-weight: 800; }
            .approval-cell small { display: block; margin-top: 6px; color: #64748b; font-size: 10px; }
            .reference { border: 1px solid #475569; padding: 10px; font-size: 12px; }
            .fields { display: grid; grid-template-columns: repeat(2, 1fr); border-top: 1.5px solid #334155; border-left: 1.5px solid #334155; }
            .field { min-height: 58px; padding: 9px 10px; border-right: 1.5px solid #334155; border-bottom: 1.5px solid #334155; }
            .field.wide { grid-column: 1 / -1; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th { background: #f8fafc; font-weight: 800; }
            th, td { border: 1.5px solid #334155; padding: 8px; text-align: left; word-break: break-word; }
            .attachments { margin: 0; padding: 0; list-style: none; border: 1.5px solid #334155; }
            .attachments li { display: flex; justify-content: space-between; gap: 16px; padding: 9px 10px; border-bottom: 1px solid #64748b; font-size: 12px; }
            .attachments li:last-child { border-bottom: 0; }
            .attachments .empty { color: #64748b; }
            footer { margin-top: 22px; padding-top: 10px; border-top: 1px solid #64748b; color: #475569; font-size: 10px; }
            .keep-together { break-inside: avoid; page-break-inside: avoid; }
            @page { size: A4; margin: 0; }
            @media print { .page { margin: 0; } }
          </style>
        </head>
        <body>
          <main class="page">
            <header>
              <div class="brand">ZETA</div>
              <div class="heading">
                <p>${escapePrintHtml(document.template_title)}</p>
                <h1>${escapePrintHtml(document.title)}</h1>
              </div>
              <div class="status">승인 완료</div>
            </header>
            <section class="meta keep-together">
              <div><span>작성자</span><strong>${escapePrintHtml(document.requester_name)}</strong></div>
              <div><span>소속</span><strong>${escapePrintHtml(document.requester_team || "-")}</strong></div>
              <div><span>작성일</span><strong>${escapePrintHtml(formatDate(document.submitted_at))}</strong></div>
              <div><span>승인 완료일</span><strong>${escapePrintHtml(formatDate(document.completed_at))}</strong></div>
            </section>
            <section class="section keep-together">
              <h2>결재선</h2>
              <div class="approval">${approvalMarkup}</div>
            </section>
            <section class="section keep-together">
              <h2>참조</h2>
              <div class="reference">${referenceMarkup}</div>
            </section>
            <section class="section">
              <h2>문서 내용</h2>
              <div class="fields">${fieldsMarkup}</div>
            </section>
            ${tablesMarkup}
            <section class="section keep-together">
              <h2>첨부파일 목록</h2>
              <ul class="attachments">${attachmentMarkup}</ul>
            </section>
            <footer>출력일: ${escapePrintHtml(printDate)} / 본 출력물은 ZETA 업무통합시스템의 승인 완료 문서를 기준으로 생성되었습니다.</footer>
          </main>
        </body>
      </html>`);
    printWindow.document.close();
    printWindow.focus();
    window.setTimeout(() => printWindow.print(), 250);
  }

  const currentPendingLine = selectedDocument ? getFirstPendingLine(selectedDocument) : null;
  const canAct =
    selectedDocument?.status === "pending" && isCurrentApprovalLine(currentPendingLine);
  const renderProgressNotice = (document: ApprovalDocumentRow) => {
    const pendingLine = getFirstPendingLine(document);
    const awaitingMyApproval = document.status === "pending" && isCurrentApprovalLine(pendingLine);
    const headline =
      document.status === "approved"
        ? "최종 승인이 완료된 문서입니다."
        : document.status === "rejected"
          ? "반려 처리된 문서입니다."
          : awaitingMyApproval
            ? "현재 내 결재 처리가 필요합니다."
            : pendingLine
              ? `현재 ${pendingLine.approver_name}님의 결재를 기다리고 있습니다.`
              : "결재가 진행 중인 문서입니다.";
    const description =
      document.status === "approved"
        ? "완료된 문서의 첨부파일은 추가하거나 변경할 수 없습니다."
        : document.status === "rejected"
          ? "반려된 문서는 첨부파일을 추가하거나 변경할 수 없습니다."
          : awaitingMyApproval
            ? `${pendingLine?.role_label || "결재"} 단계의 승인 또는 반려를 진행해 주세요.`
            : pendingLine
              ? `${pendingLine.role_label} 단계가 완료되면 다음 결재로 진행됩니다.`
              : "결재선 진행 상태를 확인해 주세요.";

    return (
      <div
        style={{
          ...styles.progressNotice,
          ...(document.status === "approved"
            ? styles.progressNoticeApproved
            : document.status === "rejected"
              ? styles.progressNoticeRejected
              : awaitingMyApproval
                ? styles.progressNoticeAction
                : {}),
        }}
      >
        <strong>{headline}</strong>
        <span>{description}</span>
      </div>
    );
  };
  const renderApprovalFlow = (document: ApprovalDocumentRow) => {
    const lines = getSortedApprovalLines(document);
    const pendingLine = getFirstPendingLine(document);
    if (lines.length === 0) return null;

    return (
      <div style={styles.approvalFlowBox}>
        <div style={styles.approvalFlowHeader}>
          <strong>결재 진행 라인</strong>
          <span>{progressText(document)}</span>
        </div>
        <div style={{ ...styles.approvalFlow, ...(isMobile ? styles.approvalFlowMobile : {}) }}>
          {lines.map((line, index) => {
            const current = document.status === "pending" && pendingLine?.id === line.id;
            const approved = line.status === "approved";
            const rejected = line.status === "rejected";

            return (
              <div key={line.id} style={styles.approvalFlowStepWrap}>
                <div
                  style={{
                    ...styles.approvalFlowStep,
                    ...(approved ? styles.approvalFlowStepApproved : {}),
                    ...(rejected ? styles.approvalFlowStepRejected : {}),
                    ...(current ? styles.approvalFlowStepCurrent : {}),
                  }}
                >
                  <span>{index + 1}차</span>
                  <strong>{line.approver_name}</strong>
                  <em style={styles.approvalFlowStatus}>
                    {approved ? "승인" : rejected ? "반려" : current ? "진행중" : "대기"}
                  </em>
                </div>
                {index < lines.length - 1 && <i style={styles.approvalFlowArrow}>→</i>}
              </div>
            );
          })}
        </div>
      </div>
    );
  };
  const renderDocumentButton = (document: ApprovalDocumentRow) => {
    const active = selectedDocument?.id === document.id;
    const pendingLine = getFirstPendingLine(document);
    const awaitingMyApproval = document.status === "pending" && isCurrentApprovalLine(pendingLine);

    return (
      <button
        key={document.id}
        type="button"
        style={{
          ...styles.documentButton,
          ...(active ? styles.documentButtonActive : {}),
        }}
        onClick={() => {
          setSelectedDocumentId(document.id);
          setDetailModalDocumentId(document.id);
        }}
      >
        <span style={styles.documentTopLine}>
          <strong style={styles.documentTitleText}>{document.title}</strong>
          <em
            style={{
              ...styles.statusBadge,
              ...(document.status === "approved"
                ? styles.statusBadgeApproved
                : document.status === "rejected"
                  ? styles.statusBadgeRejected
                  : awaitingMyApproval
                    ? styles.statusBadgeAction
                    : {}),
            }}
          >
            {awaitingMyApproval ? "결재 필요" : statusText(document.status)}
          </em>
        </span>
        <span style={styles.documentMeta}>
          {document.requester_name}
        </span>
      </button>
    );
  };
  const renderAttachments = (document: ApprovalDocumentRow) => {
    const rows = getDocumentAttachments(document.id);
    const canAdd = document.status === "pending" && isCurrentRequester(document);
    const canRemove = canAdd;

    return (
      <section style={styles.attachmentDetailBox}>
        <div style={styles.attachmentHeader}>
          <strong>첨부파일</strong>
          <span>{rows.length}개</span>
        </div>
        {document.status !== "pending" && (
          <p style={styles.attachmentLockedNotice}>
            {document.status === "approved"
              ? "승인 완료 문서의 첨부파일은 추가하거나 변경할 수 없습니다."
              : "반려 문서의 첨부파일은 추가하거나 변경할 수 없습니다."}
          </p>
        )}
        {rows.length === 0 ? (
          <p style={styles.attachmentEmpty}>등록된 첨부파일이 없습니다.</p>
        ) : (
          <div style={styles.attachmentList}>
            {rows.map((attachment) => (
              <div key={attachment.id} style={styles.attachmentItem}>
                <div style={styles.attachmentFileInfo}>
                  <strong>{attachment.original_name}</strong>
                  <span>{formatFileSize(attachment.size_bytes)}</span>
                </div>
                <div style={styles.attachmentActions}>
                  <button
                    type="button"
                    style={styles.ghostButton}
                    disabled={attachmentBusy}
                    onClick={() => downloadAttachment(attachment)}
                  >
                    다운로드
                  </button>
                  {canRemove && (
                    <button
                      type="button"
                      style={styles.smallDangerButton}
                      disabled={attachmentBusy}
                      onClick={() => deleteAttachment(attachment)}
                    >
                      삭제
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {canAdd && attachmentFeatureReady && rows.length < MAX_ATTACHMENT_COUNT && (
          <label style={styles.attachmentAddButton}>
            파일 추가
            <input
              type="file"
              multiple
              accept={APPROVAL_ATTACHMENT_ACCEPT}
              style={styles.hiddenFileInput}
              disabled={attachmentBusy}
              onChange={(event) => addFilesToExistingDocument(document, event)}
            />
          </label>
        )}
      </section>
    );
  };

  return (
    <>
      {nexusDocument && <NexusNavigation active="document" />}
      <section
        className={nexusDocument ? nexusNavigationStyles.content : undefined}
        style={styles.page}
      >
      {nexusDocument && (
        <>
          <div style={styles.nexusAppBar}>
            <div>
              <strong style={styles.nexusAppBarTitle}>
                {nexusWorkOrderMode ? "NEXUS 작업지시" : "NEXUS 전자결재"} - {nexusDocument.title}
              </strong>
            </div>
            <a href="/nexus" style={styles.nexusBackLink}>
              문서 선택으로 돌아가기
            </a>
          </div>
          <div style={styles.nexusApprovalGuide}>
            {nexusWorkOrderMode ? (
              <>
                <strong>작업지시서 운영 방식</strong>
                <span>생산본부장이 작업 내용을 발행하면 작업지시방이 자동 생성됩니다.</span>
                <span>결재선은 없으며 기술1팀·기술2팀과 국내/해외 선택에 따른 영업 담당자가 자동 참여합니다.</span>
              </>
            ) : (
              <>
                <strong>결재 진행 방식</strong>
                <span>문서 제출 → 1차 결재자 승인 → 다음 결재자 알림 → 최종 승인 및 완료 PDF 보관</span>
                <span>현재 순서의 결재자만 승인·반려할 수 있으며, 한 명이 반려하면 문서는 즉시 전체 반려됩니다.</span>
                <span>보류 기능은 현재 적용하지 않으며 반려 사유를 남긴 뒤 새 문서로 재상신하는 방식입니다.</span>
              </>
            )}
          </div>
        </>
      )}
      {!nexusDocument && (
        <div
          style={{
            ...styles.summaryGrid,
            ...(isMobile ? styles.summaryGridMobile : {}),
          }}
        >
          <div style={{ ...styles.summaryCard, ...(isMobile ? styles.summaryCardMobile : {}) }}>
            <span style={styles.summaryLabel}>내 결재 대기</span>
            <strong style={styles.summaryValue}>{pendingForMe.length}건</strong>
          </div>
          <div style={{ ...styles.summaryCard, ...(isMobile ? styles.summaryCardMobile : {}) }}>
            <span style={styles.summaryLabel}>읽지 않은 알림</span>
            <strong style={styles.summaryValue}>{notifications.length}건</strong>
          </div>
          <div style={{ ...styles.summaryCard, ...(isMobile ? styles.summaryCardMobile : {}) }}>
            <span style={styles.summaryLabel}>완료 히스토리</span>
            <strong style={styles.summaryValue}>
              {completedForMe.length}건
            </strong>
          </div>
        </div>
      )}

      {setupError && (
        <div style={styles.setupBox}>
          <strong>DB 준비 필요</strong>
          <span>{setupError}</span>
        </div>
      )}

      {message && <div style={styles.messageBox}>{message}</div>}

      <div
        style={{
          ...styles.layout,
          ...(nexusDocument ? styles.nexusLayout : {}),
          ...(isMobile ? styles.layoutMobile : {}),
        }}
      >
        <section
          style={{
            ...styles.formPanel,
            ...(nexusDocument ? styles.nexusFormPanel : {}),
            ...(isMobile ? styles.panelMobile : {}),
          }}
        >
          <div
            style={{
              ...styles.panelTitleRow,
              ...(isMobile ? styles.panelTitleRowMobile : {}),
            }}
          >
            <div>
              <h2 style={styles.panelTitle}>{selectedTemplate.title}</h2>
              <p style={styles.panelSubText}>
                {nexusSubmissionLocked
                  ? nexusWorkOrderMode
                    ? "기존 작업지시서 양식 기준으로 작성할 수 있습니다. 발행 시 작업지시방이 자동 생성됩니다."
                    : "기존 양식 기준으로 작성할 수 있습니다. 결재 정책 확정 전에는 실제 상신되지 않습니다."
                  : "기존 양식의 입력 항목을 웹 입력 흐름으로 정리했습니다."}
              </p>
            </div>
            <button
              type="button"
              style={{
                ...styles.primaryButton,
                ...(nexusSubmissionLocked || isMobile ? styles.primaryButtonDisabled : {}),
              }}
              onClick={submitDocument}
              disabled={saving || Boolean(setupError) || nexusSubmissionLocked || isMobile}
            >
              {isMobile
                ? "PC에서 작성 가능"
                : saving
                ? "처리중"
                : nexusWorkOrderMode
                  ? "작업지시 발행"
                : nexusSubmissionLocked
                  ? nexusWorkOrderMode
                    ? "발행 정책 설정 필요"
                    : "결재 정책 설정 필요"
                  : "결재 등록"}
            </button>
          </div>

          {!nexusDocument && <section style={styles.templateStripBox}>
            <div
              style={{
                ...styles.panelTitleRow,
                ...(isMobile ? styles.panelTitleRowMobile : {}),
              }}
            >
              <h3 style={styles.sectionTitle}>양식 선택</h3>
              <button type="button" style={styles.ghostButton} onClick={loadData}>
                새로고침
              </button>
            </div>
            <div style={styles.templateRows}>
              {templateRows.map((row, rowIndex) => (
                <div
                  key={rowIndex}
                  style={{
                    ...styles.templateRow,
                    ...(isMobile ? styles.templateRowMobile : {}),
                  }}
                >
                  {row.map((template, templateIndex) => {
                    const active = template.key === selectedTemplate.key;

                    return (
                      <button
                        key={template.key}
                        type="button"
                        style={{
                          ...styles.templateButton,
                          ...(isMobile ? styles.templateButtonMobile : {}),
                          ...(templateIndex === manufacturingTemplateKeys.length - 1
                            ? styles.templateGroupBreak
                            : {}),
                          ...(active ? styles.templateButtonActive : {}),
                        }}
                        onClick={() => changeTemplate(template.key)}
                      >
                        <span style={styles.templateCategory}>{template.category}</span>
                        <strong>{template.title}</strong>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </section>}

          {nexusSubmissionLocked && nexusDocument && (
            <section style={styles.nexusPolicyBox}>
              <strong>{nexusDocument.title} 작성 화면 준비 완료</strong>
              <span>
                {nexusWorkOrderMode
                  ? "문서 작성 화면은 사용할 수 있으며, 기본 참조자와 저장 위치를 확정한 뒤 PDF 생성·생산부 채팅방 공유·발행 기능을 연결합니다."
                  : "문서 작성 화면은 사용할 수 있으며, 문서번호와 결재 참여자, 저장 위치를 확정한 뒤 PDF 생성·결재방 생성·상신 기능을 연결합니다."}
              </span>
            </section>
          )}

          {!nexusDocument && legacyTemplateKeys.includes(selectedTemplate.key) && (
            <section style={styles.inputModeBox}>
              <div>
                <h3 style={styles.sectionTitle}>
                  {selectedTemplate.key === "manufacturing_request" ? "현황판 자동 등록" : "입력 방식"}
                </h3>
                <p style={styles.panelSubText}>
                  {selectedTemplate.key === "manufacturing_request"
                    ? "제조요구서를 상신하면 입력한 수주 정보로 메인 현황판에 새 건이 자동 생성됩니다."
                    : "기존 엑셀 양식에 가까운 구형양식과 웹 입력 중심의 신규양식 중 선택합니다."}
                </p>
              </div>
              <div style={styles.inputModeActions}>
                {[
                  ["legacy", "구형양식 입력"],
                  ["modern", "신규양식 입력"],
                ].map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    style={{
                      ...styles.modeButton,
                      ...(inputMode === mode ? styles.modeButtonActive : {}),
                    }}
                    onClick={() => setInputMode(mode as InputMode)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </section>
          )}

          {shouldSelectEquipmentOrder && (
            <section style={styles.orderReferenceBox}>
              <div
                style={{
                  ...styles.panelTitleRow,
                  ...(isMobile ? styles.panelTitleRowMobile : {}),
                }}
              >
                <div>
                  <h3 style={styles.sectionTitle}>수주 건 연결</h3>
                  <p style={styles.panelSubText}>
                    최종 승인 시 메인 현황판의 해당 단계 날짜가 자동 반영됩니다.
                  </p>
                </div>
              </div>
              <select
                style={styles.input}
                value={selectedEquipmentOrderId}
                onChange={(event) => handleEquipmentOrderChange(event.target.value)}
              >
                <option value="">연결하지 않음</option>
                {linkableEquipmentOrders.map((order) => (
                  <option key={order.id} value={order.id}>
                    {getEquipmentOrderLabel(order)}
                  </option>
                ))}
              </select>
            </section>
          )}

          {!nexusSubmissionLocked && !nexusWorkOrderMode && <section
            style={{
              ...styles.approvalLineBoxTop,
              ...(nexusDocument ? styles.nexusApprovalLineBox : {}),
            }}
          >
            <div
              style={{
                ...styles.panelTitleRow,
                ...(isMobile ? styles.panelTitleRowMobile : {}),
              }}
            >
              <h3 style={styles.sectionTitle}>결재라인 지정</h3>
              <button type="button" style={styles.ghostButton} onClick={addApproverSlot}>
                결재라인 추가
              </button>
            </div>
            <div
              style={{
                ...styles.approvalReferenceRow,
                ...(nexusDocument ? styles.nexusApprovalReferenceRow : {}),
                ...(isMobile ? styles.approvalReferenceRowMobile : {}),
              }}
            >
              <div style={styles.approverCompactArea}>
                <div style={styles.approvalLineGrid}>
                  {approverSlots.map((slot, index) => (
                    <label key={`${slot.roleLabel}-${index}`} style={styles.approverSlot}>
                      <span style={styles.approverLabel}>{slot.roleLabel}</span>
                      <div style={styles.approverControl}>
                        <select
                          style={styles.input}
                          value={slot.approverId}
                          onChange={(event) => selectApprover(index, event.target.value)}
                        >
                          <option value="">결재자 선택</option>
                          {sortedProfiles.map((profile) => (
                            <option key={profile.id} value={profile.id}>
                              {profile.name || "-"} / {getDisplayTeam(profile) || "-"}
                            </option>
                          ))}
                        </select>
                        {approverSlots.length > 1 && (
                          <button
                            type="button"
                            style={styles.removeLineButton}
                            onClick={() => removeApproverSlot(index)}
                            aria-label={`${slot.roleLabel} 삭제`}
                          >
                            삭제
                          </button>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div
                style={{
                  ...styles.referenceCompactArea,
                  ...(nexusDocument ? styles.nexusReferenceCompactArea : {}),
                }}
              >
                <div style={styles.referenceCompactHeader}>
                  <h3 style={styles.sectionTitle}>참조 인원</h3>
                  <button type="button" style={styles.ghostButton} onClick={addReference}>
                    참조 추가
                  </button>
                </div>

                {referenceIds.length === 0 ? (
                  <div style={styles.referenceEmpty}>참조 없음</div>
                ) : (
                  <div
                    style={{
                      ...styles.referenceGridCompact,
                      ...(nexusDocument ? styles.nexusReferenceGridCompact : {}),
                    }}
                  >
                    {referenceIds.map((profileId, index) => (
                      <label key={`reference-${index}`} style={styles.approverSlot}>
                        <span style={styles.approverLabel}>참조 {index + 1}</span>
                        <div style={styles.approverControl}>
                          <select
                            style={styles.input}
                            value={profileId}
                            onChange={(event) => selectReference(index, event.target.value)}
                          >
                            <option value="">참조자 선택</option>
                            {sortedProfiles.map((profile) => (
                              <option key={profile.id} value={profile.id}>
                                {profile.name || "-"} / {getDisplayTeam(profile) || "-"}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            style={styles.removeLineButton}
                            onClick={() => removeReference(index)}
                            aria-label={`참조 ${index + 1} 삭제`}
                          >
                            삭제
                          </button>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>}

          {selectedTemplate.key === "manufacturing_request" && inputMode === "legacy" ? (
            <LegacyManufacturingForm
              data={formData}
              isMobile={isMobile}
              onFieldChange={updateField}
            />
          ) : selectedTemplate.key === "work_order" && inputMode === "legacy" ? (
            <LegacyWorkOrderForm
              data={formData}
              isMobile={isMobile}
              onFieldChange={updateField}
            />
          ) : selectedTemplate.key === "purchase_resolution" &&
            inputMode === "legacy" &&
            selectedTemplate.tables[0] ? (
            <LegacyPurchaseResolutionForm
              data={formData}
              table={selectedTemplate.tables[0]}
              isMobile={isMobile}
              onFieldChange={updateField}
              onTableCellChange={updateTableCell}
              onAddRow={addTableRow}
            />
          ) : (selectedTemplate.key === "purchase_request" || selectedTemplate.key === "outsourcing_request") &&
            inputMode === "legacy" &&
            selectedTemplate.tables[0] ? (
            <LegacyPurchaseOutsourcingForm
              templateKey={selectedTemplate.key}
              data={formData}
              table={selectedTemplate.tables[0]}
              isMobile={isMobile}
              onFieldChange={updateField}
              onTableCellChange={updateTableCell}
              onAddRow={addTableRow}
            />
          ) : selectedTemplate.key === "inspection_request" && inputMode === "legacy" && selectedTemplate.tables[0] ? (
            <LegacyInspectionRequestForm
              data={formData}
              table={selectedTemplate.tables[0]}
              isMobile={isMobile}
              onFieldChange={updateField}
              onTableCellChange={updateTableCell}
              onAddRow={addTableRow}
              onRemoveRow={removeTableRow}
            />
          ) : (
            <>
              <div
                style={{
                  ...styles.formGrid,
                  ...(isMobile ? styles.formGridMobile : {}),
                }}
              >
                {selectedTemplate.fields.map((field) => {
                  const readOnlyField = ["applicant", "requester", "owner", "team"].includes(field.key);

                  return (
                    <label
                      key={field.key}
                      style={{
                        ...styles.field,
                        gridColumn: field.span === 2 ? "1 / -1" : undefined,
                      }}
                    >
                      <span>{field.label}</span>
                      {field.type === "textarea" ? (
                        <textarea
                          style={styles.textarea}
                          value={String(formData[field.key] || "")}
                          placeholder={field.placeholder}
                          onChange={(event) => updateField(field.key, event.target.value)}
                        />
                      ) : field.type === "select" ? (
                        <select
                          style={styles.input}
                          value={String(formData[field.key] || "")}
                          onChange={(event) => updateField(field.key, event.target.value)}
                        >
                          <option value="">선택</option>
                          {(field.options || []).map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          style={{
                            ...styles.input,
                            ...(readOnlyField ? styles.readOnlyInput : {}),
                          }}
                          type={field.type}
                          value={String(formData[field.key] || "")}
                          placeholder={field.placeholder}
                          list={field.key === "client" ? "approval-customer-options" : undefined}
                          readOnly={readOnlyField}
                          onChange={(event) => updateField(field.key, event.target.value)}
                        />
                      )}
                    </label>
                  );
                })}
              </div>

              <datalist id="approval-customer-options">
                {customerOptions.map((customer) => (
                  <option key={customer.id} value={customer.name} />
                ))}
              </datalist>

              {selectedTemplate.tables.map((table) => (
                <section key={table.key} style={styles.tableSection}>
                  <div style={styles.panelTitleRow}>
                    <h3 style={styles.sectionTitle}>{table.title}</h3>
                    <button type="button" style={styles.ghostButton} onClick={() => addTableRow(table)}>
                      행 추가
                    </button>
                  </div>

                  <div style={styles.tableWrap}>
                    <table style={styles.table}>
                      <thead>
                        <tr>
                          <th style={{ ...styles.th, width: "48px" }}>No</th>
                          {table.columns.map((column) => (
                            <th key={column.key} style={{ ...styles.th, width: column.width }}>
                              {column.label}
                            </th>
                          ))}
                          <th style={{ ...styles.th, width: "58px" }} />
                        </tr>
                      </thead>
                      <tbody>
                        {getRows(formData[table.key]).map((row, rowIndex) => (
                          <tr key={rowIndex}>
                            <td style={styles.td}>{rowIndex + 1}</td>
                            {table.columns.map((column) => (
                              <td key={column.key} style={styles.td}>
                                <input
                                  style={styles.tableInput}
                                  value={row[column.key] || ""}
                                  onChange={(event) =>
                                    updateTableCell(table, rowIndex, column.key, event.target.value)
                                  }
                                />
                              </td>
                            ))}
                            <td style={styles.td}>
                              <button
                                type="button"
                                style={styles.smallDangerButton}
                                onClick={() => removeTableRow(table, rowIndex)}
                              >
                                삭제
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))}
            </>
          )}

          <section style={styles.attachmentUploadBox}>
            <div style={styles.attachmentHeader}>
              <div>
                <h3 style={styles.sectionTitle}>파일 첨부</h3>
                <p style={styles.panelSubText}>엑셀, PDF, 이미지, DWG/DXF, ZIP 파일 · 파일당 최대 30MB · 최대 10개</p>
              </div>
              {attachmentFeatureReady && (
                <label style={styles.attachmentAddButton}>
                  파일 선택
                  <input
                    type="file"
                    multiple
                    accept={APPROVAL_ATTACHMENT_ACCEPT}
                    style={styles.hiddenFileInput}
                    disabled={saving}
                    onChange={handlePendingAttachmentChange}
                  />
                </label>
              )}
            </div>
            {!attachmentFeatureReady ? (
              <p style={styles.attachmentNotice}>
                파일 첨부 기능은 저장소 설정 SQL 적용 후 사용할 수 있습니다. 기존 결재 등록은 그대로 이용할 수 있습니다.
              </p>
            ) : pendingAttachmentFiles.length === 0 ? (
              <p style={styles.attachmentEmpty}>상신할 파일을 선택해 주세요.</p>
            ) : (
              <div style={styles.attachmentList}>
                {pendingAttachmentFiles.map((file, index) => (
                  <div key={`${file.name}-${file.lastModified}-${index}`} style={styles.attachmentItem}>
                    <div style={styles.attachmentFileInfo}>
                      <strong>{file.name}</strong>
                      <span>{formatFileSize(file.size)}</span>
                    </div>
                    <button
                      type="button"
                      style={styles.smallDangerButton}
                      onClick={() =>
                        setPendingAttachmentFiles((prev) =>
                          prev.filter((_, currentIndex) => currentIndex !== index)
                        )
                      }
                    >
                      제거
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

        </section>

        {!nexusDocument && (
          <aside
            style={{
              ...styles.documentPanel,
              ...(isMobile ? styles.panelMobile : {}),
            }}
          >
          <div
            style={{
              ...styles.panelTitleRow,
              ...(isMobile ? styles.panelTitleRowMobile : {}),
            }}
          >
            <h2 style={styles.panelTitle}>문서함</h2>
            <div style={styles.panelTitleActions}>
              <button type="button" style={styles.exportButton} onClick={exportApprovalList}>
                목록
              </button>
              <button type="button" style={styles.exportButton} onClick={exportApprovalForms}>
                양식
              </button>
              <span style={styles.countText}>{loading ? "불러오는 중" : `${filteredDocuments.length}건`}</span>
            </div>
          </div>

          <div
            style={{
              ...styles.filterTabs,
              ...(isMobile ? styles.filterTabsMobile : {}),
            }}
          >
            {[
              { key: "mine", label: isAdmin ? "전체 문서" : "내 문서", count: myDocuments.length },
              { key: "pending", label: "결재 대기", count: pendingForMe.length },
              { key: "reference", label: "참조", count: referenceForMe.length },
              { key: "history", label: "완료", count: completedForMe.length },
            ].map(({ key, label, count }) => (
              <button
                key={key}
                type="button"
                style={{
                  ...styles.filterButton,
                  ...(activeFilter === key ? styles.filterButtonActive : {}),
                }}
                onClick={() => setActiveFilter(key as typeof activeFilter)}
              >
                <span>{label}</span>
                <small>{count}</small>
              </button>
            ))}
          </div>

          <input
            type="search"
            value={documentSearchQuery}
            onChange={(event) => setDocumentSearchQuery(event.target.value)}
            placeholder="문서명, 작성자, 고객사, 장비명, S/N 검색"
            style={styles.documentSearchInput}
          />

          <button
            type="button"
            style={{
              ...styles.documentFilterToggle,
              ...(hasDetailedFilters ? styles.documentFilterToggleActive : {}),
            }}
            onClick={() => setShowDocumentFilters((prev) => !prev)}
          >
            <span>상세 필터 {hasDetailedFilters ? "적용 중" : ""}</span>
            <strong>{showDocumentFilters ? "접기" : "펼치기"}</strong>
          </button>

          {showDocumentFilters && <section style={styles.documentFilterPanel}>
            <div style={styles.documentFilterHeader}>
              <strong>상세 필터</strong>
              {hasDetailedFilters && (
                <button
                  type="button"
                  style={styles.filterResetButton}
                  onClick={() => {
                    setDocumentTemplateFilter("all");
                    setDocumentStatusFilter("all");
                    setDocumentRequesterFilter("all");
                    setDocumentDateFrom("");
                    setDocumentDateTo("");
                    setDocumentsWithAttachmentsOnly(false);
                  }}
                >
                  초기화
                </button>
              )}
            </div>
            <div style={styles.documentFilterGrid}>
              <label style={styles.documentFilterField}>
                <span>양식</span>
                <select
                  style={styles.documentFilterControl}
                  value={documentTemplateFilter}
                  onChange={(event) => setDocumentTemplateFilter(event.target.value)}
                >
                  <option value="all">전체</option>
                  {templates.map((template) => (
                    <option key={template.key} value={template.key}>{template.title}</option>
                  ))}
                </select>
              </label>
              <label style={styles.documentFilterField}>
                <span>상태</span>
                <select
                  style={styles.documentFilterControl}
                  value={documentStatusFilter}
                  onChange={(event) => setDocumentStatusFilter(event.target.value as DocumentStatusFilter)}
                >
                  <option value="all">전체</option>
                  <option value="pending">진행중</option>
                  <option value="approved">승인완료</option>
                  <option value="rejected">반려</option>
                </select>
              </label>
              <label style={{ ...styles.documentFilterField, ...styles.documentFilterFieldWide }}>
                <span>작성자</span>
                <select
                  style={styles.documentFilterControl}
                  value={documentRequesterFilter}
                  onChange={(event) => setDocumentRequesterFilter(event.target.value)}
                >
                  <option value="all">전체 작성자</option>
                  {requesterFilterOptions.map((requesterName) => (
                    <option key={requesterName} value={requesterName}>{requesterName}</option>
                  ))}
                </select>
              </label>
              <label style={styles.documentFilterField}>
                <span>작성일 시작</span>
                <input
                  style={styles.documentFilterControl}
                  type="date"
                  value={documentDateFrom}
                  onChange={(event) => setDocumentDateFrom(event.target.value)}
                />
              </label>
              <label style={styles.documentFilterField}>
                <span>작성일 종료</span>
                <input
                  style={styles.documentFilterControl}
                  type="date"
                  value={documentDateTo}
                  onChange={(event) => setDocumentDateTo(event.target.value)}
                />
              </label>
            </div>
            <label style={styles.attachmentOnlyFilter}>
              <input
                type="checkbox"
                checked={documentsWithAttachmentsOnly}
                onChange={(event) => setDocumentsWithAttachmentsOnly(event.target.checked)}
              />
              첨부파일이 있는 문서만 보기
            </label>
          </section>}

          <div
            style={{
              ...styles.documentList,
              ...(isMobile ? styles.documentListMobile : {}),
            }}
          >
            {filteredDocuments.length === 0 ? (
              <div style={styles.emptyBox}>표시할 문서가 없습니다.</div>
            ) : activeFilter === "history" ? (
              historyMonthGroups.map(({ monthKey, rows }) => {
                const expanded = expandedHistoryMonths.includes(monthKey);

                return (
                  <section key={monthKey} style={styles.historyMonthGroup}>
                    <button
                      type="button"
                      style={styles.historyMonthHeader}
                      onClick={() =>
                        setExpandedHistoryMonths((prev) =>
                          prev.includes(monthKey)
                            ? prev.filter((item) => item !== monthKey)
                            : [...prev, monthKey]
                        )
                      }
                    >
                      <span>{formatMonthLabel(monthKey)}</span>
                      <strong>{rows.length}건</strong>
                      <em>{expanded ? "접기" : "펼치기"}</em>
                    </button>

                    {expanded && (
                      <div style={styles.historyMonthList}>
                        {rows.map((document) => renderDocumentButton(document))}
                      </div>
                    )}
                  </section>
                );
              })
            ) : (
              filteredDocuments.map((document) => renderDocumentButton(document))
            )}
          </div>

          </aside>
        )}
      </div>

      {detailModalDocument && (
        <div style={styles.modalOverlay} onClick={() => setDetailModalDocumentId(null)}>
          <section
            style={{
              ...styles.modalPanel,
              ...(isMobile ? styles.modalPanelMobile : {}),
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div style={styles.modalHeader}>
              <div>
                <span style={styles.templateCategory}>{detailModalDocument.template_title}</span>
                <h3 style={styles.detailTitle}>{detailModalDocument.title}</h3>
              </div>
              <div style={styles.modalHeaderActions}>
                {detailModalDocument.status === "approved" && (
                  <button
                    type="button"
                    style={styles.printButton}
                    onClick={() => printApprovedDocument(detailModalDocument)}
                  >
                    인쇄 / PDF 저장
                  </button>
                )}
                <button
                  type="button"
                  style={styles.ghostButton}
                  onClick={() => setDetailModalDocumentId(null)}
                >
                  닫기
                </button>
              </div>
            </div>

            <div style={{ ...styles.modalMetaGrid, ...(isMobile ? styles.modalMetaGridMobile : {}) }}>
              <div>
                <span>작성자</span>
                <strong>{detailModalDocument.requester_name}</strong>
              </div>
              <div>
                <span>작성일</span>
                <strong>{formatDate(detailModalDocument.submitted_at)}</strong>
              </div>
              <div>
                <span>상태</span>
                <strong>{statusText(detailModalDocument.status)}</strong>
              </div>
            </div>

            {renderProgressNotice(detailModalDocument)}

            {renderApprovalFlow(detailModalDocument)}

            <div style={{ ...styles.documentFieldGrid, ...(isMobile ? styles.documentFieldGridMobile : {}) }}>
              {(templateMap[detailModalDocument.template_key]?.fields || []).map((field) => (
                <div
                  key={field.key}
                  style={{
                    ...styles.documentFieldItem,
                    ...(field.span === 2 ? styles.documentFieldItemWide : {}),
                  }}
                >
                  <span>{field.label}</span>
                  <strong>{formatDocumentValue(detailModalDocument.form_data[field.key])}</strong>
                </div>
              ))}
            </div>

            {renderAttachments(detailModalDocument)}

            {canAct && detailModalDocument.id === selectedDocument?.id && (
              <div style={styles.actionRow}>
                <button
                  type="button"
                  style={styles.primaryButton}
                  onClick={approveSelectedDocument}
                  disabled={saving}
                >
                  승인
                </button>
                <button
                  type="button"
                  style={styles.dangerButton}
                  onClick={rejectSelectedDocument}
                  disabled={saving}
                >
                  반려
                </button>
              </div>
            )}
            {isAdmin && detailModalDocument.id === selectedDocument?.id && (
              <div style={styles.actionRow}>
                <button
                  type="button"
                  style={styles.dangerButton}
                  onClick={deleteSelectedDocument}
                  disabled={saving}
                >
                  관리자 삭제
                </button>
              </div>
            )}

            {(templateMap[detailModalDocument.template_key]?.tables || []).map((table) => {
              const rows = getRows(detailModalDocument.form_data[table.key]);
              if (rows.length === 0) return null;

              return (
                <div key={table.key} style={styles.documentTableBox}>
                  <h4 style={styles.documentTableTitle}>{table.title}</h4>
                  <div style={styles.documentTableWrap}>
                    <table style={styles.documentTable}>
                      <thead>
                        <tr>
                          {table.columns.map((column) => (
                            <th key={column.key}>{column.label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row, rowIndex) => (
                          <tr key={rowIndex}>
                            {table.columns.map((column) => (
                              <td key={column.key}>{formatDocumentValue(row[column.key])}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </section>
        </div>
      )}
      </section>
    </>
  );
}

type LegacyManufacturingFormProps = {
  data: Record<string, unknown>;
  isMobile: boolean;
  onFieldChange: (key: string, value: string) => void;
};

function LegacyWorkOrderForm({
  data,
  isMobile,
  onFieldChange,
}: {
  data: Record<string, unknown>;
  isMobile: boolean;
  onFieldChange: (key: string, value: string) => void;
}) {
  const value = (key: string) => String(data[key] || "");
  const inputFor = (key: string, type = "text") => (
    <input
      type={type}
      style={styles.workOrderInput}
      value={value(key)}
      onChange={(event) => onFieldChange(key, event.target.value)}
    />
  );
  const selectFor = (key: string, options: string[]) => (
    <select
      style={styles.workOrderInput}
      value={value(key)}
      onChange={(event) => onFieldChange(key, event.target.value)}
    >
      <option value="">선택</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
  const textareaFor = (key: string, rows: number) => (
    <textarea
      style={{ ...styles.workOrderTextarea, minHeight: `${rows * 30}px` }}
      value={value(key)}
      onChange={(event) => onFieldChange(key, event.target.value)}
    />
  );

  return (
    <section style={styles.legacySheet}>
      <div
        style={{
          ...styles.legacyPaper,
          ...styles.workOrderPaper,
          ...(isMobile ? styles.legacyPaperMobile : {}),
        }}
      >
        <div style={styles.workOrderHeader}>
          <div style={styles.workOrderTitleArea}>
            <h3 style={styles.workOrderTitle}>작 업 지 시 서</h3>
            <label style={styles.workOrderDate}>
              {inputFor("issueDate", "date")}
            </label>
          </div>
          <div style={styles.workOrderIssuer}>
            <span style={styles.workOrderIssuerTeam}>생산본부</span>
            <strong style={styles.workOrderIssuerName}>
              {value("requester") || "발행자"}
            </strong>
          </div>
        </div>

        <div style={styles.workOrderMetaGrid}>
          <span style={styles.workOrderLabel}>영업구분</span>
          <div style={styles.workOrderValue}>{selectFor("marketType", ["국내", "해외"])}</div>
          <span style={styles.workOrderLabel}>발행일</span>
          <div style={styles.workOrderValue}>{inputFor("issueDate", "date")}</div>
          <span style={styles.workOrderLabel}>작성자</span>
          <div style={styles.workOrderValue}>{inputFor("requester")}</div>

          <span style={styles.workOrderLabel}>제품명</span>
          <div style={styles.workOrderValue}>{inputFor("productName")}</div>
          <span style={styles.workOrderLabel}>수량</span>
          <div style={styles.workOrderValue}>{inputFor("qty")}</div>
          <span style={styles.workOrderLabel}>발주처</span>
          <div style={styles.workOrderValue}>{inputFor("client")}</div>

          <span style={styles.workOrderLabel}>납품일</span>
          <div style={{ ...styles.workOrderValue, gridColumn: "span 3" }}>
            {inputFor("deliveryDate", "date")}
          </div>
          <span style={styles.workOrderLabel}>Serial No</span>
          <div style={styles.workOrderValue}>{inputFor("serialNo")}</div>

          <span style={styles.workOrderLabel}>검수예정일</span>
          <div style={{ ...styles.workOrderValue, gridColumn: "span 3" }}>
            {inputFor("inspectionDate", "date")}
          </div>
          <span style={styles.workOrderLabel}>제조완료예정일</span>
          <div style={styles.workOrderValue}>
            {inputFor("manufacturingDate", "date")}
          </div>
        </div>

        <div style={styles.workOrderSpecTitle}>S P E C I F I C A T I O N</div>
        <div style={styles.workOrderSectionRow}>
          <span style={styles.workOrderTallLabel}>전 원</span>
          <div style={styles.workOrderValue}>{inputFor("power")}</div>
        </div>
        <div style={styles.workOrderSectionRow}>
          <span style={styles.workOrderTallLabel}>제품규격</span>
          <div style={styles.workOrderValue}>{textareaFor("productSpec", 4)}</div>
        </div>
        <div style={styles.workOrderSectionRow}>
          <span style={styles.workOrderTallLabel}>추가규격</span>
          <div style={styles.workOrderValue}>{textareaFor("additionalSpec", 4)}</div>
        </div>
        <div style={styles.workOrderSectionRow}>
          <span style={styles.workOrderTallLabel}>발 주 처<br />요구사항</span>
          <div style={styles.workOrderValue}>{textareaFor("clientRequirements", 4)}</div>
        </div>
        <div style={styles.workOrderSectionRow}>
          <span style={styles.workOrderTallLabel}>제 조 시<br />주의사항</span>
          <div style={styles.workOrderValue}>{textareaFor("manufacturingNotes", 4)}</div>
        </div>
        <div style={styles.workOrderSectionRow}>
          <span style={styles.workOrderTallLabel}>첨부서류</span>
          <div style={styles.workOrderValue}>{textareaFor("attachments", 3)}</div>
        </div>
      </div>
    </section>
  );
}

function LegacyManufacturingForm({
  data,
  isMobile,
  onFieldChange,
}: LegacyManufacturingFormProps) {
  const value = (key: string) => String(data[key] || "");
  const requestType = value("requestType") || "제조";

  return (
    <section style={{ ...styles.legacySheet, ...styles.manufacturingLegacySheet }}>
      <div style={{ ...styles.legacyTopNotice, ...styles.manufacturingTopNotice }}>
        <label style={styles.legacyMiniField}>
          <span>현황 구분</span>
          <select
            style={styles.legacyInput}
            value={value("orderCategory")}
            onChange={(event) => onFieldChange("orderCategory", event.target.value)}
          >
            <option value="">선택</option>
            <option value="국내 장비">국내 장비</option>
            <option value="해외 장비">해외 장비</option>
            <option value="부품">부품</option>
          </select>
        </label>
        <label style={styles.legacyMiniField}>
          <span>국가/구분</span>
          <input
            style={styles.legacyInput}
            value={value("country")}
            onChange={(event) => onFieldChange("country", event.target.value)}
          />
        </label>
        <label style={styles.legacyMiniField}>
          <span>수주일</span>
          <input
            type="date"
            style={styles.legacyInput}
            value={value("orderDate")}
            onChange={(event) => onFieldChange("orderDate", event.target.value)}
          />
        </label>
      </div>

      <div
        className="nexus-manufacturing-form"
        style={{
          ...styles.legacyPaper,
          ...styles.manufacturingLegacyPaper,
          ...(isMobile ? styles.legacyPaperMobile : {}),
        }}
      >
        <div style={styles.legacyHeaderSingle}>
          <div style={styles.legacyDocTitle}>
            {[
              ["제조", "제조"],
              ["협조", "협조"],
            ].map(([type, label]) => (
              <button
                key={type}
                type="button"
                style={styles.legacyCheckButton}
                onClick={() => onFieldChange("requestType", type)}
                aria-pressed={requestType === type}
              >
                <span
                  style={{
                    ...styles.legacyCheckBox,
                    ...(requestType === type ? styles.legacyCheckBoxActive : {}),
                  }}
                />
                {label}
              </button>
            ))}
            <span>요구서</span>
          </div>
        </div>

        <div style={styles.legacyCopyLabel}>( 영업부 보관용 )</div>

        <div style={styles.legacyGrid}>
          <label style={styles.legacyCell}>
            <span>제품명</span>
            <input
              style={styles.legacyInput}
              value={value("productName")}
              onChange={(event) => onFieldChange("productName", event.target.value)}
            />
          </label>
          <label style={styles.legacyCell}>
            <span>수 량</span>
            <input
              style={styles.legacyInput}
              value={value("qty")}
              onChange={(event) => onFieldChange("qty", event.target.value)}
            />
          </label>
          <label style={styles.legacyCell}>
            <span>작성일</span>
            <input
              type="date"
              style={styles.legacyInput}
              value={value("createdDate")}
              onChange={(event) => onFieldChange("createdDate", event.target.value)}
            />
          </label>
          <label style={{ ...styles.legacyCell, gridColumn: "span 2" }}>
            <span>발주처</span>
            <input
              style={styles.legacyInput}
              value={value("client")}
              onChange={(event) => onFieldChange("client", event.target.value)}
            />
          </label>
          <label style={styles.legacyCell}>
            <span>납 기(내)</span>
            <input
              type="date"
              style={styles.legacyInput}
              value={value("deliveryDate")}
              onChange={(event) => onFieldChange("deliveryDate", event.target.value)}
            />
          </label>
          <label style={{ ...styles.legacyCell, gridColumn: "span 2" }}>
            <span>문서 NO</span>
            <input
              style={styles.legacyInput}
              value={value("documentNo")}
              onChange={(event) => onFieldChange("documentNo", event.target.value)}
            />
          </label>
          <label style={styles.legacyCell}>
            <span>Serial No</span>
            <input
              style={styles.legacyInput}
              value={value("serialNo")}
              onChange={(event) => onFieldChange("serialNo", event.target.value)}
            />
          </label>
        </div>

        <div style={styles.legacySpecTitle}>S P E C I F I C A T I O N</div>
        <div style={styles.legacySpecRows}>
          <label style={styles.legacyWideRow}>
            <span>전 원</span>
            <input
              style={styles.legacyInput}
              value={value("power")}
              onChange={(event) => onFieldChange("power", event.target.value)}
            />
          </label>
          <label style={styles.legacyWideRow}>
            <span>제품규격</span>
            <textarea
              style={{ ...styles.legacyTextarea, ...styles.legacyProductSpecTextarea }}
              value={value("productSpec")}
              onChange={(event) => onFieldChange("productSpec", event.target.value)}
            />
          </label>
          <label style={styles.legacyWideRow}>
            <span>추가사항</span>
            <textarea
              style={styles.legacyTextarea}
              value={value("additional")}
              onChange={(event) => onFieldChange("additional", event.target.value)}
            />
          </label>
          <label style={styles.legacyWideRow}>
            <span>참고사항</span>
            <textarea
              style={styles.legacyTextarea}
              value={value("reference")}
              onChange={(event) => onFieldChange("reference", event.target.value)}
            />
          </label>
          <label style={styles.legacyWideRow}>
            <span>첨부 메모(기존)</span>
            <input
              style={styles.legacyInput}
              value={value("attachment")}
              onChange={(event) => onFieldChange("attachment", event.target.value)}
            />
          </label>
        </div>
        <style>{`
          .nexus-manufacturing-form input,
          .nexus-manufacturing-form textarea,
          .nexus-manufacturing-form select {
            border: 0 !important;
            border-radius: 0 !important;
            outline: 0;
            box-shadow: none;
          }
          .nexus-manufacturing-form textarea {
            padding: 14px 16px !important;
            line-height: 1.6 !important;
          }
          .nexus-manufacturing-form label > span {
            display: flex;
            align-items: center;
            min-height: 100%;
            padding: 0 14px;
            border-right: 1px solid #2d3748;
            background: #f8fafc;
            box-sizing: border-box;
          }
        `}</style>
      </div>
    </section>
  );
}

type LegacyPurchaseOutsourcingFormProps = {
  templateKey: string;
  data: Record<string, unknown>;
  table: TableDef;
  isMobile: boolean;
  onFieldChange: (key: string, value: string) => void;
  onTableCellChange: (table: TableDef, rowIndex: number, columnKey: string, value: string) => void;
  onAddRow: (table: TableDef) => void;
};

function LegacyPurchaseOutsourcingForm({
  templateKey,
  data,
  table,
  isMobile,
  onFieldChange,
  onTableCellChange,
  onAddRow,
}: LegacyPurchaseOutsourcingFormProps) {
  const value = (key: string) => String(data[key] || "");
  const isOutsourcing =
    templateKey === "outsourcing_request" || value("requestType") === "외주";
  const specColumn = isOutsourcing ? "drawingNo" : "spec";
  const specLabel = "규 격";
  const rows = getRows(data[table.key]);
  const totalQty = rows.reduce((sum, row) => {
    const quantity = Number(String(row.qty || "").replaceAll(",", ""));
    return sum + (Number.isFinite(quantity) ? quantity : 0);
  }, 0);
  const columns = [
    { key: "name", label: "품 명" },
    { key: specColumn, label: specLabel },
    { key: "unit", label: "단 위" },
    { key: "qty", label: "수 량" },
    { key: "memo", label: "비 고" },
  ];
  const usageOptions = ["원자재", "재공품", "공용품", "판매", "무상", "사무용품", "기타"];

  return (
    <section style={styles.legacySheet}>
      <div
        className="nexus-purchase-form"
        style={{
          ...styles.legacyPaper,
          ...styles.purchaseLegacyPaper,
          ...(isMobile ? styles.legacyPaperMobile : {}),
        }}
      >
        <div style={styles.purchaseLegacyHeader}>
          <div style={styles.purchaseLegacyTitle}>
            {[
              ["구매", "구매의뢰서"],
              ["외주", "외주의뢰서"],
            ].map(([type, label]) => (
              <button
                key={type}
                type="button"
                style={styles.legacyCheckButton}
                onClick={() => onFieldChange("requestType", type)}
              >
                <span
                  style={{
                    ...styles.legacyCheckBox,
                    ...(value("requestType") === type
                      ? styles.legacyCheckBoxActive
                      : {}),
                  }}
                />
                {label}
              </button>
            ))}
            <small style={styles.purchaseNumberPreview}>
              ⊙ 부서 관리 번호
              <b>{value("controlNo") || "제출 시 자동 발급"}</b>
            </small>
          </div>
          <table className="purchase-approval-table" style={styles.purchaseApprovalTable}>
            <tbody>
              <tr>
                <th rowSpan={2}>결<br />재</th>
                {["담 당", "팀 장", "본 부 장", "부 사 장", "대표이사"].map((role) => (
                  <th key={role}>{role}</th>
                ))}
              </tr>
              <tr>
                <td>{value("requester") || "작성자"}</td>
                <td />
                <td />
                <td />
                <td />
              </tr>
            </tbody>
          </table>
        </div>

        <table className="purchase-info-table" style={styles.purchaseInfoTable}>
          <colgroup>
            <col style={{ width: "16%" }} />
            <col style={{ width: "34%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "30%" }} />
          </colgroup>
          <tbody>
            <tr>
              <th>고 객 사 :</th>
              <td><input value={value("client")} onChange={(event) => onFieldChange("client", event.target.value)} /></td>
              <th colSpan={2}>의 뢰 인 :</th>
              <td><input value={value("requester")} readOnly /></td>
            </tr>
            <tr>
              <th>장 비 명 :</th>
              <td><input value={value("equipment")} onChange={(event) => onFieldChange("equipment", event.target.value)} /></td>
              <th colSpan={2}>입고장소 :</th>
              <td><input value={value("deliveryPlace")} onChange={(event) => onFieldChange("deliveryPlace", event.target.value)} /></td>
            </tr>
            <tr>
              <th>S / N :</th>
              <td><input value={value("serialNo")} onChange={(event) => onFieldChange("serialNo", event.target.value)} /></td>
              <th rowSpan={3}>비교<br />자료</th>
              <th>업 체 :</th>
              <td><input value={value("comparisonVendor")} onChange={(event) => onFieldChange("comparisonVendor", event.target.value)} /></td>
            </tr>
            <tr>
              <th>의 뢰 일 :</th>
              <td><input type="date" value={value("requestDate")} onChange={(event) => onFieldChange("requestDate", event.target.value)} /></td>
              <th>장비명 :</th>
              <td><input value={value("comparisonEquipment")} onChange={(event) => onFieldChange("comparisonEquipment", event.target.value)} /></td>
            </tr>
            <tr>
              <th>입고요청일 :</th>
              <td><input type="date" value={value("dueDate")} onChange={(event) => onFieldChange("dueDate", event.target.value)} /></td>
              <th>S / N :</th>
              <td><input value={value("comparisonSerialNo")} onChange={(event) => onFieldChange("comparisonSerialNo", event.target.value)} /></td>
            </tr>
            <tr>
              <th>제조 소요시간 :</th>
              <td><input value={value("estimatedHours")} onChange={(event) => onFieldChange("estimatedHours", event.target.value)} /></td>
              <th colSpan={2}>출고예정일 :</th>
              <td><input type="date" value={value("shippingDate")} onChange={(event) => onFieldChange("shippingDate", event.target.value)} /></td>
            </tr>
            <tr>
              <th>사 용 구 분 :</th>
              <td colSpan={4}>
                <div style={styles.purchaseUsageRow}>
                  {usageOptions.map((option) => (
                    <button
                      key={option}
                      type="button"
                      style={styles.purchaseUsageButton}
                      onClick={() => onFieldChange("usageType", option)}
                    >
                      <span>{value("usageType") === option ? "■" : "□"}</span>
                      {option}
                    </button>
                  ))}
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        <table className="purchase-item-table" style={{ ...styles.legacyItemTable, ...styles.purchaseItemTable }}>
          <thead>
            <tr>
              <th style={{ ...styles.legacyItemTh, width: "38px" }} />
              {columns.map((column) => (
                <th key={column.key} style={styles.legacyItemTh}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <td style={styles.legacyItemTd}>{rowIndex + 1}</td>
                {columns.map((column) => (
                  <td key={column.key} style={styles.legacyItemTd}>
                    <input
                      style={styles.legacyItemInput}
                      value={row[column.key] || ""}
                      onChange={(event) =>
                        onTableCellChange(table, rowIndex, column.key, event.target.value)
                      }
                    />
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <td colSpan={3} style={styles.purchaseTotalLabel}>합 계</td>
              <td style={styles.legacyItemTd} />
              <td style={styles.legacyItemTd}>{totalQty || ""}</td>
              <td style={styles.legacyItemTd} />
            </tr>
          </tbody>
        </table>
        <div style={styles.legacyItemActions}>
          <button type="button" style={styles.ghostButton} onClick={() => onAddRow(table)}>
            + 셀 추가
          </button>
          <span>현재 {rows.length}개 행</span>
        </div>
        <div style={styles.purchaseFooter}>ZETA <small>Corporation</small></div>
        <style>{`
          .nexus-purchase-form table { border-collapse: collapse; table-layout: fixed; }
          .purchase-approval-table th, .purchase-approval-table td {
            border: 1px solid #111; text-align: center; padding: 3px; font-size: 11px;
          }
          .purchase-approval-table th:first-child { width: 42px; line-height: 1.7; }
          .purchase-approval-table tr:first-child { height: 30px; }
          .purchase-approval-table tr:last-child { height: 67px; }
          .purchase-info-table th, .purchase-info-table td {
            height: 34px; border: 1px solid #c9b987; padding: 0; text-align: center;
            font-size: 12px; font-weight: 800;
          }
          .purchase-info-table input {
            width: 100%; height: 33px; border: 0; outline: 0; background: transparent;
            padding: 0 10px; text-align: center; font-size: 12px; box-sizing: border-box;
          }
          .purchase-item-table th, .purchase-item-table td {
            height: 30px; border-color: #c9b987; padding: 0;
          }
          .purchase-item-table th:nth-child(1) { width: 38px; }
          .purchase-item-table th:nth-child(2) { width: 25%; }
          .purchase-item-table th:nth-child(3) { width: 28%; }
          .purchase-item-table th:nth-child(4) { width: 65px; }
          .purchase-item-table th:nth-child(5) { width: 65px; }
          .purchase-item-table input { height: 29px; border: 0; border-radius: 0; text-align: center; }
        `}</style>
      </div>
    </section>
  );
}

type LegacyPurchaseResolutionFormProps = {
  data: Record<string, unknown>;
  table: TableDef;
  isMobile: boolean;
  onFieldChange: (key: string, value: string) => void;
  onTableCellChange: (table: TableDef, rowIndex: number, columnKey: string, value: string) => void;
  onAddRow: (table: TableDef) => void;
};

function LegacyPurchaseResolutionForm({
  data,
  table,
  isMobile,
  onFieldChange,
  onTableCellChange,
  onAddRow,
}: LegacyPurchaseResolutionFormProps) {
  const value = (key: string) => String(data[key] || "");
  const rows = getRows(data[table.key]);
  const numberValue = (value: string) => {
    const parsed = Number(value.replaceAll(",", ""));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const totalQty = rows.reduce((sum, row) => sum + numberValue(row.qty || ""), 0);
  const totalAmount = rows.reduce((sum, row) => {
    const explicit = numberValue(row.amount || "");
    return sum + (explicit || numberValue(row.qty || "") * numberValue(row.unitPrice || ""));
  }, 0);
  const columns = [
    { key: "name", label: "품 명" },
    { key: "spec", label: "규 격" },
    { key: "unit", label: "단 위" },
    { key: "qty", label: "수 량" },
    { key: "unitPrice", label: "단 가" },
    { key: "amount", label: "금 액" },
  ];

  return (
    <section style={styles.legacySheet}>
      <div
        className="nexus-resolution-form"
        style={{
          ...styles.legacyPaper,
          ...styles.resolutionPaper,
          ...(isMobile ? styles.legacyPaperMobile : {}),
        }}
      >
        <div style={styles.resolutionHeader}>
          <div style={styles.resolutionTitleBlock}>
            <div style={styles.resolutionLogo}>ZETA<small>Corporation</small></div>
            <strong>구 매 결 의 서</strong>
            <input
              type="date"
              value={value("resolutionDate")}
              onChange={(event) => onFieldChange("resolutionDate", event.target.value)}
            />
          </div>
          <table className="resolution-approval-table" style={styles.resolutionApprovalTable}>
            <tbody>
              <tr>
                <th rowSpan={2}>결<br />재</th>
                {["담당", "이사", "본부장", "전무", "사장"].map((role) => <th key={role}>{role}</th>)}
              </tr>
              <tr><td /><td /><td /><td /><td /></tr>
              <tr>
                <th>협<br />조</th>
                <td /><td /><td /><td colSpan={2} />
              </tr>
            </tbody>
          </table>
        </div>

        <div className="resolution-meta-grid" style={styles.resolutionMetaGrid}>
          <label><b>▪ 매입처명 :</b><input value={value("vendorName")} onChange={(event) => onFieldChange("vendorName", event.target.value)} /></label>
          <label><b>▪ 공 급 처 :</b><input value={value("supplier")} onChange={(event) => onFieldChange("supplier", event.target.value)} /></label>
          <label><b>▪ 담 당 자 :</b><input value={value("managerName")} onChange={(event) => onFieldChange("managerName", event.target.value)} /></label>
          <label><b>▪ 결 제 조 건 :</b><input value={value("manufacturingCondition")} onChange={(event) => onFieldChange("manufacturingCondition", event.target.value)} /></label>
          <label><b>▪ 연 락 처 :</b><input value={value("contact")} onChange={(event) => onFieldChange("contact", event.target.value)} /></label>
          <label><b>▪ 일시불/분할 :</b><input value={value("paymentTerms")} onChange={(event) => onFieldChange("paymentTerms", event.target.value)} /></label>
          <label><b>▪ 입고예정일 :</b><input type="date" value={value("expectedArrivalDate")} onChange={(event) => onFieldChange("expectedArrivalDate", event.target.value)} /></label>
          <label><b>▪ 하자 이행보증 기간 :</b><input value={value("warrantyPeriod")} onChange={(event) => onFieldChange("warrantyPeriod", event.target.value)} /></label>
        </div>

        <div style={styles.resolutionSectionLine}>
          <strong>&lt; 구매품목 &gt;</strong>
          <span>작성자 : {value("requester") || "작성자"}</span>
        </div>
        <table className="resolution-item-table" style={styles.resolutionItemTable}>
          <thead>
            <tr>
              <th colSpan={3}>합 계 금 액</th>
              <th colSpan={3}>
                <input value={value("amountInWords")} onChange={(event) => onFieldChange("amountInWords", event.target.value)} placeholder="일금 한글 금액" />
              </th>
              <th>
                ₩{totalAmount.toLocaleString()}　
                <button type="button" onClick={() => onFieldChange("vatType", value("vatType") === "VAT포함" ? "VAT별도" : "VAT포함")}>
                  {value("vatType") || "VAT별도"}
                </button>
              </th>
            </tr>
            <tr>
              <th style={{ width: "42px" }}>번호</th>
              {columns.map((column) => <th key={column.key}>{column.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <td>{rowIndex + 1}</td>
                {columns.map((column) => (
                  <td key={column.key}>
                    <input
                      value={row[column.key] || ""}
                      onChange={(event) => onTableCellChange(table, rowIndex, column.key, event.target.value)}
                    />
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <th colSpan={3}>합　계</th>
              <td />
              <td>{totalQty || ""}</td>
              <td />
              <td>{totalAmount ? totalAmount.toLocaleString() : ""}</td>
            </tr>
          </tbody>
        </table>
        <div style={styles.legacyItemActions}>
          <button type="button" style={styles.ghostButton} onClick={() => onAddRow(table)}>
            + 셀 추가
          </button>
          <span>현재 {rows.length}개 행</span>
        </div>
        <style>{`
          .nexus-resolution-form table { border-collapse: collapse; table-layout: fixed; }
          .resolution-approval-table th, .resolution-approval-table td {
            border: 1px solid #111; text-align: center; padding: 2px; font-size: 11px;
          }
          .resolution-approval-table th:first-child { width: 34px; line-height: 1.6; }
          .resolution-approval-table tr { height: 34px; }
          .resolution-meta-grid label {
            display: grid; grid-template-columns: 130px minmax(0,1fr); align-items: center;
            min-height: 34px; font-size: 12px;
          }
          .resolution-meta-grid input {
            width: 100%; height: 31px; border: 0; border-bottom: 1px solid #aaa;
            outline: 0; padding: 0 6px; font-size: 12px; box-sizing: border-box;
          }
          .resolution-item-table { width: 100%; border: 2px solid #111; }
          .resolution-item-table th, .resolution-item-table td {
            height: 29px; border: 1px solid #777; padding: 0; text-align: center; font-size: 11px;
          }
          .resolution-item-table th:nth-child(1) { width: 42px; }
          .resolution-item-table th:nth-child(2) { width: 18%; }
          .resolution-item-table th:nth-child(3) { width: 23%; }
          .resolution-item-table th:nth-child(4) { width: 62px; }
          .resolution-item-table th:nth-child(5) { width: 62px; }
          .resolution-item-table th:nth-child(6) { width: 82px; }
          .resolution-item-table input {
            width: 100%; height: 28px; border: 0; outline: 0; padding: 0 5px;
            text-align: center; font-size: 11px; box-sizing: border-box;
          }
          .resolution-item-table button { border: 0; background: transparent; cursor: pointer; }
        `}</style>
      </div>
    </section>
  );
}

type LegacyInspectionRequestFormProps = {
  data: Record<string, unknown>;
  table: TableDef;
  isMobile: boolean;
  onFieldChange: (key: string, value: string) => void;
  onTableCellChange: (table: TableDef, rowIndex: number, columnKey: string, value: string) => void;
  onAddRow: (table: TableDef) => void;
  onRemoveRow: (table: TableDef, rowIndex: number) => void;
};

function LegacyInspectionRequestForm({
  data,
  table,
  isMobile,
  onFieldChange,
  onTableCellChange,
  onAddRow,
  onRemoveRow,
}: LegacyInspectionRequestFormProps) {
  const value = (key: string) => String(data[key] || "");
  const rows = getRows(data[table.key]);
  const columns = [
    { key: "productName", label: "제품명", width: "19%" },
    { key: "modelName", label: "모델명", width: "15%" },
    { key: "serialNo", label: "S/N", width: "15%" },
    { key: "spec", label: "제품 규격", width: "51%" },
  ];

  return (
    <section style={styles.legacySheet}>
      <div style={{ ...styles.legacyPaper, ...(isMobile ? styles.legacyPaperMobile : {}) }}>
        <div style={styles.legacyInspectionHeader}>
          <div style={styles.legacyInspectionTitleBlock}>
            <strong>제 품 검 사 요 청 서</strong>
            <label style={styles.legacyInspectionDateLine}>
              <span>작성일</span>
              <input
                type="date"
                style={styles.legacyInspectionInlineInput}
                value={value("requestDate")}
                onChange={(event) => onFieldChange("requestDate", event.target.value)}
              />
            </label>
          </div>
        </div>

        <div style={styles.legacyInspectionInfoGrid}>
          <label style={styles.legacyInspectionInfoCell}>
            <span>발 주 처</span>
            <input
              style={styles.legacyInput}
              value={value("client")}
              onChange={(event) => onFieldChange("client", event.target.value)}
            />
          </label>
          <label style={styles.legacyInspectionInfoCell}>
            <span>담 당 자</span>
            <input
              style={styles.legacyInput}
              value={value("contact")}
              onChange={(event) => onFieldChange("contact", event.target.value)}
            />
          </label>
          <label style={styles.legacyInspectionInfoCell}>
            <span>제조완료일</span>
            <input
              type="date"
              style={styles.legacyInput}
              value={value("manufacturedDate")}
              onChange={(event) => onFieldChange("manufacturedDate", event.target.value)}
            />
          </label>
          <label style={styles.legacyInspectionInfoCell}>
            <span>검수 요청일</span>
            <input
              type="date"
              style={styles.legacyInput}
              value={value("inspectionDate")}
              onChange={(event) => onFieldChange("inspectionDate", event.target.value)}
            />
          </label>
        </div>

        <div style={styles.legacySpecTitle}>S P E C I F I C A T I O N</div>
        <table style={styles.legacyItemTable}>
          <thead>
            <tr>
              <th style={{ ...styles.legacyItemTh, width: "52px" }}>No</th>
              {columns.map((column) => (
                <th key={column.key} style={{ ...styles.legacyItemTh, width: column.width }}>
                  {column.label}
                </th>
              ))}
              <th style={{ ...styles.legacyItemTh, width: "64px" }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <td style={styles.legacyItemTd}>{rowIndex + 1}</td>
                {columns.map((column) => (
                  <td key={column.key} style={styles.legacyItemTd}>
                    <input
                      style={styles.legacyItemInput}
                      value={row[column.key] || ""}
                      onChange={(event) =>
                        onTableCellChange(table, rowIndex, column.key, event.target.value)
                      }
                    />
                  </td>
                ))}
                <td style={styles.legacyItemTd}>
                  <button
                    type="button"
                    style={styles.smallDangerButton}
                    onClick={() => onRemoveRow(table, rowIndex)}
                  >
                    삭제
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={styles.legacyItemActions}>
          <button type="button" style={styles.ghostButton} onClick={() => onAddRow(table)}>
            행 추가
          </button>
        </div>

        <div style={styles.legacyInspectionQaTitle}>Q A팀 접 수 확 인</div>
        <div style={styles.legacyInspectionQaGrid}>
          <label style={styles.legacyInspectionQaCell}>
            <span>접 수 일</span>
            <input
              type="date"
              style={styles.legacyInput}
              value={value("qaReceivedDate")}
              onChange={(event) => onFieldChange("qaReceivedDate", event.target.value)}
            />
          </label>
          <label style={styles.legacyInspectionQaCell}>
            <span>QA담당자</span>
            <input
              style={styles.legacyInput}
              value={value("qaOwner")}
              onChange={(event) => onFieldChange("qaOwner", event.target.value)}
            />
          </label>
          <label style={{ ...styles.legacyInspectionQaCell, gridColumn: "span 2" }}>
            <span>접수 메모</span>
            <input
              style={styles.legacyInput}
              value={value("qaMemo")}
              onChange={(event) => onFieldChange("qaMemo", event.target.value)}
            />
          </label>
        </div>
      </div>
    </section>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    minWidth: 0,
  },
  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: "10px",
    marginBottom: "14px",
  },
  summaryGridMobile: {
    gridTemplateColumns: "repeat(3, minmax(86px, 1fr))",
    gap: "8px",
    marginBottom: "12px",
    overflowX: "auto",
  },
  summaryCard: {
    minHeight: "72px",
    border: "1px solid #e3e7ed",
    borderRadius: "8px",
    background: "#ffffff",
    padding: "13px 14px",
  },
  summaryCardMobile: {
    minHeight: "70px",
    padding: "10px",
  },
  summaryLabel: {
    display: "block",
    color: "#667085",
    fontSize: "12px",
    fontWeight: 700,
  },
  summaryValue: {
    display: "block",
    marginTop: "7px",
    color: "#111820",
    fontSize: "24px",
    lineHeight: 1,
  },
  setupBox: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    border: "1px solid #facc15",
    borderRadius: "10px",
    background: "#fffbeb",
    color: "#854d0e",
    padding: "14px 16px",
    marginBottom: "16px",
    fontSize: "13px",
    fontWeight: 700,
  },
  messageBox: {
    border: "1px solid #bfdbfe",
    borderRadius: "10px",
    background: "#eff6ff",
    color: "#1d4ed8",
    padding: "12px 14px",
    marginBottom: "16px",
    fontSize: "13px",
    fontWeight: 700,
  },
  layout: {
    display: "grid",
    gridTemplateColumns: "minmax(640px, 1fr) 360px",
    gap: "16px",
    alignItems: "start",
  },
  layoutMobile: {
    gridTemplateColumns: "minmax(0, 1fr)",
    gap: "12px",
  },
  nexusLayout: {
    gridTemplateColumns: "minmax(0, 1fr)",
    gap: 0,
  },
  formPanel: {
    border: "1px solid #e1e5ea",
    borderRadius: "8px",
    background: "#ffffff",
    padding: "18px 20px",
    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.03)",
  },
  nexusFormPanel: {
    padding: "14px 16px 20px",
  },
  documentPanel: {
    position: "sticky",
    top: "94px",
    border: "1px solid #e1e5ea",
    borderRadius: "8px",
    background: "#ffffff",
    padding: "14px",
    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.03)",
  },
  panelMobile: {
    padding: "12px",
    borderRadius: "9px",
  },
  panelTitleRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "12px",
    marginBottom: "14px",
  },
  panelTitleRowMobile: {
    alignItems: "stretch",
    flexDirection: "column",
    gap: "10px",
  },
  panelTitleActions: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: "6px",
    flexWrap: "wrap",
  },
  panelTitle: {
    margin: 0,
    color: "#111820",
    fontSize: "18px",
    fontWeight: 850,
  },
  panelSubText: {
    margin: "5px 0 0",
    color: "#667085",
    fontSize: "12px",
    fontWeight: 500,
  },
  templateStripBox: {
    borderTop: "1px solid #edf0f3",
    borderBottom: "1px solid #edf0f3",
    padding: "13px 0",
    marginBottom: "14px",
  },
  templateRows: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  templateRow: {
    display: "flex",
    flexWrap: "nowrap",
    gap: "8px",
    overflowX: "auto",
    paddingBottom: "2px",
  },
  templateRowMobile: {
    display: "flex",
    flexWrap: "nowrap",
    gap: "7px",
    overflowX: "auto",
    scrollSnapType: "x proximity",
  },
  templateButton: {
    flex: "0 0 128px",
    minWidth: "128px",
    minHeight: "50px",
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    justifyContent: "center",
    gap: "4px",
    border: "1px solid #e1e5ea",
    borderRadius: "8px",
    background: "#ffffff",
    color: "#111827",
    padding: "8px 12px",
    textAlign: "left",
    cursor: "pointer",
    fontSize: "13px",
  },
  templateButtonMobile: {
    flexBasis: "118px",
    minWidth: "118px",
    minHeight: "50px",
    padding: "8px 10px",
    fontSize: "12px",
    scrollSnapAlign: "start",
  },
  templateGroupBreak: {
    marginRight: "18px",
  },
  templateButtonActive: {
    borderColor: "#0f8a56",
    background: "#eef6f1",
  },
  templateCategory: {
    color: "#2fa368",
    fontSize: "11px",
    fontWeight: 700,
  },
  formGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "12px",
  },
  formGridMobile: {
    gridTemplateColumns: "minmax(0, 1fr)",
    gap: "10px",
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: "7px",
    color: "#111827",
    fontSize: "12px",
    fontWeight: 700,
  },
  input: {
    width: "100%",
    height: "38px",
    border: "1px solid #cfd6df",
    borderRadius: "6px",
    background: "#ffffff",
    color: "#111827",
    padding: "0 11px",
    fontSize: "13px",
    fontWeight: 500,
    boxSizing: "border-box",
  },
  textarea: {
    width: "100%",
    minHeight: "94px",
    resize: "vertical",
    border: "1px solid #cfd6df",
    borderRadius: "6px",
    background: "#ffffff",
    color: "#111827",
    padding: "11px",
    fontSize: "13px",
    fontWeight: 500,
    lineHeight: 1.5,
    boxSizing: "border-box",
  },
  primaryButton: {
    minWidth: "88px",
    height: "38px",
    border: "1px solid #0f8a56",
    borderRadius: "8px",
    background: "#0f8a56",
    color: "#ffffff",
    padding: "0 14px",
    fontSize: "13px",
    fontWeight: 800,
    cursor: "pointer",
  },
  primaryButtonDisabled: {
    borderColor: "#cbd5e1",
    background: "#cbd5e1",
    color: "#64748b",
    cursor: "not-allowed",
  },
  dangerButton: {
    minWidth: "88px",
    height: "38px",
    border: "1px solid #fecaca",
    borderRadius: "9px",
    background: "#fff1f2",
    color: "#dc2626",
    padding: "0 14px",
    fontSize: "13px",
    fontWeight: 800,
    cursor: "pointer",
  },
  ghostButton: {
    height: "32px",
    border: "1px solid #cfd6df",
    borderRadius: "6px",
    background: "#ffffff",
    color: "#111827",
    padding: "0 11px",
    fontSize: "12px",
    fontWeight: 800,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  exportButton: {
    height: "28px",
    border: "1px solid #cfd6df",
    borderRadius: "7px",
    background: "#ffffff",
    color: "#111827",
    padding: "0 9px",
    fontSize: "11px",
    fontWeight: 800,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  attachmentUploadBox: {
    marginTop: "18px",
    border: "1px solid #e1e5ea",
    borderRadius: "8px",
    background: "#fbfcfd",
    padding: "14px",
  },
  attachmentDetailBox: {
    marginTop: "14px",
    border: "1px solid #edf0f3",
    borderRadius: "8px",
    background: "#ffffff",
    padding: "10px",
  },
  attachmentHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "10px",
    color: "#344054",
    fontSize: "12px",
    fontWeight: 800,
    marginBottom: "9px",
  },
  attachmentNotice: {
    margin: 0,
    borderRadius: "7px",
    background: "#fffbeb",
    color: "#92400e",
    padding: "10px",
    fontSize: "12px",
    fontWeight: 700,
    lineHeight: 1.5,
  },
  attachmentLockedNotice: {
    margin: "0 0 9px",
    borderRadius: "7px",
    background: "#f8fafc",
    color: "#475467",
    padding: "8px 9px",
    fontSize: "11px",
    fontWeight: 700,
    lineHeight: 1.45,
  },
  attachmentEmpty: {
    margin: 0,
    color: "#667085",
    fontSize: "12px",
    fontWeight: 600,
  },
  attachmentList: {
    display: "flex",
    flexDirection: "column",
    gap: "7px",
  },
  attachmentItem: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "10px",
    border: "1px solid #edf0f3",
    borderRadius: "7px",
    background: "#ffffff",
    padding: "8px",
  },
  attachmentFileInfo: {
    display: "flex",
    flexDirection: "column",
    gap: "3px",
    minWidth: 0,
    color: "#111827",
    fontSize: "12px",
    wordBreak: "break-all",
  },
  attachmentActions: {
    display: "flex",
    gap: "5px",
    flexShrink: 0,
  },
  attachmentAddButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: "72px",
    height: "32px",
    border: "1px solid #0f8a56",
    borderRadius: "7px",
    background: "#ffffff",
    color: "#0f8a56",
    padding: "0 10px",
    fontSize: "12px",
    fontWeight: 800,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  hiddenFileInput: {
    display: "none",
  },
  tableSection: {
    marginTop: "20px",
    borderTop: "1px solid #edf0f3",
    paddingTop: "16px",
  },
  sectionTitle: {
    margin: 0,
    color: "#111820",
    fontSize: "15px",
    fontWeight: 800,
  },
  tableWrap: {
    overflowX: "auto",
  },
  table: {
    width: "100%",
    minWidth: "620px",
    borderCollapse: "separate",
    borderSpacing: 0,
  },
  th: {
    borderTop: "1px solid #e5e7eb",
    borderBottom: "1px solid #e5e7eb",
    background: "#f8fafc",
    color: "#667085",
    padding: "9px",
    fontSize: "12px",
    fontWeight: 700,
    textAlign: "left",
  },
  td: {
    borderBottom: "1px solid #edf0f3",
    padding: "7px",
    color: "#111827",
    fontSize: "13px",
  },
  tableInput: {
    width: "100%",
    height: "34px",
    border: "1px solid transparent",
    borderRadius: "7px",
    background: "#ffffff",
    color: "#111827",
    padding: "0 8px",
    fontSize: "13px",
    fontWeight: 500,
    boxSizing: "border-box",
  },
  smallDangerButton: {
    height: "30px",
    border: "1px solid #fee2e2",
    borderRadius: "7px",
    background: "#ffffff",
    color: "#dc2626",
    padding: "0 8px",
    fontSize: "11px",
    fontWeight: 800,
    cursor: "pointer",
  },
  legacySheet: {
    marginTop: "16px",
    borderTop: "1px solid #edf0f3",
    paddingTop: "16px",
    width: "100%",
    maxWidth: "100%",
    overflowX: "auto",
    overflowY: "visible",
    WebkitOverflowScrolling: "touch",
    overscrollBehaviorX: "contain",
    paddingBottom: "8px",
  },
  manufacturingLegacySheet: {
    marginTop: "12px",
    paddingTop: "12px",
  },
  legacyTopNotice: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: "10px",
    marginBottom: "12px",
  },
  manufacturingTopNotice: {
    maxWidth: "1120px",
    margin: "0 auto 14px",
    padding: "12px 14px",
    border: "1px solid #e1e7ec",
    borderRadius: "8px",
    background: "#f8fafc",
    boxSizing: "border-box",
  },
  legacyMiniField: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    color: "#475467",
    fontSize: "11px",
    fontWeight: 800,
  },
  legacyPaper: {
    minWidth: "820px",
    border: "1px solid #d8dee7",
    borderRadius: "4px",
    background: "#ffffff",
    padding: "16px",
    overflowX: "auto",
  },
  legacyPaperMobile: {
    minWidth: "760px",
  },
  workOrderPaper: {
    width: "100%",
    maxWidth: "980px",
    minWidth: "820px",
    margin: "0 auto",
    padding: 0,
    border: "1.5px solid #111827",
    borderRadius: 0,
    overflow: "hidden",
    boxSizing: "border-box",
  },
  workOrderHeader: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 250px",
    minHeight: "132px",
    borderBottom: "1.5px solid #111827",
  },
  workOrderTitleArea: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    borderRight: "1.5px solid #111827",
    padding: "18px 24px 12px",
  },
  workOrderTitle: {
    margin: 0,
    paddingBottom: "8px",
    borderBottom: "2px solid #111827",
    color: "#050505",
    fontSize: "34px",
    fontWeight: 900,
    letterSpacing: "0.28em",
    lineHeight: 1.15,
  },
  workOrderDate: {
    width: "230px",
    marginTop: "15px",
  },
  workOrderIssuer: {
    display: "grid",
    gridTemplateRows: "42px minmax(0, 1fr)",
    textAlign: "center",
  },
  workOrderIssuerTeam: {
    display: "grid",
    placeItems: "center",
    borderBottom: "1px solid #111827",
    fontSize: "13px",
    fontWeight: 800,
  },
  workOrderIssuerName: {
    display: "grid",
    placeItems: "center",
    fontSize: "17px",
    fontWeight: 900,
  },
  workOrderMetaGrid: {
    display: "grid",
    gridTemplateColumns: "110px minmax(0, 2fr) 76px minmax(90px, .65fr) 100px minmax(120px, 1fr)",
  },
  workOrderLabel: {
    display: "grid",
    minHeight: "46px",
    placeItems: "center",
    borderRight: "1px solid #111827",
    borderBottom: "1px solid #111827",
    background: "#f7f7f7",
    fontSize: "13px",
    fontWeight: 800,
  },
  workOrderValue: {
    minWidth: 0,
    borderRight: "1px solid #111827",
    borderBottom: "1px solid #111827",
    background: "#fff",
  },
  workOrderInput: {
    width: "100%",
    height: "100%",
    minHeight: "44px",
    border: 0,
    outline: 0,
    background: "transparent",
    padding: "8px 12px",
    boxSizing: "border-box",
    color: "#111827",
    fontSize: "13px",
    textAlign: "center",
  },
  workOrderSpecTitle: {
    display: "grid",
    minHeight: "42px",
    placeItems: "center",
    borderBottom: "1.5px solid #111827",
    fontSize: "14px",
    fontWeight: 900,
    letterSpacing: "0.55em",
  },
  workOrderSectionRow: {
    display: "grid",
    gridTemplateColumns: "110px minmax(0, 1fr)",
  },
  workOrderTallLabel: {
    display: "grid",
    minHeight: "48px",
    placeItems: "center",
    borderRight: "1px solid #111827",
    borderBottom: "1px solid #111827",
    background: "#f7f7f7",
    fontSize: "13px",
    fontWeight: 800,
    lineHeight: 1.5,
    textAlign: "center",
  },
  workOrderTextarea: {
    display: "block",
    width: "100%",
    resize: "vertical",
    border: 0,
    outline: 0,
    background: "transparent",
    padding: "10px 14px",
    boxSizing: "border-box",
    color: "#111827",
    fontFamily: "inherit",
    fontSize: "13px",
    lineHeight: 1.7,
  },
  manufacturingLegacyPaper: {
    width: "100%",
    maxWidth: "1120px",
    minWidth: "900px",
    margin: "0 auto",
    padding: "24px 28px 30px",
    boxSizing: "border-box",
  },
  purchaseLegacyPaper: {
    maxWidth: "900px",
    margin: "0 auto",
    borderColor: "#c9b987",
    padding: "28px 26px 18px",
  },
  purchaseLegacyHeader: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 390px",
    alignItems: "end",
    gap: "18px",
    marginBottom: "10px",
  },
  purchaseLegacyTitle: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "16px",
    minHeight: "90px",
    color: "#111827",
    fontSize: "24px",
    fontWeight: 900,
  },
  purchaseApprovalTable: {
    width: "100%",
    height: "98px",
    color: "#111827",
  },
  purchaseInfoTable: {
    width: "100%",
    color: "#111827",
  },
  purchaseNumberPreview: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    marginLeft: "8px",
    fontSize: "10px",
    fontWeight: 700,
  },
  nexusAppBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "16px",
    border: "1px solid #d8e5e1",
    borderRadius: "10px",
    background: "#f3faf7",
    padding: "9px 14px",
    marginBottom: "10px",
  },
  nexusAppBarTitle: {
    fontSize: "16px",
    fontWeight: 900,
    letterSpacing: "-0.02em",
  },
  nexusHomeButton: {
    position: "fixed",
    zIndex: 30,
    top: "18px",
    left: "18px",
    display: "grid",
    width: "46px",
    height: "46px",
    placeItems: "center",
    borderRadius: "15px",
    background: "#0d493e",
    color: "#ffffff",
    boxShadow: "0 8px 22px rgba(13, 73, 62, 0.2)",
    fontSize: "21px",
    fontWeight: 950,
    textDecoration: "none",
  },
  nexusBackLink: {
    border: "1px solid #cbded8",
    borderRadius: "8px",
    background: "#ffffff",
    color: "#0d6959",
    padding: "9px 12px",
    fontSize: "12px",
    fontWeight: 800,
    textDecoration: "none",
  },
  nexusApprovalGuide: {
    display: "grid",
    gap: "5px",
    marginBottom: "12px",
    padding: "12px 14px",
    border: "1px solid #dbe7e3",
    borderRadius: "10px",
    background: "#ffffff",
    color: "#56635f",
    fontSize: "11px",
    lineHeight: 1.5,
  },
  purchaseApprovalPreview: {
    display: "grid",
    gridTemplateColumns: "34px repeat(5, 1fr)",
    minHeight: "92px",
    borderTop: "1px solid #171717",
    borderLeft: "1px solid #171717",
  },
  purchaseApprovalVertical: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRight: "1px solid #171717",
    borderBottom: "1px solid #171717",
    fontSize: "11px",
    fontWeight: 900,
    lineHeight: 1.6,
  },
  purchaseApprovalCell: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "14px",
    borderRight: "1px solid #171717",
    borderBottom: "1px solid #171717",
    padding: "6px 3px",
    fontSize: "10px",
  },
  purchaseInfoGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    borderTop: "1px solid #c9b987",
    borderLeft: "1px solid #c9b987",
  },
  purchaseInfoCell: {
    display: "grid",
    gridTemplateColumns: "108px minmax(0, 1fr)",
    alignItems: "center",
    minHeight: "38px",
    borderRight: "1px solid #c9b987",
    borderBottom: "1px solid #c9b987",
    color: "#111827",
    fontSize: "12px",
    fontWeight: 800,
  },
  purchaseInfoInput: {
    width: "100%",
    height: "100%",
    minHeight: "36px",
    border: 0,
    borderLeft: "1px solid #c9b987",
    outline: "none",
    padding: "0 10px",
    background: "#ffffff",
    color: "#111827",
    fontSize: "12px",
    boxSizing: "border-box",
  },
  purchaseComparison: {
    display: "grid",
    gridTemplateColumns: "58px 1fr",
    gridTemplateRows: "repeat(3, 34px)",
    borderRight: "1px solid #c9b987",
    borderBottom: "1px solid #c9b987",
  },
  purchaseComparisonTitle: {
    gridRow: "1 / 4",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRight: "1px solid #c9b987",
    fontSize: "11px",
    lineHeight: 1.6,
  },
  purchaseComparisonCell: {
    display: "grid",
    gridTemplateColumns: "64px minmax(0, 1fr)",
    alignItems: "center",
    borderBottom: "1px solid #c9b987",
    fontSize: "11px",
    fontWeight: 800,
  },
  purchaseUsageRow: {
    gridColumn: "1 / -1",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "14px",
    minHeight: "42px",
    borderRight: "1px solid #c9b987",
    borderBottom: "1px solid #c9b987",
    fontSize: "12px",
  },
  purchaseUsageButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    border: 0,
    background: "transparent",
    color: "#111827",
    padding: 0,
    fontSize: "11px",
    cursor: "pointer",
  },
  purchaseItemTable: {
    borderColor: "#c9b987",
  },
  purchaseTotalLabel: {
    height: "34px",
    borderRight: "1px solid #2d3748",
    borderBottom: "1px solid #2d3748",
    textAlign: "center",
    fontWeight: 900,
    letterSpacing: "1em",
  },
  purchaseFooter: {
    paddingTop: "7px",
    textAlign: "center",
    color: "#334155",
    fontSize: "15px",
    letterSpacing: "0.08em",
  },
  resolutionPaper: {
    maxWidth: "860px",
    margin: "0 auto",
    border: "2px solid #3f3f46",
    borderRadius: 0,
    padding: "28px 38px 36px",
  },
  resolutionHeader: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 410px",
    border: "1px solid #111",
    borderBottomWidth: "3px",
  },
  resolutionTitleBlock: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "10px",
    minHeight: "118px",
    borderRight: "1px solid #111",
  },
  resolutionLogo: {
    fontSize: "20px",
    fontWeight: 800,
    letterSpacing: "0.08em",
  },
  resolutionApprovalTable: {
    width: "100%",
    color: "#111827",
  },
  resolutionMetaGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    columnGap: "42px",
    rowGap: "1px",
    borderBottom: "3px double #111",
    padding: "14px 0 12px",
  },
  resolutionSectionLine: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 8px 6px",
    fontSize: "12px",
  },
  resolutionItemTable: {
    width: "100%",
    color: "#111827",
  },
  legacyHeaderGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 360px",
    alignItems: "stretch",
    gap: "12px",
    marginBottom: "8px",
  },
  legacyHeaderSingle: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr)",
    marginBottom: "10px",
  },
  legacyDocTitle: {
    minHeight: "68px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "4px",
    flexWrap: "wrap",
    border: "1px solid #2d3748",
    color: "#0f172a",
    fontSize: "24px",
    fontWeight: 850,
    letterSpacing: "0",
  },
  legacyCheckButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: "3px",
    border: 0,
    background: "transparent",
    color: "inherit",
    padding: "0 1px",
    font: "inherit",
    fontWeight: 850,
    letterSpacing: "0",
    cursor: "pointer",
  },
  legacyCheckBox: {
    width: "13px",
    height: "13px",
    display: "inline-block",
    border: "2px solid #0f172a",
    borderRadius: "2px",
    background: "#ffffff",
    boxSizing: "border-box",
  },
  legacyCheckBoxActive: {
    background: "#0f172a",
  },
  legacyApprovalBox: {
    display: "grid",
    gridTemplateColumns: "44px repeat(5, 1fr)",
    borderTop: "1px solid #2d3748",
    borderLeft: "1px solid #2d3748",
  },
  legacyApprovalTitle: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRight: "1px solid #2d3748",
    borderBottom: "1px solid #2d3748",
    color: "#0f172a",
    fontSize: "12px",
    fontWeight: 800,
    writingMode: "vertical-rl",
  },
  legacyApprovalCell: {
    minHeight: "56px",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    borderRight: "1px solid #2d3748",
    borderBottom: "1px solid #2d3748",
    color: "#0f172a",
    paddingTop: "7px",
    fontSize: "12px",
    fontWeight: 800,
  },
  legacyCopyLabel: {
    color: "#334155",
    fontSize: "12.5px",
    fontWeight: 800,
    margin: "12px 0 10px",
  },
  legacyGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    borderTop: "1px solid #2d3748",
    borderLeft: "1px solid #2d3748",
  },
  legacyCell: {
    minHeight: "66px",
    display: "grid",
    gridTemplateColumns: "92px minmax(0, 1fr)",
    alignItems: "center",
    gap: 0,
    borderRight: "1px solid #2d3748",
    borderBottom: "1px solid #2d3748",
    color: "#0f172a",
    padding: 0,
    fontSize: "13px",
    fontWeight: 850,
  },
  legacySpecTitle: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "42px",
    borderLeft: "1px solid #2d3748",
    borderRight: "1px solid #2d3748",
    borderBottom: "1px solid #2d3748",
    background: "#f8fafc",
    color: "#0f172a",
    fontSize: "15px",
    fontWeight: 850,
    letterSpacing: "0.18em",
  },
  legacySpecRows: {
    borderLeft: "1px solid #2d3748",
    borderRight: "1px solid #2d3748",
  },
  legacyWideRow: {
    minHeight: "52px",
    display: "grid",
    gridTemplateColumns: "118px minmax(0, 1fr)",
    alignItems: "stretch",
    borderBottom: "1px solid #2d3748",
    color: "#0f172a",
    fontSize: "13px",
    fontWeight: 850,
  },
  legacyInput: {
    width: "100%",
    minWidth: 0,
    height: "36px",
    border: "1px solid #cbd5e1",
    borderRadius: "4px",
    background: "#ffffff",
    color: "#0f172a",
    padding: "0 11px",
    fontSize: "14px",
    fontWeight: 600,
    boxSizing: "border-box",
  },
  legacyTextarea: {
    width: "100%",
    minHeight: "78px",
    border: "1px solid #cbd5e1",
    borderRadius: "4px",
    background: "#ffffff",
    color: "#0f172a",
    padding: "10px 11px",
    fontSize: "14px",
    fontWeight: 600,
    lineHeight: 1.45,
    resize: "vertical",
    boxSizing: "border-box",
  },
  legacyProductSpecTextarea: {
    minHeight: "240px",
  },
  legacyItemTable: {
    width: "100%",
    borderCollapse: "collapse",
    borderLeft: "1px solid #2d3748",
    borderRight: "1px solid #2d3748",
    color: "#0f172a",
  },
  legacyItemTh: {
    height: "38px",
    borderBottom: "1px solid #2d3748",
    borderRight: "1px solid #2d3748",
    background: "#f8fafc",
    color: "#0f172a",
    padding: "7px",
    fontSize: "13px",
    fontWeight: 850,
    textAlign: "center",
  },
  legacyItemTd: {
    borderBottom: "1px solid #2d3748",
    borderRight: "1px solid #2d3748",
    padding: "6px",
    fontSize: "13px",
    fontWeight: 750,
    textAlign: "center",
  },
  legacyItemInput: {
    width: "100%",
    minWidth: 0,
    height: "34px",
    border: "1px solid #cbd5e1",
    borderRadius: "4px",
    background: "#ffffff",
    color: "#0f172a",
    padding: "0 9px",
    fontSize: "14px",
    fontWeight: 600,
    boxSizing: "border-box",
  },
  legacyItemActions: {
    display: "flex",
    justifyContent: "flex-end",
    borderLeft: "1px solid #2d3748",
    borderRight: "1px solid #2d3748",
    borderBottom: "1px solid #2d3748",
    padding: "8px",
    marginBottom: "0",
  },
  legacyInspectionHeader: {
    border: "1px solid #2d3748",
    borderBottom: 0,
    background: "#ffffff",
  },
  legacyInspectionTitleBlock: {
    minHeight: "86px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "12px",
    color: "#0f172a",
    fontSize: "24px",
    fontWeight: 850,
    letterSpacing: "0.08em",
  },
  legacyInspectionDateLine: {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    color: "#334155",
    fontSize: "13px",
    fontWeight: 800,
    letterSpacing: "0",
  },
  legacyInspectionInlineInput: {
    height: "32px",
    width: "160px",
    border: "1px solid #cbd5e1",
    borderRadius: "4px",
    background: "#ffffff",
    color: "#0f172a",
    padding: "0 9px",
    fontSize: "13px",
    fontWeight: 700,
    boxSizing: "border-box",
  },
  legacyInspectionInfoGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    borderTop: "1px solid #2d3748",
    borderLeft: "1px solid #2d3748",
  },
  legacyInspectionInfoCell: {
    minHeight: "56px",
    display: "grid",
    gridTemplateColumns: "132px minmax(0, 1fr)",
    alignItems: "center",
    gap: "10px",
    borderRight: "1px solid #2d3748",
    borderBottom: "1px solid #2d3748",
    color: "#0f172a",
    padding: "8px 10px",
    fontSize: "13px",
    fontWeight: 850,
  },
  legacyInspectionQaTitle: {
    minHeight: "38px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderLeft: "1px solid #2d3748",
    borderRight: "1px solid #2d3748",
    borderBottom: "1px solid #2d3748",
    background: "#f8fafc",
    color: "#0f172a",
    fontSize: "15px",
    fontWeight: 850,
    letterSpacing: "0.12em",
  },
  legacyInspectionQaGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    borderLeft: "1px solid #2d3748",
    borderBottom: "1px solid #2d3748",
  },
  legacyInspectionQaCell: {
    minHeight: "54px",
    display: "grid",
    gridTemplateColumns: "88px minmax(0, 1fr)",
    alignItems: "center",
    gap: "8px",
    borderRight: "1px solid #2d3748",
    color: "#0f172a",
    padding: "8px",
    fontSize: "13px",
    fontWeight: 850,
  },
  approvalLineBox: {
    marginTop: "20px",
    borderTop: "1px solid #edf0f3",
    paddingTop: "16px",
  },
  approvalLineBoxTop: {
    border: "1px solid #e1e5ea",
    borderRadius: "8px",
    background: "#f8fafc",
    padding: "13px",
    marginBottom: "14px",
  },
  nexusApprovalLineBox: {
    padding: "11px 12px",
    marginBottom: "12px",
  },
  approvalReferenceRow: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(260px, 340px)",
    gap: "10px",
    alignItems: "start",
  },
  nexusApprovalReferenceRow: {
    gridTemplateColumns: "minmax(0, 1fr)",
    gap: "12px",
  },
  approvalReferenceRowMobile: {
    gridTemplateColumns: "minmax(0, 1fr)",
  },
  approverCompactArea: {
    minWidth: 0,
  },
  orderReferenceBox: {
    border: "1px solid #e1e5ea",
    borderRadius: "8px",
    background: "#ffffff",
    padding: "14px",
    marginBottom: "16px",
  },
  inputModeBox: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "14px",
    border: "1px solid #e1e5ea",
    borderRadius: "8px",
    background: "#fbfcfd",
    padding: "14px",
    marginBottom: "16px",
  },
  nexusPolicyBox: {
    display: "flex",
    flexDirection: "column",
    gap: "5px",
    border: "1px solid #f4d58d",
    borderRadius: "8px",
    background: "#fffbeb",
    color: "#7c5a05",
    padding: "13px 14px",
    marginBottom: "16px",
    fontSize: "12px",
    lineHeight: 1.55,
  },
  inputModeActions: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
  },
  modeButton: {
    height: "36px",
    border: "1px solid #cfd6df",
    borderRadius: "8px",
    background: "#ffffff",
    color: "#111827",
    padding: "0 13px",
    fontSize: "12px",
    fontWeight: 850,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  modeButtonActive: {
    borderColor: "#0f8a56",
    background: "#eef6f1",
    color: "#0b6b43",
  },
  referenceLineBox: {
    border: "1px solid #e1e5ea",
    borderRadius: "8px",
    background: "#ffffff",
    padding: "14px",
    marginBottom: "16px",
  },
  referenceInsideBox: {
    marginTop: "14px",
    borderTop: "1px solid #e1e5ea",
    paddingTop: "14px",
  },
  referenceCompactArea: {
    minWidth: 0,
    borderLeft: "1px solid #e1e5ea",
    paddingLeft: "10px",
  },
  nexusReferenceCompactArea: {
    borderLeft: 0,
    borderTop: "1px solid #e1e5ea",
    paddingLeft: 0,
    paddingTop: "10px",
  },
  referenceCompactHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    marginBottom: "8px",
  },
  referenceEmpty: {
    border: "1px dashed #cfd6df",
    borderRadius: "8px",
    color: "#667085",
    padding: "9px",
    fontSize: "12px",
    fontWeight: 700,
    textAlign: "center",
  },
  referenceGridCompact: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr)",
    gap: "8px",
  },
  nexusReferenceGridCompact: {
    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
  },
  approvalLineGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "8px",
    marginTop: "8px",
  },
  approverSlot: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    color: "#111827",
    fontSize: "12px",
    fontWeight: 700,
  },
  approverLabel: {
    color: "#475467",
    fontSize: "11px",
    fontWeight: 800,
    lineHeight: 1.2,
  },
  approverControl: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: "5px",
  },
  removeLineButton: {
    width: "42px",
    height: "38px",
    border: "1px solid #fee2e2",
    borderRadius: "8px",
    background: "#ffffff",
    color: "#dc2626",
    fontSize: "11px",
    fontWeight: 800,
    cursor: "pointer",
  },
  readOnlyInput: {
    background: "#f8fafc",
    color: "#475467",
  },
  countText: {
    color: "#667085",
    fontSize: "12px",
    fontWeight: 700,
  },
  filterTabs: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: "6px",
    marginBottom: "8px",
  },
  filterTabsMobile: {
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  },
  filterButton: {
    minHeight: "38px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "1px",
    border: "1px solid #e5e7eb",
    borderRadius: "6px",
    background: "#ffffff",
    color: "#667085",
    fontSize: "12px",
    fontWeight: 800,
    cursor: "pointer",
  },
  filterButtonActive: {
    borderColor: "#111820",
    background: "#111820",
    color: "#ffffff",
  },
  documentFilterToggle: {
    width: "100%",
    minHeight: "34px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    background: "#ffffff",
    color: "#667085",
    padding: "0 10px",
    marginBottom: "10px",
    fontSize: "12px",
    fontWeight: 800,
    cursor: "pointer",
  },
  documentFilterToggleActive: {
    borderColor: "#a7f3d0",
    background: "#ecfdf3",
    color: "#047857",
  },
  documentFilterPanel: {
    marginBottom: "12px",
    border: "1px solid #e6eaf0",
    borderRadius: "8px",
    background: "#f8fafc",
    padding: "10px",
  },
  documentFilterHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    marginBottom: "9px",
    color: "#344054",
    fontSize: "12px",
  },
  filterResetButton: {
    border: 0,
    background: "transparent",
    color: "#0f8a56",
    padding: 0,
    fontSize: "11px",
    fontWeight: 800,
    cursor: "pointer",
  },
  documentFilterGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "8px",
  },
  documentFilterField: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    color: "#667085",
    fontSize: "11px",
    fontWeight: 800,
  },
  documentFilterFieldWide: {
    gridColumn: "1 / -1",
  },
  documentFilterControl: {
    width: "100%",
    minWidth: 0,
    height: "32px",
    border: "1px solid #d0d5dd",
    borderRadius: "6px",
    background: "#ffffff",
    color: "#111827",
    padding: "0 7px",
    fontSize: "11px",
    fontWeight: 700,
  },
  attachmentOnlyFilter: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    marginTop: "10px",
    color: "#344054",
    fontSize: "12px",
    fontWeight: 700,
  },
  documentSearchInput: {
    width: "100%",
    height: "36px",
    border: "1px solid #d0d5dd",
    borderRadius: "8px",
    background: "#ffffff",
    color: "#111827",
    fontSize: "12px",
    fontWeight: 700,
    padding: "0 10px",
    marginBottom: "8px",
    outline: "none",
  },
  documentList: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    maxHeight: "560px",
    overflowY: "auto",
  },
  documentListMobile: {
    maxHeight: "none",
    overflowY: "visible",
  },
  documentButton: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    border: "1px solid #e5e7eb",
    borderRadius: "10px",
    background: "#ffffff",
    padding: "10px 11px",
    textAlign: "left",
    cursor: "pointer",
  },
  documentButtonActive: {
    borderColor: "#0f8a56",
    background: "#f6fbf8",
    boxShadow: "0 0 0 1px rgba(15, 138, 86, 0.08)",
  },
  documentTagRow: {
    display: "flex",
    alignItems: "center",
    gap: "5px",
    flexWrap: "wrap",
  },
  relationBadge: {
    display: "inline-flex",
    borderRadius: "999px",
    background: "#eef2f6",
    color: "#475467",
    padding: "3px 7px",
    fontSize: "10px",
    fontWeight: 800,
  },
  actionBadge: {
    display: "inline-flex",
    borderRadius: "999px",
    background: "#ecfdf3",
    color: "#047857",
    padding: "3px 7px",
    fontSize: "10px",
    fontWeight: 850,
  },
  historyMonthGroup: {
    display: "grid",
    gap: "8px",
  },
  historyMonthHeader: {
    width: "100%",
    minHeight: "38px",
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto auto",
    alignItems: "center",
    gap: "8px",
    border: "1px solid #d0d5dd",
    borderRadius: "8px",
    background: "#f8fafc",
    color: "#111827",
    padding: "0 10px",
    textAlign: "left",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 900,
  },
  historyMonthList: {
    display: "grid",
    gap: "8px",
    paddingLeft: "8px",
    borderLeft: "2px solid #e5e7eb",
  },
  documentTopLine: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "8px",
    color: "#111827",
    fontSize: "12px",
    lineHeight: 1.35,
  },
  documentTitleText: {
    flex: 1,
    minWidth: 0,
    color: "#0f172a",
    fontSize: "13px",
    fontWeight: 900,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  documentMeta: {
    color: "#667085",
    fontSize: "11px",
    fontWeight: 500,
  },
  documentProgress: {
    borderRadius: "9px",
    background: "#f8fafc",
    color: "#344054",
    fontSize: "12px",
    fontWeight: 800,
    lineHeight: 1.35,
    padding: "8px 9px",
  },
  documentStepRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "5px",
  },
  documentStepBadge: {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: "999px",
    background: "#f1f5f9",
    color: "#64748b",
    padding: "4px 7px",
    fontSize: "10px",
    fontWeight: 850,
  },
  documentStepBadgeApproved: {
    background: "#ecfdf3",
    color: "#047857",
  },
  documentStepBadgeRejected: {
    background: "#fff1f2",
    color: "#dc2626",
  },
  documentStepBadgeCurrent: {
    background: "#fff7ed",
    color: "#c2410c",
  },
  statusBadge: {
    display: "inline-flex",
    alignItems: "center",
    flexShrink: 0,
    height: "22px",
    borderRadius: "999px",
    background: "#edf0f3",
    color: "#344054",
    padding: "0 8px",
    fontSize: "11px",
    fontStyle: "normal",
    fontWeight: 700,
    whiteSpace: "nowrap",
  },
  statusBadgeApproved: {
    background: "#ecfdf3",
    color: "#047857",
  },
  statusBadgeRejected: {
    background: "#fff1f2",
    color: "#dc2626",
  },
  statusBadgeAction: {
    background: "#ecfdf3",
    color: "#047857",
  },
  emptyBox: {
    border: "1px dashed #cfd6df",
    borderRadius: "9px",
    color: "#667085",
    padding: "18px",
    textAlign: "center",
    fontSize: "13px",
    fontWeight: 600,
  },
  detailBox: {
    marginTop: "16px",
    borderTop: "1px solid #edf0f3",
    paddingTop: "16px",
  },
  detailHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
  },
  detailHeaderMobile: {
    flexDirection: "column",
    alignItems: "flex-start",
  },
  detailTitle: {
    margin: "5px 0 0",
    color: "#111820",
    fontSize: "16px",
    lineHeight: 1.4,
  },
  detailMetaGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, 1fr)",
    gap: "8px",
    marginTop: "14px",
  },
  detailMetaGridMobile: {
    gridTemplateColumns: "minmax(0, 1fr)",
  },
  progressNotice: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    marginTop: "12px",
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    background: "#f8fafc",
    color: "#344054",
    padding: "10px",
    fontSize: "12px",
    lineHeight: 1.45,
  },
  progressNoticeApproved: {
    borderColor: "#a7f3d0",
    background: "#ecfdf3",
    color: "#047857",
  },
  progressNoticeRejected: {
    borderColor: "#fecdd3",
    background: "#fff1f2",
    color: "#be123c",
  },
  progressNoticeAction: {
    borderColor: "#86efac",
    background: "#f0fdf4",
    color: "#047857",
  },
  approvalFlowBox: {
    marginTop: "12px",
    border: "1px solid #e5e7eb",
    borderRadius: "10px",
    background: "#ffffff",
    padding: "10px",
  },
  approvalFlowHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "10px",
    flexWrap: "wrap",
    marginBottom: "8px",
    color: "#334155",
    fontSize: "12px",
    fontWeight: 800,
  },
  approvalFlow: {
    display: "flex",
    alignItems: "stretch",
    gap: "6px",
    overflowX: "auto",
    paddingBottom: "2px",
  },
  approvalFlowMobile: {
    alignItems: "stretch",
  },
  approvalFlowStepWrap: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    flexShrink: 0,
  },
  approvalFlowStep: {
    display: "grid",
    gap: "3px",
    minWidth: "96px",
    border: "1px solid #e5e7eb",
    borderRadius: "9px",
    background: "#f8fafc",
    padding: "8px",
    textAlign: "center",
    color: "#475569",
  },
  approvalFlowStepApproved: {
    borderColor: "#86efac",
    background: "#ecfdf3",
    color: "#047857",
  },
  approvalFlowStepRejected: {
    borderColor: "#fecdd3",
    background: "#fff1f2",
    color: "#be123c",
  },
  approvalFlowStepCurrent: {
    borderColor: "#fbbf24",
    background: "#fffbeb",
    color: "#b45309",
  },
  approvalFlowArrow: {
    alignSelf: "center",
    color: "#94a3b8",
    fontSize: "13px",
    fontStyle: "normal",
    fontWeight: 900,
  },
  approvalFlowStatus: {
    justifySelf: "center",
    borderRadius: "999px",
    background: "rgba(255, 255, 255, 0.72)",
    padding: "2px 6px",
    fontSize: "10px",
    fontStyle: "normal",
    fontWeight: 900,
  },
  lineStatusList: {
    display: "flex",
    flexDirection: "column",
    gap: "7px",
    marginTop: "14px",
  },
  lineStatusItem: {
    display: "grid",
    gridTemplateColumns: "64px minmax(0, 1fr) 70px",
    alignItems: "center",
    gap: "8px",
    border: "1px solid #edf0f3",
    borderRadius: "8px",
    padding: "9px",
    color: "#111827",
    fontSize: "12px",
  },
  lineStatusItemMobile: {
    gridTemplateColumns: "54px minmax(0, 1fr) 58px",
    gap: "6px",
    padding: "8px",
  },
  referenceDetailBox: {
    marginTop: "14px",
    border: "1px solid #edf0f3",
    borderRadius: "8px",
    padding: "10px",
  },
  referenceDetailLabel: {
    display: "block",
    color: "#667085",
    fontSize: "11px",
    fontWeight: 800,
    marginBottom: "8px",
  },
  referenceChipRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
  },
  referenceChip: {
    display: "inline-flex",
    alignItems: "center",
    minHeight: "24px",
    borderRadius: "999px",
    background: "#f3f4f6",
    color: "#344054",
    padding: "0 8px",
    fontSize: "11px",
    fontWeight: 800,
  },
  modalOverlay: {
    position: "fixed",
    inset: 0,
    zIndex: 40,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(17, 24, 39, 0.42)",
    padding: "24px",
  },
  modalPanel: {
    width: "min(920px, 100%)",
    maxHeight: "88vh",
    overflowY: "auto",
    borderRadius: "14px",
    border: "1px solid #dfe3e8",
    background: "#ffffff",
    padding: "22px",
    boxShadow: "0 24px 80px rgba(15, 23, 42, 0.18)",
  },
  modalPanelMobile: {
    maxHeight: "92vh",
    padding: "16px",
  },
  modalHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "14px",
    marginBottom: "14px",
  },
  modalHeaderActions: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: "8px",
    flexWrap: "wrap",
  },
  printButton: {
    height: "36px",
    border: "1px solid #0f8a56",
    borderRadius: "8px",
    background: "#0f8a56",
    color: "#ffffff",
    padding: "0 13px",
    fontSize: "12px",
    fontWeight: 850,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  modalMetaGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: "8px",
    marginBottom: "12px",
  },
  modalMetaGridMobile: {
    gridTemplateColumns: "minmax(0, 1fr)",
  },
  documentFieldGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "8px",
    marginTop: "14px",
  },
  documentFieldGridMobile: {
    gridTemplateColumns: "minmax(0, 1fr)",
  },
  documentFieldItem: {
    minHeight: "58px",
    border: "1px solid #edf0f3",
    borderRadius: "8px",
    background: "#fbfcfd",
    padding: "10px",
    display: "flex",
    flexDirection: "column",
    gap: "5px",
  },
  documentFieldItemWide: {
    gridColumn: "1 / -1",
  },
  documentTableBox: {
    marginTop: "14px",
  },
  documentTableTitle: {
    margin: "0 0 8px",
    color: "#111820",
    fontSize: "13px",
    fontWeight: 850,
  },
  documentTableWrap: {
    overflowX: "auto",
    border: "1px solid #edf0f3",
    borderRadius: "8px",
  },
  documentTable: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "12px",
  },
  actionRow: {
    display: "flex",
    gap: "8px",
    marginTop: "14px",
  },
};
