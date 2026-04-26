import { parseMetadata, parseMapPreviewData, parseBreakPeriods } from './parser.js';
import { PreviewRenderer } from './renderer.js';
import { normalizePreviewSettings } from './settings.js';

const FALLBACK_MAP_ID = 712945;
const PLAYBACK_DURATION_MS = 45000;

const getOsuBeatmapPageUrl = (metadata) => {
    if (!metadata) return 'https://osu.ppy.sh';
    const bid = metadata.beatmapId;
    if (Number.isFinite(bid) && bid > 0) {
        return `https://osu.ppy.sh/beatmaps/${bid}`;
    }
    const set = metadata.beatmapSetID;
    if (typeof set === 'string' && set.startsWith('https://')) {
        return set;
    }
    return 'https://osu.ppy.sh';
};

/**
 * Choose a beat time to start the preview: prefer General/PreviewTime when the next
 * PLAYBACK_DURATION_MS has hit objects; otherwise move off breaks / gaps and fall back
 * to the densest segment.
 */
const choosePlaybackStartTime = (mapData, breaks, metadata, durationMs) => {
    const objects = Array.isArray(mapData?.objects) ? mapData.objects : [];
    if (objects.length === 0) {
        return 0;
    }
    const sorted = [...objects].sort((a, b) => a.time - b.time);
    const d = Math.max(0, Number.isFinite(durationMs) ? durationMs : 0);
    const W = PLAYBACK_DURATION_MS;
    const hiT = (t) => Math.min(t + W, d);

    const countStartsInWindow = (t) => {
        if (d <= 0 || t >= d) return 0;
        const h = hiT(t);
        let c = 0;
        for (const o of sorted) {
            if (o.time >= t && o.time < h) {
                c += 1;
            }
        }
        return c;
    };

    const clampStart = (t) => {
        if (!Number.isFinite(t) || t < 0) return 0;
        if (d <= 0) return 0;
        return Math.min(t, d - 0.001);
    };

    const findBreakAt = (t) => (Array.isArray(breaks) ? breaks : []).find((b) => (
        t >= b.start && t < b.end
    ));

    const findDensestWindowStart = () => {
        let r = 0;
        let bestCount = -1;
        let bestT = sorted[0].time;
        for (let l = 0; l < sorted.length; l += 1) {
            const t = sorted[l].time;
            if (r < l) r = l;
            const end = Math.min(t + W, d);
            while (r < sorted.length && sorted[r].time < end) {
                r += 1;
            }
            const count = r - l;
            if (count > bestCount) {
                bestCount = count;
                bestT = t;
            }
        }
        return clampStart(bestT);
    };

    const pt = (metadata && Number.isFinite(metadata.previewTime) && metadata.previewTime >= 0)
        ? metadata.previewTime
        : -1;

    if (d > 0 && pt >= 0 && pt < d) {
        if (countStartsInWindow(pt) >= 1) {
            return clampStart(pt);
        }
        const br = findBreakAt(pt);
        if (br) {
            const tAfter = br.end;
            if (tAfter < d && countStartsInWindow(tAfter) >= 1) {
                return clampStart(tAfter);
            }
        }
        for (const o of sorted) {
            if (o.time >= pt) {
                if (countStartsInWindow(o.time) >= 1) {
                    return clampStart(o.time);
                }
                break;
            }
        }
    }

    return findDensestWindowStart();
};

const state = {
    metadata: null,
    mapData: null,
    breaks: [],
    durationMs: 0,
    currentTimeMs: 0,
    playStartPerfMs: 0,
    rafId: null,
    nextMapData: null,
    isLoadingNext: false,
    isInitialLoad: true,
    /** Resolved first beat time for the 45s window (after PreviewTime / break / density rules) */
    playbackAnchorMs: 0,
};

const playfieldCanvas = document.querySelector('#mapPreviewCanvas');
const statusText = document.createElement('div');
statusText.id = 'previewStatus';
statusText.style.cssText = 'position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: white; font-family: sans-serif; z-index: 100; font-size: 20px; background: rgba(0,0,0,0.5); padding: 12px; border-radius: 8px; text-align: center; pointer-events: none; display: none;';
if (playfieldCanvas && playfieldCanvas.parentElement) {
    playfieldCanvas.parentElement.appendChild(statusText);
}

const updateStatus = (msg, visible = true) => {
    statusText.innerText = msg;
    statusText.style.display = visible ? 'block' : 'none';
    console.log('[Preview]', msg);
};

let renderer = null;
if (playfieldCanvas) {
    renderer = new PreviewRenderer(playfieldCanvas, null);
}

const renderFrame = () => {
    if (!renderer) return;
    const now = performance.now();
    state.currentTimeMs = (now - state.playStartPerfMs);
    
    const t0 = Number.isFinite(state.playbackAnchorMs) ? state.playbackAnchorMs : 0;
    const relativeTime = state.currentTimeMs - t0;
    // Check if we finished the playback window from the preview point
    if (relativeTime >= PLAYBACK_DURATION_MS || state.currentTimeMs >= state.durationMs) {
        loadRandomMap();
        return;
    }

    renderer.currentTimeMs = state.currentTimeMs;
    renderer.renderPlayfield(now);
    state.rafId = requestAnimationFrame(renderFrame);
};

