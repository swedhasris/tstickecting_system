import { execute, query, setUseSQLite } from "./src/lib/db";

setUseSQLite(true);

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return 'h_' + Math.abs(hash).toString(36) + '_' + str.length;
}

async function seedAllRoles() {
  const accounts = [
    { email: "arun@technosprint.net", name: "Ulter Super Admin", role: "ultra_super_admin", uid: "prod_ultra_admin_fixed" },
    { email: "ulter@technosprint.net", name: "Super Admin", role: "super_admin", uid: "prod_super_admin_fixed" },
    { email: "admin@technosprint.net", name: "Administrator", role: "admin", uid: "prod_admin_fixed" },
    { email: "subadmin@technosprint.net", name: "Sub Admin", role: "sub_admin", uid: "prod_sub_admin_fixed" },
    { email: "agent@technosprint.net", name: "Support Agent", role: "agent", uid: "prod_agent_fixed" }
  ];
  
  const password = "Password123!";
  const passHash = simpleHash(password);

  console.log("Seeding SQLite with updated emails...");

  for (const acc of accounts) {
    try {
      // First, check if the email exists
      const existing = await query("SELECT id FROM users WHERE email = ?", [acc.email]);
      
      if (existing.length > 0) {
        await execute(
          "UPDATE users SET uid = ?, password_hash = ?, role = ?, name = ?, is_active = 1 WHERE email = ?",
          [acc.uid, passHash, acc.role, acc.name, acc.email]
        );
        console.log(`✓ Updated ${acc.email} to ${acc.role}`);
      } else {
        // Check if the UID exists (to prevent unique constraint error if swapping emails)
        const existingUid = await query("SELECT id FROM users WHERE uid = ?", [acc.uid]);
        if (existingUid.length > 0) {
            await execute(
                "UPDATE users SET email = ?, password_hash = ?, role = ?, name = ?, is_active = 1 WHERE uid = ?",
                [acc.email, passHash, acc.role, acc.name, acc.uid]
            );
            console.log(`✓ Reassigned UID ${acc.uid} to ${acc.email} (${acc.role})`);
        } else {
            await execute(
                "INSERT INTO users (uid, email, name, role, password_hash, is_active) VALUES (?, ?, ?, ?, ?, 1)",
                [acc.uid, acc.email, acc.name, acc.role, passHash]
            );
            console.log(`✓ Created new user: ${acc.email} (${acc.role})`);
        }
      }
    } catch (e: any) { 
      console.error(`Failed to seed ${acc.email}:`, e.message); 
    }
  }

  process.exit(0);
}

seedAllRoles();
