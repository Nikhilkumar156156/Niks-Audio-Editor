/**
 * app.js
 * App Controller and Event coordinator.
 * Binds UI inputs, buttons, and settings to the timeline and audio engine.
 * Implements Undo/Redo history, Ripple Delete, and Gap/Repeat triggers.
 */

class AppController {
    constructor() {
        this.timeline = null;
        this.originalBuffer = null;
        
        // Timeline Clips State
        this.clips = [];
        this.nextClipId = 1;

        // Undo/Redo History Stacks
        this.history = [];
        this.historyIndex = -1;

        // UI Binding Handles
        this.fileInput = document.getElementById('audio-file');
        this.urlInput = document.getElementById('audio-url');
        this.loadUrlBtn = document.getElementById('load-url-btn');
        this.recBtn = document.getElementById('rec-btn');
        this.recStatus = document.getElementById('rec-status');
        
        this.playBtn = document.getElementById('play-btn');
        this.stopBtn = document.getElementById('stop-btn');
        this.timeDisplay = document.getElementById('time-display');

        // Operations Panel
        this.scanGapsBtn = document.getElementById('scan-gaps-btn');
        this.scanRepeatsBtn = document.getElementById('scan-repeats-btn');
        this.gapThresholdSlider = document.getElementById('gap-threshold');
        this.gapThresholdVal = document.getElementById('gap-threshold-val');
        this.gapMinDurationSlider = document.getElementById('gap-duration');
        this.gapMinDurationVal = document.getElementById('gap-duration-val');
        this.repeatThresholdSlider = document.getElementById('repeat-threshold');
        this.repeatThresholdVal = document.getElementById('repeat-threshold-val');

        // Audio Effects Panels
        this.eqBands = Array.from({ length: 5 }, (_, i) => ({
            gain: document.getElementById(`eq-band${i + 1}-gain`),
            gainVal: document.getElementById(`eq-band${i + 1}-gain-val`),
            freq: document.getElementById(`eq-band${i + 1}-freq`),
            freqVal: document.getElementById(`eq-band${i + 1}-freq-val`),
            q: document.getElementById(`eq-band${i + 1}-q`),
            qVal: document.getElementById(`eq-band${i + 1}-q-val`)
        }));
        this.parametricToggle = document.getElementById('parametric-toggle');
        this.compressorToggle = document.getElementById('compressor-toggle');
        this.enhancerToggle = document.getElementById('enhancer-toggle');
        this.speedSlider = document.getElementById('speed-slider');
        this.speedVal = document.getElementById('speed-val');
        this.noiseGateSlider = document.getElementById('noise-gate');
        this.noiseGateVal = document.getElementById('noise-gate-val');

        // Global Operations
        this.undoBtn = document.getElementById('undo-btn');
        this.redoBtn = document.getElementById('redo-btn');
        this.cutBtn = document.getElementById('cut-btn');
        this.copyBtn = document.getElementById('copy-btn');
        this.pasteBtn = document.getElementById('paste-btn');
        this.splitBtn = document.getElementById('split-btn');
        this.insertGapBtn = document.getElementById('insert-gap-btn');
        this.exportFormatSelect = document.getElementById('export-format');
        this.exportBtn = document.getElementById('export-btn');
        
        // Mobile bindings
        this.mobileScanGapsBtn = document.getElementById('mobile-scan-gaps-btn');
        this.mobileScanRepeatsBtn = document.getElementById('mobile-scan-repeats-btn');
        this.mobileExportBtn = document.getElementById('mobile-export-btn');
        this.mobileExportFormatSelect = document.getElementById('mobile-export-format');
        
        // Edit Clipboard
        this.clipboard = null;
        
        this.zoomInBtn = document.getElementById('zoom-in-btn');
        this.zoomOutBtn = document.getElementById('zoom-out-btn');

        // Video & Mode Switcher Handles
        this.videoPreviewCard = document.getElementById('video-preview-card');
        this.videoPlayer = document.getElementById('video-preview-player');
        this.videoGapOverlay = document.getElementById('video-gap-overlay');
        this.toggleVideoSizeBtn = document.getElementById('toggle-video-size-btn');
        this.modeToggleContainer = document.getElementById('mode-toggle-container');
        this.modeAudioBtn = document.getElementById('mode-audio-btn');
        this.modeVideoBtn = document.getElementById('mode-video-btn');
        this.workspaceContent = document.getElementById('workspace-content');

        this.isVideoLoaded = false;
        this.videoObjectUrl = null;
        this.lastActiveVideoClipId = null;
        this.currentWorkspaceMode = 'audio';
    }

