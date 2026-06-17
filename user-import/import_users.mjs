import fs from "fs";
import { parse } from "csv-parse/sync";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const csv = fs.readFileSync("users.csv", "utf8");

const users = parse(csv, {
  columns: true,
  skip_empty_lines: true
});

async function run() {

  for (const u of users) {

    const { data, error } = await supabase.auth.admin.createUser({
      email: u.email,
      password: "0000!",
      email_confirm: true
    });

    if (error) {
      console.log("이미 존재하거나 실패:", u.email);
      continue;
    }

    const userId = data.user.id;

    await supabase.from("profiles").insert({
      id: userId,
      name: u.name,
      team: u.team,
      role: u.role,
      must_change_password: true
    });

    console.log("생성 완료:", u.email);
  }
}

run();