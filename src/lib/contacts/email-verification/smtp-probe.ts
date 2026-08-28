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

function classify(code: number, detail: string): SmtpProbeResult {
  if (code === 250 || code === 251) return { outcome: "accepted", code, detail };
  if (code >= 500 && code < 600) return { outcome: "rejected", code, detail };
  return { outcome: "inconclusive", code, detail };
}

/**
 * Minimal SMTP RCPT probe. It never sends DATA and therefore never sends mail.
 * Callers must keep this behind the explicit smtpProbeEnabled setting.
 */
export const smtpRcptProbe: SmtpProbeProvider = async (address, mxRecords) => {
  const host = [...mxRecords].sort((a, b) => a.priority - b.priority)[0]?.exchange;
  if (!host) return { outcome: "inconclusive", detail: "No MX host is available." };

  return new Promise((resolve) => {
    const socket = createConnection({ host, port: 25 });
    socket.setEncoding("utf8");
    socket.setTimeout(8_000);
    let buffer = "";
    let settled = false;
    const commands = ["EHLO signals.local", "MAIL FROM:<>", `RCPT TO:<${address}>`];
    let step = 0;

    const finish = (result: SmtpProbeResult) => {
      if (settled) return;
      settled = true;
      socket.end("QUIT\r\n");
      resolve(result);
    };

    socket.on("timeout", () => finish({ outcome: "inconclusive", detail: "SMTP connection timed out." }));
    socket.on("error", (error) => finish({ outcome: "inconclusive", detail: error.message }));
    socket.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const match = /^(\d{3})([ -])(.*)$/.exec(line);
        if (!match || match[2] === "-") continue;
        const code = Number(match[1]);
        if (step === 0 && code !== 220) return finish(classify(code, line));
        if (step < commands.length) {
          if (step > 0 && code >= 400) return finish(classify(code, line));
          socket.write(`${commands[step]}\r\n`);
          step++;
          continue;
        }
        return finish(classify(code, line));
      }
    });
  });
};
