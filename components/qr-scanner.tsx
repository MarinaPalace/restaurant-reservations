"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";

/**
 * The camera, pointed at a guest's card.
 *
 * ## Two decoders, because one is not available everywhere
 *
 * Chrome and Edge — which is what a desk tablet runs — have `BarcodeDetector`
 * built in, and it is faster and better at odd angles than anything shipped as
 * JavaScript. Safari and Firefox do not, and an iPad at reception is far too
 * likely for "install Chrome" to be an answer. So the native detector is used
 * where it exists and `jsQR` decodes the same frames where it does not.
 *
 * ## Scanning is never the only way in
 *
 * Cameras get refused, break, and are absent on a desktop. Every screen using
 * this keeps a text box beside it, and this component's job ends at handing
 * back a string — it never navigates, never searches, and never becomes the
 * only route to the thing behind it.
 *
 * ## It stops itself
 *
 * A camera left running is a light on at the desk and a battery draining in
 * somebody's hand. The stream is stopped when the component unmounts, when
 * scanning is turned off, and after a successful read — reception scans one
 * guest at a time, and a scanner that keeps firing re-reads the same card.
 */

type BarcodeDetectorLike = {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
};

type BarcodeDetectorConstructor = new (options: { formats: string[] }) => BarcodeDetectorLike;

function nativeDetector(): BarcodeDetectorLike | null {
  const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor })
    .BarcodeDetector;

  if (!Detector) {
    return null;
  }

  try {
    return new Detector({ formats: ["qr_code"] });
  } catch {
    // Present but refusing QR — treated as absent, and jsQR takes over.
    return null;
  }
}

