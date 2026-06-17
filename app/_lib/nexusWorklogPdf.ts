type WorklogPdfRow = {
  start: { hh: string; mm: string };
  end: { hh: string; mm: string };
  location: string;
  company: string;
  equipment: string;
  task: string;
  note: string;
};

type WorklogPdfInput = {
  date: string;
  authorName: string;
  team: string;
  previousRows: WorklogPdfRow[];
  todayRows: WorklogPdfRow[];
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function timeText(row: WorklogPdfRow) {
  const start = row.start.hh && row.start.mm ? `${row.start.hh}:${row.start.mm}` : "";
  const end = row.end.hh && row.end.mm ? `${row.end.hh}:${row.end.mm}` : "";
  return start || end ? `${start} ~ ${end}` : "";
}

function sectionRows(rows: WorklogPdfRow[]) {
  const visibleRows = rows.filter((row) =>
    [
      row.start.hh,
      row.start.mm,
      row.end.hh,
      row.end.mm,
      row.location,
      row.company,
      row.equipment,
      row.task,
      row.note,
    ].some(Boolean)
  );

  const padded = [...visibleRows];
  while (padded.length < 3) {
    padded.push({
      start: { hh: "", mm: "" },
      end: { hh: "", mm: "" },
      location: "",
      company: "",
      equipment: "",
      task: "",
      note: "",
    });
  }

  return padded
    .map(
      (row, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(timeText(row))}</td>
          <td>${escapeHtml(row.location)}</td>
          <td>${escapeHtml(row.company)}</td>
          <td>${escapeHtml(row.equipment)}</td>
          <td class="task">${escapeHtml(row.task)}</td>
          <td>${escapeHtml(row.note)}</td>
        </tr>`
    )
    .join("");
}

export async function createNexusWorklogPdf(input: WorklogPdfInput) {
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-10000px";
  host.style.top = "0";
  host.style.width = "794px";
  host.style.background = "#fff";
  host.innerHTML = `
    <article style="box-sizing:border-box;width:794px;min-height:1123px;padding:58px 54px;background:#fff;color:#111;font-family:Pretendard,'Malgun Gothic',sans-serif">
      <header style="display:flex;align-items:flex-end;justify-content:space-between;padding-bottom:18px;border-bottom:3px solid #183c35">
        <div>
          <div style="font-size:12px;letter-spacing:3px;color:#16755f;font-weight:800">ZETA NEXUS</div>
          <h1 style="margin:8px 0 0;font-size:30px;letter-spacing:8px">업 무 일 지</h1>
        </div>
        <div style="text-align:right;font-size:13px;line-height:1.8">
          <b>${escapeHtml(input.date)}</b><br />
          ${escapeHtml(input.team)} · ${escapeHtml(input.authorName)}
        </div>
      </header>
      <section style="margin-top:28px">
        <h2 style="margin:0 0 10px;font-size:17px;color:#183c35">전일 업무</h2>
        <table style="width:100%;border-collapse:collapse;table-layout:fixed;font-size:11px">
          <thead><tr>
            <th style="width:34px">No</th><th style="width:92px">시간</th><th style="width:70px">장소</th>
            <th style="width:90px">업체</th><th style="width:100px">장비</th><th>업무내용</th><th style="width:95px">비고</th>
          </tr></thead>
          <tbody>${sectionRows(input.previousRows)}</tbody>
        </table>
      </section>
      <section style="margin-top:34px">
        <h2 style="margin:0 0 10px;font-size:17px;color:#183c35">금일 업무</h2>
        <table style="width:100%;border-collapse:collapse;table-layout:fixed;font-size:11px">
          <thead><tr>
            <th style="width:34px">No</th><th style="width:92px">시간</th><th style="width:70px">장소</th>
            <th style="width:90px">업체</th><th style="width:100px">장비</th><th>업무내용</th><th style="width:95px">비고</th>
          </tr></thead>
          <tbody>${sectionRows(input.todayRows)}</tbody>
        </table>
      </section>
      <footer style="margin-top:42px;padding-top:14px;border-top:1px solid #b8c8c4;text-align:center;color:#73817e;font-size:10px;letter-spacing:2px">
        ZETA Corporation · NEXUS Worklog
      </footer>
      <style>
        th,td{border:1px solid #778b86;padding:9px 6px;text-align:center;vertical-align:middle;word-break:break-word}
        th{background:#edf4f2;color:#183c35;font-weight:800}
        td.task{text-align:left;white-space:pre-wrap}
      </style>
    </article>`;
  document.body.appendChild(host);

  try {
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
      import("html2canvas"),
      import("jspdf"),
    ]);
    const canvas = await html2canvas(host.firstElementChild as HTMLElement, {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
      logging: false,
    });
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.96), "JPEG", 0, 0, 210, 297);
    return pdf.output("blob");
  } finally {
    host.remove();
  }
}
