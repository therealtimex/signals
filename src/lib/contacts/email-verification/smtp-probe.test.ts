import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSmtpRcptProbe, smtpRcptProbe, type SmtpProbeSocket } from "./smtp-probe";

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

describe("SMTP RCPT provider on a Dev instance (ADR-541-5)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses before the connector can open a socket", async () => {
    vi.stubEnv("SIGNALS_INSTANCE", "dev");
    const connect = vi.fn(() => new FakeSocket() as unknown as SmtpProbeSocket);
    const probe = createSmtpRcptProbe(connect);

    await expect(
      probe("person@example.com", [{ exchange: "mx.example.com", priority: 10 }]),
    ).rejects.toMatchObject({ code: "DEV_INSTANCE_GUARD", effect: "email.smtp-probe" });
    expect(connect).not.toHaveBeenCalled();
  });

  it("refuses through the default net connector too", async () => {
    vi.stubEnv("SIGNALS_INSTANCE", "dev");
    // 192.0.2.0/24 is TEST-NET-1: even a regressed guard could not reach a real mail server.
    await expect(
      smtpRcptProbe("person@example.com", [{ exchange: "192.0.2.1", priority: 10 }]),
    ).rejects.toMatchObject({ code: "DEV_INSTANCE_GUARD" });
  });

  it("connects unchanged on a canonical instance", async () => {
    const socket = new FakeSocket();
    const connect = vi.fn(() => socket as unknown as SmtpProbeSocket);
    const result = createSmtpRcptProbe(connect)("person@example.com", [
      { exchange: "mx.example.com", priority: 10 },
    ]);
    expect(connect).toHaveBeenCalledWith({ host: "mx.example.com", port: 25 });
    socket.emit("data", "554 connection policy\r\n");
    await expect(result).resolves.toMatchObject({ outcome: "inconclusive" });
  });
});
