import React, { useEffect, useState } from 'react';
import { collection, getDocs, setDoc, query, doc, orderBy } from 'firebase/firestore';
import { db } from '../context/AuthContext';
import { X, RefreshCw, Milestone, Calendar, Award } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface ReleaseNoteItem {
  version: string;
  title: string;
  releaseDate: string;
  author: string;
  notes: string[];
}

interface ReleaseNotesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const DEFAULT_NOTES: ReleaseNoteItem[] = [
  {
    version: "v1.4.0",
    title: "Deployment Automation & Password Activation Release",
    releaseDate: "2026-06-25",
    author: "Elite IT",
    notes: [
      "Unified Deployment Bindings: Configured firebase.json targeting firestore.rules and firestore.indexes.json for direct zero-friction firebase deploy actions",
      "Robust Firestore Security Rules: Hardened the real-time databases with custom-scoped, role-based protection clauses targeting emailQueue and emailTemplates",
      "Dynamic Password Activation: Engineered URL query parsing inside the IdentityGateway to pre-fill emails and display password-creation forms from direct-link inflows",
      "Onboarding Notification Upgrade: Standardized onboarding guidelines and template seeding inside the AuthContext to explain security processes and the activation loop clearly"
    ]
  },
  {
    version: "v1.3.0",
    title: "Eventarc Deserialization & SMTP Direct Retrieval Fix",
    releaseDate: "2026-06-25",
    author: "Elite IT",
    notes: [
      "Bypassed event-based serialization limitations in Cloud Functions v2 by executing direct live document lookups on custom-named databases",
      "Eliminated empty snapshot/payload properties by fetching real-time database state dynamically using the queueId context",
      "Ensured zero-loss SMTP dispatch operations, verified processed states, and successfully completed fully-functional Trial 1"
    ]
  },
  {
    version: "v1.2.0",
    title: "GMK Secure Notification Engine Launch",
    releaseDate: "2026-06-25",
    author: "Elite IT",
    notes: [
      "Architected a decoupled NotificationService layer as the unified API for portal email operations",
      "Engineered a production-ready Firebase Cloud Function v2 triggered by emailQueue onDocumentCreated",
      "Secured transmission with Secret Manager (GMK_SMTP_USER & GMK_SMTP_PASSWORD) and SSL/TLS on port 465",
      "Integrated template parser for replacing placeholders (residentName, gmkId, unit, website, etc.) on-the-fly",
      "Hardened delivery with automatic incremental retry limits, transactional safety guards, and comprehensive logging"
    ]
  },
  {
    version: "v1.1.0",
    title: "Governance & Regional Sync Enhancements",
    releaseDate: "2026-06-25",
    author: "Elite IT",
    notes: [
      "Transitioned entire system and database default community name to 'Al Hail Greens'",
      "Standardized mobile numbers and eliminated double-country prefixing globally via formatPhoneWithCountryCode",
      "Engineered real-time double snapshot listeners to eliminate role unassign/revoke replication latency",
      "Added optimistic state updates in SuperAdmin role operations for instant HUD updates",
      "Added '-Select Role-' default placeholder and enforced absolute exclusivity blocking in dropdown selectors",
      "Developed comprehensive auditable release logs and integrated developed-by annotations"
    ]
  },
  {
    version: "v1.0.0",
    title: "Initial Governance Platform",
    releaseDate: "2026-06-20",
    author: "Elite IT",
    notes: [
      "Resident Registration",
      "Admin Approval Workflow",
      "Role Assignments",
      "Audit Logging",
      "Governance Security Hardening"
    ]
  }
];

