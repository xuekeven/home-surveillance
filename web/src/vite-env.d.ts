/// <reference types="vite/client" />

declare module 'process/browser.js' {
  interface BrowserProcess {
    env: Record<string, string | undefined>
    nextTick(callback: (...args: unknown[]) => void, ...args: unknown[]): void
  }

  const process: BrowserProcess
  export default process
}
