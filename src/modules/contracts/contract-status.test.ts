import { describe, expect, it } from "vitest";

import { getContractStatus } from "./contract-status.js";

// Calendar convention for these tests only: every date is built with the
// local-time constructor, so `day(2026, 12, 31)` is midnight of 31 Dec 2026 in
// the process's time zone. Month is 1-based here to keep scenarios readable.
// No date strings are parsed and the real clock is never read. This does not
// define the date format of the future API.
function day(year: number, month: number, date: number, hours = 0): Date {
  return new Date(year, month - 1, date, hours);
}

// Shared fixture: term ends 2026-12-31, 30-day notice, deadline 2026-12-01.
const endDate = day(2026, 12, 31);
const noticeDays = 30;
const deadline = day(2026, 12, 1);

describe("getContractStatus", () => {
  describe("contract status", () => {
    it("is ON_TRACK well ahead of the notice deadline", () => {
      expect(
        getContractStatus(endDate, noticeDays, day(2026, 6, 15)),
      ).toStrictEqual({ kind: "ON_TRACK" });
    });

    it("is ON_TRACK exactly 31 days before the notice deadline", () => {
      expect(
        getContractStatus(endDate, noticeDays, day(2026, 10, 31)),
      ).toStrictEqual({ kind: "ON_TRACK" });
    });

    it("is NOTIFY_BY exactly 30 days before the notice deadline", () => {
      expect(
        getContractStatus(endDate, noticeDays, day(2026, 11, 1)),
      ).toStrictEqual({ kind: "NOTIFY_BY", deadline });
    });

    it("is NOTIFY_BY on the notice deadline itself", () => {
      expect(
        getContractStatus(endDate, noticeDays, day(2026, 12, 1)),
      ).toStrictEqual({ kind: "NOTIFY_BY", deadline });
    });

    it("is NOTICE_OVERDUE the day after the notice deadline", () => {
      expect(
        getContractStatus(endDate, noticeDays, day(2026, 12, 2)),
      ).toStrictEqual({ kind: "NOTICE_OVERDUE" });
    });

    it("is NOTICE_OVERDUE on the last day of the contract term", () => {
      expect(
        getContractStatus(endDate, noticeDays, day(2026, 12, 31)),
      ).toStrictEqual({ kind: "NOTICE_OVERDUE" });
    });

    it("is EXPIRED the day after the contract term ends", () => {
      expect(
        getContractStatus(endDate, noticeDays, day(2027, 1, 1)),
      ).toStrictEqual({ kind: "EXPIRED" });
    });

    it("gives EXPIRED precedence when both the notice deadline and the term have passed", () => {
      expect(
        getContractStatus(endDate, noticeDays, day(2027, 2, 15)),
      ).toStrictEqual({ kind: "EXPIRED" });
    });

    it("ignores the time of day when counting days to the notice deadline", () => {
      // 23:00 on 2026-10-31 is 31 calendar days, but only 30 days and 1 hour
      // of 24-hour periods, before the deadline.
      expect(
        getContractStatus(endDate, noticeDays, day(2026, 10, 31, 23)),
      ).toStrictEqual({ kind: "ON_TRACK" });
    });
  });

  describe("notice deadline", () => {
    it("subtracts the notice period across a month and a year boundary", () => {
      expect(
        getContractStatus(day(2027, 1, 10), 30, day(2026, 11, 15)),
      ).toStrictEqual({ kind: "NOTIFY_BY", deadline: day(2026, 12, 11) });
    });
  });

  describe("inputs", () => {
    it("does not modify the received dates", () => {
      const receivedEndDate = day(2026, 12, 31);
      const receivedToday = day(2026, 11, 15);
      const endDateInstant = receivedEndDate.getTime();
      const todayInstant = receivedToday.getTime();

      const status = getContractStatus(receivedEndDate, 30, receivedToday);

      expect(receivedEndDate.getTime()).toBe(endDateInstant);
      expect(receivedToday.getTime()).toBe(todayInstant);
      expect(status).toStrictEqual({ kind: "NOTIFY_BY", deadline });
      if (status.kind === "NOTIFY_BY") {
        expect(status.deadline).not.toBe(receivedEndDate);
      }
    });
  });
});
