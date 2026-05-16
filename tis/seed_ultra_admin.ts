import { execute, query } from "./src/lib/db";

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return 'h_' + Math.abs(hash).toString(36) + '_' + str.length;
}

async function seedAdmin() {
  const accounts = [
    { email: "ultrasuperadmin@technosprint.net", name: "Ultra Super Admin" },
    { email: "ulter@technosprint.net", name: "Ulter Super Admin" }
  ];
  
  const password = "Password123!";
  const role = "ultra_super_admin";
  const passHash = simpleHash(password);

  console.log("Starting database seeding...");

  for (const acc of accounts) {
    console.log(`Seeding user: ${acc.email}`);
    try {
      const existing = await query("SELECT id FROM users WHERE email = ?", [acc.email]);
      if (existing.length > 0) {
        await execute(
          "UPDATE users SET password_hash = ?, role = ?, is_active = 1 WHERE email = ?",
          [passHash, role, acc.email]
        );
        console.log(`Updated existing user: ${acc.email}`);
      } else {
        const uid = `prod_admin_${acc.email.split('@')[0]}_${Date.now()}`;
        await execute(
          "INSERT INTO users (uid, email, name, role, password_hash, is_active) VALUES (?, ?, ?, ?, ?, 1)",
          [uid, acc.email, acc.name, role, passHash]
        );
        console.log(`Created new user: ${acc.email}`);
      }
    } catch (e: any) { 
      console.error(`Failed to seed ${acc.email}:`, e.message); 
    }
  }

  console.log("\n-------------------------------------------");
  console.log("LOGIN CREDENTIALS (ULTRA SUPER ADMIN):");
  for (const acc of accounts) {
    console.log(`Email: ${acc.email}`);
    console.log(`Password: ${password}`);
    console.log(`Role: ${role}`);
    console.log("---");
  }
  console.log("-------------------------------------------\n");
    
  process.exit(0);
}

seedAdmin().catch(err => {
  console.error("Fatal seeding error:", err);
  process.exit(1);
});