const processMapContent = (content) => {
    const metadata = parseMetadata(content);
    const mapData = parseMapPreviewData(content);
    const breaks = parseBreakPeriods(content);
    const durationMs = (mapData.maxObjectTime || 120000) + 2000;
    return { metadata, mapData, breaks, durationMs };
};

/** `public/sample.osu` is served as `/sample.osu`. */
const SAMPLE_OSU_URL = "/sample.osu";

const fetchLocalSampleOsu = async () => {
    try {
        const response = await fetch(SAMPLE_OSU_URL);
        if (!response.ok) return null;
        const content = await response.text();
        return processMapContent(content);
    } catch (err) {
        console.warn('Could not load local sample.osu', err);
        return null;
    }
};

const fetchOsuFileByMapId = async (mapId) => {
    let response = await fetch(`https://osu.direct/api/osu/${mapId}`);
    if (!response.ok) {
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(`https://osu.ppy.sh/osu/${mapId}`)}`;
        response = await fetch(proxyUrl);
    }
    if (!response.ok) throw new Error(`Fetch .osu failed (${response.status})`);
    const content = await response.text();
    return processMapContent(content);
};

const fetchRandomMapData = async () => {
    try {
        // Nerinyan query: `min_diff:7` often returns no hits; use ranked pool and prefer harder diffs
        const searchResponse = await fetch('https://api.nerinyan.moe/search?q=status:1');
        if (!searchResponse.ok) {
            const local = await fetchLocalSampleOsu();
            if (local) return local;
            throw new Error(`Search failed (${searchResponse.status})`);
        }
        const results = await searchResponse.json();
        if (!Array.isArray(results) || results.length === 0) {
            return fetchOsuFileByMapId(FALLBACK_MAP_ID);
        }
        const randomSet = results[Math.floor(Math.random() * results.length)];
        const pool = Array.isArray(randomSet.beatmaps) ? randomSet.beatmaps : [];
        if (pool.length === 0) {
            return fetchOsuFileByMapId(FALLBACK_MAP_ID);
        }
        let pickList = pool.filter((m) => m.difficulty_rating >= 5);
        if (pickList.length === 0) {
            pickList = pool;
        }
        const randomMap = pickList[Math.floor(Math.random() * pickList.length)];
        const mapId = randomMap?.id || FALLBACK_MAP_ID;

        return fetchOsuFileByMapId(mapId);
    } catch (err) {
        console.error('Failed to fetch online map:', err);
        try {
            return await fetchOsuFileByMapId(FALLBACK_MAP_ID);
        } catch (fallbackErr) {
            console.error('Fallback map fetch failed:', fallbackErr);
            const local = await fetchLocalSampleOsu();
            if (local) return local;
            return null;
        }
    }
};

const preloadNextMap = async () => {
    if (state.isLoadingNext || state.nextMapData) return;
    state.isLoadingNext = true;
    state.nextMapData = await fetchRandomMapData();
    state.isLoadingNext = false;
};

const loadRandomMap = async () => {
    try {
        if (state.rafId) cancelAnimationFrame(state.rafId);
        
        let data = state.nextMapData;
        state.nextMapData = null;

        if (state.isInitialLoad) {
            const sampleData = await fetchLocalSampleOsu();
            if (sampleData) data = sampleData;
            state.isInitialLoad = false;
        }

        if (!data) {
            data = await fetchRandomMapData();
        }

        if (!data) throw new Error('Failed to load map data');

        state.metadata = data.metadata;
        state.mapData = data.mapData;
        state.breaks = data.breaks;
        state.durationMs = data.durationMs;

        if (renderer) {
            renderer.setBeatmap(state.mapData, state.breaks, state.durationMs);
            renderer.setPreviewSettings(normalizePreviewSettings());
        }

        const elLink = document.getElementById('mapPreviewTrackLink');
        const elTitle = document.getElementById('mapPreviewTrackTitle');
        const elDiff = document.getElementById('mapPreviewTrackDiff');
        const elMapper = document.getElementById('mapPreviewTrackMapper');
        if (elLink && elTitle && elDiff && elMapper) {
            const m = data.metadata || {};
            elTitle.textContent = m.title || '';
            elDiff.textContent = m.version || '';
            elMapper.textContent = m.creator ? `Mapper: ${m.creator}` : '';
            elLink.href = getOsuBeatmapPageUrl(m);
            elLink.setAttribute(
                'aria-label',
                `${m.title || 'Beatmap'} — ${m.version || ''} — ${m.creator ? `mapped by ${m.creator}` : ''}. Open on osu! website.`,
            );
        }

        const startTime = choosePlaybackStartTime(
            state.mapData,
            state.breaks,
            state.metadata,
            state.durationMs,
        );
        state.playbackAnchorMs = startTime;
        state.playStartPerfMs = performance.now() - startTime;
        state.currentTimeMs = startTime;
        state.rafId = requestAnimationFrame(renderFrame);

        preloadNextMap();
        
    } catch (err) {
        console.error(err);
        setTimeout(loadRandomMap, 3000);
    }
};

if (playfieldCanvas) {
    loadRandomMap();
}
