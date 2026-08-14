"use client";

import { useId, useRef, useState } from "react";
import { DishImage } from "@/components/dish-image";
import { Button } from "@/components/ui/button";
import { compressImageFile, ImageCompressionError } from "@/lib/image-compression";

/**
 * Picture control for a course or an option: drop in a file, paste a URL, or
 * clear it. Uploaded files are resized in the browser first, so staff can use
 * a photo straight off their phone.
 */
export function ImageUploader({
  label,
  value,
  onChange,
  previewClassName = "h-24 w-32",
}: {
  label: string;
  value: string;
  onChange: (imageUrl: string) => void;
  previewClassName?: string;
}) {
  const inputId = useId();
  const urlId = `${inputId}-url`;
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const isUploaded = value.startsWith("data:");

  const handleFile = async (file: File | undefined) => {
    if (!file) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      onChange(await compressImageFile(file));
    } catch (compressionError) {
      setError(
        compressionError instanceof ImageCompressionError
          ? compressionError.message
          : "That image could not be processed.",
      );
    } finally {
      setBusy(false);
      // Allows re-picking the same file after an error.
      if (fileRef.current) {
        fileRef.current.value = "";
      }
    }
  };

  return (
    <div className="rounded-control border border-line bg-surface p-3">
      <p className="text-sm font-medium text-ink">{label}</p>

      <div className="mt-3 flex flex-wrap items-start gap-4">
        <DishImage src={value} alt="" width={128} height={96} className={previewClassName} />

        <div className="min-w-56 flex-1 space-y-3">
          <div>
            <label htmlFor={urlId} className="block text-xs font-medium text-ink-muted">
              Image address
            </label>
            <input
              id={urlId}
              value={isUploaded ? "" : value}
              placeholder={isUploaded ? "Using an uploaded photo" : "https://…"}
              disabled={isUploaded}
              onChange={(event) => onChange(event.target.value)}
              className="mt-1 w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent disabled:bg-surface-muted disabled:text-ink-subtle"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              id={inputId}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(event) => handleFile(event.target.files?.[0])}
            />
            <Button
              variant="secondary"
              loading={busy}
              loadingLabel="Processing…"
              onClick={() => fileRef.current?.click()}
            >
              {value ? "Replace photo" : "Upload photo"}
            </Button>

            {value ? (
              <Button variant="ghost" onClick={() => onChange("")}>
                Remove
              </Button>
            ) : null}
          </div>

          <p className="text-xs text-ink-subtle">
            Photos are resized automatically — a picture straight from a phone is fine.
          </p>

          {error ? (
            <p role="alert" className="text-xs font-medium text-danger">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
