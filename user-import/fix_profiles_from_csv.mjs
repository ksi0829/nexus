import fs from "fs";
import { parse } from "csv-parse/sync";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL; // 예: https://xxxxx.supabase.co
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; // sb_secret_...

if (!SUPABASE_URL) throw new Error("SUPABASE_URL is required");
if (!SERVICE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

function cleanHeader(h) {
  // BOM 제거 + 앞뒤 공백 제거
  return String(h || "").replace(/^\uFEFF/, "").trim();
}
function cleanVal(v) {
  return String(v ?? "").trim();
}

async function getAllUsers() {
  const all = [];
  let page = 1;
  const perPage = 1000;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) throw error;

    all.push(...(data?.users || []));
    if (!data?.users || data.users.length < perPage) break;
    page += 1;
  }
  return all;
}

async function run() {
  const csvPath = "./users.csv";
  const csvText = fs.readFileSync(csvPath, "utf8");

  // records를 "객체"로 파싱 + 컬럼 헤더 정리
  const records = parse(csvText, {
    columns: (headers) => headers.map(cleanHeader),
    skip_empty_lines: true,
    trim: true,
  });

  // auth.users 전체를 email->id로 맵핑
  const users = await getAllUsers();
  const emailToId = new Map();
  for (const u of users) {
    if (u.email) emailToId.set(u.email.toLowerCase(), u.id);
  }

  let ok = 0;
  let miss = 0;

  for (const r of records) {
    const email = cleanVal(r.email).toLowerCase();
    const name = cleanVal(r.name);
    const team = cleanVal(r.team);
    const role = cleanVal(r.role) || "user";

    if (!email) continue;

    const userId = emailToId.get(email);
    if (!userId) {
      console.log("❌ auth.users에서 이메일 못찾음:", email);
      miss++;
      continue;
    }

    const payload = {
      id: userId,
      name: name || null,
      team: team || null,
      role,
      must_change_password: true,
    };

    const { error } = await supabase.from("profiles").upsert(payload, {
      onConflict: "id",
    });

    if (error) {
      console.log("❌ profiles upsert 실패:", email, error.message);
      continue;
    }

    console.log("✅ profiles 갱신:", email, name, team, role);
    ok++;
  }

  console.log(`\nDONE ✅ ok=${ok}, auth-missing=${miss}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});