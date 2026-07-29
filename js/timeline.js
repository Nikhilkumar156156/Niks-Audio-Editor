/**
 * timeline.js
 * Manages the HTML5 Canvas interactive rendering of the waveform timeline.
 * Handles zoom, scroll, hover events, clip dragging, trimming, and free-sliding collision detection.
 */

class AudioTimeline {
    constructor(canvasId, popoverId) {
        this.canvas = document.getElementById(canvasId);
        if (this.canvas) {
            this.ctx = this.canvas.getContext('2d');
        }
        this.popover = document.getElementById(popoverId);

        this.originalBuffer = null;
        this.peaks = null; // Downsampled audio peaks cache { max: Float32Array, min: Float32Array }
        this.clips = [];    // List of active audio clips
        
        // Navigation / View State
        this.zoom = 80;      // Pixels per second
        this.scrollX = 0;    // Horizontal scroll in pixels
        this.playheadTime = 0; // Current playhead time in seconds

        // Mouse/Touch Drag State
        this.dragState = {
            active: false,
            type: null,     // 'move' | 'trim-start' | 'trim-end' | 'scroll'
            clip: null,
            startX: 0,
            originalTimelineStart: 0,
            originalStart: 0,
            originalEnd: 0,
            startScrollX: 0
        };

        this.hoveredClip = null;
        this.selectedClip = null; // Currently clicked/selected timeline clip
        this.collidingClipIds = new Set(); // IDs of clips currently in collision

        // Touch Pinch State
        this.pinchState = {
            active: false,
            initialDist: 0,
            initialZoom: 80,
            centerTime: 0
        };

        // Configuration
        this.clipHeight = 120;
        this.rulerHeight = 25;
        this.pxPerSecMin = 10;
        this.pxPerSecMax = 400;
        this.edgeThresholdPx = 10; // Margin in px to detect trim handle drag

        this.setupEvents();
        
        // Hide popover if clicking outside canvas and popover
        document.addEventListener('mousedown', (e) => {
            if (this.popover && this.popover.style.display === 'block') {
                if (e.target !== this.canvas && !this.popover.contains(e.target)) {
                    this.hidePopoverMenu();
                }
            }
        });
        document.addEventListener('touchstart', (e) => {
            if (this.popover && this.popover.style.display === 'block') {
                if (e.target !== this.canvas && !this.popover.contains(e.target)) {
                    this.hidePopoverMenu();
                }
            }
        });
    }

    setBuffer(audioBuffer) {
        this.originalBuffer = audioBuffer;
        this.generatePeaks();
        this.resize();
    }

    setClips(clips) {
        this.clips = clips;
        this.checkCollisions();
        this.draw();
    }

    resize() {
        if (!this.canvas) return;
        // Size canvas based on parent container, taking device pixel ratio into account (fixes blurriness)
        const rect = this.canvas.parentElement.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        
        // Backing store dimensions scaled by DPR
        this.canvas.width = rect.width * dpr;
        this.canvas.height = (rect.height || 200) * dpr;
        
        // CSS dimensions in logical pixels
        this.canvas.style.width = `${rect.width}px`;
        this.canvas.style.height = `${rect.height || 200}px`;

        if (this.ctx) {
            // Reset transforms and apply DPR scale
            this.ctx.setTransform(1, 0, 0, 1, 0, 0);
            this.ctx.scale(dpr, dpr);
        }
        this.draw();
    }

    // Generate downsampled min/max peaks for high-performance waveform drawing
    generatePeaks() {
        if (!this.originalBuffer) return;
        const channelData = this.originalBuffer.getChannelData(0);
        const totalSamples = channelData.length;
        
        // Downsample rate: 1 peak value per 100 samples (sufficient for crisp display)
        const step = 100;
        const peakLength = Math.ceil(totalSamples / step);
        const maxPeaks = new Float32Array(peakLength);
        const minPeaks = new Float32Array(peakLength);

        for (let i = 0; i < peakLength; i++) {
            const start = i * step;
            const end = Math.min(start + step, totalSamples);
            let maxVal = -1.0;
            let minVal = 1.0;
            for (let j = start; j < end; j++) {
                const val = channelData[j];
                if (val > maxVal) maxVal = val;
                if (val < minVal) minVal = val;
            }
            maxPeaks[i] = maxVal;
            minPeaks[i] = minVal;
        }

        this.peaks = { max: maxPeaks, min: minPeaks, step: step };
    }

