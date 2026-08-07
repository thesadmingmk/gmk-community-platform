import { collection, doc, setDoc } from 'firebase/firestore';
import { db } from '../context/AuthContext';
import { AuditLog } from '../types';

export async function createAuditLog(
  action: string,
  actorEmail: string,
  entityType: string,
  entityId: string,
  details: string,
  targetName?: string
) {
  try {
    const logsRef = collection(db, "auditLogs");
    const logDoc = doc(logsRef);
    const payload: AuditLog = {
      id: logDoc.id,
      action: action || "",
      actorEmail: actorEmail || "",
      entityType: entityType || "",
      entityId: entityId || "",
      details: details || "",
      timestamp: new Date().toISOString()
    };
    if (targetName !== undefined && targetName !== null) {
      payload.targetName = targetName;
    }
    await setDoc(logDoc, payload);
    console.log(`[AUDIT LOG SUCCESS] Created audit log for action: ${action}`);
  } catch (err) {
    console.error("[AUDIT LOG ERROR] Failed to record transaction log:", err);
  }
}