export function QrScanner({
  onScan,
  labels,
}: {
  /** Called once per successful read, with the raw contents of the code. */
  onScan: (value: string) => void;
  labels: {
    start: string;
    stop: string;
    scanning: string;
    noCamera: string;
    denied: string;
    hint: string;
  };
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);

  const [active, setActive] = useState(false);
  const [error, setError] = useState("");

  /**
   * Held in a ref rather than state so the frame loop reads the current
   * callback without being torn down and restarted every render — restarting
   * the loop mid-scan is how a card that was almost in focus gets missed.
   */
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  const stop = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }

    for (const track of streamRef.current?.getTracks() ?? []) {
      track.stop();
    }

    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  // The camera must not outlive the screen it was opened on.
  useEffect(() => stop, [stop]);

  useEffect(() => {
    if (!active) {
      stop();
      return;
    }

    let cancelled = false;
    const canvas = document.createElement("canvas");

    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            // The back camera on a phone or tablet. `ideal` rather than
            // `exact` so a laptop with only a front camera still works.
            facingMode: { ideal: "environment" },
            /**
             * A big frame, and **only the width is asked for**.
             *
             * Nothing is displayed at this size — it is decoded at it, and a
             * code held across a desk is a handful of pixels per module, so
             * asking small is the difference between a card that scans at
             * arm's length and one that has to be pressed against the glass.
             *
             * Naming the height too would quietly make this worse. Asking a
             * 4:3 sensor for 16:9 does not letterbox it, it **crops** it — the
             * browser throws away the top and bottom of the sensor to satisfy
             * the shape, which is exactly the narrowed view being fixed here.
             * One dimension leaves the camera on its own aspect.
             */
            width: { ideal: 1280 }
          },
          audio: false,
        });

        /**
         * And take the zoom back off.
         *
         * Some phones and most tablets open the back camera part-way zoomed in,
         * which crops the field of view before anything of ours has seen a
         * pixel — the guest holds the card up, it is plainly inside the frame
         * on their side, and the desk sees the middle third of it. Where the
         * track exposes `zoom`, it is wound back to the widest the hardware
         * offers; where it does not, nothing happens and nothing breaks.
         */
        for (const track of stream.getVideoTracks()) {
          const zoom = (track.getCapabilities?.() as { zoom?: { min?: number } } | undefined)?.zoom;

          if (typeof zoom?.min === "number") {
            try {
              await track.applyConstraints({
                advanced: [{ zoom: zoom.min } as MediaTrackConstraintSet],
              });
            } catch {
              // A camera that will not be told. Not worth failing a scan over.
            }
          }
        }

        if (cancelled) {
          for (const track of stream.getTracks()) {
            track.stop();
          }
          return;
        }

        streamRef.current = stream;

        const video = videoRef.current;
        if (!video) {
          return;
        }

        video.srcObject = stream;
        // iOS refuses to play an inline video without both of these.
        video.setAttribute("playsinline", "true");
        video.muted = true;
        await video.play();

        const detector = nativeDetector();
        const jsQR = detector ? null : (await import("jsqr")).default;

        const read = async () => {
          if (cancelled || !videoRef.current) {
            return;
          }

          const width = video.videoWidth;
          const height = video.videoHeight;

          if (width && height) {
            canvas.width = width;
            canvas.height = height;

            const context = canvas.getContext("2d", { willReadFrequently: true });

            if (context) {
              context.drawImage(video, 0, 0, width, height);

              try {
                let value: string | null = null;

                if (detector) {
                  value = (await detector.detect(canvas))[0]?.rawValue ?? null;
                } else if (jsQR) {
                  const pixels = context.getImageData(0, 0, width, height);
                  value = jsQR(pixels.data, width, height)?.data ?? null;
                }

                if (value && !cancelled) {
                  // One card at a time. Left running, this re-reads the same
                  // code many times a second.
                  setActive(false);
                  onScanRef.current(value);
                  return;
                }
              } catch {
                // A frame that would not decode. The next one usually does,
                // and reporting each would fill the screen with noise.
              }
            }
          }

          frameRef.current = requestAnimationFrame(() => void read());
        };

        frameRef.current = requestAnimationFrame(() => void read());
      } catch (cameraError) {
        if (cancelled) {
          return;
        }

        setActive(false);

        /**
         * Told apart because the fixes differ: a refused camera is a permission
         * the person can grant, and a missing one means type the code instead.
         */
        const name = (cameraError as { name?: string })?.name;
        setError(name === "NotAllowedError" || name === "SecurityError" ? labels.denied : labels.noCamera);
      }
    })();

    return () => {
      cancelled = true;
      stop();
    };
  }, [active, stop, labels.denied, labels.noCamera]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant={active ? "secondary" : "primary"}
          onClick={() => {
            setError("");
            setActive((current) => !current);
          }}
        >
          {active ? labels.stop : labels.start}
        </Button>
        {active ? <span className="text-sm text-ink-muted">{labels.scanning}</span> : null}
      </div>

      {error ? (
        <Alert tone="warning" className="mt-3">
          {error}
        </Alert>
      ) : null}

      {/*
        Kept in the tree rather than mounted on demand: the stream is attached
        to this element, and a video that appears at the same moment it is
        played is the reliable way to get a black rectangle on iOS.
      */}
      <div className={active ? "mt-3" : "hidden"}>
        {/*
          `object-contain`, never `object-cover`.

          Cover fills the box by cropping, which on a wide short box throws away
          the top and bottom of the frame — and the decoder reads the *whole*
          frame, so the preview was showing less than was being scanned. The
          card could sit plainly inside what the camera saw and outside what the
          person aiming it saw, which is the one thing a viewfinder must never
          do. Contain letterboxes instead: black bars, and what is on screen is
          exactly what is read.
        */}
        <div className="relative overflow-hidden rounded-control border border-line-strong bg-black">
          <video
            ref={videoRef}
            className="mx-auto block max-h-[60vh] w-full object-contain"
            playsInline
            muted
          />
          {/*
            A guide, and only a guide: the code is found anywhere in the frame,
            so this is sized as a share of the preview rather than a fixed
            square that would sit in a different place on every device.
          */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 m-auto aspect-square w-1/2 max-w-56 rounded-lg border-2 border-white/70"
          />
        </div>
        <p className="mt-2 text-sm text-ink-muted">{labels.hint}</p>
      </div>
    </div>
  );
}
