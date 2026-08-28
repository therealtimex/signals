import { createConnection } from "node:net";

export type SmtpProbeResult = {
  outcome: "accepted" | "rejected" | "inconclusive";
  code?: number;
  detail?: string;
};

export type SmtpProbeProvider = (
  address: string,
  mxRecords: { exchange: string; priority: number }[],
) => Promise<SmtpProbeResult>;

export type SmtpProbeSocket = {
  setEncoding(encoding: BufferEncoding): void;
  setTimeout(timeout: number): void;
  write(data: string): unknown;
  end(data?: string): unknown;
  on(event: "data", listener: (chunk: string | Buffer) => void): SmtpProbeSocket;
  on(event: "error", listener: (error: Error) => void): SmtpProbeSocket;
  on(event: "timeout" | "end" | "close", listener: () => void): SmtpProbeSocket;
};

export type SmtpConnector = (options: { host: string; port: number }) => SmtpProbeSocket;

function recipientResult(code: number, detail: string): SmtpProbeResult {
  if (code === 250 || code === 251) return { outcome: "accepted", code, detail };
  if (code >= 500 && code < 600) return { outcome: "rejected", code, detail };
  return { outcome: "inconclusive", code, detail };
}

function policyFailure(code: number, detail: string): SmtpProbeResult {
  return { outcome: "inconclusive", code, detail };
}

/**
 * Minimal SMTP RCPT probe. It never sends DATA and therefore never sends mail.
 * Only a recipient-specific RCPT rejection is allowed to invalidate an address.
 */
export function createSmtpRcptProbe(
  connect: SmtpConnector = (options) => createConnection(options) as unknown as SmtpProbeSocket,
): SmtpProbeProvider {
  return async (address, mxRecords) => {
    const host = [...mxRecords].sort((a, b) => a.priority - b.priority)[0]?.exchange;
    if (!host) return { outcome: "inconclusive", detail: "No MX host is available." };

    return new Promise((resolve) => {
      const socket = connect({ host, port: 25 });
      socket.setEncoding("utf8");
      socket.setTimeout(8_000);
      let buffer = "";
      let settled = false;
      let phase: "greeting" | "ehlo" | "mail" | "rcpt" = "greeting";

      const finish = (result: SmtpProbeResult) => {
        if (settled) return;
        settled = true;
        socket.end("QUIT\r\n");
        resolve(result);
      };

      const earlyClose = () => finish({
        outcome: "inconclusive",
        detail: buffer.trim()
          ? `SMTP connection closed with an incomplete response: ${buffer.trim()}`
          : `SMTP connection closed during ${phase}.`,
      });

      socket.on("timeout", () => finish({ outcome: "inconclusive", detail: "SMTP connection timed out." }));
      socket.on("error", (error) => finish({ outcome: "inconclusive", detail: error.message }));
      socket.on("end", earlyClose);
      socket.on("close", earlyClose);
      socket.on("data", (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const match = /^(\d{3})([ -])(.*)$/.exec(line);
          if (!match || match[2] === "-") continue;
          const code = Number(match[1]);
          if (phase === "greeting") {
            if (code !== 220) return finish(policyFailure(code, line));
            socket.write("EHLO signals.local\r\n");
            phase = "ehlo";
          } else if (phase === "ehlo") {
            if (code < 200 || code >= 300) return finish(policyFailure(code, line));
            socket.write("MAIL FROM:<>\r\n");
            phase = "mail";
          } else if (phase === "mail") {
            if (code < 200 || code >= 300) return finish(policyFailure(code, line));
            socket.write(`RCPT TO:<${address}>\r\n`);
            phase = "rcpt";
          } else {
            return finish(recipientResult(code, line));
          }
        }
      });
    });
  };
}

export const smtpRcptProbe = createSmtpRcptProbe();
