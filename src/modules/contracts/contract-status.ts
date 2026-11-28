import { differenceInCalendarDays, subDays } from "date-fns";

export type ContractStatus =
  | { kind: "EXPIRED" }
  | { kind: "NOTICE_OVERDUE" }
  | { kind: "NOTIFY_BY"; deadline: Date }
  | { kind: "ON_TRACK" };

const NOTICE_WINDOW_DAYS = 30;

export function getContractStatus(
  endDate: Date,
  noticeDays: number,
  today: Date,
): ContractStatus {
  const deadline = subDays(endDate, noticeDays);

  if (differenceInCalendarDays(today, endDate) > 0) {
    return { kind: "EXPIRED" };
  }

  if (differenceInCalendarDays(today, deadline) > 0) {
    return { kind: "NOTICE_OVERDUE" };
  }

  if (differenceInCalendarDays(deadline, today) <= NOTICE_WINDOW_DAYS) {
    return { kind: "NOTIFY_BY", deadline };
  }

  return { kind: "ON_TRACK" };
}
