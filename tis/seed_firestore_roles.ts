import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, serverTimestamp } from "firebase/firestore";
import fs from "fs";

// Load Firebase config
const firebaseConfig = JSON.parse(fs.readFileSync("./firebase-applet-config.json", "utf-8"));

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return 'h_' + Math.abs(hash).toString(36) + '_' + str.length;
}

async function seedFirestore() {
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);

  const accounts = [
    { email: "arun@technosprint.net", name: "Ulter Super Admin", role: "ultra_super_admin", uid: "prod_ultra_admin_fixed" },
    { email: "ulter@technosprint.net", name: "Super Admin", role: "super_admin", uid: "prod_super_admin_fixed" },
    { email: "admin@technosprint.net", name: "Administrator", role: "admin", uid: "prod_admin_fixed" },
    { email: "subadmin@technosprint.net", name: "Sub Admin", role: "sub_admin", uid: "prod_sub_admin_fixed" },
    { email: "agent@technosprint.net", name: "Support Agent", role: "agent", uid: "prod_agent_fixed" }
  ];
  
  const password = "Password123!";
  const passHash = simpleHash(password);

  console.log("Seeding Firestore with updated emails...");

  for (const acc of accounts) {
    const profile = {
      uid: acc.uid,
      name: acc.name,
      email: acc.email,
      role: acc.role,
      passwordHash: passHash,
      createdAt: serverTimestamp(),
      disabled: false
    };

    try {
      await setDoc(doc(db, "users", acc.uid), profile);
      console.log(`✓ Seeded ${acc.name} (${acc.email}) in Firestore`);
    } catch (err: any) {
      // Ignored for connectivity reasons
    }
  }

  process.exit(0);
}

seedFirestore();
