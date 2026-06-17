type Approval = {
  role: string;
  name: string;
  status: string;
};

type PurchaseResolutionPdfInput = {
  requesterName: string;
  formData: Record<string, unknown>;
  version?: "submitted" | "approved";
  approvals?: Approval[];
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
  return Array.isArray(data.items)
    ? data.items.filter(
        (row): row is Record<string, string> =>
          Boolean(row) && typeof row === "object"
      )
    : [];
}

function numberValue(value: string) {
  const parsed = Number(value.replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function createPurchaseResolutionPdf(
  input: PurchaseResolutionPdfInput
) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);
  const data = input.formData;
  const itemRows = [...rows(data)];
  while (itemRows.length < 20) itemRows.push({});
  const visibleRows = itemRows.slice(0, 20);
  const totalQty = visibleRows.reduce(
    (sum, row) => sum + numberValue(row.qty || ""),
    0
  );
  const totalAmount = visibleRows.reduce((sum, row) => {
    const explicit = numberValue(row.amount || "");
    return (
      sum +
      (explicit ||
        numberValue(row.qty || "") * numberValue(row.unitPrice || ""))
    );
  }, 0);
  const approvals = input.approvals || [
    { role: "담당", name: input.requesterName, status: "작성" },
    { role: "이사", name: "한차현 차장", status: "대기" },
    { role: "본부장", name: "장동철 이사", status: "대기" },
    { role: "사장", name: "신영호 대표이사", status: "대기" },
  ];
  const sheet = document.createElement("div");
  sheet.style.cssText =
    "position:fixed;left:-12000px;top:0;width:794px;height:1123px;padding:48px 48px 36px;box-sizing:border-box;background:#fff;color:#111;font-family:Arial,'Malgun Gothic',sans-serif;";
  sheet.innerHTML = `
    <div class="header">
      <div class="title">
        <div class="logo">ZETA <small>Corporation</small></div>
        <strong>구 매 결 의 서</strong>
        <time>${escapeHtml(text(data, "resolutionDate"))}</time>
      </div>
      <table class="approval"><tbody>
        <tr><th rowspan="2">결<br>재</th>${["담당", "이사", "본부장", "전무", "사장"].map((role) => `<th>${role}</th>`).join("")}</tr>
        <tr>${["담당", "이사", "본부장", "전무", "사장"].map((role) => {
          const approval = approvals.find((item) => item.role === role);
          return `<td><b>${escapeHtml(approval?.name || "")}</b><em>${escapeHtml(approval?.status || "")}</em></td>`;
        }).join("")}</tr>
        <tr><th>협<br>조</th><td></td><td></td><td></td><td colspan="2"></td></tr>
      </tbody></table>
    </div>
    <div class="meta">
      <p><b>▪ 매입처명 :</b>${escapeHtml(text(data, "vendorName"))}</p>
      <p><b>▪ 공 급 처 :</b>${escapeHtml(text(data, "supplier"))}</p>
      <p><b>▪ 담 당 자 :</b>${escapeHtml(text(data, "managerName"))}</p>
      <p><b>▪ 결 제 조 건 :</b>${escapeHtml(text(data, "manufacturingCondition"))}</p>
      <p><b>▪ 연 락 처 :</b>${escapeHtml(text(data, "contact"))}</p>
      <p><b>▪ 일시불/분할 :</b>${escapeHtml(text(data, "paymentTerms"))}</p>
      <p><b>▪ 입고예정일 :</b>${escapeHtml(text(data, "expectedArrivalDate"))}</p>
      <p><b>▪ 하자 이행보증 기간 :</b>${escapeHtml(text(data, "warrantyPeriod"))}</p>
    </div>
    <div class="section"><b>&lt; 구매품목 &gt;</b><span>작성자 : ${escapeHtml(input.requesterName)}</span></div>
    <table class="items">
      <thead>
        <tr><th colspan="3">합 계 금 액</th><th colspan="3">${escapeHtml(text(data, "amountInWords"))}</th><th>₩${totalAmount.toLocaleString()}　${escapeHtml(text(data, "vatType"))}</th></tr>
        <tr><th>번호</th><th>품　명</th><th>규　격</th><th>단위</th><th>수량</th><th>단　가</th><th>금　액</th></tr>
      </thead>
      <tbody>
        ${visibleRows.map((row, index) => `<tr>
          <td>${index + 1}</td><td>${escapeHtml(row.name || "")}</td>
          <td>${escapeHtml(row.spec || "")}</td><td>${escapeHtml(row.unit || "")}</td>
          <td>${escapeHtml(row.qty || "")}</td><td>${escapeHtml(row.unitPrice || "")}</td>
          <td>${escapeHtml(row.amount || "")}</td>
        </tr>`).join("")}
        <tr class="total"><th colspan="3">합　계</th><td></td><td>${totalQty || ""}</td><td></td><td>${totalAmount ? totalAmount.toLocaleString() : ""}</td></tr>
      </tbody>
    </table>
    <footer>${input.version === "approved" ? "최종 승인본" : "제출본"} · NEXUS 전자결재</footer>
    <style>
      *{box-sizing:border-box}table{border-collapse:collapse;table-layout:fixed}.header{display:grid;grid-template-columns:1fr 390px;border:1.5px solid #111;border-bottom:3px solid #111}.title{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:9px;height:118px;border-right:1px solid #111}.logo{font-size:18px;font-weight:800}.logo small{font-size:7px}.title strong{font-size:25px;font-weight:500;letter-spacing:8px;border-bottom:1px solid #111;padding:0 6px 5px}.title time{font-size:10px}
      .approval{width:100%;height:118px}.approval th,.approval td{border:1px solid #111;text-align:center;padding:2px;font-size:8px}.approval th:first-child{width:28px;line-height:1.6}.approval tr{height:39px}.approval td b,.approval td em{display:block;font-size:7px}.approval td em{margin-top:6px;font-style:normal}
      .meta{display:grid;grid-template-columns:1fr 1fr;column-gap:46px;padding:14px 0 11px;border-bottom:3px double #111}.meta p{display:grid;grid-template-columns:120px 1fr;align-items:center;height:31px;margin:0;font-size:10px}.meta b{font-size:10px}.section{display:flex;justify-content:space-between;padding:11px 8px 6px;font-size:10px}
      .items{width:100%;border:2px solid #111;font-size:8px}.items th,.items td{height:28px;border:1px solid #777;padding:2px 5px;text-align:center}.items th:nth-child(1){width:39px}.items th:nth-child(2){width:18%}.items th:nth-child(3){width:24%}.items th:nth-child(4){width:55px}.items th:nth-child(5){width:55px}.items th:nth-child(6){width:75px}.items td:nth-child(2),.items td:nth-child(3){text-align:left}.total th,.total td{height:28px;font-weight:800}
      footer{position:absolute;left:48px;right:48px;bottom:20px;border-top:1px solid #aaa;padding-top:6px;text-align:center;color:#555;font-size:8px}
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
