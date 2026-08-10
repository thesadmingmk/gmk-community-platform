import React, { useState } from 'react';
import { db } from '../../context/AuthContext';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { Family, ResidentProfile } from '../../types';
import { Search, MapPin, Briefcase, Phone, Mail, Heart, ShieldAlert, Sparkles, AlertCircle, RefreshCw } from 'lucide-react';
import { normalizeName } from '../../utils/nameNormalization';

// Search categories
const EXPERTISE_CATEGORIES = [
  "Healthcare", "Automotive", "Logistics", "Construction", "Interior Design",
  "Education", "Finance", "Legal", "Technology", "Hospitality", "Retail",
  "Government", "Business Owner", "Other"
];

export default function ProfessionalSearch() {
  const [loading, setLoading] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<Family[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Keep track of which card contact details have been requested / unlocked
  const [unlockedContacts, setUnlockedContacts] = useState<Record<string, boolean>>({});

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);
    setHasSearched(true);
    setUnlockedContacts({});

    try {
      // 1. Fetch from families collection based on directoryConsent
      const qFam = query(
        collection(db, "families"), 
        where("directoryConsent", "==", true),
        where("onboardingCompleted", "==", true)
      );
      const snap = await getDocs(qFam);
      const list: Family[] = [];

      snap.forEach(d => {
        list.push({ id: d.id, ...d.data() } as Family);
      });

      // 2. Perform in-memory client-side filters for Category and Search Query matching
      interface DirectoryEntry {
        id: string;
        personType: 'primary' | 'spouse';
        fullName: string;
        salutation?: string;
        professionCategory: string;
        professionTitle: string;
        company: string;
        expertiseCategories: string[];
        contactPreference?: string;
        email: string;
        phone: string;
        doctorConsent: boolean;
      }

      let entries: DirectoryEntry[] = [];

      list.forEach(f => {
        const option = f.directoryOption || (f.directoryConsent ? 'me' : 'none');

        if (option === 'me' || option === 'both') {
          if (f.professionTitle || f.professionCategory) {
            entries.push({
              id: `${f.id}_primary`,
              personType: 'primary',
              fullName: f.fullName,
              salutation: f.salutation,
              professionCategory: f.professionCategory || '',
              professionTitle: f.professionTitle || '',
              company: f.company || '',
              expertiseCategories: f.expertiseCategories || [],
              contactPreference: f.contactPreference,
              email: f.primaryMemberEmail || '',
              phone: f.phone || '',
              doctorConsent: f.doctorConsent || false
            });
          }
        }

        if (option === 'spouse' || option === 'both') {
          if (f.spouseProfessionTitle || f.spouseProfessionCategory) {
            entries.push({
              id: `${f.id}_spouse`,
              personType: 'spouse',
              fullName: f.spouseName || 'Spouse',
              salutation: '',
              professionCategory: f.spouseProfessionCategory || '',
              professionTitle: f.spouseProfessionTitle || '',
              company: f.spouseCompany || '',
              expertiseCategories: f.spouseExpertiseCategories || [],
              contactPreference: f.spouseContactPreference || f.contactPreference,
              email: f.spouseEmail || f.primaryMemberEmail || '',
              phone: f.spouseWhatsApp || f.spousePhone || f.phone || '',
              doctorConsent: f.spouseDoctorConsent || false
            });
          }
        }
      });

      let filtered = [...entries];

      if (selectedCategory) {
        filtered = filtered.filter(f => {
          const matchesPrimary = f.professionCategory === selectedCategory;
          const matchesMulti = Array.isArray(f.expertiseCategories) && f.expertiseCategories.includes(selectedCategory);
          return matchesPrimary || matchesMulti;
        });
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        filtered = filtered.filter(f => {
          const salutationLower = (f.salutation || '').toLowerCase();
          const isDrSalutation = salutationLower === 'dr' || salutationLower === 'dr.';
          const queryMatchesDoctor = q.includes('doctor') || q.includes('dr') || q.includes('dr.');
          const salutationMatch = isDrSalutation && queryMatchesDoctor;

          return (
            (f.fullName || '').toLowerCase().includes(q) ||
            (f.professionTitle || '').toLowerCase().includes(q) ||
            (f.company || '').toLowerCase().includes(q) ||
            salutationMatch
          );
        });
      }

      setResults(filtered as any);
    } catch (err: any) {
      console.error("❌ Expertise search failure:", err);
      setErrorMsg("Database connection error. Failed to retrieve experts directory.");
    } finally {
      setLoading(false);
    }
  };

  const handleRequestContact = (id: string) => {
    setUnlockedContacts(prev => ({
      ...prev,
      [id]: true
    }));
  };

  return (
    <div className="space-y-6 animate-fadeIn text-xs font-semibold text-stone-600">
      
      {/* Intro block */}
      <div className="bg-white border border-stone-250 rounded-3xl p-6 md:p-8 space-y-4 shadow-sm">
        <div className="flex items-center space-x-2">
          <Briefcase className="w-5 h-5 text-[#d4af37]" />
          <h3 className="text-base font-extrabold text-[#0f4c2a] uppercase tracking-wider font-heading">GMK Community Expertise</h3>
        </div>
        <p className="text-stone-800 text-xs leading-relaxed max-w-2xl font-semibold">
          Need legal counsel, computing assistance, or interior contracting guidance? Search qualified expertise right within Al Hail Greens. All directory listings represent verified residents who have explicitly consented to community discoverability rules.
        </p>

        {/* Search Input Box */}
        <form onSubmit={handleSearch} className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
          <div>
            <label className="block text-[10px] uppercase font-bold text-stone-850 font-black mb-1">Expertise Category</label>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="block w-full px-3 py-2.5 border border-stone-250 rounded-xl bg-stone-50/50 text-stone-900 focus:ring-1 focus:ring-[#0f4c2a] focus:border-[#0f4c2a] cursor-pointer font-bold"
            >
              <option value="">-Select-</option>
              {EXPERTISE_CATEGORIES.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] uppercase font-bold text-stone-850 font-black mb-1">Keywords</label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="block w-full px-3 py-2.5 border border-stone-250 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#0f4c2a] focus:border-[#0f4c2a] text-stone-900 bg-stone-50/50 font-bold"
            />
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-[#0f4c2a] hover:bg-[#125831] text-white font-bold uppercase tracking-wider rounded-xl transition-all shadow flex items-center justify-center space-x-2 cursor-pointer h-[38px] cursor-pointer"
            >
              {loading ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <>
                  <Search className="w-3.5 h-3.5" />
                  <span>Execute Search</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Error alert */}
      {errorMsg && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-red-700 font-semibold shadow-sm animate-fadeIn">
          <p>{errorMsg}</p>
        </div>
      )}

      {/* Search Result section (Strict: search only, no listings shown before search) */}
      {hasSearched && (
        <div className="space-y-4 animate-fadeIn">
          <div className="flex items-center justify-between border-b border-stone-150 pb-2">
            <h4 className="text-xs font-black text-[#0f4c2a] uppercase tracking-widest">Search Results</h4>
            <span className="text-[10px] bg-stone-100 text-stone-850 font-bold px-2 py-0.5 rounded-full border border-stone-250 font-mono">Found: {results.length}</span>
          </div>

          {results.length === 0 ? (
            <div className="p-12 text-center bg-white border border-stone-250 rounded-3xl space-y-2 max-w-md mx-auto shadow-sm">
              <ShieldAlert className="w-8 h-8 text-[#d4af37] mx-auto opacity-75 animate-bounce" />
              <p className="text-stone-850 font-bold text-xs uppercase tracking-wider">No Matches Registered</p>
              <p className="text-stone-705 text-[11px] font-bold leading-relaxed">No verified resident profiles under Category matching your search query are presently discoverable. Verify search keywords and categorization filters.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {results.map((r) => {
                const isUnlocked = !!unlockedContacts[r.id];
                const isDoc = r.doctorConsent === true && (
                  r.professionCategory === 'Healthcare' || 
                  r.professionTitle.toLowerCase().includes('doctor') ||
                  (r.salutation || '').toLowerCase() === 'dr' ||
                  (r.salutation || '').toLowerCase() === 'dr.'
                );
                
                return (
                  <div key={r.id} className={`bg-white border rounded-3xl p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between space-y-4 ${
                    isDoc ? 'border-[#d4af37]/45 ring-1 ring-[#d4af37]/25 bg-amber-50/5' : 'border-stone-250'
                  }`}>
                    
                    <div className="space-y-3">
                      <div className="flex justify-between items-start font-heading">
                        <span className="px-2.5 py-0.5 bg-[#0f4c2a]/5 text-[#0f4c2a] border border-[#0f4c2a]/10 rounded-full text-[9px] font-bold uppercase tracking-wider font-mono">
                          {r.professionCategory}
                        </span>

                        {isDoc && (
                          <span className="flex items-center space-x-1 text-red-800 bg-red-100 border border-red-200 px-2 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-widest animate-pulse">
                            <Heart className="w-2.5 h-2.5" />
                            <span>Emergencies OK</span>
                          </span>
                        )}
                      </div>

                      <div>
                        {/* Show Name, Profession, Company */}
                        <h5 className="text-xs font-bold text-stone-900 font-heading capitalize block">{r.salutation} {normalizeName(r.fullName)}</h5>
                        <p className="text-stone-800 font-sans text-[10.5px] font-bold mt-1 italic block leading-relaxed">{r.professionTitle}</p>
                        <p className="text-stone-705 font-extrabold text-[9px] uppercase tracking-wider mt-0.5">{r.company}</p>
                        {r.expertiseCategories && r.expertiseCategories.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2.5">
                            {r.expertiseCategories.map((ec: string) => (
                              <span key={ec} className="px-1.5 py-0.5 bg-stone-100 text-stone-805 border border-stone-200 rounded text-[9px] font-bold">
                                {ec}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="pt-3 border-t border-stone-150 space-y-3">
                      {isUnlocked ? (
                        <div className="p-3 bg-stone-50 border border-stone-200 rounded-xl text-[10px] space-y-2 text-stone-850 font-bold leading-none animate-fadeIn">
                          <div className="flex items-center justify-between font-mono text-[9px] text-stone-605 pb-1.5 mb-1.5 border-b border-stone-200/60 block">
                            <span>Preferred Contact:</span>
                            <span className="px-1.5 py-0.5 bg-amber-50 text-amber-900 font-extrabold rounded border border-amber-200 uppercase tracking-wider">{r.contactPreference || 'Any'}</span>
                          </div>
                          <div className="flex items-center space-x-1.5 break-all">
                            <Mail className="w-3.5 h-3.5 text-stone-450 shrink-0" />
                            <span className={r.contactPreference === 'Email' || r.contactPreference === 'Any' || !r.contactPreference ? 'text-[#0f4c2a] font-black' : 'text-stone-500 line-through decoration-stone-300'}>{r.email}</span>
                          </div>
                          <div className="flex items-center space-x-1.5">
                            <Phone className="w-3.5 h-3.5 text-stone-450 shrink-0" />
                            <span className={r.contactPreference === 'Phone' || r.contactPreference === 'WhatsApp' || r.contactPreference === 'Any' || !r.contactPreference ? 'text-[#0f4c2a] font-black' : 'text-stone-500 line-through decoration-stone-300'}>{r.phone}</span>
                          </div>
                          <p className="text-[9px] text-[#0f4c2a] font-bold mt-2 pt-1 border-t border-stone-150 leading-normal">
                            ✓ Consent verified: Stored in accordance with GMK privacy rules. Kindly contact only for business queries or as authorized.
                          </p>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleRequestContact(r.id)}
                          className="w-full py-1.5 text-center bg-stone-105 hover:bg-[#0f4c2a] text-stone-800 hover:text-white border border-stone-250 hover:border-[#0f4c2a] uppercase tracking-wider text-[9px] font-extrabold rounded-xl transition-all cursor-pointer"
                        >
                          Request Contact
                        </button>
                      )}
                    </div>

                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

    </div>
  );
}
