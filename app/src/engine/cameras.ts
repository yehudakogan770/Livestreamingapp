// Cameras: one stream per device, shared by every view in this window (the
// screens and the recorder), and stopped when nothing uses it any more.

const cameras = new Map<
  string,
  { stream: Promise<MediaStream>; users: number }
>();

/** A camera's stream; call releaseCamera when done with it. */
export function acquireCamera(deviceId: string): Promise<MediaStream> {
  let entry = cameras.get(deviceId);
  if (!entry) {
    const stream = navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 60 },
      },
    });
    entry = { stream, users: 0 };
    cameras.set(deviceId, entry);
    stream.catch(() => cameras.delete(deviceId));
  }
  entry.users++;
  return entry.stream;
}

export function releaseCamera(deviceId: string) {
  const entry = cameras.get(deviceId);
  if (!entry) return;
  entry.users--;
  if (entry.users <= 0) {
    cameras.delete(deviceId);
    void entry.stream.then(
      (s) => s.getTracks().forEach((t) => t.stop()),
      () => {},
    );
  }
}
