type PurchaseApproval = {
  role: string;
  name: string;
  status: string;
  actedAt?: string | null;
};

type PurchasePdfInput = {
  documentNo: string;
  requesterName: string;
  formData: Record<string, unknown>;
  version?: "submitted" | "approved";
  approvals?: PurchaseApproval[];
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

function rows(data: Record<string, unknown>) {
  const value = data.items;
  return Array.isArray(value)
    ? value.filter(
        (row): row is Record<string, string> =>
          Boolean(row) && typeof row === "object"
      )
    : [];
}

function checked(active: boolean) {
  return active ? "■" : "□";
}

export async function createPurchasePdf(input: PurchasePdfInput) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);
  const data = input.formData;
  const requestType = text(data, "requestType") === "외주" ? "외주" : "구매";
  const itemRows = [...rows(data)];
  while (itemRows.length < 28) itemRows.push({});
  const visibleRows = itemRows.slice(0, 28);
  const totalQty = visibleRows.reduce((sum, row) => {
    const quantity = Number(String(row.qty || "").replaceAll(",", ""));
    return sum + (Number.isFinite(quantity) ? quantity : 0);
  }, 0);
  const approvals = input.approvals || [
    { role: "담당", name: input.requesterName, status: "작성" },
    { role: "팀장", name: "한차현 차장", status: "대기" },
    { role: "본부장", name: "장동철 이사", status: "대기" },
    { role: "대표이사", name: "신영호 대표이사", status: "대기" },
  ];
  const usageOptions = ["원자재", "재공품", "공용품", "판매", "무상", "사무용품", "기타"];
  const sheet = document.createElement("div");
  sheet.style.cssText =
    "position:fixed;left:-12000px;top:0;width:794px;height:1123px;padding:44px 52px 28px;box-sizing:border-box;overflow:hidden;background:#fff;color:#111;font-family:Arial,'Malgun Gothic',sans-serif;";
  sheet.innerHTML = `
    <div class="head">
      <div class="title">
        <div><b>${checked(requestType === "구매")}</b> 구매의뢰서　 <b>${checked(requestType === "외주")}</b> 외주의뢰서</div>
        <small>⊙ 부서 관리 번호<br><strong>${escapeHtml(input.documentNo)}</strong></small>
      </div>
      <table class="approval"><tbody>
        <tr><th rowspan="2">결<br>재</th>${["담당", "팀장", "본부장", "부사장", "대표이사"].map((role) => `<th>${role}</th>`).join("")}</tr>
        <tr>${["담당", "팀장", "본부장", "부사장", "대표이사"]
          .map((role) => {
            const approval = approvals.find((item) => item.role === role);
            return `<td><b>${escapeHtml(approval?.name || "")}</b><em class="${approval?.status === "승인" ? "ok" : ""}">${escapeHtml(approval?.status || "")}</em></td>`;
          })
          .join("")}</tr>
      </tbody></table>
    </div>
    <table class="info">
      <colgroup><col style="width:16%"><col style="width:34%"><col style="width:8%"><col style="width:12%"><col style="width:30%"></colgroup>
      <tbody>
        <tr><th>고 객 사 :</th><td>${escapeHtml(text(data, "client"))}</td><th colspan="2">의 뢰 인 :</th><td>${escapeHtml(input.requesterName)}</td></tr>
        <tr><th>장 비 명 :</th><td>${escapeHtml(text(data, "equipment"))}</td><th colspan="2">입고장소 :</th><td>${escapeHtml(text(data, "deliveryPlace"))}</td></tr>
        <tr><th>S / N :</th><td>${escapeHtml(text(data, "serialNo"))}</td><th rowspan="3">비교<br>자료</th><th>업 체 :</th><td>${escapeHtml(text(data, "comparisonVendor"))}</td></tr>
        <tr><th>의 뢰 일 :</th><td>${escapeHtml(text(data, "requestDate"))}</td><th>장비명 :</th><td>${escapeHtml(text(data, "comparisonEquipment"))}</td></tr>
        <tr><th>입고요청일 :</th><td>${escapeHtml(text(data, "dueDate"))}</td><th>S / N :</th><td>${escapeHtml(text(data, "comparisonSerialNo"))}</td></tr>
        <tr><th>제조 소요시간 :</th><td>${escapeHtml(text(data, "estimatedHours"))}</td><th colspan="2">출고예정일 :</th><td>${escapeHtml(text(data, "shippingDate"))}</td></tr>
        <tr><th>사 용 구 분 :</th><td colspan="4" class="usage">${usageOptions.map((option) => `<span>${checked(text(data, "usageType") === option)} ${option}</span>`).join("")}</td></tr>
      </tbody>
    </table>
    <table class="items">
      <thead><tr><th></th><th>품　명</th><th>규　격</th><th>단위</th><th>수량</th><th>비　고</th></tr></thead>
      <tbody>
        ${visibleRows
          .map(
            (row, index) => `<tr>
              <td>${index + 1}</td>
              <td>${escapeHtml(row.name || "")}</td>
              <td>${escapeHtml(row.spec || row.drawingNo || "")}</td>
              <td>${escapeHtml(row.unit || "")}</td>
              <td>${escapeHtml(row.qty || "")}</td>
              <td>${escapeHtml(row.memo || "")}</td>
            </tr>`
          )
          .join("")}
        <tr class="total"><td colspan="3">합　계</td><td></td><td>${totalQty || ""}</td><td></td></tr>
      </tbody>
    </table>
    <footer>ZETA <small>Corporation</small> · ${input.version === "approved" ? "최종 승인본" : "제출본"}</footer>
    <style>
      *{box-sizing:border-box}table{border-collapse:collapse;table-layout:fixed}
      .head{display:grid;grid-template-columns:minmax(0,1fr) 294px;align-items:end;gap:12px;margin-bottom:7px}
      .title{display:grid;grid-template-rows:1fr auto;align-items:center;justify-items:center;height:92px;padding:6px 0 1px;font-size:20px;font-weight:800;white-space:nowrap}
      .title>div{width:100%;text-align:center}.title>div b{font-size:14px}.title small{display:block;font-size:9px;line-height:1.45;text-align:center}.title small strong{display:block;color:#075e9b;font-size:10px}
      .approval{width:294px;height:92px}.approval th,.approval td{height:auto;border:1px solid #111;padding:2px 1px;text-align:center;font-size:8px;letter-spacing:0}
      .approval th:first-child{width:27px;line-height:1.6}.approval tr:first-child{height:26px}.approval tr:last-child{height:66px}.approval td b,.approval td em{display:block;font-size:7.5px;overflow-wrap:anywhere}.approval td em{margin-top:7px;font-style:normal;color:#777}.approval .ok{color:#111}
      .info{width:100%;font-size:9px}.info th,.info td{height:28px;border:1px solid #b9a975;padding:0 6px;letter-spacing:0}.info th{text-align:center}.info td{text-align:center}.info .usage{height:28px;text-align:center;white-space:nowrap}.usage span{display:inline-block;margin:0 5px;font-size:8px}
      .items{width:100%;font-size:8px}.items th,.items td{height:21px;border:1px solid #b9a975;padding:1px 4px;text-align:center}
      .items th{height:24px;font-size:9px;letter-spacing:1px}.items th:nth-child(1){width:28px}.items th:nth-child(2){width:145px}.items th:nth-child(3){width:160px}.items th:nth-child(4){width:48px}.items th:nth-child(5){width:46px}
      .items td:nth-child(2),.items td:nth-child(3),.items td:nth-child(6){text-align:left}.items .total td{height:24px;font-weight:800;text-align:center}
      footer{height:16px;padding-top:4px;text-align:center;color:#333;font-size:8px;letter-spacing:1px}footer small{font-size:5px;letter-spacing:0}
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
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, 210, 297);
    return pdf.output("blob");
  } finally {
    sheet.remove();
  }
}
