import { StubPlatformAdapter } from "@/lib/platforms/stub-adapter";

export class ThreadsPlatformAdapter extends StubPlatformAdapter {
  constructor() {
    super("threads");
  }
}
