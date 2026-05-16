import { query, setUseSQLite } from "./src/lib/db";
setUseSQLite(true);
async function check() {
  const res = await query("SELECT email, role, password_hash FROM users WHERE email = 'arun@technosprint.net'");
  console.log(JSON.stringify(res, null, 2));
  
  function simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return 'h_' + Math.abs(hash).toString(36) + '_' + str.length;
  }
  
  console.log("Expected hash for Password123!:", simpleHash("Password123!"));
  process.exit(0);
}
check();
