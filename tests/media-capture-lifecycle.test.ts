import { describe, expect, it, vi } from 'vitest';
import { attachCaptureVideo, createMediaCapture } from '../lib/browser/media-capture';

function stream() {
  const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
  return { tracks, media: { getTracks: () => tracks } as unknown as MediaStream };
}

describe('receipt camera and voice capture lifecycle', () => {
  it('attaches the acquired camera stream once the video element exists and detaches on cleanup', () => {
    const capture = stream(); const video = { srcObject: null } as Pick<HTMLVideoElement, 'srcObject'>;
    const detach = attachCaptureVideo(video, capture.media);
    expect(video.srcObject).toBe(capture.media);
    detach(); expect(video.srcObject).toBeNull();
  });
  it('stops every video/audio track on close, unmount or setup failure cleanup', async () => {
    const capture = stream(); const owner = createMediaCapture(vi.fn().mockResolvedValue(capture.media));
    expect(await owner.start({ audio: true })).toBe(capture.media);
    owner.stop(); owner.stop();
    capture.tracks.forEach(track => expect(track.stop).toHaveBeenCalledOnce());
  });
  it('stops a permission request that resolves after the screen closes', async () => {
    const capture = stream(); let resolve!: (stream: MediaStream) => void;
    const owner = createMediaCapture(() => new Promise(done => { resolve = done; }));
    const pending = owner.start({ video: true });
    owner.stop();
    resolve(capture.media);
    expect(await pending).toBeNull();
    capture.tracks.forEach(track => expect(track.stop).toHaveBeenCalledOnce());
  });
  it('replaces a previous active capture without leaving its hardware running', async () => {
    const first = stream(); const second = stream();
    const owner = createMediaCapture(vi.fn().mockResolvedValueOnce(first.media).mockResolvedValueOnce(second.media));
    await owner.start({ video: true }); await owner.start({ video: true });
    first.tracks.forEach(track => expect(track.stop).toHaveBeenCalledOnce());
    second.tracks.forEach(track => expect(track.stop).not.toHaveBeenCalled());
    owner.stop(); second.tracks.forEach(track => expect(track.stop).toHaveBeenCalledOnce());
  });
  it('releases an out-of-order stream without replacing the newer capture', async () => {
    const first = stream(); const second = stream(); let resolveFirst!: (stream: MediaStream) => void;
    const acquire = vi.fn().mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; })).mockResolvedValueOnce(second.media);
    const owner = createMediaCapture(acquire);
    const pending = owner.start({ audio: true });
    await owner.start({ audio: true });
    resolveFirst(first.media);
    expect(await pending).toBeNull();
    first.tracks.forEach(track => expect(track.stop).toHaveBeenCalledOnce());
    second.tracks.forEach(track => expect(track.stop).not.toHaveBeenCalled());
    owner.stop();
  });
  it('reports active denial but ignores a late denial after closing', async () => {
    const owner = createMediaCapture(vi.fn().mockRejectedValue(new Error('permission denied')));
    await expect(owner.start({ audio: true })).rejects.toThrow('permission denied');
    const pending = owner.start({ audio: true }); owner.stop();
    await expect(pending).resolves.toBeNull();
  });
});
