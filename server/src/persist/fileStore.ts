import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

export async function readTextFileIfExists(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
}

export async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  const temporaryFile = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`
  )

  try {
    await fs.writeFile(temporaryFile, `${JSON.stringify(data)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    })
    await fs.rename(temporaryFile, file)
  } catch (error) {
    await fs.unlink(temporaryFile).catch(() => undefined)
    throw error
  }
}

export function createMutationQueue() {
  let tail: Promise<void> = Promise.resolve()

  return function enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(operation)
    tail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
}
