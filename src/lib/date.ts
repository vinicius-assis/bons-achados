const BRAZIL_UTC_OFFSET_MS = -3 * 60 * 60 * 1000; // fixed offset, Brazil has not observed DST since 2019

export function startOfTodayInBrazil(now: Date = new Date()): Date {
  const brazilNow = new Date(now.getTime() + BRAZIL_UTC_OFFSET_MS);
  const startOfDayBrazilMs = Date.UTC(
    brazilNow.getUTCFullYear(),
    brazilNow.getUTCMonth(),
    brazilNow.getUTCDate()
  );
  return new Date(startOfDayBrazilMs - BRAZIL_UTC_OFFSET_MS);
}

export function formatBrazilTime(date: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}