export default function ReleaseNotesModal({ isOpen, onClose }: ReleaseNotesModalProps) {
  const [notesList, setNotesList] = useState<ReleaseNoteItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    const fetchReleaseNotes = async () => {
      setLoading(true);
      try {
        const q = query(collection(db, "releaseNotes"));
        const snapshot = await getDocs(q);
        
        if (snapshot.empty) {
          setNotesList(DEFAULT_NOTES);
          
          try {
            await setDoc(doc(db, "releaseNotes", "v1_0_0"), DEFAULT_NOTES[4]);
            await setDoc(doc(db, "releaseNotes", "v1_1_0"), DEFAULT_NOTES[3]);
            await setDoc(doc(db, "releaseNotes", "v1_2_0"), DEFAULT_NOTES[2]);
            await setDoc(doc(db, "releaseNotes", "v1_3_0"), DEFAULT_NOTES[1]);
            await setDoc(doc(db, "releaseNotes", "v1_4_0"), DEFAULT_NOTES[0]);
            console.log("🌱 Successfully seeded default release notes to Firestore.");
          } catch (err) {
            console.log("ℹ️ Skipping auto-seed: ", err);
          }
        } else {
          const list: ReleaseNoteItem[] = [];
          snapshot.forEach((d) => {
            const data = d.data();
            list.push({
              version: data.version || d.id,
              title: data.title || 'Update Release',
              releaseDate: data.releaseDate || '2026-06-20',
              author: data.author || 'Elite IT',
              notes: Array.isArray(data.notes) ? data.notes : []
            });
          });
          
          // Merge with DEFAULT_NOTES to make sure v1.1.0 and v1.0.0 are always present
          DEFAULT_NOTES.forEach(dn => {
            if (!list.some(item => item.version === dn.version)) {
              list.push(dn);
              // Try to write it back so DB is updated
              const docId = dn.version.replace('.', '_');
              setDoc(doc(db, "releaseNotes", docId), dn).catch(() => {});
            }
          });
          
          // Sort list by version descending
          list.sort((a, b) => b.version.localeCompare(a.version));
          setNotesList(list);
        }
      } catch (err) {
        console.error("⚠️ Failed to load release notes from Firestore:", err);
        setNotesList(DEFAULT_NOTES); // Safe fallback
      } finally {
        setLoading(false);
      }
    };

    fetchReleaseNotes();
  }, [isOpen]);

  // Trap focus or prevent back-scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-stone-900/60 backdrop-blur-sm"
          />

          {/* Modal Content container */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            transition={{ type: "spring", duration: 0.4 }}
            className="relative bg-white w-full max-w-lg rounded-xl shadow-2xl border border-stone-200 overflow-hidden flex flex-col max-h-[85vh] z-10"
          >
            {/* Header */}
            <div className="px-6 py-4 bg-[#0F4C2A] text-white flex items-center justify-between border-b border-white/10 shrink-0">
              <div className="flex items-center space-x-2">
                <Milestone className="w-5 h-5 text-[#D4AF37]" />
                <div>
                  <h3 className="text-base font-serif font-bold tracking-wide">Platform Release Notes</h3>
                  <p className="text-[10px] text-[#D4AF37] font-mono uppercase tracking-widest">Version Auditable Logs</p>
                </div>
              </div>
              
              <button
                onClick={onClose}
                aria-label="Close"
                className="p-1 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-stone-50">
              {loading ? (
                <div className="flex flex-col items-center justify-center py-20 space-y-3">
                  <RefreshCw className="w-6 h-6 text-[#0F4C2A] animate-spin" />
                  <p className="text-xs font-mono text-stone-500">Retrieving system evolution logs...</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {notesList.map((item, index) => (
                    <div
                      key={item.version}
                      className="bg-white border border-stone-200 rounded-lg p-5 shadow-sm space-y-4 hover:border-[#D4AF37]/50 transition-all duration-200"
                    >
                      {/* Version Header */}
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 pb-2.5">
                        <div className="flex items-center space-x-2">
                          <span className="bg-[#0F4C2A] text-white font-mono text-xs font-bold px-2.5 py-0.5 rounded">
                            {item.version}
                          </span>
                          <h4 className="font-serif font-bold text-stone-900 text-sm">
                            {item.title}
                          </h4>
                        </div>
                        <div className="flex items-center space-x-1 text-[11px] font-mono text-stone-400">
                          <Calendar className="w-3 h-3 text-[#D4AF37]" />
                          <span>{item.releaseDate}</span>
                        </div>
                      </div>

                      {/* Notes bullet points list */}
                      <ul className="space-y-2.5">
                        {item.notes.map((note, idx) => (
                          <li key={idx} className="flex items-start text-xs font-mono text-stone-700 leading-normal">
                            <span className="text-[#D4AF37] mr-2 mt-0.5 select-none shrink-0">•</span>
                            <span className="flex-1">{note}</span>
                          </li>
                        ))}
                      </ul>

                      {/* Author credentials footer */}
                      <div className="flex px-3 py-1 bg-amber-50/40 rounded border border-amber-200/20 text-[10px] font-mono text-stone-500 justify-between items-center sm:text-xs">
                        <span className="flex items-center space-x-1">
                          <Award className="w-3.5 h-3.5 text-[#D4AF37] shrink-0" />
                          <span>Delivered by: <strong>{item.author}</strong></span>
                        </span>
                        <span className="text-[10px] text-[#0F4C2A] font-bold">PRODUCTION VERIFIED</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer buttons */}
            <div className="px-6 py-4 bg-white border-t border-stone-100 flex justify-end shrink-0">
              <button
                onClick={onClose}
                className="px-4 py-1.5 bg-[#0F4C2A] text-white hover:bg-[#072414] font-mono text-xs font-bold uppercase tracking-wider rounded transition-all cursor-pointer shadow"
              >
                Close Logs
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
