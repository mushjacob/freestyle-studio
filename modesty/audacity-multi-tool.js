/** Audacity 3.2.1 Multi-Tool hit policy. No audio writes or inferred samples.
 * Pinned commit 969e36f4968e66375a794a938dd906a3556e0bbc:
 * WaveTrackView.cpp958, WaveformView.cpp66–83, CommonTrackView.cpp56–71.
 */
import {amplitudeToY,validateAmplitudeDisplay} from './audacity-amplitude.js';
const finite=Number.isFinite,F=Math.fround;

/** EnvelopeHandle.cpp115–167. Keep C++ integer truncation and signed remainder;
 * this proximity test is distinct from choosing which handle to drag.
 */
export function hitEnvelopeContour({gain,y,height,display}={}){
 if(![gain,y,height].every(finite)||height<1||gain<0)return false;
 display=validateAmplitudeDisplay(display);
 const outer=amplitudeToY(gain,height,display),center=amplitudeToY(0,height,display),distanceFromCenter=Math.abs(center-Math.trunc(y)),envelopeDistance=Math.abs(center-outer);
 const spacing=Math.max(1,Math.trunc(F(F(Math.trunc(height))/F(2*F(display.max-display.min))))),half=Math.trunc(spacing/2),displace=envelopeDistance-2-distanceFromCenter+half;
 if(displace>2*spacing)return false;
 return Math.abs(displace%spacing-half)<5;
}

/** TimeShiftHandle.cpp89–111: these are CHANNEL/LANE VIEW borders, not clip
 * edges. Native adjusts the cursor hotspot by 5px and tests a 14px margin.
 */
export function hitTimeShiftGrip({x,left=0,width}={}){
 return [x,left,width].every(finite)&&width>0&&(Math.trunc(x)+5<Math.trunc(left)+14||Math.trunc(x)+5>=Math.trunc(left)+Math.trunc(width)-14);
}

/** SampleHandle.cpp92–160. Caller must prove this is one actual source frame;
 * coarse peaks, interpolated points and missing PCM must never activate it.
 * Editing samples requires an additional engine API and remains unavailable.
 */
export function hitSamplePoint({verified=false,sample,envelopeGain=1,y,height,display,pixelsPerSecond,sampleRate}={}){
 if(!verified||![sample,envelopeGain,y,height,pixelsPerSecond,sampleRate].every(finite)||height<1||sampleRate<=0||pixelsPerSecond<=3*sampleRate)return false;
 const sampleY=amplitudeToY(Math.fround(sample)*envelopeGain,height,display);
 return Math.abs(sampleY-Math.trunc(y))<10;
}

/** Detailed/native targets precede fallback right zoom and selection. A right
 * click on an earlier target opens its default context action: CellularPanel
 * cpp924–927 does not skip it in search of a right-click-capable handle.
 */
export function multiToolHit({commandDown=false,envelopeHit=false,gripHit=false,sampleHit=false,rightButton=false}={}){
 if(commandDown)return {action:'move',source:'command'};
 if(envelopeHit)return {action:'envelope',source:'contour'};
 if(gripHit)return {action:'move',source:'grip'};
 if(sampleHit)return {action:'sample-unavailable',source:'sample'};
 if(rightButton)return {action:'zoom',source:'fallback'};
 return {action:'select',source:'fallback'};
}

/** ZoomHandle.cpp149–197,234. Native uses >3px for a region gesture. Shift
 * reverses region scale; a normal right release halves scale about its cursor.
 * This describes view geometry only and never alters the audio selection.
 */
export function multiToolZoom({startX,endX,width,scale,leftSec,shift=false}={}){
 if(![startX,endX,width,scale,leftSec].every(finite)||width<=0||scale<=0)throw new Error('Multi-Tool zoom needs a finite visible timeline.');
 const lastPixel=Math.max(0,Math.trunc(width)-1);startX=Math.max(0,Math.min(lastPixel,startX));endX=Math.max(0,Math.min(lastPixel,endX));const span=Math.abs(endX-startX);
 if(span<=3)return {kind:'click',factor:.5,anchorPx:endX};
 const multiplier=width/span;
 return {kind:'region',factor:shift?1/multiplier:multiplier,leftSec:leftSec+Math.min(startX,endX)/scale,startX:Math.min(startX,endX),endX:Math.max(startX,endX)};
}
