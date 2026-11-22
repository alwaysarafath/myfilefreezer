"use client";

import { useEffect, useState } from "react";

/**
 * Thumbnail of the file as it sits on this device.
 *
 * The image is the in-memory File, never something fetched back from S3 -- Deep Archive
 * is 12-48 hours from being readable, so a preview after upload can only ever mean "here
 * is what you sent", which is exactly the reassurance that is wanted at that moment.
 *
 * The object URL is created inside the effect rather than in a useMemo, and that matters:
 * StrictMode mounts, unmounts and remounts every component in development. A memoised URL
 * is revoked by the first cleanup and not recreated on remount, leaving a broken image.
 * Creating it in the effect means each mount gets its own URL and revokes its own.
 */
export default function UploadPreview({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    // The URL must be created and revoked per mount (see the note above), so it cannot be
    // derived during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  const box = "h-14 w-14 shrink-0 overflow-hidden rounded bg-current/10";

  if (!url) return <div className={box} />;

  if (file.type.startsWith("image/")) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className={`${box} object-cover`} />;
  }

  if (file.type.startsWith("video/")) {
    // The #t=0.1 media fragment makes the browser seek just past the start and paint that
    // frame. Without it a paused <video> is a blank grey box, which looks like a failure.
    return (
      <video
        src={`${url}#t=0.1`}
        preload="metadata"
        muted
        playsInline
        className={`${box} object-cover`}
      />
    );
  }

  return (
    <div className={`${box} flex items-center justify-center text-[10px] opacity-50`}>
      file
    </div>
  );
}
