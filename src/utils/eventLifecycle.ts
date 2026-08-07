import { CommunityEvent } from '../types';

export type RegistrationStatusType = 
  | 'not_started' 
  | 'open' 
  | 'closing_soon' 
  | 'closed' 
  | 'completed';

export function getEventRegistrationStatus(event: {
  status?: string;
  date?: string;
  registrationStart?: string;
  registrationEnd?: string;
}): RegistrationStatusType {
  // If explicitly completed
  if (event.status === 'completed' || event.status === 'closed') {
    return 'completed';
  }

  const now = new Date();

  // If event date (start or exact) is passed, treat as completed
  if (event.date) {
    const eventDate = new Date(event.date);
    // Use the calendar date without time, or complete date if there is one
    if (now > eventDate) {
      return 'completed';
    }
  }

  // If registration dates are not specified, default to not started
  if (!event.registrationStart || !event.registrationEnd) {
    return 'not_started';
  }

  const regStart = new Date(event.registrationStart);
  const regEnd = new Date(event.registrationEnd);

  if (now < regStart) {
    return 'not_started';
  }

  if (now > regEnd) {
    return 'closed';
  }

  // Registration closing soon: e.g. within 48 hours of regEnd
  const fortyEightHoursMs = 48 * 60 * 60 * 1000;
  if (regEnd.getTime() - now.getTime() <= fortyEightHoursMs) {
    return 'closing_soon';
  }

  return 'open';
}

export function getRegistrationStatusLabel(status: RegistrationStatusType): string {
  switch (status) {
    case 'not_started':
      return 'Registration Not Started';
    case 'open':
      return 'Register Now';
    case 'closing_soon':
      return 'Registration Closing Soon';
    case 'closed':
      return 'Registration Closed';
    case 'completed':
      return 'Event Completed';
    default:
      return '';
  }
}
