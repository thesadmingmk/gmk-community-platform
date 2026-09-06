import React, { useState, useEffect } from 'react';
import { collection, query, getDocs } from 'firebase/firestore';
import { db } from '../context/AuthContext';
import { CommunityEvent } from '../types';
import ExternalRegistrationsManager from './ExternalRegistrationsManager';
import AttendanceReport from './shared/AttendanceReport';
import { RefreshCw, Calendar } from 'lucide-react';

export default function AdminEventsWorkspace() {
  const [events, setEvents] = useState<CommunityEvent[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [loading, setLoading] = useState(true);

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

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 space-x-3 text-stone-500">
        <RefreshCw className="w-5 h-5 animate-spin" />
        <span className="font-bold text-sm tracking-wider uppercase">Loading Events...</span>
      </div>
    );
  }

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
          <div className="h-[600px] border border-stone-200 rounded-2xl overflow-hidden shadow-xs">
            <ExternalRegistrationsManager eventId={selectedEventId} />
          </div>
          <div className="mt-8 border-t border-stone-200 pt-8">
            <h3 className="text-sm font-black uppercase tracking-widest text-stone-700 mb-4 ml-1">Event Attendance Reports</h3>
            <AttendanceReport initialEventId={selectedEventId} hideSelector={true} />
          </div>
        </div>
      )}
    </div>
  );
}
