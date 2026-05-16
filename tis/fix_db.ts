import { execute, setUseSQLite } from "./src/lib/db";

setUseSQLite(true);

async function fixDb() {
  console.log("Fixing SQLite database schema...");
  try {
    await execute("ALTER TABLE users ADD COLUMN last_login DATETIME");
    console.log("✓ Added last_login column to users table");
  } catch (e: any) {
    if (e.message.includes("duplicate column name")) {
      console.log("! last_login column already exists");
    } else {
      console.error("Failed to add last_login:", e.message);
    }
  }
  process.exit(0);
}

fixDb();
