import { Buffer } from 'buffer'
import process from 'process/browser.js'

const globalScope = globalThis as unknown as Record<string, unknown>

globalScope.global ??= globalThis
globalScope.Buffer ??= Buffer
globalScope.process ??= process
