const VIENNA_TZ = 'Europe/Vienna';

const dateKeyFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: VIENNA_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const weekdayFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: VIENNA_TZ,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: VIENNA_TZ,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function toDateKey(date) {
  return dateKeyFormatter.format(date);
}

function parseDateKey(dateKey) {
  return new Date(`${dateKey}T12:00:00`);
}

export function getTimeslotSearchRange({ fromDate = new Date(), dayCount = 3 } = {}) {
  const start = new Date(fromDate);
  start.setUTCHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + dayCount);

  return {
    startDate: start.toISOString(),
    endDate: end.toISOString(),
  };
}

export function buildTimeslotDisplay(timeslots, { displayDays = 3, fromDate = new Date() } = {}) {
  const sorted = [...(timeslots || [])].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
  );

  const anchorKey = toDateKey(fromDate);
  const displayDayKeys = Array.from({ length: displayDays }, (_, index) => {
    const day = parseDateKey(anchorKey);
    day.setDate(day.getDate() + index);
    return toDateKey(day);
  });

  const displayKeySet = new Set(displayDayKeys);
  const inWindow = sorted.filter((slot) => displayKeySet.has(toDateKey(new Date(slot.startTime))));
  const beyondWindow = sorted.filter((slot) => !displayKeySet.has(toDateKey(new Date(slot.startTime))));

  let number = 1;
  const days = displayDayKeys.map((dateKey) => {
    const daySlots = inWindow.filter((slot) => toDateKey(new Date(slot.startTime)) === dateKey);

    return {
      date: dateKey,
      label: weekdayFormatter.format(parseDateKey(dateKey)),
      slots: daySlots.map((slot) => {
        const start = new Date(slot.startTime);
        const end = new Date(slot.endTime);
        const entry = {
          number,
          id: slot.id,
          startTime: slot.startTime,
          endTime: slot.endTime,
          label: `${timeFormatter.format(start)} – ${timeFormatter.format(end)}`,
        };
        number += 1;
        return entry;
      }),
    };
  });

  const beyondDates = [...new Set(beyondWindow.map((slot) => toDateKey(new Date(slot.startTime))))].sort();

  return {
    timezone: VIENNA_TZ,
    displayDays,
    days,
    slotsInWindow: inWindow.length,
    hasMoreDates: beyondWindow.length > 0,
    moreDatesCount: beyondDates.length,
    moreDatesNote: beyondWindow.length
      ? `Additional appointment times are available on ${beyondDates.length} later date${beyondDates.length === 1 ? '' : 's'}. Ask if you'd like to see more dates.`
      : null,
    allSlots: sorted.map((slot) => ({
      id: slot.id,
      startTime: slot.startTime,
      endTime: slot.endTime,
    })),
  };
}

export async function listTimeslotOptions(fetchTimeslots, { timeslotLabel, displayDays = 3, horizonDays = 8, fromDate = new Date() }) {
  const search = getTimeslotSearchRange({ fromDate, dayCount: horizonDays });
  const timeslots = await fetchTimeslots({
    timeslotLabel,
    startDate: search.startDate,
    endDate: search.endDate,
  });

  return buildTimeslotDisplay(timeslots, { displayDays, fromDate });
}
