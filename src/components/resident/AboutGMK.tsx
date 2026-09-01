import React, { useState } from 'react';
import { Compass, Sparkles, Heart, Users, MapPin, Mail, RefreshCw, Layers } from 'lucide-react';
import ReleaseNotesModal from '../ReleaseNotesModal';

export default function AboutGMK() {
  const [isNotesOpen, setIsNotesOpen] = useState(false);

  return (
    <div className="space-y-8 animate-fadeIn text-xs font-semibold text-stone-600">
      
      {/* Editorial Hero block */}
      <div className="relative rounded-3xl overflow-hidden bg-gradient-to-br from-[#0f4c2a] to-[#041a0e] text-white p-8 md:p-12 shadow-xl shadow-emerald-950/20">
        <div className="absolute right-0 bottom-0 translate-x-12 translate-y-12 opacity-5">
          <Compass className="w-96 h-96" />
        </div>
        
        <div className="relative max-w-3xl space-y-4">
          <div className="inline-flex items-center space-x-1.5 bg-white/10 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest text-[#d4af37]">
            <Sparkles className="w-3.5 h-3.5 animate-pulse" />
            <span>Greens Malayalee Koottayma</span>
          </div>
          
          <h3 className="text-3xl md:text-4xl font-extrabold tracking-tight font-heading text-white">
            Culture, Cohesion & Caring Community
          </h3>
          
          <p className="text-emerald-100 text-xs sm:text-sm leading-relaxed font-sans font-medium">
            Greens Malayalee Koottayma (GMK) is the official cultural and social consortium of Malayali residents living inside the Al Hail Greens and surrounding vicinity, Muscat, Oman. Established to protect, celebrate, and propagate traditional cultural roots, GMK functions as a unified support circle and family collective.
          </p>
        </div>
      </div>

      {/* Grid: Vision, Mission, Values */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* Vision */}
        <div className="bg-white border border-stone-250 p-6 rounded-3xl space-y-3 shadow-sm">
          <div className="w-10 h-10 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-[#0f4c2a]">
            <Compass className="w-5 h-5 text-[#d4af37]" />
          </div>
          <h4 className="text-sm font-extrabold text-[#0f4c2a] font-heading uppercase tracking-wide">Our Vision</h4>
          <p className="text-stone-850 font-semibold leading-relaxed font-sans">
            To build a vibrant, harmonious, and highly supportive neighborhood network that celebrates Malayali roots, empowers families, and leads cultural representation in Muscat.
          </p>
        </div>

        {/* Mission */}
        <div className="bg-white border border-stone-250 p-6 rounded-3xl space-y-3 shadow-sm">
          <div className="w-10 h-10 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-[#0f4c2a]">
            <Layers className="w-5 h-5 text-[#d4af37]" />
          </div>
          <h4 className="text-sm font-extrabold text-[#0f4c2a] font-heading uppercase tracking-wide">Our Mission</h4>
          <p className="text-stone-850 font-semibold leading-relaxed font-sans">
            Fostering integration through family gatherings, collaborative support systems, community welfare action, and preserving artistic, educational, and heritage values across generations.
          </p>
        </div>

        {/* Core Values */}
        <div className="bg-white border border-stone-250 p-6 rounded-3xl space-y-3 shadow-sm">
          <div className="w-10 h-10 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-[#0f4c2a]">
            <Heart className="w-5 h-5 text-[#d4af37]" />
          </div>
          <h4 className="text-sm font-extrabold text-[#0f4c2a] font-heading uppercase tracking-wide">Our Values</h4>
          <p className="text-stone-850 font-semibold leading-relaxed font-sans">
            United in welfare, grounded in heritage, prioritizing mutual respect, complete transparency in governance, and active voluntary participation from all households.
          </p>
        </div>

      </div>

      {/* Committee & Contact Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Executive Committee framework */}
        <div className="bg-white border border-stone-250 p-6 rounded-3xl space-y-4 shadow-sm">
          <h4 className="text-sm font-extrabold text-[#0f4c2a] font-heading uppercase tracking-wide flex items-center space-x-1 border-b border-stone-150 pb-2">
            <Users className="w-4 h-4 text-[#d4af37]" />
            <span>Administrative governance structure</span>
          </h4>
          
          <p className="text-stone-800 font-semibold leading-relaxed">
            The GMK operations are organized by the democratically appointed Executive Council, with granular assistance split into special sub-committees:
          </p>

          <div className="space-y-2 text-xs font-semibold text-stone-900 font-mono">
            <div className="flex justify-between py-1 border-b border-stone-100">
              <span className="text-stone-750 font-bold">Executive Council Committee</span>
              <strong className="text-[#0f4c2a] font-black">President, VP, Secretary, Treasurer</strong>
            </div>
            <div className="flex justify-between py-1 border-b border-stone-100">
              <span className="text-stone-750 font-bold">Arts & Cultural Committee</span>
              <strong className="text-[#0f4c2a] font-black">Programs Coordinator & Event Directors</strong>
            </div>
            <div className="flex justify-between py-1 border-b border-stone-100">
              <span className="text-stone-750 font-bold">Welfare & Logistics Team</span>
              <strong className="text-[#0f4c2a] font-black">Ground Operations Leads</strong>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-stone-750 font-bold">Sports & Youth Committee</span>
              <strong className="text-[#0f4c2a] font-black">Annual Games Coordinators</strong>
            </div>
          </div>
        </div>

        {/* Contact info and dynamic version details */}
        <div className="bg-white border border-stone-250 p-6 rounded-3xl space-y-4 shadow-sm flex flex-col justify-between">
          <div className="space-y-4">
            <h4 className="text-sm font-extrabold text-[#0f4c2a] font-heading uppercase tracking-wide flex items-center space-x-1 border-b border-stone-150 pb-2">
              <MapPin className="w-4 h-4 text-[#d4af37]" />
              <span>Contact & Support Desk</span>
            </h4>

            <p className="text-stone-800 font-semibold leading-relaxed">
              Have questions regarding membership eligibility, upcoming registration rules, or professional validation? Write directly to our communications core desk:
            </p>

            <div className="space-y-2 font-sans">
              <div className="flex items-center space-x-2 text-stone-900">
                <Mail className="w-4 h-4 text-stone-705 font-bold" />
                <span className="font-extrabold">support@gmkcommunity.com</span>
              </div>
              <div className="flex items-center space-x-2 text-stone-900">
                <MapPin className="w-4 h-4 text-stone-705 font-bold" />
                <span className="font-extrabold">Al Hail Greens Registry Desk, Muscat, Oman</span>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-stone-150 flex flex-col sm:flex-row items-center justify-between text-xs font-semibold text-stone-500 gap-2">
            <div>
              GMK Resident Portal • Developed by Elite IT
            </div>
            <div>
              Platform Version: <button type="button" onClick={() => setIsNotesOpen(true)} className="font-extrabold text-[#0f4c2a] hover:text-[#125831] underline cursor-pointer">v1.5.9 (Release Notes)</button>
            </div>
          </div>
        </div>

      </div>

      {/* Release Notes Modal */}
      <ReleaseNotesModal isOpen={isNotesOpen} onClose={() => setIsNotesOpen(false)} />

    </div>
  );
}