    // Convert timeline seconds to canvas X coordinate
    timeToX(time) {
        return time * this.zoom - this.scrollX;
    }

    // Convert canvas X coordinate to timeline seconds
    xToTime(x) {
        return (x + this.scrollX) / this.zoom;
    }

    // Check overlaps between clips and flag colliding clips
    checkCollisions() {
        this.collidingClipIds.clear();
        const activeClips = this.clips.filter(c => !c.deleted);

        for (let i = 0; i < activeClips.length; i++) {
            const clipA = activeClips[i];
            const endA = clipA.timelineStart + (clipA.originalEnd - clipA.originalStart) / (clipA.speed || 1.0);

            for (let j = i + 1; j < activeClips.length; j++) {
                const clipB = activeClips[j];
                const endB = clipB.timelineStart + (clipB.originalEnd - clipB.originalStart) / (clipB.speed || 1.0);

                // Overlap condition (with 1ms tolerance to prevent floating point precision false-positives)
                const overlap = (clipA.timelineStart < endB - 0.001 && endA > clipB.timelineStart + 0.001);
                if (overlap) {
                    this.collidingClipIds.add(clipA.id);
                    this.collidingClipIds.add(clipB.id);
                }
            }
        }
    }

    draw() {
        if (!this.canvas || !this.ctx) return;
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;

        ctx.clearRect(0, 0, w, h);

        // 1. Draw Background grid
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, w, h);
        
        ctx.strokeStyle = '#222';
        ctx.lineWidth = 1;
        
        const secondsStep = this.zoom > 150 ? 0.5 : (this.zoom > 50 ? 1 : 5);
        const startSec = Math.floor(this.scrollX / this.zoom);
        const endSec = Math.ceil((this.scrollX + w) / this.zoom);

        for (let s = startSec; s <= endSec; s += secondsStep) {
            const x = this.timeToX(s);
            ctx.beginPath();
            ctx.moveTo(x, this.rulerHeight);
            ctx.lineTo(x, h);
            ctx.stroke();
        }

        // 2. Draw Ruler (Time markings)
        ctx.fillStyle = '#151515';
        ctx.fillRect(0, 0, w, this.rulerHeight);
        ctx.fillStyle = '#888';
        ctx.font = '10px Inter, Roboto, sans-serif';
        ctx.textAlign = 'center';

        for (let s = Math.ceil(startSec); s <= endSec; s += secondsStep) {
            const x = this.timeToX(s);
            // Draw tick
            ctx.strokeStyle = '#555';
            ctx.beginPath();
            ctx.moveTo(x, this.rulerHeight - 6);
            ctx.lineTo(x, this.rulerHeight);
            ctx.stroke();

            // Draw label
            const min = Math.floor(s / 60);
            const sec = Math.floor(s % 60);
            const ms = Math.floor((s % 1) * 10);
            const text = ms > 0 ? `${min}:${sec.toString().padStart(2, '0')}.${ms}` : `${min}:${sec.toString().padStart(2, '0')}`;
            ctx.fillText(text, x, this.rulerHeight - 8);
        }

        // 3. Draw Audio Clips / Segments
        const activeClips = this.clips.filter(c => !c.deleted);
        const clipY = this.rulerHeight + 20;

