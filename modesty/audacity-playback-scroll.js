/**
 * Pure viewport following from official Audacity 3.7.1. The supplied seconds
 * must be an authoritative transport position; this module never advances it.
 *
 * Source tag: https://github.com/audacity/audacity/tree/Audacity-3.7.1
 * src/ProjectWindow.cpp: PlaybackScroller::OnTimer
 * src/tracks/ui/PlayIndicatorOverlay.cpp: PlayIndicatorOverlay::OnTimer
 * src/toolbars/ControlToolBar.cpp: StartScrollingIfPreferred/StartScrolling
 * src/tracks/ui/Scrubbing.cpp: IsTransportingPinned
 * src/prefs/TracksPrefs.cpp and libraries/lib-time-frequency-selection/ViewInfo.cpp
 * libraries/lib-screen-geometry/ZoomInfo.cpp: TimeToPosition
 * libraries/lib-viewport/Viewport.cpp: SetHorizontalThumb/ScrollingLowerBoundTime
 */
export const PLAYBACK_SCROLL_DEFAULTS = Object.freeze({
  autoScroll: true,
  continuousScrolling: false,
  pinnedFraction: 0.5,
  alwaysScrubUnpinned: true,
});

const finite = value => typeof value === 'number' && Number.isFinite(value);
const roundPixel = value => Math.floor(0.5 + value);

/**
 * All dimensions are pixels of the waveform viewport, excluding track headers.
 * scrollLeft is relative to time zero. maxScrollLeft, if supplied, is the
 * current scrollbar's maximum; native page scrolling uses that cap, while its
 * pinned scroller writes the viewport position directly and has no upper cap.
 *
 * audioActive can explicitly distinguish an owned paused stream from stopped
 * transport. If omitted, playing || recording || paused is used. A paused
 * owned stream still pins, but never pages. Native Playing() includes pause.
 *
 * A null scrollLeft means leave the viewport alone. Re-evaluate with current
 * dimensions after resize/zoom and after user scrolling. Native has no manual
 * scroll grace period and does not switch off these preferences on wheel input.
 * No transport, selection, loop, settings, or input objects are mutated.
 */
export function computePlaybackScroll({
  seconds,
  clockAvailable = false,
  playing = false,
  paused = false,
  recording = false,
  audioActive,
  scrollLeft,
  viewportWidth,
  pixelsPerSecond,
  autoScroll = PLAYBACK_SCROLL_DEFAULTS.autoScroll,
  continuousScrolling = PLAYBACK_SCROLL_DEFAULTS.continuousScrolling,
  pinnedFraction = PLAYBACK_SCROLL_DEFAULTS.pinnedFraction,
  oneSecondPlay = false,
  scrubbing = false,
  scrubPaused = false,
  speedPlaying = false,
  alwaysScrubUnpinned = PLAYBACK_SCROLL_DEFAULTS.alwaysScrubUnpinned,
  maxScrollLeft,
} = {}) {
  const active = typeof audioActive === 'boolean'
    ? audioActive : playing === true || recording === true || paused === true;
  const pinned = continuousScrolling === true &&
    (!scrubbing || speedPlaying || !alwaysScrubUnpinned);
  const mode = pinned ? 'pinned' : autoScroll === true ? 'page' : 'off';
  const unchanged = reason => ({ scrollLeft: null, changed: false, mode, reason });

  if (!active) return unchanged('inactive');
  if (clockAvailable !== true || !finite(seconds) || seconds < 0)
    return unchanged('clock-unavailable');
  if (!finite(scrollLeft) || scrollLeft < 0 || !finite(viewportWidth) ||
      viewportWidth < 1 || !finite(pixelsPerSecond) || pixelsPerSecond <= 0)
    return unchanged('invalid-viewport');
  const width = Math.floor(viewportWidth);
  const playPixel = seconds * pixelsPerSecond;
  if (!Number.isFinite(playPixel)) return unchanged('invalid-viewport');

  let proposed;
  let reason;
  if (pinned) {
    // C++ TimeToPosition rounds to integer pixels, then deltaX assignment
    // truncates toward zero. This preserves native subpixel threshold behavior.
    const fraction = finite(pinnedFraction)
      ? Math.max(0, Math.min(1, pinnedFraction)) : 0.5;
    const delta = Math.trunc(roundPixel(playPixel - scrollLeft) - width * fraction);
    proposed = Math.max(0, scrollLeft + delta);
    reason = 'pinned';
  } else {
    if (autoScroll !== true) return unchanged('disabled');
    if (paused || (scrubbing && scrubPaused)) return unchanged('paused');
    if (oneSecondPlay) return unchanged('one-second-play');
    // Native uses an inclusive left edge and an exclusive right edge. A loop
    // wrap follows the same backwards paging branch; loop mode is not excluded.
    if (playPixel >= scrollLeft && playPixel < scrollLeft + width)
      return unchanged('visible');
    const backwards = playPixel < scrollLeft;
    proposed = backwards
      ? roundPixel(scrollLeft + roundPixel(playPixel - scrollLeft) - width)
      : roundPixel(playPixel);
    proposed = Math.max(0, proposed);
    if (finite(maxScrollLeft)) proposed = Math.min(proposed, Math.max(0, maxScrollLeft));
    reason = backwards ? 'page-backward' : 'page-forward';
  }
  if (Math.abs(proposed - scrollLeft) < 1e-9) return unchanged('unchanged');
  return { scrollLeft: proposed, changed: true, mode, reason };
}
