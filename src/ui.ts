/**
 * Glasses UI state manager.
 *
 * The Even G2 display is tiny (576×136 px) — keep every message terse.
 * Layout:
 *   - Text container (ID 1): status line and transcription result
 *   - List container (ID 2): action buttons (only when actions are available)
 *
 * containerStyle 1 = full-width, single column (assumed default).
 */

import type { EvenAppBridge } from '@evenrealities/even_hub_sdk';
import { MAX_RECORDING_SECONDS } from './audio';

export type AppState = 'idle' | 'recording' | 'processing' | 'result' | 'error';

interface ListItem {
  itemIndex: number;
  itemText: string;
}

interface ListContainer {
  containerID: number;
  containerStyle: number;
  itemList: ListItem[];
  isEventCapture: 0 | 1;
}

interface TextContainer {
  containerID: number;
  containerStyle: number;
  text: string;
  isEventCapture: 0 | 1;
}

interface PageConfig {
  containerTotalNum: number;
  listObject: ListContainer[];
  textObject: TextContainer[];
}

// Action labels
const ACTIONS = {
  record:      'הקלט',
  stop:        'עצור',
  recordAgain: 'הקלט שוב',
  clear:       'נקה',
} as const;

function buildPage(text: string, actions: string[]): PageConfig {
  const textContainer: TextContainer = {
    containerID: 1,
    containerStyle: 1,
    text,
    isEventCapture: 0,
  };

  if (actions.length === 0) {
    return { containerTotalNum: 1, listObject: [], textObject: [textContainer] };
  }

  const listContainer: ListContainer = {
    containerID: 2,
    containerStyle: 1,
    itemList: actions.map((itemText, itemIndex) => ({ itemIndex, itemText })),
    isEventCapture: 1,
  };

  return {
    containerTotalNum: 2,
    listObject: [listContainer],
    textObject: [textContainer],
  };
}

export class GlassesUI {
  private state: AppState = 'idle';
  private resultText = '';
  private errorText = '';
  private recordingSeconds = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private initialized = false;

  constructor(private readonly bridge: EvenAppBridge) {}

  // ---------------------------------------------------------------------------
  // Public state transitions
  // ---------------------------------------------------------------------------

  async init(): Promise<void> {
    const page = buildPage('מוכן להקלטה', [ACTIONS.record]);
    await this.bridge.createStartUpPageContainer(page as Parameters<EvenAppBridge['createStartUpPageContainer']>[0]);
    this.initialized = true;
  }

  async setRecording(): Promise<void> {
    this.state = 'recording';
    this.recordingSeconds = 0;
    this.startTimer();
    await this.render();
  }

  async setProcessing(): Promise<void> {
    this.stopTimer();
    this.state = 'processing';
    await this.render();
  }

  async setResult(text: string): Promise<void> {
    this.resultText = text || 'לא זוהה טקסט';
    this.state = 'result';
    await this.render();
  }

  async setError(message: string): Promise<void> {
    this.stopTimer();
    this.errorText = message;
    this.state = 'error';
    await this.render();
  }

  async setIdle(): Promise<void> {
    this.stopTimer();
    this.resultText = '';
    this.errorText = '';
    this.state = 'idle';
    await this.render();
  }

  getState(): AppState {
    return this.state;
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  private async render(): Promise<void> {
    if (!this.initialized) return;
    const page = this.buildCurrentPage();
    await this.bridge.rebuildPageContainer(page as Parameters<EvenAppBridge['rebuildPageContainer']>[0]);
  }

  private buildCurrentPage(): PageConfig {
    switch (this.state) {
      case 'idle':
        return buildPage('מוכן להקלטה', [ACTIONS.record]);

      case 'recording': {
        const remaining = MAX_RECORDING_SECONDS - this.recordingSeconds;
        const text = `מקליט... ${this.recordingSeconds}ש׳ (נותרו ${remaining}ש׳)`;
        return buildPage(text, [ACTIONS.stop]);
      }

      case 'processing':
        return buildPage('מעבד... אנא המתן', []);

      case 'result':
        return buildPage(this.resultText, [ACTIONS.recordAgain, ACTIONS.clear]);

      case 'error':
        return buildPage(`⚠ ${this.errorText}`, [ACTIONS.record, ACTIONS.clear]);
    }
  }

  // ---------------------------------------------------------------------------
  // Timer (updates "recording" display every second)
  // ---------------------------------------------------------------------------

  private startTimer(): void {
    this.stopTimer();
    this.timer = setInterval(() => {
      this.recordingSeconds++;
      void this.render();
    }, 1_000);
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
