export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { bootstrapRtxIfEmbedded } = await import("./lib/rtx/bootstrap");
    await bootstrapRtxIfEmbedded();
  }
}
