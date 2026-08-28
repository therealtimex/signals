import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { createSmtpRcptProbe, type SmtpProbeSocket } from "./smtp-probe";

class FakeSocket extends EventEmitter {
  writes: string[] = [];
  timeout: number | null = null;

  setEncoding() {}
  setTimeout(timeout: number) { this.timeout = timeout; }
  write(data: string) { this.writes.push(data); }
  end(data?: string) { if (data) this.writes.push(data); }
}

function setup() {
  const socket = new FakeSocket();
  const probe = createSmtpRcptProbe(() => socket as unknown as SmtpProbeSocket);
  const result = probe("person@example.com", [{ exchange: "mx.example.com", priority: 10 }]);
  return { socket, result };
}

function reachRcpt(socket: FakeSocket) {
  socket.emit("data", "220 mx ready\r\n");
  socket.emit("data", "250 hello\r\n");
  socket.emit("data", "250 sender ok\r\n");
}

describe("SMTP RCPT provider", () => {
  it("keeps greeting rejection inconclusive", async () => {
    const { socket, result } = setup();
    socket.emit("data", "554 connection policy\r\n");
    await expect(result).resolves.toMatchObject({ outcome: "inconclusive", code: 554 });
  });

  it("keeps EHLO rejection inconclusive", async () => {
    const { socket, result } = setup();
    socket.emit("data", "220 mx ready\r\n");
    socket.emit("data", "550 invalid hello policy\r\n");
    await expect(result).resolves.toMatchObject({ outcome: "inconclusive", code: 550 });
  });

  it("keeps MAIL-FROM rejection inconclusive", async () => {
    const { socket, result } = setup();
    socket.emit("data", "220 mx ready\r\n");
    socket.emit("data", "250 hello\r\n");
    socket.emit("data", "550 null sender denied\r\n");
    await expect(result).resolves.toMatchObject({ outcome: "inconclusive", code: 550 });
  });

  it("rejects only after a recipient-specific RCPT response", async () => {
    const { socket, result } = setup();
    reachRcpt(socket);
    socket.emit("data", "550 mailbox unavailable\r\n");
    await expect(result).resolves.toMatchObject({ outcome: "rejected", code: 550 });
    expect(socket.writes).toContain("RCPT TO:<person@example.com>\r\n");
  });

  it("settles a silent close as inconclusive", async () => {
    const { socket, result } = setup();
    socket.emit("close");
    await expect(result).resolves.toMatchObject({ outcome: "inconclusive", detail: "SMTP connection closed during greeting." });
  });

  it("settles a partial unterminated response as inconclusive", async () => {
    const { socket, result } = setup();
    socket.emit("data", "220 partial");
    socket.emit("end");
    const outcome = await result;
    expect(outcome).toMatchObject({ outcome: "inconclusive" });
    expect(outcome.detail).toContain("220 partial");
  });

  it("settles timeout as inconclusive", async () => {
    const { socket, result } = setup();
    socket.emit("timeout");
    await expect(result).resolves.toMatchObject({ outcome: "inconclusive", detail: "SMTP connection timed out." });
    expect(socket.timeout).toBe(8_000);
  });

  it("settles socket errors as inconclusive", async () => {
    const { socket, result } = setup();
    socket.emit("error", new Error("connection reset"));
    await expect(result).resolves.toMatchObject({ outcome: "inconclusive", detail: "connection reset" });
  });
});
