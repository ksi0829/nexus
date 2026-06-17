type WorkOrderPdfInput = {
  documentNo: string;
  requesterName: string;
  formData: Record<string, unknown>;
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

export async function createWorkOrderPdf(input: WorkOrderPdfInput) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);
  const data = input.formData;
  const sheet = document.createElement("div");
  sheet.style.cssText =
    "position:fixed;left:-12000px;top:0;width:794px;height:1123px;padding:34px 40px;box-sizing:border-box;background:#fff;color:#111;font-family:Arial,'Malgun Gothic',sans-serif;";
  sheet.innerHTML = `
    <div class="header">
      <div class="title">
        <strong>작 업 지 시 서</strong>
        <time>${escapeHtml(text(data, "issueDate"))}</time>
      </div>
      <div class="issuer">
        <b>생산본부</b>
        <strong>${escapeHtml(input.requesterName || text(data, "requester"))}</strong>
      </div>
    </div>
    <div class="meta">
      <div><b>영업구분</b><span>${escapeHtml(text(data, "marketType"))}</span></div>
      <div><b>발행일</b><span>${escapeHtml(text(data, "issueDate"))}</span></div>
      <div><b>작성자</b><span>${escapeHtml(text(data, "requester") || input.requesterName)}</span></div>
      <div><b>제품명</b><span>${escapeHtml(text(data, "productName"))}</span></div>
      <div><b>수량</b><span>${escapeHtml(text(data, "qty"))}</span></div>
      <div><b>발주처</b><span>${escapeHtml(text(data, "client"))}</span></div>
      <div class="wide"><b>납품일</b><span>${escapeHtml(text(data, "deliveryDate"))}</span></div>
      <div><b>Serial No</b><span>${escapeHtml(text(data, "serialNo"))}</span></div>
      <div class="wide"><b>검수예정일</b><span>${escapeHtml(text(data, "inspectionDate"))}</span></div>
      <div><b>제조완료예정일</b><span>${escapeHtml(text(data, "manufacturingDate"))}</span></div>
    </div>
    <div class="spec-title">S P E C I F I C A T I O N</div>
    <div class="section power"><b>전 원</b><span>${escapeHtml(text(data, "power"))}</span></div>
    <div class="section tall"><b>제품규격</b><span>${escapeHtml(text(data, "productSpec"))}</span></div>
    <div class="section tall"><b>추가규격</b><span>${escapeHtml(text(data, "additionalSpec"))}</span></div>
    <div class="section tall"><b>발 주 처<br>요구사항</b><span>${escapeHtml(text(data, "clientRequirements"))}</span></div>
    <div class="section tall"><b>제 조 시<br>주의사항</b><span>${escapeHtml(text(data, "manufacturingNotes"))}</span></div>
    <div class="section attachment"><b>첨부서류</b><span>${escapeHtml(text(data, "attachments"))}</span></div>
    <footer>NEXUS 작업지시 · ${escapeHtml(input.documentNo)} · 제출본</footer>
    <style>
      *{box-sizing:border-box}.header{display:grid;grid-template-columns:1fr 250px;border:1.5px solid #111}.title{height:108px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;border-right:1px solid #111}.title strong{font-size:30px;letter-spacing:14px;border-bottom:2px solid #111;padding:0 14px 8px}.title time{font-size:11px}.issuer{display:grid;grid-template-rows:38px 1fr}.issuer b,.issuer strong{display:flex;align-items:center;justify-content:center;border-bottom:1px solid #111;font-size:12px}.issuer strong{border-bottom:0;font-size:18px}
      .meta{display:grid;grid-template-columns:80px 1fr 76px 1fr 76px 1fr;border-left:1px solid #111;border-top:0}.meta div{display:contents}.meta b,.meta span{min-height:42px;border-right:1px solid #111;border-bottom:1px solid #111;display:flex;align-items:center;justify-content:center;padding:6px 8px;font-size:11px;text-align:center;line-height:1.25}.meta b{background:#f5f5f5;font-weight:800}.meta span{justify-content:center;overflow-wrap:anywhere}.meta .wide span{grid-column:span 3}
      .spec-title{height:38px;display:flex;align-items:center;justify-content:center;border:1px solid #111;border-top:0;background:#f5f5f5;font-size:14px;font-weight:800;letter-spacing:8px}.section{display:grid;grid-template-columns:92px 1fr;border-left:1px solid #111;border-right:1px solid #111;border-bottom:1px solid #111}.section b{display:flex;align-items:center;justify-content:center;min-height:100%;border-right:1px solid #111;background:#f5f5f5;font-size:11px;line-height:1.5;text-align:center}.section span{display:flex;align-items:flex-start;min-height:100%;padding:12px 14px;font-size:11px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}.section.power{min-height:42px}.section.power span{align-items:center;padding-top:0;padding-bottom:0}.section.tall{min-height:135px}.section.attachment{min-height:78px}
      footer{position:absolute;left:40px;right:40px;bottom:20px;border-top:1px solid #aaa;padding-top:7px;text-align:center;color:#555;font-size:8px}
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
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.94), "JPEG", 0, 0, 210, 297);
    return pdf.output("blob");
  } finally {
    sheet.remove();
  }
}
