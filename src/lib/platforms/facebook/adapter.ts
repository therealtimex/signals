import { StubPlatformAdapter } from "@/lib/platforms/stub-adapter";

export class FacebookPlatformAdapter extends StubPlatformAdapter {
  constructor() {
    super("facebook");
  }
}
