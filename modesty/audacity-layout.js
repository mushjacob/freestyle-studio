// Track-area metrics of the reference editor (3.x, macOS), measured from a native
// capture at default zoom: the track frame starts 4px from the window edge, the
// track control panel is 151px wide (150 + its divider), the vertical amplitude
// ruler 32px, so clip time 0 is drawn at x=188.
// Every hit-test, waveform x, drop time, cursor, scroll and CSS width uses these
// values; no other module may hard-code the gutter.
export const TRACK_MARGIN_LEFT_PX=4;
export const TRACK_BORDER_PX=1;
export const TRACK_PANEL_WIDTH_PX=151;
export const AMPLITUDE_RULER_WIDTH_PX=32;
export const TRACK_GUTTER_PX=TRACK_MARGIN_LEFT_PX+TRACK_BORDER_PX+TRACK_PANEL_WIDTH_PX+AMPLITUDE_RULER_WIDTH_PX;
// WaveTrackView default height (TrackView::DefaultHeight) for a new or loaded track.
export const DEFAULT_TRACK_HEIGHT_PX=150;

export const TRACK_LAYOUT_CSS_PROPERTIES=Object.freeze({
 '--au-gutter':TRACK_GUTTER_PX+'px',
 '--au-track-margin-left':TRACK_MARGIN_LEFT_PX+'px',
 '--au-track-panel-width':TRACK_PANEL_WIDTH_PX+'px',
 '--au-amplitude-width':AMPLITUDE_RULER_WIDTH_PX+'px'
});
/** Publish the metrics to CSS so stylesheet widths cannot drift from JS geometry. */
export function applyTrackLayoutProperties(element){
 for(const [name,value] of Object.entries(TRACK_LAYOUT_CSS_PROPERTIES))element?.style?.setProperty(name,value);
 return element;
}
