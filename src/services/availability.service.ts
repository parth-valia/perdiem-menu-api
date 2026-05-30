// Availability service: determines whether a catalog item or category is
// orderable RIGHT NOW at a given location.
//
// Square's availability model (as of 2024):
//   - CatalogAvailabilityPeriod objects linked to categories via
//     categoryData.availabilityPeriodIds
//   - Each period has: dayOfWeek, startLocalTime, endLocalTime
//   - Times are in the location's local timezone (IANA string from Location object)
//
// Trade-off: We resolve availability on the backend per request so the mobile
// client receives a simple boolean + human-readable reason. This costs a bit of
// compute per request but avoids timezone library weight on the client and keeps
// the availability logic in one testable place.

import type { SquareCatalogAvailabilityPeriodObject } from '../types/square.types';

function parseLocalTime(timeStr: string): { hours: number; minutes: number } {
  // Square format: "HH:MM:SS" in local time
  const parts = timeStr.split(':');
  return {
    hours: parseInt(parts[0] ?? '0', 10),
    minutes: parseInt(parts[1] ?? '0', 10),
  };
}

interface LocalMoment {
  dayOfWeek: string; // 'MON', 'TUE', etc.
  hours: number;
  minutes: number;
}

function getCurrentLocalMoment(timezone: string): LocalMoment {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
    hour12: false,
  });

  const parts = formatter.formatToParts(new Date());
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '0';

  let hours = parseInt(get('hour'), 10);
  // Intl hour12:false can return 24 for midnight — normalize to 0
  if (hours === 24) hours = 0;

  return {
    dayOfWeek: get('weekday').toUpperCase().slice(0, 3),
    hours,
    minutes: parseInt(get('minute'), 10),
  };
}

function toMinutes(hours: number, minutes: number): number {
  return hours * 60 + minutes;
}

function isWithinPeriod(
  period: SquareCatalogAvailabilityPeriodObject,
  moment: LocalMoment,
): boolean {
  const periodData = period.availabilityPeriodData;
  if (!periodData) return true; // No data = no restriction

  // If a period specifies a day, it must match
  if (periodData.dayOfWeek) {
    const periodDay = periodData.dayOfWeek.toUpperCase().slice(0, 3);
    if (periodDay !== moment.dayOfWeek) return false;
  }

  const currentMinutes = toMinutes(moment.hours, moment.minutes);

  if (periodData.startLocalTime) {
    const { hours, minutes } = parseLocalTime(periodData.startLocalTime);
    if (currentMinutes < toMinutes(hours, minutes)) return false;
  }

  if (periodData.endLocalTime) {
    const { hours, minutes } = parseLocalTime(periodData.endLocalTime);
    if (currentMinutes >= toMinutes(hours, minutes)) return false;
  }

  return true;
}

export function evaluateAvailability(
  availabilityPeriodIds: string[],
  allPeriods: SquareCatalogAvailabilityPeriodObject[],
  timezone: string,
): { availableNow: boolean; reason?: string } {
  // No periods attached = available always
  if (!availabilityPeriodIds.length) {
    return { availableNow: true };
  }

  const relevantPeriods = allPeriods.filter(p => availabilityPeriodIds.includes(p.id));

  if (!relevantPeriods.length) {
    return { availableNow: true };
  }

  const moment = getCurrentLocalMoment(timezone);

  const available = relevantPeriods.some(p => isWithinPeriod(p, moment));

  if (available) {
    return { availableNow: true };
  }

  // Build a human-readable reason for the UI to display under greyed items
  const reason = buildUnavailableReason(relevantPeriods);
  return { availableNow: false, reason };
}

function buildUnavailableReason(periods: SquareCatalogAvailabilityPeriodObject[]): string {
  const descriptions = periods.map(p => {
    const data = p.availabilityPeriodData;
    if (!data) return 'Limited hours';

    const parts: string[] = [];

    if (data.dayOfWeek) {
      const dayMap: Record<string, string> = {
        MON: 'Mondays',
        TUE: 'Tuesdays',
        WED: 'Wednesdays',
        THU: 'Thursdays',
        FRI: 'Fridays',
        SAT: 'Saturdays',
        SUN: 'Sundays',
      };
      parts.push(dayMap[data.dayOfWeek] ?? data.dayOfWeek);
    }

    if (data.startLocalTime || data.endLocalTime) {
      const fmt = (t: string) => {
        const { hours, minutes } = parseLocalTime(t);
        const period = hours >= 12 ? 'pm' : 'am';
        const h = hours % 12 || 12;
        const m = minutes > 0 ? `:${String(minutes).padStart(2, '0')}` : '';
        return `${h}${m}${period}`;
      };
      const start = data.startLocalTime ? fmt(data.startLocalTime) : '';
      const end = data.endLocalTime ? fmt(data.endLocalTime) : '';
      if (start && end) parts.push(`${start}–${end}`);
      else if (start) parts.push(`after ${start}`);
      else if (end) parts.push(`until ${end}`);
    }

    return parts.length ? `Available ${parts.join(' ')}` : 'Limited hours';
  });

  return descriptions[0] ?? 'Not available right now';
}