    init() {
        this.timeline = new AudioTimeline('timeline-canvas', 'timeline-popover');
        
        // Setup initial portals layout
        this.handleResponsivePortals();

        if (this.toggleVideoSizeBtn && this.videoPreviewCard) {
            this.toggleVideoSizeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                const container = this.videoPreviewCard.querySelector('.video-container');
                if (container) container.classList.toggle('expanded');
            });
        }

        if (this.modeAudioBtn && this.modeVideoBtn) {
            this.modeAudioBtn.addEventListener('click', () => this.setWorkspaceMode('audio'));
            this.modeVideoBtn.addEventListener('click', () => this.setWorkspaceMode('video'));
        }

        this.setupBindings();
        this.setupTimelineEvents();
        this.updateHistoryUI();
        
        // Setup resize event
        window.addEventListener('resize', () => {
            this.handleResponsivePortals();
            this.timeline.resize();
        });
    }

    setWorkspaceMode(mode) {
        this.currentWorkspaceMode = mode;
        if (mode === 'video' && this.isVideoLoaded) {
            if (this.modeAudioBtn) this.modeAudioBtn.classList.remove('active');
            if (this.modeVideoBtn) this.modeVideoBtn.classList.add('active');
            if (this.workspaceContent) this.workspaceContent.classList.add('video-mode');
            if (this.videoPreviewCard) this.videoPreviewCard.style.display = 'flex';
        } else {
            if (this.modeAudioBtn) this.modeAudioBtn.classList.add('active');
            if (this.modeVideoBtn) this.modeVideoBtn.classList.remove('active');
            if (this.workspaceContent) this.workspaceContent.classList.remove('video-mode');
            if (this.videoPreviewCard) this.videoPreviewCard.style.display = 'none';
        }
        setTimeout(() => {
            if (this.timeline) this.timeline.resize();
        }, 50);
    }

    handleResponsivePortals() {
        const isMobile = window.innerWidth <= 1024;
        const scannerPanel = document.getElementById('scanner-panel-card');
        const eqPanel = document.getElementById('eq-panel-card');
        const fxPanel = document.getElementById('fx-panel-card');
        const sidebar = document.querySelector('.sidebar');

        // EQ is always in body (modal popup on all screen sizes)
        if (eqPanel && eqPanel.parentElement !== document.body) {
            document.body.appendChild(eqPanel);
        }

        if (isMobile) {
            if (scannerPanel && scannerPanel.parentElement !== document.body) {
                document.body.appendChild(scannerPanel);
            }
            if (fxPanel && fxPanel.parentElement !== document.body) {
                document.body.appendChild(fxPanel);
            }
        } else {
            if (sidebar) {
                if (scannerPanel && scannerPanel.parentElement !== sidebar) {
                    sidebar.insertBefore(scannerPanel, sidebar.firstChild);
                }
                if (fxPanel && fxPanel.parentElement !== sidebar) {
                    const actionsPanel = document.getElementById('actions-panel-card');
                    sidebar.insertBefore(fxPanel, actionsPanel);
                }
            }
        }
    }

    setupBindings() {
        // File Loader
        this.fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) this.loadFile(file);
        });

        // URL Loader
        this.loadUrlBtn.addEventListener('click', () => {
            const url = this.urlInput.value.trim();
            if (url) {
                this.loadUrl(url);
                // Close url modal popup
                const urlModal = document.getElementById('url-modal');
                const modalBackdrop = document.getElementById('modal-backdrop');
                if (urlModal) urlModal.classList.remove('show');
                if (modalBackdrop) {
                    modalBackdrop.style.display = 'none';
                    document.body.style.overflow = '';
                }
            }
        });

        // URL Modal popup controls
        const openUrlModalBtn = document.getElementById('open-url-modal-btn');
        const closeUrlModalBtn = document.getElementById('close-url-modal');
        const urlModal = document.getElementById('url-modal');

        if (openUrlModalBtn && closeUrlModalBtn && urlModal && this.loadUrlBtn) {
            openUrlModalBtn.addEventListener('click', (e) => {
                e.preventDefault();
                console.log("Opening URL modal");
                urlModal.classList.add('show');
                const modalBackdrop = document.getElementById('modal-backdrop');
                if (modalBackdrop) modalBackdrop.style.display = 'block';
                document.body.style.overflow = 'hidden';
                // Focus on URL input field
                setTimeout(() => {
                    if (this.urlInput) this.urlInput.focus();
                }, 50);
            });

            const closeUrlModal = (e) => {
                if (e) e.preventDefault();
                console.log("Closing URL modal");
                urlModal.classList.remove('show');
                const modalBackdrop = document.getElementById('modal-backdrop');
                if (modalBackdrop) modalBackdrop.style.display = 'none';
                document.body.style.overflow = '';
            };

            closeUrlModalBtn.addEventListener('click', closeUrlModal);
        }

        // Live Recording Button
        this.recBtn.addEventListener('click', () => {
            if (window.audioEngine.isRecording) {
                this.stopRecording();
            } else {
                this.startRecording();
            }
        });

        // Empty state record button mapping
        const emptyRecBtn = document.getElementById('empty-rec-btn');
        if (emptyRecBtn) {
            emptyRecBtn.addEventListener('click', () => this.recBtn.click());
        }

        // Drag & Drop audio file onto timeline wrapper
        const timelineWrapper = document.getElementById('timeline-wrapper');
        if (timelineWrapper) {
            timelineWrapper.addEventListener('dragover', (e) => {
                e.preventDefault();
                timelineWrapper.classList.add('dragover');
            });
            timelineWrapper.addEventListener('dragleave', () => {
                timelineWrapper.classList.remove('dragover');
            });
            timelineWrapper.addEventListener('drop', (e) => {
                e.preventDefault();
                timelineWrapper.classList.remove('dragover');
                const file = e.dataTransfer.files[0];
                if (file) {
                    this.loadFile(file);
                }
            });
        }

        // Transport Controls
        this.playBtn.addEventListener('click', () => {
            if (window.audioEngine.isPlaying) {
                window.audioEngine.pause();
                if (this.isVideoLoaded && this.videoPlayer) {
                    this.videoPlayer.pause();
                }
                this.playBtn.innerHTML = `
                    <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                        <path d="M8 5v14l11-7z"/>
                    </svg><span class="btn-text"> Play</span>
                `;
            } else {
                this.playTimeline();
            }
        });

        this.stopBtn.addEventListener('click', () => {
            window.audioEngine.stop();
            if (this.isVideoLoaded && this.videoPlayer) {
                this.videoPlayer.pause();
            }
            this.playBtn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                    <path d="M8 5v14l11-7z"/>
                </svg><span class="btn-text"> Play</span>
            `;
            this.timeline.playheadTime = 0;
            this.timeline.draw();
            this.updateTimeDisplay(0);
        });

        // Scan Actions
        this.scanGapsBtn.addEventListener('click', () => this.runGapDetection());
        this.scanRepeatsBtn.addEventListener('click', () => this.runRepeatDetection());

        // Sensitivity Sliders UI values
        this.gapThresholdSlider.addEventListener('input', (e) => {
            this.gapThresholdVal.innerText = `${e.target.value} dB`;
        });
        this.gapMinDurationSlider.addEventListener('input', (e) => {
            this.gapMinDurationVal.innerText = `${e.target.value} ms`;
        });
        this.repeatThresholdSlider.addEventListener('input', (e) => {
            this.repeatThresholdVal.innerText = (e.target.value / 100).toFixed(2);
        });

        // Audio Effects Bindings
        this.eqBands.forEach((band, idx) => {
            const bandNum = idx + 1;
            
            // Gain slider
            band.gain.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                const sign = val > 0 ? '+' : '';
                band.gainVal.innerText = `${sign}${val} dB`;
                window.audioEngine.updateEQBandGain(bandNum, val);
            });

            // Frequency slider (if present)
            if (band.freq) {
                band.freq.addEventListener('input', (e) => {
                    const val = parseInt(e.target.value, 10);
                    band.freqVal.innerText = val;
                    window.audioEngine.updateEQBandFreq(bandNum, val);
                });
            }

            // Q Factor slider (if present)
            if (band.q) {
                band.q.addEventListener('input', (e) => {
                    const val = parseFloat(e.target.value) / 10;
                    band.qVal.innerText = val.toFixed(1);
                    window.audioEngine.updateEQBandQ(bandNum, val);
                });
            }
        });

        // Parametric Tuning Toggle Switch
        this.parametricToggle.addEventListener('change', (e) => {
            const show = e.target.checked;
            const subrows = document.querySelectorAll('.parametric-subrow');
            subrows.forEach(row => {
                row.style.display = show ? 'flex' : 'none';
            });
            // Auto-resize timeline canvas as dimensions change
            setTimeout(() => {
                this.timeline.resize();
            }, 100);
        });

        // Mobile EQ & FX Modal Bindings
        const openEqModalBtn = document.getElementById('open-eq-modal-btn');
        const closeEqModalBtn = document.getElementById('close-eq-modal');
        const openFxModalBtn = document.getElementById('open-fx-modal-btn');
        const closeFxModalBtn = document.getElementById('close-fx-modal');
        const openScannerModalBtn = document.getElementById('mobile-open-scanner-modal-btn');
        const closeScannerModalBtn = document.getElementById('close-scanner-modal');
        const modalBackdrop = document.getElementById('modal-backdrop');
        const eqPanelCard = document.getElementById('eq-panel-card');
        const fxPanelCard = document.getElementById('fx-panel-card');
        const scannerPanelCard = document.getElementById('scanner-panel-card');

        if (modalBackdrop) {
            // Open Scanner Modal
            if (openScannerModalBtn && scannerPanelCard) {
                openScannerModalBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    console.log("Opening Scanner modal");
                    scannerPanelCard.classList.add('modal-view');
                    modalBackdrop.style.display = 'block';
                    document.body.style.overflow = 'hidden';
                });
            }

            // Close Scanner Modal
            if (closeScannerModalBtn && scannerPanelCard) {
                closeScannerModalBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    console.log("Closing Scanner modal");
                    scannerPanelCard.classList.remove('modal-view');
                    modalBackdrop.style.display = 'none';
                    document.body.style.overflow = '';
                });
            }

            // Open EQ Modal
            if (openEqModalBtn && eqPanelCard) {
                openEqModalBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    console.log("Opening EQ modal");
                    eqPanelCard.classList.add('modal-view');
                    modalBackdrop.style.display = 'block';
                    document.body.style.overflow = 'hidden';
                });
            }

            // Close EQ Modal
            if (closeEqModalBtn && eqPanelCard) {
                closeEqModalBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    console.log("Closing EQ modal");
                    eqPanelCard.classList.remove('modal-view');
                    modalBackdrop.style.display = 'none';
                    document.body.style.overflow = '';
                });
            }

            // Open FX Modal
            if (openFxModalBtn && fxPanelCard) {
                openFxModalBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    console.log("Opening FX modal");
                    fxPanelCard.classList.add('modal-view');
                    modalBackdrop.style.display = 'block';
                    document.body.style.overflow = 'hidden';
                });
            }

            // Close FX Modal
            if (closeFxModalBtn && fxPanelCard) {
                closeFxModalBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    console.log("Closing FX modal");
                    fxPanelCard.classList.remove('modal-view');
                    modalBackdrop.style.display = 'none';
                    document.body.style.overflow = '';
                });
            }

            // Clicking backdrop closes any active modal
            modalBackdrop.addEventListener('click', () => {
                console.log("Backdrop clicked, closing modals");
                if (eqPanelCard) eqPanelCard.classList.remove('modal-view');
                if (fxPanelCard) fxPanelCard.classList.remove('modal-view');
                if (scannerPanelCard) scannerPanelCard.classList.remove('modal-view');
                const urlModal = document.getElementById('url-modal');
                if (urlModal) urlModal.classList.remove('show');
                const gapModal = document.getElementById('gap-modal');
                if (gapModal) gapModal.classList.remove('show');
                const exportModal = document.getElementById('export-modal');
                if (exportModal) exportModal.classList.remove('show');
                modalBackdrop.style.display = 'none';
                document.body.style.overflow = '';
            });
        }

        // Mobile Drawer Control Bindings
        if (this.mobileScanGapsBtn) {
            this.mobileScanGapsBtn.addEventListener('click', () => {
                if (this.scanGapsBtn) this.scanGapsBtn.click();
            });
        }
        if (this.mobileScanRepeatsBtn) {
            this.mobileScanRepeatsBtn.addEventListener('click', () => {
                if (this.scanRepeatsBtn) this.scanRepeatsBtn.click();
            });
        }
        
        const mobileFxBtn = document.getElementById('mobile-fx-btn');
        if (mobileFxBtn && fxPanelCard) {
            mobileFxBtn.addEventListener('click', (e) => {
                e.preventDefault();
                console.log("Opening FX modal via mobile button");
                fxPanelCard.classList.add('modal-view');
                if (modalBackdrop) modalBackdrop.style.display = 'block';
                document.body.style.overflow = 'hidden';
            });
        }
        
        const mobileEqBtn = document.getElementById('mobile-eq-btn');
        if (mobileEqBtn && eqPanelCard) {
            mobileEqBtn.addEventListener('click', (e) => {
                e.preventDefault();
                console.log("Opening EQ modal via mobile button");
                eqPanelCard.classList.add('modal-view');
                if (modalBackdrop) modalBackdrop.style.display = 'block';
                document.body.style.overflow = 'hidden';
            });
        }

        // Mobile Export button binding (opens Export Format pop-up modal)
        if (this.mobileExportBtn) {
            const openExportModal = (e) => {
                if (e) {
                    e.preventDefault();
                    e.stopPropagation();
                }
                console.log("Opening Export Modal on mobile");
                const exportModal = document.getElementById('export-modal');
                const modalBackdrop = document.getElementById('modal-backdrop');
                if (exportModal) {
                    exportModal.classList.add('show');
                    if (modalBackdrop) modalBackdrop.style.display = 'block';
                    document.body.style.overflow = 'hidden';
                }
            };

            this.mobileExportBtn.addEventListener('click', openExportModal);
            this.mobileExportBtn.addEventListener('touchend', openExportModal);
        }

        const closeExportModalBtn = document.getElementById('close-export-modal');
        if (closeExportModalBtn) {
            closeExportModalBtn.addEventListener('click', (e) => {
                e.preventDefault();
                const exportModal = document.getElementById('export-modal');
                if (exportModal) exportModal.classList.remove('show');
                const modalBackdrop = document.getElementById('modal-backdrop');
                if (modalBackdrop) modalBackdrop.style.display = 'none';
                document.body.style.overflow = '';
            });
        }

        const modalExportConfirmBtn = document.getElementById('modal-export-confirm-btn');
        const modalExportFormatSelect = document.getElementById('modal-export-format');
        if (modalExportConfirmBtn && modalExportFormatSelect) {
            modalExportConfirmBtn.addEventListener('click', () => {
                const format = modalExportFormatSelect.value;
                const exportModal = document.getElementById('export-modal');
                if (exportModal) exportModal.classList.remove('show');
                const modalBackdrop = document.getElementById('modal-backdrop');
                if (modalBackdrop) modalBackdrop.style.display = 'none';
                document.body.style.overflow = '';
                this.exportAudio(format);
            });
        }

        this.compressorToggle.addEventListener('change', (e) => {
            window.audioEngine.toggleCompression(e.target.checked);
        });

        this.enhancerToggle.addEventListener('change', (e) => {
            const checked = e.target.checked;
            window.audioEngine.toggleEnhancer(checked);
            if (checked) {
                // Sync UI sliders
                this.eqBands[0].gain.value = 4;
                this.eqBands[0].gainVal.innerText = '+4 dB';
                this.eqBands[2].gain.value = 1;
                this.eqBands[2].gainVal.innerText = '+1 dB';
                this.eqBands[4].gain.value = 5;
                this.eqBands[4].gainVal.innerText = '+5 dB';
                this.compressorToggle.checked = true;
            } else {
                this.eqBands.forEach(band => {
                    band.gain.value = 0;
                    band.gainVal.innerText = '0 dB';
                });
                this.compressorToggle.checked = false;
            }
        });

        this.noiseGateSlider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            this.noiseGateVal.innerText = `${val} dB`;
            window.audioEngine.updateNoiseGate(val);
            // Re-render buffer since noise gate is rendered offline in clips
            this.renderAndSyncAudio();
        });

        this.speedSlider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            this.speedVal.innerText = `${val.toFixed(2)}x`;
            window.audioEngine.setPlaybackSpeed(val);
        });

        // Undo / Redo
        this.undoBtn.addEventListener('click', () => this.undo());
        this.redoBtn.addEventListener('click', () => this.redo());

        // Zooming Timeline
        this.zoomInBtn.addEventListener('click', () => this.timeline.setZoom(this.timeline.zoom * 1.25));
        this.zoomOutBtn.addEventListener('click', () => this.timeline.setZoom(this.timeline.zoom * 0.8));

        // Export Wav
        this.exportBtn.addEventListener('click', () => this.exportAudio());

        // Cut, Copy, Paste, Split Button Event Listeners
        this.cutBtn.addEventListener('click', () => this.cutSelected());
        this.copyBtn.addEventListener('click', () => this.copySelected());
        this.pasteBtn.addEventListener('click', () => this.pasteAtPlayhead());
        this.splitBtn.addEventListener('click', () => this.splitAtPlayhead());

        this.insertGapBtn.addEventListener('click', () => {
            const gapModal = document.getElementById('gap-modal');
            const gapDurationInput = document.getElementById('gap-duration-input');
            const modalBackdrop = document.getElementById('modal-backdrop');
            if (gapModal) {
                gapModal.classList.add('show');
                if (modalBackdrop) modalBackdrop.style.display = 'block';
                document.body.style.overflow = 'hidden';
                if (gapDurationInput) {
                    gapDurationInput.value = "1.0";
                    setTimeout(() => gapDurationInput.focus(), 50);
                }
            }
        });

        const closeGapModalBtn = document.getElementById('close-gap-modal');
        if (closeGapModalBtn) {
            closeGapModalBtn.addEventListener('click', (e) => {
                e.preventDefault();
                const gapModal = document.getElementById('gap-modal');
                if (gapModal) gapModal.classList.remove('show');
                const modalBackdrop = document.getElementById('modal-backdrop');
                if (modalBackdrop) modalBackdrop.style.display = 'none';
                document.body.style.overflow = '';
            });
        }

        const confirmGapBtn = document.getElementById('confirm-gap-btn');
        const gapDurationInput = document.getElementById('gap-duration-input');
        if (confirmGapBtn && gapDurationInput) {
            confirmGapBtn.addEventListener('click', () => {
                const duration = parseFloat(gapDurationInput.value);
                if (isNaN(duration) || duration <= 0) {
                    alert("Please enter a valid positive duration in seconds.");
                    return;
                }
                this.insertGapAtPlayhead(duration);
                const gapModal = document.getElementById('gap-modal');
                if (gapModal) gapModal.classList.remove('show');
                const modalBackdrop = document.getElementById('modal-backdrop');
                if (modalBackdrop) modalBackdrop.style.display = 'none';
                document.body.style.overflow = '';
            });

            gapDurationInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    confirmGapBtn.click();
                }
            });
        }

        // Keyboard Shortcuts (Space key to play/pause, Ctrl+X, Ctrl+C, Ctrl+V, S, Delete)
        window.addEventListener('keydown', (e) => {
            const active = document.activeElement;
            if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) {
                return;
            }

            // Space key to play/pause
            if (e.code === 'Space' || e.key === ' ') {
                e.preventDefault();
                this.playBtn.click();
            }
            // Ctrl+X or Cmd+X to Cut
            else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
                e.preventDefault();
                this.cutSelected();
            }
            // Ctrl+C or Cmd+C to Copy
            else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
                e.preventDefault();
                this.copySelected();
            }
            // Ctrl+V or Cmd+V to Paste
            else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
                e.preventDefault();
                this.pasteAtPlayhead();
            }
            // S key or Ctrl+K to Split (Cut segments in between)
            else if (e.key.toLowerCase() === 's' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
                e.preventDefault();
                this.splitAtPlayhead();
            }
            // G key to trigger Insert Gap Modal
            else if (e.key.toLowerCase() === 'g') {
                if (this.insertGapBtn && !this.insertGapBtn.disabled) {
                    e.preventDefault();
                    this.insertGapBtn.click();
                }
            }
            // Delete or Backspace to delete selected clip
            else if (e.key === 'Delete' || e.key === 'Backspace') {
                if (this.timeline.selectedClip) {
                    e.preventDefault();
                    this.deleteClip(this.timeline.selectedClip.id);
                    this.timeline.selectedClip = null;
                    this.updateCutCopyPasteUI();
                }
            }
        });
    }

    setupTimelineEvents() {
        const canvas = this.timeline.canvas;

        // Jump Playhead when scrubbing or dblclicking timeline
        canvas.addEventListener('playhead-jump', (e) => {
            const time = e.detail.time;
            this.updateTimeDisplay(time);
            if (window.audioEngine.isPlaying) {
                this.playTimeline(time);
            }
            this.updateCutCopyPasteUI();
        });

        // Re-render audio buffer when segments are dragged or trimmed
        canvas.addEventListener('timeline-updated', () => {
            this.saveHistory();
            this.renderAndSyncAudio();
        });

        // Timeline item context delete operations
        canvas.addEventListener('delete-clip', (e) => {
            if (this.timeline.selectedClip && this.timeline.selectedClip.id === e.detail.id) {
                this.timeline.selectedClip = null;
            }
            this.deleteClip(e.detail.id);
            this.updateCutCopyPasteUI();
        });

        canvas.addEventListener('delete-all-clips', (e) => {
            this.timeline.selectedClip = null;
            this.deleteAllClipsOfType(e.detail.type);
            this.updateCutCopyPasteUI();
        });

        canvas.addEventListener('clip-selected', () => {
            this.updateCutCopyPasteUI();
        });

        canvas.addEventListener('cut-clip', (e) => {
            const clip = this.clips.find(c => c.id === e.detail.id);
            if (clip) {
                this.timeline.selectedClip = clip;
                this.cutSelected();
            }
        });

        canvas.addEventListener('copy-clip', (e) => {
            const clip = this.clips.find(c => c.id === e.detail.id);
            if (clip) {
                this.timeline.selectedClip = clip;
                this.copySelected();
            }
        });
    }

    // Load a local Audio or Video File
    async loadFile(file) {
        const isVideo = file.type.startsWith('video/') || /\.(mp4|webm|mov|mkv|avi|flv|wmv|m4v|3gp|ts)$/i.test(file.name);
        this.showLoadingState(true, isVideo ? "Extracting video audio track & decoding..." : "Decoding audio file...");
        try {
            const audioBuf = await window.audioEngine.decodeAudio(file, file);
            const videoUrl = isVideo ? URL.createObjectURL(file) : null;
            this.setNewAudioBuffer(audioBuf, isVideo, videoUrl);
        } catch (err) {
            console.error("Error decoding file:", err);
            alert(`Could not load media file (${file.name}). Please check that it is a valid audio or video file supported by your browser.`);
        } finally {
            this.showLoadingState(false);
        }
    }

    // Load from url
    async loadUrl(url) {
        const isVideo = /\.(mp4|webm|mov|mkv|avi|flv|wmv|m4v|3gp|ts)($|\?)/i.test(url);
        this.showLoadingState(true, isVideo ? "Downloading video & decoding audio..." : "Downloading audio...");
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error("HTTP error " + response.status);
            const blob = await response.blob();
            const arrayBuf = await blob.arrayBuffer();
            const audioBuf = await window.audioEngine.decodeAudio(arrayBuf, blob);
            this.setNewAudioBuffer(audioBuf, isVideo, url);
        } catch (err) {
            console.error("Error fetching URL:", err);
            alert("Could not fetch or decode media from URL. Ensure CORS headers are enabled.");
        } finally {
            this.showLoadingState(false);
        }
    }

    // Recording Session
    async startRecording() {
        this.recStatus.style.display = "inline-flex";
        this.recBtn.classList.add("recording");
        this.recBtn.innerHTML = `
            <span class="rec-dot pulsing"></span><span class="btn-text"> Stop Rec</span>
        `;
        window.audioEngine.stop();
        await window.audioEngine.startRecording((audioBuf) => {
            this.setNewAudioBuffer(audioBuf, false, null);
        });
    }

    stopRecording() {
        window.audioEngine.stopRecording();
        this.recStatus.style.display = "none";
        this.recBtn.classList.remove("recording");
        this.recBtn.innerHTML = `
            <span class="rec-dot"></span><span class="btn-text"> Record (Live)</span>
        `;
    }

    // Set a newly loaded or recorded buffer as the project source
    setNewAudioBuffer(audioBuffer, isVideo = false, videoUrl = null) {
        this.originalBuffer = audioBuffer;
        
        if (this.videoObjectUrl && this.videoObjectUrl.startsWith('blob:')) {
            URL.revokeObjectURL(this.videoObjectUrl);
        }
        this.videoObjectUrl = videoUrl;

        if (isVideo && videoUrl && this.videoPlayer) {
            this.isVideoLoaded = true;
            this.videoPlayer.src = videoUrl;
            this.videoPlayer.load();
            if (this.modeToggleContainer) this.modeToggleContainer.style.display = 'flex';
            this.setWorkspaceMode('video');
        } else {
            this.isVideoLoaded = false;
            if (this.videoPlayer) this.videoPlayer.src = '';
            if (this.modeToggleContainer) this.modeToggleContainer.style.display = 'none';
            this.setWorkspaceMode('audio');
        }

        // Hide empty state placeholder
        const emptyState = document.getElementById('empty-state');
        if (emptyState) {
            emptyState.style.display = 'none';
        }
        
        // Reset states
        this.clips = [{
            id: this.nextClipId++,
            originalStart: 0,
            originalEnd: audioBuffer.duration,
            timelineStart: 0,
            speed: 1.0,
            type: 'normal',
            boundsMin: 0,
            boundsMax: audioBuffer.duration,
            deleted: false
        }];
        
        this.history = [];
        this.historyIndex = -1;

        // Initialize timeline and audio engine with new buffer
        this.timeline.setBuffer(audioBuffer);
        this.timeline.setClips(this.clips);
        
        this.saveHistory();
        this.renderAndSyncAudio();

        // Reset selections & clipboard
        this.clipboard = null;
        this.timeline.selectedClip = null;
        this.updateCutCopyPasteUI();

        // Enable action buttons
        this.scanGapsBtn.disabled = false;
        this.scanRepeatsBtn.disabled = false;
        this.exportBtn.disabled = false;
        if (this.mobileScanGapsBtn) this.mobileScanGapsBtn.disabled = false;
        if (this.mobileScanRepeatsBtn) this.mobileScanRepeatsBtn.disabled = false;
        if (this.mobileExportBtn) this.mobileExportBtn.disabled = false;
    }

    // Playback starting from an offset
    playTimeline(timeOffset = null) {
        if (!this.originalBuffer) return;
        
        const offset = timeOffset !== null ? timeOffset : this.timeline.playheadTime;
        
        this.playBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
            </svg><span class="btn-text"> Pause</span>
        `;

        if (this.isVideoLoaded && this.videoPlayer) {
            this.syncVideoToPlayhead(offset);
        }

        window.audioEngine.play(
            offset,
            (currentTime) => {
                this.timeline.playheadTime = currentTime;
                this.timeline.draw();
                this.updateTimeDisplay(currentTime);
            },
            () => {
                // Completed playback
                if (this.isVideoLoaded && this.videoPlayer) {
                    this.videoPlayer.pause();
                }
                this.playBtn.innerHTML = `
                    <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                        <path d="M8 5v14l11-7z"/>
                    </svg><span class="btn-text"> Play</span>
                `;
                this.timeline.playheadTime = 0;
                this.timeline.draw();
                this.updateTimeDisplay(0);
            }
        );
    }

    // Build the rendered audio buffer based on the active clip list
    renderAndSyncAudio() {
        if (!this.originalBuffer) return;
        const rendered = window.audioEngine.renderTimeline(this.originalBuffer, this.clips);
        
        // Sync duration to timeline scroll bounds
        this.timeline.draw();

        // Update the timecode indicator to show updated duration
        this.updateTimeDisplay(this.timeline.playheadTime);
    }

    // Run Silence Gap detection algorithm
    runGapDetection() {
        if (!this.originalBuffer) return;
        
        const thresholdDb = parseFloat(this.gapThresholdSlider.value);
        const minGapDurationMs = parseFloat(this.gapMinDurationSlider.value);
        
        this.showLoadingState(true, "Scanning silent gaps...");
        
        setTimeout(() => {
            const { gaps, speech } = window.AudioDetector.detectGaps(this.originalBuffer, thresholdDb, minGapDurationMs);
            
            // Build new clip list
            const newClips = [];
            
            // Add gaps and speech segments to the list
            gaps.forEach(gap => {
                newClips.push({
                    id: this.nextClipId++,
                    originalStart: gap.start,
                    originalEnd: gap.end,
                    timelineStart: gap.start,
                    type: 'gap',
                    boundsMin: gap.start,
                    boundsMax: gap.end,
                    deleted: false
                });
            });

            speech.forEach(seg => {
                newClips.push({
                    id: this.nextClipId++,
                    originalStart: seg.start,
                    originalEnd: seg.end,
                    timelineStart: seg.start,
                    type: 'normal',
                    boundsMin: seg.start,
                    boundsMax: seg.end,
                    deleted: false
                });
            });

            // Sort clips by timelineStart
            newClips.sort((a, b) => a.timelineStart - b.timelineStart);

            this.clips = newClips;
            this.timeline.setClips(this.clips);
            this.saveHistory();
            this.renderAndSyncAudio();
            this.showLoadingState(false);
        }, 50);
    }
    // Run DTW-based repeat phrases detection
    runRepeatDetection() {
        if (!this.originalBuffer) return;

        this.showLoadingState(true, "Refining segments & analyzing repeats...");

        setTimeout(() => {
            const thresholdDb = parseFloat(this.gapThresholdSlider.value);
            const subMinDurationMs = 150; // Sensitive pause threshold for subdivision

            const newClips = [];
            let clipsChanged = false;

            this.clips.forEach(clip => {
                if (clip.deleted || clip.type === 'gap') {
                    newClips.push(clip);
                    return;
                }

                // Subdivide active speech clips
                const sampleRate = this.originalBuffer.sampleRate;
                const startSample = Math.floor(clip.originalStart * sampleRate);
                const endSample = Math.floor(clip.originalEnd * sampleRate);
                const length = endSample - startSample;

                if (length <= 0) {
                    newClips.push(clip);
                    return;
                }

                // Extract audio slice data
                const channelData = this.originalBuffer.getChannelData(0).subarray(startSample, endSample);
                
                // Construct a mock AudioBuffer for detectGaps
                const mockBuffer = {
                    sampleRate: sampleRate,
                    duration: length / sampleRate,
                    getChannelData: () => channelData
                };

                const { gaps, speech } = window.AudioDetector.detectGaps(mockBuffer, thresholdDb, subMinDurationMs);

                if (speech.length <= 1) {
                    newClips.push(clip);
                    return;
                }

                clipsChanged = true;
                const speed = clip.speed || 1.0;

                // Add subdivided speech and gap clips
                const subSegments = [];
                gaps.forEach(gap => {
                    subSegments.push({
                        type: 'gap',
                        start: gap.start,
                        end: gap.end
                    });
                });
                speech.forEach(sp => {
                    subSegments.push({
                        type: 'speech',
                        start: sp.start,
                        end: sp.end
                    });
                });

                // Sort chronologically
                subSegments.sort((a, b) => a.start - b.start);

                subSegments.forEach(sub => {
                    const origStart = clip.originalStart + sub.start;
                    const origEnd = clip.originalStart + sub.end;
                    const timelineOffset = sub.start / speed;

                    newClips.push({
                        id: this.nextClipId++,
                        originalStart: origStart,
                        originalEnd: origEnd,
                        timelineStart: clip.timelineStart + timelineOffset,
                        speed: speed,
                        type: sub.type === 'gap' ? 'gap' : 'normal',
                        boundsMin: origStart,
                        boundsMax: origEnd,
                        deleted: false
                    });
                });
            });

            if (clipsChanged) {
                this.clips = newClips;
                this.clips.sort((a, b) => a.timelineStart - b.timelineStart);
                this.timeline.setClips(this.clips);
            }

            // Now, run repeat detection on all active speech segments
            const activeSpeechClips = this.clips.filter(c => !c.deleted && c.type !== 'gap');
            if (activeSpeechClips.length <= 1) {
                this.showLoadingState(false);
                this.renderAndSyncAudio();
                return;
            }

            // Reset type to normal
            activeSpeechClips.forEach(c => {
                c.type = 'normal';
                c.groupId = null;
            });

            const similarityThreshold = parseFloat(this.repeatThresholdSlider.value) / 100;
            const speechBounds = activeSpeechClips.map(c => ({ start: c.originalStart, end: c.originalEnd }));
            const results = window.AudioDetector.detectRepeats(this.originalBuffer, speechBounds, similarityThreshold);

            // Merge detection types back into the actual clips
            results.forEach(res => {
                const clip = activeSpeechClips[res.id];
                if (clip) {
                    clip.type = res.type; // 'normal' | 'repeat' | 'final'
                    clip.groupId = res.groupId;
                }
            });

            this.timeline.setClips(this.clips);
            this.saveHistory();
            this.renderAndSyncAudio();
            this.showLoadingState(false);
        }, 50);
    }

    /**
     * Ripple Delete a clip from the timeline.
     * Shifts all subsequent clips left by the deleted clip's duration to close the void.
     * @param {number} clipId
     */
    deleteClip(clipId) {
        const clipIdx = this.clips.findIndex(c => c.id === clipId);
        if (clipIdx === -1) return;

        const deletedClip = this.clips[clipIdx];
        deletedClip.deleted = true;

        const duration = (deletedClip.originalEnd - deletedClip.originalStart) / (deletedClip.speed || 1.0);
        const delStart = deletedClip.timelineStart;

        // Ripple shift: shift clips that start at or after the deleted clip (using >= to prevent rounding gaps)
        this.clips.forEach(clip => {
            if (!clip.deleted && clip.timelineStart >= delStart) {
                clip.timelineStart = Math.max(delStart, clip.timelineStart - duration);
            }
        });

        // Clean up repeat groups: if a group has <= 1 active clips left, convert them to normal (Blue)
        this.cleanRepeatGroups();

        // Sort clips chronologically by timelineStart to maintain array consistency
        this.clips.sort((a, b) => a.timelineStart - b.timelineStart);

        this.timeline.setClips(this.clips);
        this.saveHistory();
        this.renderAndSyncAudio();
    }

    /**
     * Copy selected clip properties to virtual clipboard, and delete it from timeline (with ripple shift).
     */
    cutSelected() {
        if (!this.timeline.selectedClip) return;
        this.clipboard = { ...this.timeline.selectedClip };
        this.deleteClip(this.timeline.selectedClip.id);
        this.timeline.selectedClip = null;
        this.updateCutCopyPasteUI();
    }

    /**
     * Copy selected clip properties to virtual clipboard.
     */
    copySelected() {
        if (!this.timeline.selectedClip) return;
        this.clipboard = { ...this.timeline.selectedClip };
        this.updateCutCopyPasteUI();
    }

    /**
     * Paste clipboard contents at the current playhead position, shifting subsequent elements to the right.
     */
    pasteAtPlayhead() {
        if (!this.clipboard) return;
        const playhead = this.timeline.playheadTime;
        const speed = this.clipboard.speed || 1.0;
        const duration = (this.clipboard.originalEnd - this.clipboard.originalStart) / speed;

        // 1. Check if playhead intersects an active segment (if so, split it)
        const activeClips = this.clips.filter(c => !c.deleted);
        const intersectingClip = activeClips.find(c => {
            const end = c.timelineStart + (c.originalEnd - c.originalStart) / (c.speed || 1.0);
            return playhead > c.timelineStart && playhead < end;
        });

        if (intersectingClip) {
            const splitSpeed = intersectingClip.speed || 1.0;
            const timeOffset = playhead - intersectingClip.timelineStart;
            const splitOffset = intersectingClip.originalStart + timeOffset * splitSpeed;

            // Left part
            const leftClip = {
                ...intersectingClip,
                id: this.nextClipId++,
                originalEnd: splitOffset,
                boundsMax: splitOffset
            };

            // Right part
            const rightClip = {
                ...intersectingClip,
                id: this.nextClipId++,
                originalStart: splitOffset,
                timelineStart: playhead,
                boundsMin: splitOffset
            };

            intersectingClip.deleted = true;
            this.clips.push(leftClip, rightClip);
        }

        // 2. Ripple shift all active segments starting at or after playhead to the right
        this.clips.forEach(c => {
            if (!c.deleted && c.timelineStart >= playhead) {
                c.timelineStart += duration;
            }
        });

        // 3. Insert pasted clip at playhead position
        const pastedClip = {
            ...this.clipboard,
            id: this.nextClipId++,
            timelineStart: playhead,
            boundsMin: this.clipboard.originalStart,
            boundsMax: this.clipboard.originalEnd,
            deleted: false
        };
        this.clips.push(pastedClip);

        // 4. Sort clips and clean repeat groups
        this.clips.sort((a, b) => a.timelineStart - b.timelineStart);
        this.cleanRepeatGroups();

        this.timeline.setClips(this.clips);
        this.saveHistory();
        this.renderAndSyncAudio();
        this.updateCutCopyPasteUI();
    }

    /**
     * Enable or disable Cut, Copy, Paste, and Split actions based on selection, clipboard state, and playhead position.
     */
    updateCutCopyPasteUI() {
        const hasSelection = !!this.timeline.selectedClip;
        this.cutBtn.disabled = !hasSelection;
        this.copyBtn.disabled = !hasSelection;
        this.pasteBtn.disabled = !this.clipboard;

        // Enable split if playhead is within any active clip (cutting segments in between)
        const playhead = this.timeline.playheadTime;
        const activeClips = this.clips.filter(c => !c.deleted);
        const canSplit = activeClips.some(c => {
            const duration = (c.originalEnd - c.originalStart) / (c.speed || 1.0);
            return playhead > c.timelineStart && playhead < c.timelineStart + duration;
        });
        this.splitBtn.disabled = !canSplit;

        if (this.insertGapBtn) {
            this.insertGapBtn.disabled = !this.originalBuffer;
        }
    }

    /**
     * Cut/Split the segment under the playhead into two distinct segments.
     */
    splitAtPlayhead() {
        const playhead = this.timeline.playheadTime;
        const activeClips = this.clips.filter(c => !c.deleted);
        const targetClip = activeClips.find(c => {
            const duration = (c.originalEnd - c.originalStart) / (c.speed || 1.0);
            return playhead > c.timelineStart && playhead < c.timelineStart + duration;
        });

        if (!targetClip) return;

        const speed = targetClip.speed || 1.0;
        const timeOffset = playhead - targetClip.timelineStart;
        const splitOffset = targetClip.originalStart + timeOffset * speed;

        // Left Part
        const leftClip = {
            ...targetClip,
            id: this.nextClipId++,
            originalEnd: splitOffset,
            boundsMax: splitOffset
        };

        // Right Part
        const rightClip = {
            ...targetClip,
            id: this.nextClipId++,
            originalStart: splitOffset,
            timelineStart: playhead,
            boundsMin: splitOffset
        };

        // Mark original clip as deleted and store left/right split pieces
        targetClip.deleted = true;
        this.clips.push(leftClip, rightClip);

        // Sort clips chronologically
        this.clips.sort((a, b) => a.timelineStart - b.timelineStart);

        this.timeline.selectedClip = leftClip; // Select left split part
        this.timeline.setClips(this.clips);
        this.saveHistory();
        this.renderAndSyncAudio();
        this.updateCutCopyPasteUI();
    }

    /**
     * Insert a silent gap at the playhead by shifting subsequent elements to the right.
     */
    insertGapAtPlayhead(duration) {
        if (!this.originalBuffer) return;
        const playhead = this.timeline.playheadTime;

        // 1. Check if playhead intersects an active segment (if so, split it)
        const activeClips = this.clips.filter(c => !c.deleted);
        const intersectingClip = activeClips.find(c => {
            const end = c.timelineStart + (c.originalEnd - c.originalStart) / (c.speed || 1.0);
            return playhead > c.timelineStart && playhead < end;
        });

        if (intersectingClip) {
            const splitSpeed = intersectingClip.speed || 1.0;
            const timeOffset = playhead - intersectingClip.timelineStart;
            const splitOffset = intersectingClip.originalStart + timeOffset * splitSpeed;

            // Left part
            const leftClip = {
                ...intersectingClip,
                id: this.nextClipId++,
                originalEnd: splitOffset,
                boundsMax: splitOffset
            };

            // Right part
            const rightClip = {
                ...intersectingClip,
                id: this.nextClipId++,
                originalStart: splitOffset,
                timelineStart: playhead,
                boundsMin: splitOffset
            };

            intersectingClip.deleted = true;
            this.clips.push(leftClip, rightClip);
        }

        // 2. Ripple shift all active segments starting at or after playhead to the right
        this.clips.forEach(c => {
            if (!c.deleted && c.timelineStart >= playhead) {
                c.timelineStart += duration;
            }
        });

        // 3. Sort clips and clean repeat groups
        this.clips.sort((a, b) => a.timelineStart - b.timelineStart);
        this.cleanRepeatGroups();

        // 4. Update timeline and audio engine
        this.timeline.setClips(this.clips);
        this.saveHistory();
        this.renderAndSyncAudio();
        this.updateCutCopyPasteUI();
    }

    /**
     * Ripple Delete all clips of a specific type (e.g. 'gap' or 'repeat')
     * @param {string} type - 'gap' | 'repeat'
     */
    deleteAllClipsOfType(type) {
        // Sort active clips chronologically to execute safe ordered shifting
        let activeClips = this.clips.filter(c => !c.deleted).sort((a, b) => a.timelineStart - b.timelineStart);

        let cumulativeShift = 0;
        const targetClips = activeClips.filter(c => c.type === type);

        if (targetClips.length === 0) return;

        // Traverse clips chronologically
        activeClips.forEach(clip => {
            if (clip.type === type) {
                // Delete this clip
                clip.deleted = true;
                const duration = (clip.originalEnd - clip.originalStart) / (clip.speed || 1.0);
                cumulativeShift += duration;
            } else {
                // Shift this clip left by the current cumulative deleted duration
                clip.timelineStart = Math.max(0, clip.timelineStart - cumulativeShift);
            }
        });

        // Clean up repeat groups: if a group has <= 1 active clips left, convert them to normal (Blue)
        this.cleanRepeatGroups();

        // Sort clips chronologically by timelineStart to maintain array consistency
        this.clips.sort((a, b) => a.timelineStart - b.timelineStart);

        this.timeline.setClips(this.clips);
        this.saveHistory();
        this.renderAndSyncAudio();
    }

    /**
     * Clear and reset repeat groups that have been resolved (only 1 or 0 clips remaining in the group).
     * Automatically converts the final green "keep" takes back to normal blue segments.
     */
    cleanRepeatGroups() {
        const groupCounts = {};
        this.clips.forEach(clip => {
            if (!clip.deleted && clip.groupId) {
                groupCounts[clip.groupId] = (groupCounts[clip.groupId] || 0) + 1;
            }
        });

        this.clips.forEach(clip => {
            if (!clip.deleted && clip.groupId && groupCounts[clip.groupId] <= 1) {
                clip.type = 'normal';
                clip.groupId = null;
            }
        });
    }

    // Save current state of clips into the Undo stack
    saveHistory() {
        // Truncate any forward history (if we had undone steps)
        this.history = this.history.slice(0, this.historyIndex + 1);
        
        // Deep copy clips array
        const clipsCopy = this.clips.map(c => ({ ...c }));
        
        this.history.push(clipsCopy);
        this.historyIndex++;
        
        this.updateHistoryUI();
    }

    undo() {
        if (this.historyIndex > 0) {
            this.historyIndex--;
            this.restoreFromHistory();
        }
    }

    redo() {
        if (this.historyIndex < this.history.length - 1) {
            this.historyIndex++;
            this.restoreFromHistory();
        }
    }

    restoreFromHistory() {
        const restoredClips = this.history[this.historyIndex];
        // Deep copy
        this.clips = restoredClips.map(c => ({ ...c }));

        this.timeline.setClips(this.clips);
        this.renderAndSyncAudio();
        this.updateHistoryUI();
    }

    updateHistoryUI() {
        this.undoBtn.disabled = (this.historyIndex <= 0);
        this.redoBtn.disabled = (this.historyIndex >= this.history.length - 1);
    }

    // Export output as a WAV, MP3, AAC, WebM, or MP4 file download
    exportAudio(formatOverride = null) {
        if (!window.audioEngine.renderedBuffer) {
            alert("Please import or record a media file first before exporting.");
            return;
        }
        
        let format = formatOverride || 'wav';
        if (!formatOverride && this.exportFormatSelect) {
            format = this.exportFormatSelect.value;
        }
        const formatText = format.toUpperCase();
        this.showLoadingState(true, `Encoding ${formatText} file...`);
        
        setTimeout(async () => {
            try {
                let blob;
                const filename = `edited_podcast_hq.${format}`;
                
                if (format === 'mp3') {
                    blob = window.audioEngine.exportMp3(window.audioEngine.renderedBuffer);
                } else if (format === 'aac') {
                    blob = await window.audioEngine.exportAac(window.audioEngine.renderedBuffer);
                } else if (format === 'webm' || format === 'mp4') {
                    if (!this.isVideoLoaded || !this.videoPlayer) {
                        alert("Exporting a video file requires an imported video. Please load a video file.");
                        this.showLoadingState(false);
                        return;
                    }
                    blob = await window.audioEngine.exportVideoTimeline(
                        this.videoPlayer,
                        this.clips,
                        window.audioEngine.renderedBuffer,
                        format === 'mp4' ? 'video/mp4' : 'video/webm'
                    );
                } else {
                    blob = window.audioEngine.exportWav(window.audioEngine.renderedBuffer);
                }
                
                const url = URL.createObjectURL(blob);
                
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                
                setTimeout(() => {
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                }, 100);
            } catch (err) {
                console.error("Export failed:", err);
                alert(`Audio export failed: ${err.message || err}`);
            } finally {
                this.showLoadingState(false);
            }
        }, 50);
    }

    syncVideoToPlayhead(time) {
        if (!this.isVideoLoaded || !this.videoPlayer) return;

        const isPlaying = window.audioEngine.isPlaying;
        const activeClips = this.clips.filter(c => !c.deleted);
        const activeClip = activeClips.find(c => {
            const dur = (c.originalEnd - c.originalStart) / (c.speed || 1.0);
            return time >= c.timelineStart && time < c.timelineStart + dur;
        });

        if (activeClip) {
            if (this.videoGapOverlay) this.videoGapOverlay.style.display = 'none';
            const speed = activeClip.speed || 1.0;
            const timeOffset = time - activeClip.timelineStart;
            const targetVideoTime = activeClip.originalStart + timeOffset * speed;

            if (this.videoPlayer.playbackRate !== speed) {
                this.videoPlayer.playbackRate = speed;
            }

            if (isPlaying) {
                if (this.videoPlayer.paused) {
                    if (Math.abs(this.videoPlayer.currentTime - targetVideoTime) > 0.05) {
                        this.videoPlayer.currentTime = targetVideoTime;
                    }
                    this.videoPlayer.play().catch(() => {});
                    this.lastActiveVideoClipId = activeClip.id;
                } else {
                    const clipChanged = this.lastActiveVideoClipId !== activeClip.id;
                    const drift = Math.abs(this.videoPlayer.currentTime - targetVideoTime);
                    if (clipChanged || drift > 0.25) {
                        this.videoPlayer.currentTime = targetVideoTime;
                        this.lastActiveVideoClipId = activeClip.id;
                    }
                }
            } else {
                if (!this.videoPlayer.paused) {
                    this.videoPlayer.pause();
                }
                if (Math.abs(this.videoPlayer.currentTime - targetVideoTime) > 0.03) {
                    this.videoPlayer.currentTime = targetVideoTime;
                }
            }
        } else {
            if (this.videoGapOverlay) this.videoGapOverlay.style.display = 'flex';
            if (!this.videoPlayer.paused) {
                this.videoPlayer.pause();
            }
            this.lastActiveVideoClipId = null;
        }
    }

    updateTimeDisplay(sec) {
        const totalSec = window.audioEngine.renderedBuffer ? window.audioEngine.renderedBuffer.duration : 0;
        
        const formatTime = (t) => {
            const m = Math.floor(t / 60);
            const s = Math.floor(t % 60);
            const ms = Math.floor((t % 1) * 100);
            return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
        };

        if (totalSec > 0) {
            this.timeDisplay.innerText = `${formatTime(sec)} / ${formatTime(totalSec)}`;
        } else {
            this.timeDisplay.innerText = formatTime(sec);
        }

        this.syncVideoToPlayhead(sec);
    }

    showLoadingState(show, text = "") {
        const spinner = document.getElementById('loading-overlay');
        const spinnerText = document.getElementById('loading-text');
        if (spinner) {
            spinner.style.display = show ? 'flex' : 'none';
            if (spinnerText) spinnerText.innerText = text;
        }
    }
}

// Instantiate and launch App
window.onload = () => {
    window.app = new AppController();
    window.app.init();
};
