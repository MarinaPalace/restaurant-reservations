"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PageShell } from "@/components/page-shell";
import { BookingSteps } from "@/components/booking-steps";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { useBookingSession, writeBookingSession } from "@/hooks/use-booking-session";
import { isValidRoomNumber } from "@/lib/booking-session";

export default function BookingPage() {
  const router = useRouter();
  const session = useBookingSession();
  const [roomNumber, setRoomNumber] = useState<string | null>(null);
  const [error, setError] = useState("");

  // Falls back to whatever is already in the session until the guest types.
  const value = roomNumber ?? session.roomNumber;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();

    if (!isValidRoomNumber(trimmed)) {
      setError("Please enter your room number, for example 402 or L10.");
      return;
    }

    writeBookingSession({ roomNumber: trimmed });
    router.push("/booking/guests");
  };

  return (
    <PageShell width="sm">
      <BookingSteps current="room" />
      <Card className="p-6">
        <CardHeader
          as="h1"
          align="center"
          eyebrow="À la carte restaurant"
          title="Reserve your dinner"
          description="Your table is booked to your room, so we can find your reservation at the door."
        />

        {/* A real form: the on-screen keyboard shows "Go", and Enter submits. */}
        <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-6">
          <Field label="Room number" error={error}>
            {(fieldProps) => (
              <Input
                {...fieldProps}
                name="roomNumber"
                autoComplete="off"
                autoFocus
                maxLength={10}
                placeholder="e.g. 402 or L10"
                value={value}
                onChange={(event) => {
                  setRoomNumber(event.target.value.replace(/[^A-Za-z0-9-]/g, "").toUpperCase());
                  setError("");
                }}
                className="text-xl"
              />
            )}
          </Field>

          <Button type="submit" size="lg" className="w-full">
            Continue
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-ink-muted">
          Already booked?{" "}
          <Link href="/booking/manage" className="font-medium text-accent underline underline-offset-2">
            Change or cancel your reservation
          </Link>
        </p>

        <p className="mt-4 rounded-control border border-line bg-surface-muted p-3 text-sm text-ink-muted">
          Need help? Dial <span className="font-semibold text-ink">9</span> from your room to reach guest services.
        </p>
      </Card>
    </PageShell>
  );
}
