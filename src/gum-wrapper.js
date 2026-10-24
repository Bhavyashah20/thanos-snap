// Replaces mediaDevices.getUserMedia so video requests get the processed (snap-able) feed.
// Everything environment-specific is injected so the logic is testable without a browser.
export function wrapGetUserMedia(mediaDevices, deps) {
  const orig = mediaDevices.getUserMedia.bind(mediaDevices);

  mediaDevices.getUserMedia = async (constraints) => {
    if (!constraints || !constraints.video || !deps.getSettings().enabled) return orig(constraints);

    const real = await orig(constraints);
    let runner;
    try {
      runner = await deps.createRunner(real);
    } catch (err) {
      console.warn('[thanos-snap] falling back to the plain camera:', err);
      return real; // never break the call
    }

    const trigger = Promise.resolve(deps.startAudioTrigger(orig, () => runner.trigger())).catch(() => null);

    const outTrack = runner.videoTrack;
    const stopOut = outTrack.stop.bind(outTrack);
    outTrack.stop = () => {
      stopOut();
      real.getVideoTracks().forEach((t) => t.stop());
      runner.stop();
      trigger.then((t) => t && t.stop());
    };
    return deps.makeStream([outTrack, ...real.getAudioTracks()]);
  };
}
