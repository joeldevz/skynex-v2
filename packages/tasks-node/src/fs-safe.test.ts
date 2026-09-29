import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import * as fsSafe from "./fs-safe.js";

test("readFileSafe stops after maximum plus one byte when a file grows", async () => {
  const maximum = 5;
  const contents = Buffer.from("a substantially larger file than the permitted read");
  let offset = 0;
  let consumed = 0;
  let openCalls = 0;
  const fakeHandle = {
    async stat() {
      // The file was empty when checked; content arrives/grows during the read.
      return { isFile: () => true, size: 0 };
    },
    async read(buffer: Buffer, bufferOffset: number, length: number) {
      const bytesRead = Math.min(length, contents.length - offset);
      contents.copy(buffer, bufferOffset, offset, offset + bytesRead);
      offset += bytesRead;
      consumed += bytesRead;
      return { bytesRead, buffer };
    },
    async readFile() {
      // A fully-draining implementation must be detected even though it reports
      // FILE_TOO_LARGE after reading the data.
      consumed += contents.length - offset;
      offset = contents.length;
      return contents;
    },
    async close() {},
  };

  const directory = await mkdtemp(join(tmpdir(), "tasks-node-fs-safe-"));
  const path = join(directory, "growing-file");
  try {
    await writeFile(path, "x");
    const readFileSafe = fsSafe.readFileSafe as unknown as (
      path: string,
      maximum: number,
      openFile: () => Promise<typeof fakeHandle>,
    ) => Promise<string | undefined>;
    await assert.rejects(
      readFileSafe(path, maximum, async () => {
        openCalls += 1;
        return fakeHandle;
      }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "FILE_TOO_LARGE");
        return true;
      },
    );
    assert.equal(openCalls, 1, "readFileSafe must use the controlled open dependency");
    assert(consumed <= maximum + 1, `consumed ${consumed} bytes for a ${maximum}-byte limit`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