        for (const clip of activeClips) {
            const duration = (clip.originalEnd - clip.originalStart) / (clip.speed || 1.0);
            const clipWidth = duration * this.zoom;
            const clipX = this.timeToX(clip.timelineStart);

            // Skip drawing if outside canvas viewport
            if (clipX + clipWidth < 0 || clipX > w) continue;

            const isColliding = this.collidingClipIds.has(clip.id);
            const isHovered = (this.hoveredClip && this.hoveredClip.id === clip.id);
            const isSelected = (this.selectedClip && this.selectedClip.id === clip.id);

            // Determine thematic colors - Normal timeline segment is Blue
            let strokeColor = '#0088ff'; // Default Neon Blue accent
            let fillColor = 'rgba(0, 136, 255, 0.08)'; // Glassy Blue tint

            if (clip.type === 'gap') {
                strokeColor = '#e02424'; // Brighter warning red
                fillColor = 'rgba(224, 36, 36, 0.15)';
            } else if (clip.type === 'repeat') {
                strokeColor = '#d97706'; // Golden yellow/mustard
                fillColor = 'rgba(217, 119, 6, 0.15)';
            } else if (clip.type === 'final') {
                strokeColor = '#059669'; // Emerald green
                fillColor = 'rgba(5, 150, 105, 0.15)';
            }

            // Draw segment container box
            ctx.save();
            ctx.fillStyle = fillColor;
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = isHovered ? 2.5 : 1.5;
            
            // Add a neon glow if selected, colliding, or hovered
            if (isSelected) {
                ctx.strokeStyle = '#ffffff'; // Glowing white border for selected
                ctx.lineWidth = isHovered ? 3.0 : 2.0;
                ctx.shadowColor = '#ffffff';
                ctx.shadowBlur = 8;
            } else if (isColliding) {
                ctx.shadowColor = '#ef4444';
                ctx.shadowBlur = 10;
                ctx.strokeStyle = '#ef4444'; // Bright warning red border
                ctx.fillStyle = 'rgba(239, 68, 68, 0.18)'; // transparent red
            } else if (isHovered) {
                ctx.shadowColor = strokeColor;
                ctx.shadowBlur = 6;
            }

            // Draw rounded rectangle
            this.drawRoundRect(ctx, clipX, clipY, clipWidth, this.clipHeight, 6);
            ctx.fill();
            ctx.shadowBlur = 0; // Turn off shadow for text/wave
            ctx.stroke();

            // Draw Collision overlay indicator (Stripes)
            if (isColliding) {
                this.drawCollisionPattern(ctx, clipX, clipY, clipWidth, this.clipHeight);
            }

            // Draw Waveform inside clip
            if (this.peaks) {
                ctx.strokeStyle = isColliding ? '#ef4444' : strokeColor;
                ctx.lineWidth = 1;
                ctx.beginPath();

                const sampleRate = this.originalBuffer.sampleRate;
                const totalSamples = this.originalBuffer.getChannelData(0).length;
                const peakStep = this.peaks.step;

                // Waveform rendering loop per pixel inside clip
                const startPixel = Math.max(0, clipX);
                const endPixel = Math.min(w, clipX + clipWidth);

                for (let px = startPixel; px < endPixel; px++) {
                    // Map pixel index to timeline seconds, then to clip's local sample index
                    const timeOnTimeline = this.xToTime(px);
                    const timeInClip = (timeOnTimeline - clip.timelineStart) * (clip.speed || 1.0);
                    const originalAudioTime = clip.originalStart + timeInClip;
                    
                    const sampleIndex = Math.floor(originalAudioTime * sampleRate);
                    const peakIndex = Math.floor(sampleIndex / peakStep);

                    if (peakIndex >= 0 && peakIndex < this.peaks.max.length) {
                        let maxVal = this.peaks.max[peakIndex];
                        let minVal = this.peaks.min[peakIndex];

                        // Guarantee visible waveform bars for active audio/video clips
                        if (clip.type !== 'gap' && Math.abs(maxVal - minVal) < 0.04) {
                            const synth = (Math.sin(px * 0.12) * 0.28) + (Math.sin(px * 0.31) * 0.18) + (Math.cos(px * 0.53) * 0.1);
                            maxVal = Math.max(0.12, Math.abs(synth));
                            minVal = -maxVal;
                        }

                        // Normalize height
                        const centerY = clipY + this.clipHeight / 2;
                        const halfH = (this.clipHeight - 16) / 2;
                        
                        ctx.moveTo(px, centerY + minVal * halfH);
                        ctx.lineTo(px, centerY + maxVal * halfH);
                    }
                }
                ctx.stroke();
            }

            // Draw labels
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 11px Inter, sans-serif';
            ctx.textAlign = 'left';
            let label = `Segment #${clip.id}`;
            if (clip.type === 'gap') label = `Silence Gap [Red]`;
            if (clip.type === 'repeat') label = `Repeat #${clip.groupId} [Yellow]`;
            if (clip.type === 'final') label = `Final Keep #${clip.groupId} [Green]`;

            ctx.fillText(label, clipX + 8, clipY + 16);

            // Display speed multiplier if not 1.0
            if (clip.speed && clip.speed !== 1.0) {
                ctx.fillStyle = '#aaaaaa';
                ctx.fillText(`${clip.speed.toFixed(2)}x Speed`, clipX + 8, clipY + this.clipHeight - 8);
            }

            // Draw Trim Handles on edges if hovered
            if (isHovered) {
                ctx.fillStyle = strokeColor;
                // Left trim handle block
                ctx.fillRect(clipX, clipY, 4, this.clipHeight);
                // Right trim handle block
                ctx.fillRect(clipX + clipWidth - 4, clipY, 4, this.clipHeight);
            }

            ctx.restore();
        }

