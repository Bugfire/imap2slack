import { sleep } from "../sleep";

describe("sleep", () => {
  it("1秒sleep", async () => {
    const startTime = new Date().getTime();
    await sleep(1000);
    const endTime = new Date().getTime();
    expect(endTime - startTime).toBeGreaterThan(999);
  });
});
