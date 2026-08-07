import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';

// Since we are running in a Cloud Run container, the service account credentials are automatically inferred.
// Let's initialize firebase-admin using default credentials.
initializeApp({
  projectId: "gen-lang-client-0905030123"
});

const db = getFirestore();

async function runComparison() {
  console.log("=== FIREBASE SYSTEM INTEGRITY DIAGNOSTIC AND COMPARISON ===");
  const targetEmails = [
    { label: "Resident Test 02", email: "resident.test02@gmk.com" }, // We'll look for exact email matches or label search
    { label: "Resident Test 05", email: "resident.test05@gmk.com" },
    { label: "way2anand@yahoo.com", email: "way2anand@yahoo.com" }
  ];

  // Try to search for residents by email
  for (const t of targetEmails) {
    console.log(`\n--------------------------------------------`);
    console.log(`PROFILE SEARCH: ${t.label} (${t.email})`);
    console.log(`--------------------------------------------`);

    // 1. Resident Document
    const resSnap = await db.collection("residents")
      .where("email", "==", t.email.toLowerCase().trim())
      .get();
    
    if (resSnap.empty) {
      // Try searching for any resident whose name contains the label or check all residents
      console.log(`❌ No resident document found for email: ${t.email}`);
      // Let's do a search based on part of the label or general query
      if (t.label.includes("Test")) {
        const fallbackSnap = await db.collection("residents").get();
        const matches = [];
        fallbackSnap.forEach(doc => {
          const data = doc.data();
          if (data.fullName && data.fullName.toLowerCase().includes(t.label.toLowerCase())) {
            matches.push({ id: doc.id, ...data });
          }
        });
        if (matches.length > 0) {
          console.log(`ℹ️ Fallback matches found by name:`, matches.map(m => m.email));
        }
      }
      continue;
    }

    const resDoc = resSnap.docs[0];
    const resData = resDoc.data();
    const gmkId = resDoc.id;
    console.log(`✅ Resident Document Found!`);
    console.log(`   - Document ID (gmkId): ${gmkId}`);
    console.log(`   - Full Name: ${resData.fullName}`);
    console.log(`   - Flat No: ${resData.flatNo}`);
    console.log(`   - Status: ${resData.status}`);
    console.log(`   - Unit Key: ${resData.unitKey}`);
    console.log(`   - Role: ${resData.role}`);
    console.log(`   - Phone: ${resData.phone}`);
    console.log(`   - Gated Community: ${resData.gatedCommunity}`);
    console.log(`   - Onboarding Completed: ${resData.onboardingCompleted ?? "Not Defined"}`);

    // 2. User Document (UID mapping)
    const userSnap = await db.collection("users")
      .where("email", "==", t.email.toLowerCase().trim())
      .get();
    if (!userSnap.empty) {
      const userDoc = userSnap.docs[0];
      const userData = userDoc.data();
      console.log(`✅ User Document (Auth Mapping) Found!`);
      console.log(`   - UID: ${userDoc.id}`);
      console.log(`   - Roles: ${JSON.stringify(userData.roles)}`);
      console.log(`   - IsActive: ${userData.isActive}`);
    } else {
      console.log(`❌ No user document (Auth Mapping) found in 'users' collection.`);
    }

    // 3. Family Document
    // Family IDs are typically "fam_" + gmkId or just gmkId. Let's query families collection
    const famDocRef1 = db.collection("families").doc(`fam_${gmkId}`);
    const famSnap1 = await famDocRef1.get();
    
    const famDocRef2 = db.collection("families").doc(gmkId);
    const famSnap2 = await famDocRef2.get();

    let familyDocId = null;
    if (famSnap1.exists) {
      familyDocId = `fam_${gmkId}`;
      console.log(`✅ Family Document Found (ID: ${familyDocId})`);
      console.log(`   - Owner Email: ${famSnap1.data().ownerEmail}`);
    } else if (famSnap2.exists) {
      familyDocId = gmkId;
      console.log(`✅ Family Document Found (ID: ${familyDocId})`);
      console.log(`   - Owner Email: ${famSnap2.data().ownerEmail}`);
    } else {
      console.log(`❌ No family document found with ID 'fam_${gmkId}' or '${gmkId}' in 'families' collection.`);
      // Let's search family collection by ownerEmail
      const famQuery = await db.collection("families")
        .where("ownerEmail", "==", t.email.toLowerCase().trim())
        .get();
      if (!famQuery.empty) {
        familyDocId = famQuery.docs[0].id;
        console.log(`ℹ️ Found family document by ownerEmail instead: (ID: ${familyDocId})`);
      } else {
        console.log(`❌ No family document found by ownerEmail.`);
      }
    }

    // 4. Family Members
    if (familyDocId) {
      const memsSnap = await db.collection("familyMembers")
        .where("familyId", "==", familyDocId)
        .get();
      console.log(`✅ Family Members Found (${memsSnap.size} total):`);
      memsSnap.forEach(doc => {
        const d = doc.data();
        console.log(`   - Member: ${d.fullName} (Relation: ${d.relation}, Age: ${d.age}, Email: ${d.email || "N/A"})`);
      });
    }

    // 5. Role Assignments
    const roleAssignSnap = await db.collection("roleAssignments")
      .where("email", "==", t.email.toLowerCase().trim())
      .get();
    if (!roleAssignSnap.empty) {
      console.log(`✅ Dynamic Role Assignments Found:`);
      roleAssignSnap.forEach(doc => {
        const d = doc.data();
        console.log(`   - Assigned Role: ${d.role} (Assigned At: ${d.assignedAt})`);
      });
    } else {
      console.log(`❌ No dynamic Role Assignments found.`);
    }

    // 6. Registrations
    const regSnap = await db.collection("event_registrations")
      .where("residentEmail", "==", t.email.toLowerCase().trim())
      .get();
    if (!regSnap.empty) {
      console.log(`✅ Event Registrations Found (${regSnap.size}):`);
      regSnap.forEach(doc => {
        const d = doc.data();
        console.log(`   - Event: ${d.eventTitle || d.eventId} (Status: ${d.status}, Total Paid: OMR ${d.paymentAmount || d.amountPaid}, Participants: ${d.totalParticipants})`);
      });
    } else {
      console.log(`❌ No existing registrations found.`);
    }
  }
}

runComparison().catch(err => {
  console.error("Diagnostic run failed:", err);
});
