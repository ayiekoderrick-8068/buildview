import type { BuildViewTestHook } from '../../apps/web/src/debug.ts';

declare global {
  interface Window {
    __BUILDVIEW__?: BuildViewTestHook;
  }
}
