import {
  getDefaultMailAccount,
  listHimalayaMailAccounts,
} from "@/lib/db/queries/mail-accounts";
import { getHimalayaConfigPath } from "@/lib/mail/himalaya";
import type { listMailAccountsSchema } from "@/lib/agent-tools/schemas";
import type { z } from "zod";

export async function handleListMailAccounts(
  _input: z.infer<typeof listMailAccountsSchema>
) {
  const accounts = listHimalayaMailAccounts();
  const defaultAccount = getDefaultMailAccount();

  return {
    accounts: accounts.map((account) => ({
      alias: account.alias,
      email: account.email,
      status: account.status,
      isDefault: account.isDefault,
    })),
    defaultAlias: defaultAccount?.alias ?? null,
    configPath: getHimalayaConfigPath(),
    contract:
      "Mail read/send uses Himalaya CLI only: `himalaya -a <alias> --output json ...`. Pass optional account alias; default from workspace setting when omitted.",
  };
}