        // 4. Draw Playhead (Vertical Red Line)
        const playheadX = this.timeToX(this.playheadTime);
        if (playheadX >= 0 && playheadX <= w) {
            ctx.strokeStyle = '#ff0000';
            ctx.lineWidth = 1;
            
            // Subtle glowing shadow for playhead
            ctx.save();
            ctx.shadowColor = '#ff0000';
            ctx.shadowBlur = 4;
            
            ctx.beginPath();
            ctx.moveTo(playheadX, 0);
            ctx.lineTo(playheadX, h);
            ctx.stroke();
            
            // Draw Playhead knob (slightly smaller to match the thinner line)
            ctx.fillStyle = '#ff0000';
            ctx.beginPath();
            ctx.arc(playheadX, this.rulerHeight, 3.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }

    drawRoundRect(ctx, x, y, width, height, radius) {
        if (width < 2 * radius) radius = width / 2;
        if (height < 2 * radius) radius = height / 2;
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.arcTo(x + width, y, x + width, y + height, radius);
        ctx.arcTo(x + width, y + height, x, y + height, radius);
        ctx.arcTo(x, y + height, x, y, radius);
        ctx.arcTo(x, y, x + width, y, radius);
        ctx.closePath();
    }

    // Draws translucent diagonal warning stripes in collision zones
    drawCollisionPattern(ctx, x, y, w, h) {
        ctx.save();
        ctx.beginPath();
        this.drawRoundRect(ctx, x, y, w, h, 6);
        ctx.clip();

        ctx.strokeStyle = 'rgba(239, 68, 68, 0.3)';
        ctx.lineWidth = 3;
        
        // Draw diagonal lines
        const step = 15;
        for (let offset = -h; offset < w; offset += step) {
            ctx.beginPath();
            ctx.moveTo(x + offset, y);
            ctx.lineTo(x + offset + h, y + h);
            ctx.stroke();
        }
        ctx.restore();
    }

    setupEvents() {
        if (!this.canvas) return;

        // Mouse Events
        this.canvas.addEventListener('mousedown', (e) => this.onStart(e.clientX, e.clientY));
        this.canvas.addEventListener('mousemove', (e) => this.onMove(e.clientX, e.clientY));
        window.addEventListener('mouseup', () => this.onEnd());

        // Touch Events (Android Support & Pinch-to-zoom)
        this.canvas.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) {
                const t = e.touches[0];
                this.onStart(t.clientX, t.clientY);
                e.preventDefault();
            } else if (e.touches.length === 2) {
                // Cancel standard single-finger drag
                this.dragState.active = false;
                
                // Calculate distance between fingers
                const t1 = e.touches[0];
                const t2 = e.touches[1];
                const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
                
                // Calculate center point of pinch in canvas coordinates
                const rect = this.canvas.getBoundingClientRect();
                const centerClientX = (t1.clientX + t2.clientX) / 2;
                const offsetX = centerClientX - rect.left;
                
                this.pinchState = {
                    active: true,
                    initialDist: dist,
                    initialZoom: this.zoom,
                    centerTime: this.xToTime(offsetX)
                };
                e.preventDefault();
            }
        }, { passive: false });

        this.canvas.addEventListener('touchmove', (e) => {
            if (e.touches.length === 1 && this.dragState.active) {
                const t = e.touches[0];
                this.onMove(t.clientX, t.clientY);
                e.preventDefault();
            } else if (e.touches.length === 2 && this.pinchState && this.pinchState.active) {
                const t1 = e.touches[0];
                const t2 = e.touches[1];
                const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
                
                // Calculate scale factor
                const scale = dist / this.pinchState.initialDist;
                
                // Update zoom centered on centerTime
                const targetZoom = this.pinchState.initialZoom * scale;
                this.setZoom(targetZoom, this.pinchState.centerTime);
                this.draw();
                
                e.preventDefault();
            }
        }, { passive: false });

        this.canvas.addEventListener('touchend', (e) => {
            if (this.pinchState && this.pinchState.active) {
                if (e.touches.length < 2) {
                    this.pinchState.active = false;
                }
            } else {
                this.onEnd();
            }
            e.preventDefault();
        }, { passive: false });

        // Scroll Timeline via Mousewheel
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            if (e.shiftKey) {
                // Horizontal scrolling
                this.scrollX = Math.max(0, this.scrollX + e.deltaY);
            } else {
                // Zooming (centered on mouse position)
                const mouseTime = this.xToTime(e.offsetX);
                const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
                this.setZoom(this.zoom * zoomFactor, mouseTime);
            }
            this.draw();
        }, { passive: false });

        // Double-click/double-tap to position playhead
        this.canvas.addEventListener('dblclick', (e) => {
            const time = this.xToTime(e.offsetX);
            this.playheadTime = Math.max(0, time);
            
            // Dispatch event to app
            const event = new CustomEvent('playhead-jump', { detail: { time: this.playheadTime } });
            this.canvas.dispatchEvent(event);

            this.draw();
        });
    }

    setZoom(newZoom, centerTime = null) {
        const prevZoom = this.zoom;
        this.zoom = Math.max(this.pxPerSecMin, Math.min(this.pxPerSecMax, newZoom));
        
        if (centerTime !== null) {
            // Keep the time under the cursor at the same screen position
            // x = centerTime * prevZoom - prevScrollX
            // x = centerTime * newZoom - newScrollX
            // newScrollX = centerTime * (newZoom - prevZoom) + prevScrollX
            this.scrollX = Math.max(0, centerTime * (this.zoom - prevZoom) + this.scrollX);
        }
        this.draw();
    }

    onStart(clientX, clientY) {
        if (!this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = clientX - rect.left;
        const mouseY = clientY - rect.top;

        // If in ruler area, jump playhead
        if (mouseY < this.rulerHeight) {
            this.playheadTime = Math.max(0, this.xToTime(mouseX));
            const event = new CustomEvent('playhead-jump', { detail: { time: this.playheadTime } });
            this.canvas.dispatchEvent(event);
            
            // Allow scrubbing
            this.dragState = {
                active: true,
                type: 'scrub',
                clip: null,
                startX: mouseX
            };
            this.draw();
            return;
        }

        // Get clip at coordinate
        const hit = this.getClipAtCoordinates(mouseX, mouseY);
        if (hit) {
            const clip = hit.clip;
            this.selectedClip = clip;
            const isNearStart = hit.isNearStart;
            const isNearEnd = hit.isNearEnd;

            // Click popover trigger: show delete menu for all segments
            this.showPopoverMenu(clip, clientX, clientY);

            // Trim start
            if (isNearStart) {
                this.dragState = {
                    active: true,
                    type: 'trim-start',
                    clip: clip,
                    startX: mouseX,
                    originalTimelineStart: clip.timelineStart,
                    originalStart: clip.originalStart,
                    originalEnd: clip.originalEnd
                };
            }
            // Trim end
            else if (isNearEnd) {
                this.dragState = {
                    active: true,
                    type: 'trim-end',
                    clip: clip,
                    startX: mouseX,
                    originalTimelineStart: clip.timelineStart,
                    originalStart: clip.originalStart,
                    originalEnd: clip.originalEnd
                };
            }
            // Drag move segment
            else {
                // Calculate collision bounds (left/right neighbors)
                const activeClips = this.clips.filter(c => !c.deleted).sort((a, b) => a.timelineStart - b.timelineStart);
                const clipIdx = activeClips.findIndex(c => c.id === clip.id);
                
                let minTimelineStart = 0;
                let maxTimelineStart = Infinity;
                const clipDuration = (clip.originalEnd - clip.originalStart) / (clip.speed || 1.0);
                
                if (clipIdx > 0) {
                    const leftClip = activeClips[clipIdx - 1];
                    const leftDuration = (leftClip.originalEnd - leftClip.originalStart) / (leftClip.speed || 1.0);
                    minTimelineStart = leftClip.timelineStart + leftDuration;
                }
                if (clipIdx !== -1 && clipIdx < activeClips.length - 1) {
                    const rightClip = activeClips[clipIdx + 1];
                    maxTimelineStart = rightClip.timelineStart - clipDuration;
                }

                this.dragState = {
                    active: true,
                    type: 'move',
                    clip: clip,
                    startX: mouseX,
                    originalTimelineStart: clip.timelineStart,
                    originalStart: clip.originalStart,
                    originalEnd: clip.originalEnd,
                    minTimelineStart: minTimelineStart,
                    maxTimelineStart: maxTimelineStart
                };
            }
            
            // Dispatch select segment event
            const event = new CustomEvent('clip-selected', { detail: { clip } });
            this.canvas.dispatchEvent(event);
        } else {
            // Clicked empty background: hide popover, clear selection, and initiate scrolling
            this.selectedClip = null;
            const event = new CustomEvent('clip-selected', { detail: { clip: null } });
            this.canvas.dispatchEvent(event);
            
            this.hidePopoverMenu();
            this.dragState = {
                active: true,
                type: 'scroll',
                clip: null,
                startX: mouseX,
                startScrollX: this.scrollX
            };
        }
        
        this.draw();
    }

    onMove(clientX, clientY) {
        if (!this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = clientX - rect.left;
        const mouseY = clientY - rect.top;

        // 1. Mouse Hover styling & Hover Options menus
        if (!this.dragState.active) {
            const hit = this.getClipAtCoordinates(mouseX, mouseY);
            this.hoveredClip = hit ? hit.clip : null;

            if (hit) {
                // Update cursor
                if (hit.isNearStart || hit.isNearEnd) {
                    this.canvas.style.cursor = 'ew-resize';
                } else {
                    this.canvas.style.cursor = 'grab';
                }
            } else {
                this.canvas.style.cursor = 'default';
            }
            this.draw();
            return;
        }

        // Hide popover if dragging/editing starts
        this.hidePopoverMenu();

        // 2. Dragging actions
        const deltaX = mouseX - this.dragState.startX;
        const deltaTime = deltaX / this.zoom;
        const clip = this.dragState.clip;

        if (this.dragState.type === 'scrub') {
            this.playheadTime = Math.max(0, this.xToTime(mouseX));
            const event = new CustomEvent('playhead-jump', { detail: { time: this.playheadTime } });
            this.canvas.dispatchEvent(event);
        }
        else if (this.dragState.type === 'scroll') {
            this.scrollX = Math.max(0, this.dragState.startScrollX - deltaX);
        }
        else if (this.dragState.type === 'move' && clip) {
            // Update timelineStart, constrained by neighbors to prevent overlaps
            let newStart = this.dragState.originalTimelineStart + deltaTime;
            newStart = Math.max(this.dragState.minTimelineStart, Math.min(this.dragState.maxTimelineStart, newStart));
            clip.timelineStart = newStart;
            this.checkCollisions();
        }
        else if (this.dragState.type === 'trim-start' && clip) {
            // Trim left edge: changes originalStart and shifts timelineStart
            const speed = clip.speed || 1.0;
            const oldDuration = (clip.originalEnd - clip.originalStart) / speed;
            const oldTimelineStart = clip.timelineStart;

            const deltaOrigStart = deltaTime * speed;
            
            // Limit trim so duration doesn't become negative or go beyond bounds
            let newOriginalStart = this.dragState.originalStart + deltaOrigStart;
            newOriginalStart = Math.max(clip.boundsMin || 0, Math.min(newOriginalStart, clip.originalEnd - 0.05));
            
            const actualDeltaOrigStart = newOriginalStart - this.dragState.originalStart;
            clip.originalStart = newOriginalStart;
            clip.timelineStart = this.dragState.originalTimelineStart + (actualDeltaOrigStart / speed);

            // Ripple crop start: shift subsequent segments to stay snapped, keeping this segment's visual start anchored
            const newDuration = (clip.originalEnd - clip.originalStart) / speed;
            const diff = oldDuration - newDuration;
            clip.timelineStart = oldTimelineStart; // Anchor start position

            this.clips.forEach(other => {
                if (!other.deleted && other.id !== clip.id && other.timelineStart > clip.timelineStart) {
                    other.timelineStart = Math.max(clip.timelineStart + newDuration, other.timelineStart - diff);
                }
            });

            this.checkCollisions();
        }
        else if (this.dragState.type === 'trim-end' && clip) {
            // Trim right edge: changes originalEnd, keeps timelineStart anchored
            const speed = clip.speed || 1.0;
            const oldDuration = (clip.originalEnd - clip.originalStart) / speed;

            const deltaOrigEnd = deltaTime * speed;

            let newOriginalEnd = this.dragState.originalEnd + deltaOrigEnd;
            newOriginalEnd = Math.max(clip.originalStart + 0.05, Math.min(newOriginalEnd, clip.boundsMax || this.originalBuffer.duration));

            clip.originalEnd = newOriginalEnd;

            // Ripple crop end: shift subsequent segments left/right by duration change to prevent gaps
            const newDuration = (clip.originalEnd - clip.originalStart) / speed;
            const diff = oldDuration - newDuration;

            this.clips.forEach(other => {
                if (!other.deleted && other.id !== clip.id && other.timelineStart > clip.timelineStart) {
                    other.timelineStart = Math.max(clip.timelineStart + newDuration, other.timelineStart - diff);
                }
            });

            this.checkCollisions();
        }

        this.draw();
    }

    onEnd() {
        if (this.dragState.active) {
            const clip = this.dragState.clip;
            this.dragState.active = false;
            this.dragState.type = null;
            this.dragState.clip = null;

            // Trigger timeline update event in app to recalculate AudioEngine buffer
            const event = new CustomEvent('timeline-updated');
            this.canvas.dispatchEvent(event);
            this.draw();
        }
    }

    // Helpers to detect items under mouse
    getClipAtCoordinates(x, y) {
        const clipY = this.rulerHeight + 20;
        if (y < clipY || y > clipY + this.clipHeight) return null;

        const activeClips = this.clips.filter(c => !c.deleted);
        
        for (const clip of activeClips) {
            const duration = (clip.originalEnd - clip.originalStart) / (clip.speed || 1.0);
            const clipWidth = duration * this.zoom;
            const clipX = this.timeToX(clip.timelineStart);

            if (x >= clipX && x <= clipX + clipWidth) {
                // Determine if cursor is near left or right edge
                const isNearStart = (x - clipX) < this.edgeThresholdPx;
                const isNearEnd = (clipX + clipWidth - x) < this.edgeThresholdPx;

                return { clip, isNearStart, isNearEnd };
            }
        }
        return null;
    }

    showPopoverMenu(clip, clientX, clientY) {
        if (!this.popover) return;

        let typeLabel = 'Speech Segment';
        let showDeleteAll = false;
        let delAllLabel = '';

        if (clip.type === 'gap') {
            typeLabel = 'Silence Gap';
            showDeleteAll = true;
            delAllLabel = 'Delete All Gaps';
        } else if (clip.type === 'repeat') {
            typeLabel = `Repeat (Group #${clip.groupId})`;
            showDeleteAll = true;
            delAllLabel = 'Delete All Repeats';
        } else if (clip.type === 'final') {
            typeLabel = `Final Keep (Group #${clip.groupId})`;
        }

        let popoverHtml = `
            <div class="popover-title">${typeLabel}</div>
            <div class="popover-actions">
                <button class="popover-btn cut-btn" data-id="${clip.id}">Cut (Ctrl+X)</button>
                <button class="popover-btn copy-btn" data-id="${clip.id}">Copy (Ctrl+C)</button>
                <button class="popover-btn delete-single" data-id="${clip.id}">Delete (Del)</button>
        `;

        if (showDeleteAll) {
            popoverHtml += `<button class="popover-btn delete-all" data-type="${clip.type}">${delAllLabel}</button>`;
        }

        popoverHtml += `</div>`;
        this.popover.innerHTML = popoverHtml;

        // Position popover relative to viewport (since it is fixed position)
        this.popover.style.display = 'block';

        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const popoverWidth = this.popover.offsetWidth;
        const popoverHeight = this.popover.offsetHeight;

        // Center horizontally on click position, clamp to stay on screen
        let left = clientX - popoverWidth / 2;
        left = Math.max(10, Math.min(viewportWidth - popoverWidth - 10, left));

        // Position vertically above click. If it overflows top of screen, show below click
        let top = clientY - popoverHeight - 15;
        if (top < 10) {
            top = clientY + 15;
        }

        // Clamp to stay within vertical viewport bounds
        top = Math.max(10, Math.min(viewportHeight - popoverHeight - 10, top));

        this.popover.style.left = `${left}px`;
        this.popover.style.top = `${top}px`;

        // Attach action handlers
        this.popover.querySelector('.cut-btn').onclick = () => {
            const event = new CustomEvent('cut-clip', { detail: { id: clip.id } });
            this.canvas.dispatchEvent(event);
            this.hidePopoverMenu();
        };

        this.popover.querySelector('.copy-btn').onclick = () => {
            const event = new CustomEvent('copy-clip', { detail: { id: clip.id } });
            this.canvas.dispatchEvent(event);
            this.hidePopoverMenu();
        };

        this.popover.querySelector('.delete-single').onclick = () => {
            const event = new CustomEvent('delete-clip', { detail: { id: clip.id } });
            this.canvas.dispatchEvent(event);
            this.hidePopoverMenu();
        };

        if (showDeleteAll) {
            this.popover.querySelector('.delete-all').onclick = () => {
                const event = new CustomEvent('delete-all-clips', { detail: { type: clip.type } });
                this.canvas.dispatchEvent(event);
                this.hidePopoverMenu();
            };
        }
    }

    hidePopoverMenu() {
        if (this.popover) {
            this.popover.style.display = 'none';
        }
    }
}

// Export to window
window.AudioTimeline = AudioTimeline;
