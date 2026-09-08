import React, { useState, useEffect } from 'react';
import { collection, query, getDocs, onSnapshot, where } from 'firebase/firestore';
import { db } from '../context/AuthContext';
import { CommunityEvent, EventRegistration, Family, FamilyMember } from '../types';
import RegistrationManagementWorkspace from './RegistrationManagementWorkspace';
import RegistrationReportingWorkspace from './RegistrationReportingWorkspace';
import AttendanceReport from './shared/AttendanceReport';
import { RefreshCw, Calendar, Users, FileText } from 'lucide-react';

export default function AdminEventsWorkspace() {
  const [events, setEvents] = useState<CommunityEvent[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  
  const [registrations, setRegistrations] = useState<EventRegistration[]>([]);
  const [families, setFamilies] = useState<Family[]>([]);
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([]);
  const [activeTab, setActiveTab] = useState<'management' | 'reports'>('management');

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const eventsSnap = await getDocs(query(collection(db, 'events')));
        const eventsList: CommunityEvent[] = [];
        eventsSnap.forEach((doc) => {
          eventsList.push({ id: doc.id, ...doc.data() } as CommunityEvent);
        });
        // Sort by date (descending)
        eventsList.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        setEvents(eventsList);
        if (eventsList.length > 0 && !selectedEventId) {
          setSelectedEventId(eventsList[0].id);
        }
      } catch (error) {
        console.error('Error fetching events:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchEvents();
  }, []);

  useEffect(() => {
    if (!selectedEventId) {
      setRegistrations([]);
      return;
    }
    
    // Subscribe to registrations for the selected event
    const qRegs = query(
      collection(db, 'event_registrations'),
      where('eventId', '==', selectedEventId)
    );
    
    const unsubRegs = onSnapshot(qRegs, (snap) => {
      const list: EventRegistration[] = [];
      snap.forEach(d => {
        list.push({ id: d.id, ...d.data() } as EventRegistration);
      });
      setRegistrations(list);
    });
    
    return () => unsubRegs();
  }, [selectedEventId]);

  useEffect(() => {
    // Subscribe to families and family members globally
    const unsubFamilies = onSnapshot(collection(db, "families"), (snap) => {
      const list: Family[] = [];
      snap.forEach(d => {
        list.push({ id: d.id, ...d.data() } as Family);
      });
      setFamilies(list);
    });

    const unsubFamilyMembers = onSnapshot(collection(db, "familyMembers"), (snap) => {
      const list: FamilyMember[] = [];
      snap.forEach(d => {
        list.push({ id: d.id, ...d.data() } as FamilyMember);
      });
      setFamilyMembers(list);
    });

    return () => {
      unsubFamilies();
      unsubFamilyMembers();
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 space-x-3 text-stone-500">
        <RefreshCw className="w-5 h-5 animate-spin" />
        <span className="font-bold text-sm tracking-wider uppercase">Loading Events...</span>
      </div>
    );
  }

  const activeEvent = events.find(e => e.id === selectedEventId) || null;

  return (
    <div className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 space-y-6 animate-fadeIn">
      <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-black uppercase tracking-widest text-stone-700 flex items-center space-x-2">
            <Calendar className="w-4 h-4 text-[#0f4c2a]" />
            <span>Event Context Selection</span>
          </h2>
          <p className="text-xs font-medium text-stone-500 mt-1">
            Select an event to load associated registrations and reports.
          </p>
        </div>
        <div className="w-full md:w-80">
          <select
            value={selectedEventId}
            onChange={(e) => setSelectedEventId(e.target.value)}
            className="w-full px-4 py-2.5 border border-stone-250 rounded-xl bg-stone-50 text-stone-900 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-[#0f4c2a] cursor-pointer"
          >
            {events.length === 0 && <option value="">No active events found</option>}
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.eventCode || e.eventId || e.id} — {e.title || e.displayName}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!selectedEventId ? (
        <div className="flex items-center justify-center p-12 bg-white rounded-2xl border border-stone-200">
          <span className="text-sm font-semibold text-stone-500 uppercase tracking-wider">Please select an event</span>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex space-x-2 border-b border-stone-200 pb-2">
            <button
              onClick={() => setActiveTab('management')}
              className={`px-4 py-2 text-sm font-bold uppercase tracking-wider rounded-lg transition-colors flex items-center space-x-2 ${
                activeTab === 'management'
                  ? 'bg-[#0f4c2a] text-white shadow-sm'
                  : 'bg-transparent text-stone-500 hover:text-stone-700 hover:bg-stone-100'
              }`}
            >
              <Users className="w-4 h-4" />
              <span>Registration Management</span>
            </button>
            <button
              onClick={() => setActiveTab('reports')}
              className={`px-4 py-2 text-sm font-bold uppercase tracking-wider rounded-lg transition-colors flex items-center space-x-2 ${
                activeTab === 'reports'
                  ? 'bg-[#0f4c2a] text-white shadow-sm'
                  : 'bg-transparent text-stone-500 hover:text-stone-700 hover:bg-stone-100'
              }`}
            >
              <FileText className="w-4 h-4" />
              <span>Reports</span>
            </button>
          </div>

          {activeTab === 'management' ? (
            <RegistrationManagementWorkspace 
              eventId={selectedEventId} 
              activeEvent={activeEvent}
              events={events}
              registrations={registrations}
              families={families}
              familyMembers={familyMembers}
            />
          ) : (
            <div className="space-y-6">
              <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-4">
                <RegistrationReportingWorkspace 
                  events={events}
                  registrations={registrations}
                  families={families}
                  familyMembers={familyMembers}
                  activeEvent={activeEvent}
                />
              </div>
              <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-4">
                <h3 className="text-sm font-black uppercase tracking-widest text-stone-700 mb-4 ml-1">Event Attendance Reports</h3>
                <AttendanceReport initialEventId={selectedEventId} hideSelector={true} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

