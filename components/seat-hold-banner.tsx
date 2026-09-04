"use client";

import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/i18n-provider";
import { format } from "@/lib/i18n";
import { formatSeatHoldClock } from "@/lib/seat-hold";
import { releaseSeatHold, useSeatHold } from "@/hooks/use-seat-hold";

/**
 * What is happening to the guest's seats, on every screen after the calendar.
 *
 * The seats are held for a quarter of an hour and the guest is the last person
 * who should have to guess at that. So it is on the screen the whole way
 * through: how long is left while there is time, and what happened the moment
 * there is not.
 *
 * ## It never navigates on its own
 *
 * When the hold runs out this puts up a message with a button, and waits. That
 * is the rule this whole feature was written to establish — a guest is never
 * moved between steps without being told why — and it is a rule about the
 * *expired* case above all, because that is the one where they have already
 * chosen six dishes and the screen has bad news.
 *
 * ## The last two minutes look different
 *
 * Not because the guest can do much about it, but because a quiet grey line
 * saying `1:58` is easy to read as decoration. Under two minutes it turns to a
 * warning, which is the point at which somebody deciding between two desserts
 * should know they are deciding against a clock.
 */
export function SeatHoldBanner() {
  const router = useRouter();
  const { session, standing } = useSeatHold();
  const { t } = useI18n();

  /**
   * Nothing to say. Either the guest has not reached the calendar yet, or this
   * evening was booked from a screen open since before holds existed — in which
   * case the booking still works and inventing a countdown for a hold that does
   * not exist would be worse than silence.
   */
  if (standing.state === "none") {
    return null;
  }

  /**
   * The hold is for a different evening or a bigger party than the session now
   * says — the guest went back and changed their mind. Nothing is wrong yet:
   * the calendar retakes the hold when they come forward again, and saying
   * anything here would be alarming about a state the guest cannot see.
   */
  if (standing.state === "stale") {
    return null;
  }

  if (standing.state === "expired") {
    return (
      <Alert tone="warning" className="mb-6">
        <span className="block">{t.seatHold.expired}</span>
        <Button
          className="mt-3"
          onClick={() => {
            // Already gone on the server; this clears the session so the
            // calendar does not offer to move a hold that is not there.
            releaseSeatHold(session.holdId);
            router.push("/booking/date");
          }}
        >
          {t.seatHold.chooseAgain}
        </Button>
      </Alert>
    );
  }

  const urgent = standing.secondsLeft <= 120;

  return (
    <Alert tone={urgent ? "warning" : "info"} className="mb-6">
      {format(urgent ? t.seatHold.endingSoon : t.seatHold.holding, {
        clock: formatSeatHoldClock(standing.secondsLeft),
      })}
    </Alert>
  );
}
