/** Own one capture stream, including permission requests that finish after a UI closes. */
export function createMediaCapture(acquire: (constraints: MediaStreamConstraints) => Promise<MediaStream>) {
  let generation = 0;
  let active: MediaStream | null = null;
  const stop = () => {
    generation += 1;
    active?.getTracks().forEach(track => track.stop());
    active = null;
  };
  return {
    stop,
    async start(constraints: MediaStreamConstraints): Promise<MediaStream | null> {
      stop();
      const current = generation;
      try {
        const stream = await acquire(constraints);
        if (current !== generation) {
          stream.getTracks().forEach(track => track.stop());
          return null;
        }
        active = stream;
        return stream;
      } catch (error) {
        if (current !== generation) return null;
        throw error;
      }
    },
  };
}

/** Run after the conditional video element mounts. */
export function attachCaptureVideo(video: Pick<HTMLVideoElement, 'srcObject'>, stream: MediaStream) {
  video.srcObject = stream;
  return () => { if (video.srcObject === stream) video.srcObject = null; };
}
