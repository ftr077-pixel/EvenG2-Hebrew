/**
 * useGlassesHebrew — renders Hebrew text as images using the G2's chart layout.
 *
 * Uses the proven chart layout: 3 image tiles (200×100) across the top,
 * with a text container below for action buttons.
 * This is the same layout stock chart apps use — proven on real G2 hardware.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { DisplayData, GlassAction, GlassNavState } from 'even-toolkit';
import { EvenHubBridge } from 'even-toolkit/bridge';
import { mapGlassEvent } from 'even-toolkit/action-map';
import { bindKeyboard } from 'even-toolkit/keyboard';
import { activateKeepAlive, deactivateKeepAlive } from 'even-toolkit/keep-alive';
import { renderHebrewTiles, TILES } from './hebrewRenderer';
import { dbg } from './debugLog';

export interface UseGlassesHebrewConfig<S> {
  getSnapshot: () => S;
  toDisplayData: (snapshot: S, nav: GlassNavState) => DisplayData;
  onGlassAction: (action: GlassAction, nav: GlassNavState, snapshot: S) => GlassNavState;
  deriveScreen: (path: string) => string;
  appName: string;
}

/** Build a simple ASCII action bar from DisplayData (for the text area below tiles) */
function extractActionText(data: DisplayData): string {
  // Take only non-image lines (action buttons at the bottom)
  const lines = data.lines;
  const actionLines: string[] = [];
  for (const ln of lines) {
    if (ln.inverted || ln.style === 'separator') {
      const t = ln.inverted ? `> ${ln.text}` : '---';
      actionLines.push(t);
    }
  }
  return actionLines.length > 0 ? '\n' + actionLines.join('\n') : '';
}

export function useGlassesHebrew<S>(config: UseGlassesHebrewConfig<S>): void {
  const location = useLocation();
  const navigate = useNavigate();

  const hubRef = useRef<EvenHubBridge | null>(null);
  const navRef = useRef<GlassNavState>({ highlightedIndex: 0, screen: '' });
  const lastSnapshotRef = useRef<S | null>(null);
  const sendingRef = useRef(false);
  const pendingRef = useRef(false);
  const chartReadyRef = useRef(false);
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const configRef = useRef(config);
  configRef.current = config;

  const sendDisplay = useCallback(async () => {
    if (sendingRef.current || !hubRef.current) {
      pendingRef.current = true;
      return;
    }
    sendingRef.current = true;
    pendingRef.current = false;

    try {
      const hub = hubRef.current;
      const snapshot = configRef.current.getSnapshot();
      const nav = navRef.current;
      const data = configRef.current.toDisplayData(snapshot, nav);

      // Set up chart layout if not done yet
      if (!chartReadyRef.current) {
        const actionText = extractActionText(data);
        dbg.info(`Setting up chart layout (${TILES.length} tiles)`);
        await hub.showChartPage(actionText);
        chartReadyRef.current = true;
        dbg.info('Chart layout ready');
      } else {
        // Update action text below the images
        const actionText = extractActionText(data);
        await hub.updateChartText(actionText);
      }

      // Render Hebrew text to 3 tile images and send each
      try {
        const tiles = await renderHebrewTiles(data);
        let totalBytes = 0;
        for (const tile of tiles) {
          totalBytes += tile.bytes.length;
          await hub.sendImage(tile.id, tile.name, tile.bytes);
        }
        dbg.info(`IMG: ${totalBytes}B (${tiles.length} tiles)`);
      } catch (imgErr) {
        dbg.error(`IMG FAIL: ${imgErr instanceof Error ? imgErr.message : String(imgErr)}`);
      }
    } catch (err) {
      dbg.warn(`Display failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      sendingRef.current = false;
      if (pendingRef.current) {
        pendingRef.current = false;
        sendDisplay();
      }
    }
  }, []);

  const flushDisplay = useCallback(() => {
    sendDisplay();
  }, [sendDisplay]);

  const handleAction = useCallback((action: GlassAction) => {
    const snapshot = configRef.current.getSnapshot();
    const newNav = configRef.current.onGlassAction(action, navRef.current, snapshot);
    navRef.current = newNav;
    flushDisplay();
  }, [flushDisplay]);

  useEffect(() => {
    const newScreen = configRef.current.deriveScreen(location.pathname);
    if (newScreen !== navRef.current.screen) {
      navRef.current = { highlightedIndex: 0, screen: newScreen };
      flushDisplay();
    }
  }, [location.pathname, flushDisplay]);

  useEffect(() => {
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let disposed = false;

    const hub = new EvenHubBridge();
    hubRef.current = hub;

    navRef.current = {
      highlightedIndex: 0,
      screen: configRef.current.deriveScreen(location.pathname),
    };

    async function initBridge() {
      dbg.info('initBridge: starting (chart image mode)');
      try {
        await hub.init();
        dbg.info('initBridge: bridge ready');
        (window as any).__evenBridge = hub;
        if (disposed) return;

        // Set up chart layout with 3 standard image tiles
        await hub.showChartPage('');
        chartReadyRef.current = true;
        if (disposed) return;

        hub.onEvent((event: any) => {
          const action = mapGlassEvent(event);
          if (action) handleAction(action);
        });

        dbg.info('initBridge: chart layout ready');
      } catch (err) {
        dbg.warn('Bridge init failed: ' + (err instanceof Error ? err.message : String(err)));
      }

      if (!disposed) {
        flushDisplay();
        pollTimer = setInterval(() => {
          const snapshot = configRef.current.getSnapshot();
          if (snapshot !== lastSnapshotRef.current) {
            lastSnapshotRef.current = snapshot;
            flushDisplay();
          }
        }, 150);
      }
    }

    initBridge();

    const unbindKeyboard = bindKeyboard(handleAction);
    activateKeepAlive(`${configRef.current.appName}_keep_alive`);

    return () => {
      disposed = true;
      if (pollTimer) clearInterval(pollTimer);
      unbindKeyboard();
      hub.dispose();
      hubRef.current = null;
      (window as any).__evenBridge = null;
      deactivateKeepAlive();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
