import { nexusApprovalStepRole } from "@/lib/nexus/approvalLabels";
import { formatKstDateKorean, formatKstTime } from "@/app/_lib/kstDate";

type ManufacturingPdfInput = {
  documentNo: string;
  title: string;
  requesterName: string;
  requesterTeam: string;
  formData: Record<string, unknown>;
  inputMode: "modern" | "legacy";
  version?: "submitted" | "approved";
  approvals?: Array<{
    role: string;
    name: string;
    status: string;
    actedAt?: string | null;
    signatureDataUrl?: string | null;
  }>;
};

function text(data: Record<string, unknown>, key: string) {
  const value = data[key];
  return typeof value === "string" && value.trim() ? value.trim() : "-";
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderApprovalStatus(approval: {
  status: string;
  signatureDataUrl?: string | null;
}) {
  if (approval.status === "승인" && approval.signatureDataUrl) {
    console.info("[Approval PDF]", "manufacturing:render_signature", {
      dataUrlLength: approval.signatureDataUrl.length,
    });
    return `<img class="signature-image" src="${escapeHtml(approval.signatureDataUrl)}" alt="승인 서명">`;
  }

  if (approval.status === "승인") {
    console.info("[Approval PDF]", "manufacturing:fallback_approval_mark");
  }

  return `<strong class="${approval.status === "승인" ? "approved" : ""}">${escapeHtml(approval.status)}</strong>`;
}

function isReferenceRow(approval: { role: string; status: string }) {
  return approval.role.includes("참조") || approval.status === "참조";
}

export async function createManufacturingPdf(input: ManufacturingPdfInput) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);
  const data = input.formData;
  const requestType = text(data, "requestType") === "협조" ? "협조" : "제조";
  const approvalRows = input.approvals || [
    { role: nexusApprovalStepRole(0, 2), name: "장동철 이사", status: "대기" },
    { role: nexusApprovalStepRole(1, 2), name: "신영호 대표", status: "대기" },
    { role: "참조", name: "신훈식 부장", status: "참조" },
    { role: "참조", name: "신상민 회장", status: "참조" },
  ];
  const approvalCells = approvalRows.filter((approval) => !isReferenceRow(approval));
  const referenceRows = approvalRows.filter(isReferenceRow);
  const visibleApprovalCells = approvalCells.length > 0 ? approvalCells : approvalRows;
  const approvalColumnCount = Math.max(visibleApprovalCells.length, 1);
  const approvalPanelWidth = Math.min(
    430,
    Math.max(315, 32 + approvalColumnCount * 88)
  );
  const approvalNameFontSize = approvalColumnCount >= 4 ? 10 : 12;
  const approvalStatusFontSize = approvalColumnCount >= 4 ? 13 : 15;
  const approvalCellPadding = approvalColumnCount >= 4 ? "6px 2px" : "7px 3px";
  const signatureImageWidth = approvalColumnCount >= 4 ? 58 : 74;
  console.info("[Approval PDF]", "manufacturing:create", {
    documentNo: input.documentNo,
    version: input.version || "submitted",
    approvalColumnCount,
    approvals: approvalRows.map((approval) => ({
      role: approval.role,
      name: approval.name,
      status: approval.status,
      hasSignature: Boolean(approval.signatureDataUrl),
      signatureDataUrlLength: approval.signatureDataUrl?.length || 0,
    })),
  });
  const sheet = document.createElement("div");
  sheet.style.cssText =
    "position:fixed;left:-12000px;top:0;width:794px;height:1123px;padding:28px 34px;box-sizing:border-box;background:#fff;color:#111;font-family:Arial,'Malgun Gothic',sans-serif;";
  sheet.innerHTML = `
    <div class="top-meta">
      <span>현황 구분 : ${escapeHtml(text(data, "orderCategory"))}</span>
      <span>국가/구분 : ${escapeHtml(text(data, "country"))}</span>
      <span>수주일 : ${escapeHtml(text(data, "orderDate"))}</span>
    </div>
    <div class="title-row" style="grid-template-columns:minmax(0,1fr) ${approvalPanelWidth}px">
      <div class="doc-title">
        <span class="check">${requestType === "제조" ? "■" : "□"}</span> 제조
        <span class="check">${requestType === "협조" ? "■" : "□"}</span> 협조
        <b>요 구 서</b>
      </div>
      <div class="approval-grid" style="grid-template-columns:32px repeat(${approvalColumnCount}, minmax(0,1fr))">
        <div class="approval-label">결<br>재</div>
        ${visibleApprovalCells
          .map(
            (approval) => `<div class="approval-cell">
              <small>${escapeHtml(approval.role)}</small>
              <b>${escapeHtml(approval.name)}</b>
              ${renderApprovalStatus(approval)}
              ${approval.actedAt ? `<time>${escapeHtml(formatKstDateKorean(approval.actedAt))}<br>${escapeHtml(formatKstTime(approval.actedAt))}</time>` : ""}
            </div>`
          )
          .join("")}
      </div>
    </div>
    <div class="copy-row">
      <b>( 영업부 보관용 )</b>
      <span>${input.version === "approved" ? "최종 승인본" : "제출본"}</span>
    </div>
    <div class="info-grid">
      <div class="field"><b>제품명</b><span>${escapeHtml(text(data, "productName"))}</span></div>
      <div class="field"><b>수 량</b><span>${escapeHtml(text(data, "qty"))}</span></div>
      <div class="field"><b>작성일</b><span>${escapeHtml(text(data, "createdDate"))}</span></div>
      <div class="field span2"><b>발주처</b><span>${escapeHtml(text(data, "client"))}</span></div>
      <div class="field"><b>납 기(내)</b><span>${escapeHtml(text(data, "deliveryDate"))}</span></div>
      <div class="field span2"><b>문서 NO</b><span>${escapeHtml(input.documentNo)}</span></div>
      <div class="field"><b>Serial No</b><span>${escapeHtml(text(data, "serialNo"))}</span></div>
    </div>
    <div class="spec-title">S P E C I F I C A T I O N</div>
    <div class="spec-rows">
      <div class="spec power"><b>전 원</b><span>${escapeHtml(text(data, "power"))}</span></div>
      <div class="spec product"><b>제품규격</b><span>${escapeHtml(text(data, "productSpec"))}</span></div>
      <div class="spec"><b>추가사항</b><span>${escapeHtml(text(data, "additional"))}</span></div>
      <div class="spec"><b>참고사항</b><span>${escapeHtml(text(data, "reference"))}</span></div>
      <div class="spec attachment"><b>첨부 메모</b><span>${escapeHtml(text(data, "attachment"))}</span></div>
    </div>
    <div class="reference-grid">
      ${referenceRows
        .map(
          (approval) =>
            `<div><b>${escapeHtml(approval.role)}</b><span>${escapeHtml(approval.name)}</span><em>${escapeHtml(approval.status)}</em></div>`
        )
        .join("")}
      <div><b>작성자</b><span>${escapeHtml(input.requesterName)}</span><em>${escapeHtml(input.requesterTeam || "-")}</em></div>
    </div>
    <footer>NEXUS 전자결재 · ${escapeHtml(input.documentNo)} · ${input.inputMode === "legacy" ? "구형 양식" : "신형 입력"}</footer>
    <style>
      *{box-sizing:border-box} .top-meta{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:7px;font-size:10px;font-weight:700}
      .top-meta span{display:flex;align-items:center;height:28px;border:1px solid #222;padding:0 8px;line-height:1}.title-row{display:grid;grid-template-columns:1fr 315px;border:1.5px solid #111}
      .doc-title{display:flex;align-items:center;justify-content:center;gap:5px;min-height:92px;font-size:20px;font-weight:800}
      .doc-title b{margin-left:8px;font-size:29px;letter-spacing:9px}.check{font-size:14px}.approval-grid{display:grid;grid-template-columns:32px repeat(2,1fr);border-left:1px solid #111}
      .approval-label{display:flex;align-items:center;justify-content:center;border-right:1px solid #111;font-size:13px;font-weight:800;line-height:1.5}
      .approval-cell{display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:4px;padding:${approvalCellPadding};border-right:1px solid #111;text-align:center;min-width:0}
      .approval-cell:last-child{border-right:0}.approval-cell small{font-size:10px}.approval-cell b{max-width:100%;font-size:${approvalNameFontSize}px;line-height:1.2;overflow-wrap:anywhere}.approval-cell strong{font-size:${approvalStatusFontSize}px;color:#777}.approval-cell .approved{color:#111;border:2px solid #111;padding:2px 8px;border-radius:50%}
      .signature-image{display:block;width:${signatureImageWidth}px;max-width:88%;height:24px;object-fit:contain;margin-top:1px}
      .approval-cell time{font-size:8px;line-height:1.35}.copy-row{display:flex;justify-content:space-between;padding:7px 2px 6px;font-size:11px}
      .info-grid{display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid #111;border-left:1px solid #111}
      .field{display:grid;grid-template-columns:74px minmax(0,1fr);height:47px;border-right:1px solid #111;border-bottom:1px solid #111;overflow:hidden}.field.span2{grid-column:span 2}
      .field b,.spec b{display:flex;align-items:center;justify-content:center;height:100%;padding:0 7px;border-right:1px solid #111;background:#f5f5f5;font-size:11px;line-height:1;text-align:center}
      .field span{display:flex;align-items:center;min-width:0;height:100%;padding:0 9px;font-size:11px;line-height:1.25;white-space:pre-wrap;overflow-wrap:anywhere}.spec-title{display:flex;align-items:center;justify-content:center;height:34px;border:1px solid #111;border-top:0;background:#f5f5f5;font-size:14px;font-weight:800;line-height:1;letter-spacing:5px}
      .spec-rows{border-left:1px solid #111;border-right:1px solid #111}.spec{display:grid;grid-template-columns:92px 1fr;min-height:92px;border-bottom:1px solid #111}.spec.power{min-height:42px}.spec.product{min-height:180px}.spec.attachment{min-height:42px}
      .spec span{display:flex;align-items:flex-start;min-width:0;height:100%;padding:11px 12px;font-size:11px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}.spec.power span,.spec.attachment span{align-items:center;padding-top:0;padding-bottom:0}.reference-grid{display:grid;grid-template-columns:repeat(3,1fr);margin-top:9px;border-top:1px solid #111;border-left:1px solid #111}
      .reference-grid div{display:grid;grid-template-columns:58px minmax(0,1fr) 58px;height:38px;border-right:1px solid #111;border-bottom:1px solid #111;font-size:9px;overflow:hidden}.reference-grid b,.reference-grid span,.reference-grid em{display:flex;align-items:center;justify-content:center;min-width:0;height:100%;padding:0 5px;line-height:1.15;text-align:center;overflow-wrap:anywhere}.reference-grid b{background:#f5f5f5;border-right:1px solid #111}.reference-grid em{border-left:1px solid #111;font-style:normal}
      footer{position:absolute;left:34px;right:34px;bottom:18px;border-top:1px solid #aaa;padding-top:7px;text-align:center;color:#555;font-size:8px}
    </style>
  `;
  document.body.appendChild(sheet);
  try {
    const canvas = await html2canvas(sheet, {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
    });
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const image = canvas.toDataURL("image/jpeg", 0.94);
    pdf.addImage(image, "JPEG", 0, 0, 210, 297);
    return pdf.output("blob");
  } finally {
    sheet.remove();
  }
}

export function downloadPdf(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
